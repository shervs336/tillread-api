import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export { verifyWebhook } from "./verify";
export type { components, paths };
export type Transaction = components["schemas"]["Transaction"];
export type Job = components["schemas"]["Job"];
export type ParseResult = components["schemas"]["ParseResult"];
export type Problem = components["schemas"]["Problem"];

/** Thrown for any non-2xx response, with the API's problem document attached. */
export class TillreadError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(`${problem.title}${problem.detail ? `: ${problem.detail}` : ""} (${problem.code}, ${problem.request_id})`);
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * A small typed client. Every method's inputs and outputs come from the OpenAPI spec.
 *
 * ```ts
 * const tillread = createTillread({ apiKey: process.env.TILLREAD_KEY! });
 * const { transactions } = await tillread.parse(await file.arrayBuffer());
 * const job = await tillread.createJob(bytes, { idempotencyKey: "jan-statement" });
 * const done = await tillread.waitForJob(job.id);
 * ```
 */
export function createTillread({ apiKey, baseUrl = "https://tillread-api.vercel.app", fetch: f }: ClientOptions) {
  const client = createClient<paths>({ baseUrl, headers: { Authorization: `Bearer ${apiKey}` }, fetch: f });
  const unwrap = <T>(r: { data?: T; error?: unknown; response: Response }): T => {
    if (r.error !== undefined || !r.response.ok) throw new TillreadError(r.response.status, r.error as Problem);
    return r.data as T;
  };
  type Options = NonNullable<paths["/v1/parse"]["post"]["parameters"]["query"]>;
  const raw = (body: BodyInit) => ({ body: body as never, bodySerializer: (b: unknown) => b as BodyInit, headers: { "Content-Type": "application/octet-stream" } });

  return {
    /** Parse a file (up to 1 MB) and get the transactions now. */
    parse: async (file: ArrayBuffer | Uint8Array | Blob | string, options: Options = {}) =>
      unwrap(await client.POST("/v1/parse", { params: { query: options }, ...raw(file as BodyInit) })),

    /** Queue a file (up to 4 MB). Pass an idempotency key so a retry can't create a second job. */
    createJob: async (file: ArrayBuffer | Uint8Array | Blob | string, { idempotencyKey, filename, ...options }: Options & { idempotencyKey?: string; filename?: string } = {}) =>
      unwrap(
        await client.POST("/v1/jobs", {
          params: { query: { ...options, filename }, header: { "idempotency-key": idempotencyKey } },
          ...raw(file as BodyInit),
        }),
      ),

    getJob: async (id: string) => unwrap(await client.GET("/v1/jobs/{id}", { params: { path: { id } } })),
    getJobResult: async (id: string) => unwrap(await client.GET("/v1/jobs/{id}/result", { params: { path: { id } } })),
    listJobs: async (query: { limit?: number; starting_after?: string } = {}) => unwrap(await client.GET("/v1/jobs", { params: { query } })),

    /** Polls until the job finishes (prefer webhooks in production). */
    async waitForJob(id: string, { intervalMs = 1000, timeoutMs = 60_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const job = unwrap(await client.GET("/v1/jobs/{id}", { params: { path: { id } } }));
        if (job.status === "succeeded" || job.status === "failed") return job;
        if (Date.now() > deadline) throw new Error(`Job ${id} still ${job.status} after ${timeoutMs} ms`);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },

    usage: async () => unwrap(await client.GET("/v1/usage")),
    webhookEndpoints: {
      list: async () => unwrap(await client.GET("/v1/webhook-endpoints")),
      create: async (body: components["schemas"]["CreateWebhookEndpoint"]) => unwrap(await client.POST("/v1/webhook-endpoints", { body })),
      delete: async (id: string) => {
        const r = await client.DELETE("/v1/webhook-endpoints/{id}", { params: { path: { id } } });
        if (!r.response.ok) throw new TillreadError(r.response.status, r.error as Problem);
      },
    },
  };
}
