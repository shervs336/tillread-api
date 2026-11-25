import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppDeps } from "./app";
import type { Db } from "./db";
import { sweepJobs } from "./jobs";
import { createKey, revokeKey } from "./keys";
import { ApiError, hmac, randomId, safeEqual, sha256, type Limits } from "./util";
import { createEndpoint, deleteEndpoint, emit, redeliver, sweepDeliveries, verifySignature, type WebhookDeps } from "./webhooks";

const COOKIE = "tr_console";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type App = OpenAPIHono<any>;

/**
 * The console is the dashboard's private API. A visitor gets an anonymous console (no sign-up):
 * a signed, HttpOnly cookie holds its id. Mutations also need the X-Console header and a
 * same-origin Origin, so another site can't drive a visitor's console (CSRF).
 */
export function consoleRoutes(app: App, deps: AppDeps, limits: Limits) {
  const sign = (id: string) => `${id}.${hmac(deps.consoleSecret, `console:${id}`).slice(0, 32)}`;
  const read = (c: Context): string | null => {
    const v = getCookie(c, COOKIE);
    if (!v) return null;
    const [id, mac] = v.split(".");
    if (!id || !mac || !UUID.test(id)) return null;
    return safeEqual(sign(id), v) ? id : null;
  };
  const ipHash = (c: Context) =>
    sha256(`ip:${c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local"}:${deps.consoleSecret}`).slice(0, 32);

  async function session(c: Context, create: boolean): Promise<string> {
    const db: Db = c.get("db");
    const id = read(c);
    if (id) {
      const [row] = await db.query("select id from tillread.consoles where id = $1", [id]);
      if (row) return id;
    }
    if (!create) throw new ApiError(401, "no_console", "No console session", "Open the console page first.");
    const ip = ipHash(c);
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from tillread.consoles where ip_hash = $1 and created_at > now() - interval '1 day'", [ip])) as [{ n: number }];
    if (n >= limits.consolesPerIpPerDay) throw new ApiError(429, "too_many_consoles", "Too many consoles", "Try again tomorrow.");
    const [row] = await db.query<{ id: string }>("insert into tillread.consoles (ip_hash) values ($1) returning id", [ip]);
    setCookie(c, COOKIE, sign(row!.id), {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:",
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return row!.id;
  }

  const guard = (c: Context) => {
    if (c.req.header("X-Console") !== "1") throw new ApiError(403, "forbidden", "Forbidden");
    const origin = c.req.header("Origin");
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw new ApiError(403, "forbidden", "Forbidden", "Cross-site request.");
  };
  const wd = (c: Context): WebhookDeps => c.get("deps");

  app.post("/api/console/session", async (c) => {
    guard(c);
    return c.json({ console_id: await session(c, true) });
  });

  app.get("/api/console/overview", async (c) => {
    const id = await session(c, false);
    const db: Db = c.get("db");
    // The console polls while something is pending, which also moves retries along.
    const d = wd(c);
    deps.defer(async () => {
      await sweepJobs(d, 3);
      await sweepDeliveries(d, 10);
    });
    const [keys, usage, requests, jobs, endpoints, deliveries, inbox] = await Promise.all([
      db.query(
        "select id, name, prefix, created_at, last_used_at, revoked_at from tillread.api_keys where console_id = $1 order by created_at desc",
        [id],
      ),
      db.query(
        `select to_char(u.day, 'YYYY-MM-DD') as day, sum(u.requests)::int as requests, sum(u.rows_parsed)::int as rows_parsed, sum(u.jobs)::int as jobs
         from tillread.usage_daily u join tillread.api_keys k on k.id = u.key_id
         where k.console_id = $1 and u.day > (now() at time zone 'utc')::date - 14 group by u.day order by u.day`,
        [id],
      ),
      db.query(
        `select r.request_id, r.method, r.path, r.status, r.duration_ms, r.created_at, k.prefix
         from tillread.request_log r join tillread.api_keys k on k.id = r.key_id where k.console_id = $1 order by r.created_at desc limit 25`,
        [id],
      ),
      db.query(
        `select j.id, j.status, j.filename, j.bytes, j.summary, j.error, j.created_at, j.finished_at
         from tillread.jobs j join tillread.api_keys k on k.id = j.key_id where k.console_id = $1 order by j.created_at desc limit 10`,
        [id],
      ),
      db.query(
        "select id, url, events, description, created_at from tillread.webhook_endpoints where console_id = $1 and disabled_at is null order by created_at",
        [id],
      ),
      db.query(
        `select d.id, d.endpoint_id, d.event_type, d.status, d.attempts, d.next_attempt_at, d.last_status_code, d.last_error, d.created_at, d.delivered_at
         from tillread.webhook_deliveries d join tillread.webhook_endpoints e on e.id = d.endpoint_id where e.console_id = $1 order by d.created_at desc limit 20`,
        [id],
      ),
      db.query(
        `select i.token, i.fail_next, (select coalesce(json_agg(x order by x.created_at desc), '[]') from
           (select ev.id, ev.headers, ev.body, ev.signature_valid, ev.responded, ev.created_at from tillread.inbox_events ev where ev.token = i.token order by ev.created_at desc limit 10) x) as events
         from tillread.inboxes i where i.console_id = $1 order by i.created_at desc limit 1`,
        [id],
      ),
    ]);
    return c.json({
      console_id: id,
      limits: { requests_per_minute: limits.burst, requests_per_day: limits.dailyRequests, jobs_per_day: limits.dailyJobs },
      keys,
      usage,
      requests,
      jobs,
      endpoints,
      deliveries,
      inbox: inbox[0] ?? null,
    });
  });

  app.post("/api/console/keys", async (c) => {
    guard(c);
    const id = await session(c, false);
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    return c.json(await createKey(c.get("db"), id, String(body.name ?? ""), limits), 201);
  });

  app.delete("/api/console/keys/:id", async (c) => {
    guard(c);
    const id = await session(c, false);
    const keyId = c.req.param("id");
    if (!UUID.test(keyId)) throw new ApiError(404, "not_found", "Key not found");
    await revokeKey(c.get("db"), id, keyId);
    return c.body(null, 204);
  });

  app.post("/api/console/webhooks", async (c) => {
    guard(c);
    const id = await session(c, false);
    const body = (await c.req.json().catch(() => ({}))) as { url?: string; events?: string[] };
    return c.json(await createEndpoint(wd(c), id, { url: String(body.url ?? ""), events: body.events }), 201);
  });

  app.delete("/api/console/webhooks/:id", async (c) => {
    guard(c);
    await deleteEndpoint(c.get("db"), await session(c, false), c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/console/webhooks/:id/test", async (c) => {
    guard(c);
    const id = await session(c, false);
    const ids = await emit(c.get("db"), id, "ping", { message: "A test event from the Tillread console." }, c.req.param("id"));
    if (!ids.length) throw new ApiError(404, "not_found", "Webhook endpoint not found");
    await sweepDeliveries(wd(c));
    return c.json({ deliveries: ids });
  });

  app.post("/api/console/deliveries/:id/retry", async (c) => {
    guard(c);
    await redeliver(c.get("db"), await session(c, false), c.req.param("id"));
    await sweepDeliveries(wd(c));
    return c.json({ ok: true });
  });

  /** Creates a test inbox on this server and subscribes it, so webhooks can be tried without a server of your own. */
  app.post("/api/console/inbox", async (c) => {
    guard(c);
    const id = await session(c, false);
    const db: Db = c.get("db");
    const [existing] = await db.query<{ token: string }>("select token from tillread.inboxes where console_id = $1", [id]);
    if (existing) throw new ApiError(409, "inbox_exists", "You already have a test inbox");
    const token = `inbox_${randomId(24)}`;
    await db.query("insert into tillread.inboxes (token, console_id) values ($1, $2)", [token, id]);
    const origin = new URL(c.req.url).origin;
    const endpoint = await createEndpoint({ ...wd(c), allowInsecure: true }, id, { url: `${origin}/api/inbox/${token}`, events: ["job.succeeded", "job.failed"] });
    return c.json({ token, endpoint_id: endpoint.id }, 201);
  });

  /** Makes the test inbox answer 500 for the next n deliveries, to watch retries happen. */
  app.post("/api/console/inbox/flaky", async (c) => {
    guard(c);
    const id = await session(c, false);
    const body = (await c.req.json().catch(() => ({}))) as { fail?: number };
    const fail = Math.max(0, Math.min(5, Number(body.fail ?? 2) | 0));
    await c.get("db").query("update tillread.inboxes set fail_next = $2 where console_id = $1", [id, fail]);
    return c.json({ fail_next: fail });
  });

  /** The test inbox itself: records the request and checks its signature with the endpoint's secret. */
  app.post("/api/inbox/:token", async (c) => {
    const db: Db = c.get("db");
    const token = c.req.param("token");
    const body = await c.req.text();
    const [inbox] = await db.query<{ fail_next: number; secret: string }>(
      `select i.fail_next, e.secret from tillread.inboxes i
       join tillread.webhook_endpoints e on e.console_id = i.console_id and e.url like '%/api/inbox/' || i.token
       where i.token = $1 and e.disabled_at is null limit 1`,
      [token],
    );
    if (!inbox) return c.json({ error: "unknown inbox" }, 404);
    const respond = inbox.fail_next > 0 ? 500 : 200;
    if (respond === 500) await db.query("update tillread.inboxes set fail_next = fail_next - 1 where token = $1", [token]);
    const headers = Object.fromEntries(
      ["content-type", "user-agent", "tillread-event-id", "tillread-delivery-id", "tillread-signature"].map((h) => [h, c.req.header(h) ?? null]),
    );
    await db.query("insert into tillread.inbox_events (token, headers, body, signature_valid, responded) values ($1, $2::jsonb, $3, $4, $5)", [
      token,
      headers,
      body.slice(0, 20_000),
      verifySignature(inbox.secret, body, c.req.header("Tillread-Signature")),
      respond,
    ]);
    return c.json({ received: respond === 200 }, respond);
  });
}
