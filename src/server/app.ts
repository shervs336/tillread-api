import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { parse, type ParseOptions } from "tillread";
import { consoleRoutes } from "./console";
import type { Db } from "./db";
import { createJob, getJob, getJobResult, listJobs, publicJob, runJob, shapeResult, sweepJobs } from "./jobs";
import { authenticate, consume, rateHeaders, type KeyRow, type RateState } from "./keys";
import { DESCRIPTION } from "./openapi-description";
import * as S from "./schemas";
import { ApiError, DOCS_URL, LIMITS, randomId, type Limits } from "./util";
import { createEndpoint, deleteEndpoint, listEndpoints, sweepDeliveries, type WebhookDeps } from "./webhooks";

export interface AppDeps {
  db: () => Promise<Db>;
  /** Runs work after the response is sent (Next's `after`, or collected and awaited in tests). */
  defer: (task: () => Promise<unknown>) => void;
  limits?: Limits;
  fetch?: typeof fetch;
  allowInsecureWebhooks?: boolean;
  resolve?: (host: string) => Promise<string[]>;
  cronSecret?: string;
  consoleSecret: string;
  /** Log lines go here (stdout in production). */
  log?: (line: Record<string, unknown>) => void;
}

type Env = { Variables: { requestId: string; db: Db; key: KeyRow; rate: RateState; deps: WebhookDeps } };

export function createApp(deps: AppDeps) {
  const limits = deps.limits ?? LIMITS;
  const log = deps.log ?? ((l) => console.log(JSON.stringify(l)));
  const app = new OpenAPIHono<Env>({
    defaultHook: (result) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new ApiError(422, "validation_error", "Invalid request", issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : undefined);
      }
    },
  });
  let lastSweep = 0;

  // ---------- Middleware ----------
  app.use("*", async (c, next) => {
    const requestId = `req_${randomId(12)}`;
    c.set("requestId", requestId);
    const started = performance.now();
    await next();
    c.header("X-Request-Id", requestId);
    const ms = Math.round(performance.now() - started);
    const key = c.get("key") as KeyRow | undefined;
    log({ level: c.res.status >= 500 ? "error" : "info", request_id: requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms, key: key?.prefix });
    if (key && c.req.path.startsWith("/v1/")) {
      const db = c.get("db");
      deps.defer(() =>
        db.query("insert into tillread.request_log (request_id, key_id, method, path, status, duration_ms) values ($1, $2, $3, $4, $5, $6)", [
          requestId,
          key.id,
          c.req.method,
          c.req.path,
          c.res.status,
          ms,
        ]),
      );
    }
  });

  app.use("*", async (c, next) => {
    if (c.req.path === "/openapi.json") return next();
    const db = await deps.db();
    c.set("db", db);
    c.set("deps", { db, limits, fetch: deps.fetch ?? fetch, allowInsecure: !!deps.allowInsecureWebhooks, resolve: deps.resolve });
    await next();
  });

  app.use(
    "/v1/*",
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      exposeHeaders: ["RateLimit", "RateLimit-Policy", "Retry-After", "X-Request-Id", "Location", "Idempotent-Replayed"],
      maxAge: 86400,
    }),
  );

  app.use("/v1/*", async (c, next) => {
    if (c.req.path === "/v1/health" || c.req.method === "OPTIONS") return next();
    const db = c.get("db");
    const key = await authenticate(db, c.req.header("Authorization"));
    c.set("key", key);
    const rate = await consume(db, key.id, limits);
    c.set("rate", rate);
    await next();
    for (const [k, v] of Object.entries(rateHeaders(rate))) c.header(k, v);
    // Retries and stuck jobs move along with ordinary traffic, at most once a minute per instance.
    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      const d = c.get("deps");
      deps.defer(async () => {
        await sweepJobs(d);
        await sweepDeliveries(d);
      });
    }
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? `req_${randomId(12)}`;
    const e =
      err instanceof ApiError
        ? err
        : err instanceof HTTPException && err.status === 415
          ? new ApiError(415, "unsupported_media_type", "Unsupported content type", "Send the file as text/csv or application/octet-stream, or JSON with a csv field.")
          : err instanceof HTTPException && err.status < 500
            ? new ApiError(err.status, "bad_request", "Bad request", err.message)
            : new ApiError(500, "internal_error", "Something went wrong", "The error was logged. Retrying is safe; send the request id if it keeps happening.");
    if (!(err instanceof ApiError) && !(err instanceof HTTPException && err.status < 500)) log({ level: "error", request_id: requestId, error: String(err), stack: (err as Error).stack?.split("\n").slice(0, 4).join(" | ") });
    return c.json(
      { type: `${DOCS_URL}#errors-${e.code}`, title: e.title, status: e.status, detail: e.detail, code: e.code, request_id: requestId, ...e.extra },
      e.status as 400,
      { "Content-Type": "application/problem+json", "X-Request-Id": requestId, ...e.headers },
    );
  });

  app.notFound((c) => {
    throw new ApiError(404, "not_found", "Not found", `No route for ${c.req.method} ${c.req.path}.`);
  });

  // ---------- Shared pieces ----------
  const problems = {
    401: { description: "Missing, invalid or revoked API key", content: { "application/problem+json": { schema: S.Problem } } },
    422: { description: "The request was invalid", content: { "application/problem+json": { schema: S.Problem } } },
    429: { description: "Rate limit or daily quota reached", content: { "application/problem+json": { schema: S.Problem } } },
  } as const;
  const security = [{ bearerAuth: [] }];
  // required: false keeps the JSON validator from running on CSV bodies; readInput validates
  // every content type itself, and the published spec marks the body required (see spec()).
  const csvBody = {
    required: false,
    content: {
      "text/csv": { schema: z.string().openapi({ format: "binary", example: "Date,Description,Amount\n2026-01-02,Coffee,-4.50\n" }) },
      "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) },
      "application/json": { schema: S.ParseJsonBody },
    },
  };

  /** Reads the CSV from a raw body (any encoding) or from JSON, plus options from the query string. */
  async function readInput(c: Context<Env>, maxBytes: number): Promise<{ bytes: Uint8Array; options: ParseOptions }> {
    const declared = Number(c.req.header("Content-Length") ?? 0);
    if (declared > maxBytes) throw new ApiError(413, "payload_too_large", "File too large", `The limit here is ${maxBytes / 1024 / 1024} MB.`);
    const type = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    let bytes: Uint8Array;
    let query: Record<string, unknown> = c.req.query();
    if (type === "application/json") {
      const body = S.ParseJsonBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new ApiError(422, "validation_error", "Invalid request", "Send { \"csv\": \"…\", \"options\": { … } }.");
      bytes = new TextEncoder().encode(body.data.csv);
      query = { ...query, ...body.data.options };
    } else if (["text/csv", "text/plain", "application/octet-stream", "application/vnd.ms-excel", "text/tab-separated-values"].includes(type)) {
      bytes = new Uint8Array(await c.req.arrayBuffer());
    } else {
      throw new ApiError(415, "unsupported_media_type", "Unsupported content type", "Send the file as text/csv or application/octet-stream, or JSON with a csv field.");
    }
    if (bytes.byteLength > maxBytes) throw new ApiError(413, "payload_too_large", "File too large", `The limit here is ${maxBytes / 1024 / 1024} MB.`);
    if (bytes.byteLength === 0) throw new ApiError(422, "empty_file", "Empty file", "The request body was empty.");
    const q = S.ParseOptionsQuery.safeParse(query);
    if (!q.success) throw new ApiError(422, "validation_error", "Invalid option", q.error.issues[0]?.message);
    const options: ParseOptions = {};
    if (q.data.date_format) options.dateFormat = q.data.date_format;
    if (q.data.decimal) options.decimal = q.data.decimal;
    if (q.data.sign) options.sign = q.data.sign;
    if (q.data.delimiter) options.delimiter = q.data.delimiter === "tab" ? "\t" : q.data.delimiter;
    if (q.data.minor_units !== undefined) options.minorUnits = q.data.minor_units;
    return { bytes, options };
  }

  // ---------- Routes ----------
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/health",
      tags: ["Meta"],
      summary: "Health check",
      description: "No key needed. Checks the database too.",
      responses: { 200: { description: "OK", content: { "application/json": { schema: z.object({ status: z.literal("ok"), time: z.string() }) } } } },
    }),
    async (c) => {
      const [row] = await c.get("db").query<{ now: Date }>("select now()");
      return c.json({ status: "ok" as const, time: new Date(row!.now).toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/parse",
      tags: ["Parse"],
      summary: "Parse a CSV now",
      description: `Reads a bank CSV (up to ${limits.syncBytes / 1024 / 1024} MB) and returns the transactions. Send the raw file in any encoding, or JSON with a \`csv\` string. For bigger files, or to be notified by webhook, create a job instead.`,
      security,
      request: { body: csvBody, query: S.ParseOptionsQuery },
      responses: {
        200: { description: "Transactions, skipped rows and how the file was read", content: { "application/json": { schema: S.ParseResponse } } },
        413: { description: "File too large", content: { "application/problem+json": { schema: S.Problem } } },
        415: { description: "Unsupported content type", content: { "application/problem+json": { schema: S.Problem } } },
        ...problems,
      },
    }),
    async (c) => {
      const { bytes, options } = await readInput(c, limits.syncBytes);
      const shaped = shapeResult(parse(bytes, options));
      const key = c.get("key");
      deps.defer(() =>
        c.get("db").query("update tillread.usage_daily set rows_parsed = rows_parsed + $2 where key_id = $1 and day = (now() at time zone 'utc')::date", [key.id, shaped.summary.transactions]),
      );
      return c.json(shaped as unknown as z.infer<typeof S.ParseResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/jobs",
      tags: ["Jobs"],
      summary: "Create a parse job",
      description: `Queues a file (up to ${limits.jobBytes / 1024 / 1024} MB) and returns at once. Poll the job, or subscribe a webhook endpoint to \`job.succeeded\` and \`job.failed\`. Send an \`Idempotency-Key\` header so a retried request never creates a second job.`,
      security,
      request: {
        body: csvBody,
        query: S.ParseOptionsQuery.extend({ filename: z.string().max(200).optional() }),
        headers: z.object({ "idempotency-key": z.string().max(200).optional().openapi({ example: "import-2026-01-statement" }) }),
      },
      responses: {
        202: { description: "Queued", content: { "application/json": { schema: S.Job } } },
        200: { description: "Replayed: this Idempotency-Key was already used for the same request", content: { "application/json": { schema: S.Job } } },
        413: { description: "File too large", content: { "application/problem+json": { schema: S.Problem } } },
        ...problems,
      },
    }),
    async (c) => {
      const { bytes, options } = await readInput(c, limits.jobBytes);
      const idem = c.req.header("Idempotency-Key")?.trim() || null;
      const { job, replayed } = await createJob(c.get("db"), c.get("key").id, { bytes, options, filename: c.req.query("filename") ?? null, idempotencyKey: idem }, limits.dailyJobs);
      c.header("Location", `/v1/jobs/${job.id}`);
      if (replayed) {
        c.header("Idempotent-Replayed", "true");
        return c.json(publicJob(job), 200);
      }
      const d = c.get("deps");
      deps.defer(() => runJob(d, job.id));
      return c.json(publicJob(job), 202);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs",
      tags: ["Jobs"],
      summary: "List jobs",
      security,
      request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), starting_after: z.string().optional() }) },
      responses: { 200: { description: "Newest first", content: { "application/json": { schema: S.JobList } } }, ...problems },
    }),
    async (c) => {
      const { limit, starting_after } = c.req.valid("query");
      const rows = await listJobs(c.get("db"), c.get("key").id, limit + 1, starting_after);
      return c.json({ object: "list" as const, data: rows.slice(0, limit).map(publicJob), has_more: rows.length > limit }, 200);
    },
  );

  const jobId = z.object({ id: z.string().regex(/^job_[0-9A-Za-z]{20}$/).openapi({ param: { name: "id", in: "path" }, example: "job_3kTq9VwZp2Lx8NcR4bYe" }) });

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs/{id}",
      tags: ["Jobs"],
      summary: "Get a job",
      security,
      request: { params: jobId },
      responses: {
        200: { description: "The job, with a summary once it has succeeded", content: { "application/json": { schema: S.Job } } },
        404: { description: "No such job for this key", content: { "application/problem+json": { schema: S.Problem } } },
        ...problems,
      },
    }),
    async (c) => c.json(publicJob(await getJob(c.get("db"), c.get("key").id, c.req.valid("param").id)), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs/{id}/result",
      tags: ["Jobs"],
      summary: "Get a job's transactions",
      security,
      request: { params: jobId },
      responses: {
        200: { description: "Same shape as POST /v1/parse", content: { "application/json": { schema: S.ParseResponse } } },
        404: { description: "No such job for this key", content: { "application/problem+json": { schema: S.Problem } } },
        409: { description: "The job hasn't succeeded", content: { "application/problem+json": { schema: S.Problem } } },
        ...problems,
      },
    }),
    async (c) => c.json(await getJobResult(c.get("db"), c.get("key").id, c.req.valid("param").id), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/usage",
      tags: ["Account"],
      summary: "Usage for this key",
      description: "Requests, rows parsed and jobs per UTC day for the last 30 days, and the limits that apply.",
      security,
      responses: { 200: { description: "Usage", content: { "application/json": { schema: S.Usage } } }, ...problems },
    }),
    async (c) => {
      const key = c.get("key");
      const days = await c.get("db").query<{ day: string; requests: number; rows_parsed: number; jobs: number }>(
        "select to_char(day, 'YYYY-MM-DD') as day, requests, rows_parsed, jobs from tillread.usage_daily where key_id = $1 and day > (now() at time zone 'utc')::date - 30 order by day",
        [key.id],
      );
      return c.json(
        {
          key: { id: key.id, name: key.name, prefix: key.prefix },
          limits: { requests_per_minute: limits.burst, requests_per_day: limits.dailyRequests, jobs_per_day: limits.dailyJobs },
          days,
        },
        200,
      );
    },
  );

  const endpointOut = (e: { id: string; url: string; events: string[]; description: string | null; created_at: Date; secret?: string }) => ({
    ...e,
    created_at: new Date(e.created_at).toISOString(),
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/webhook-endpoints",
      tags: ["Webhooks"],
      summary: "List webhook endpoints",
      security,
      responses: { 200: { description: "Endpoints", content: { "application/json": { schema: z.object({ object: z.literal("list"), data: z.array(S.WebhookEndpoint) }) } } }, ...problems },
    }),
    async (c) => c.json({ object: "list" as const, data: (await listEndpoints(c.get("db"), c.get("key").console_id)).map(endpointOut) }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/webhook-endpoints",
      tags: ["Webhooks"],
      summary: "Create a webhook endpoint",
      description: "The URL must be public HTTPS. The response includes the signing `secret`, shown only this once.",
      security,
      request: { body: { required: true, content: { "application/json": { schema: S.CreateWebhookEndpoint } } } },
      responses: { 201: { description: "Created", content: { "application/json": { schema: S.WebhookEndpoint } } }, ...problems },
    }),
    async (c) => c.json(endpointOut(await createEndpoint(c.get("deps"), c.get("key").console_id, c.req.valid("json"))), 201),
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/webhook-endpoints/{id}",
      tags: ["Webhooks"],
      summary: "Delete a webhook endpoint",
      security,
      request: { params: z.object({ id: z.string().regex(/^we_[0-9A-Za-z]{20}$/).openapi({ param: { name: "id", in: "path" } }) }) },
      responses: {
        204: { description: "Deleted" },
        404: { description: "Not found", content: { "application/problem+json": { schema: S.Problem } } },
        ...problems,
      },
    }),
    async (c) => {
      await deleteEndpoint(c.get("db"), c.get("key").console_id, c.req.valid("param").id);
      return c.body(null, 204);
    },
  );

  // ---------- OpenAPI ----------
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "An API key from the console: `Authorization: Bearer tr_live_…`",
  });
  const spec = () => {
    const doc = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Tillread API", version: "1.0.0", description: DESCRIPTION, license: { name: "MIT", url: "https://opensource.org/license/mit" } },
      servers: [{ url: "https://tillread-api.vercel.app", description: "Production" }],
      tags: [
        { name: "Parse", description: "Read a file and get the transactions back in the same request." },
        { name: "Jobs", description: "Queue bigger files and get them back by polling or webhook." },
        { name: "Webhooks", description: "Be told when a job finishes." },
        { name: "Account", description: "Usage and limits." },
        { name: "Meta" },
      ],
    });
    for (const path of ["/v1/parse", "/v1/jobs"]) {
      const body = doc.paths?.[path]?.post?.requestBody;
      if (body && "content" in body) body.required = true;
    }
    return doc;
  };
  app.get("/openapi.json", (c) => c.json(spec()));

  // ---------- Cron: due jobs and webhook retries ----------
  app.get("/api/cron/tick", async (c) => {
    if (!deps.cronSecret || c.req.header("Authorization") !== `Bearer ${deps.cronSecret}`) throw new ApiError(404, "not_found", "Not found");
    const d = c.get("deps");
    const jobs = await sweepJobs(d);
    const deliveries = await sweepDeliveries(d, 100);
    // Keep the request log small: the newest 500 rows per key.
    await d.db.query(
      "delete from tillread.request_log r using (select id, row_number() over (partition by key_id order by created_at desc) as n from tillread.request_log) old where r.id = old.id and old.n > 500",
    );
    return c.json({ jobs, ...deliveries });
  });

  consoleRoutes(app, deps, limits);
  return Object.assign(app, { spec });
}
