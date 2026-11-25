import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { createPglite, type Db } from "../src/server/db";
import { LIMITS } from "../src/server/util";
import { assertPublicUrl, isPrivateAddress, signPayload, verifySignature } from "../src/server/webhooks";
import { verifyWebhook } from "../packages/api-client/src/verify";

const CSV = "Date,Description,Amount\n2026-01-02,Blue Bottle Coffee,-4.50\n2026-01-03,Payroll,2500.00\n2026-01-04,Totals,\n";
const ORIGIN = "http://test.local";

let db: Db;
let pending: Promise<unknown>[] = [];
const limits = { ...LIMITS, burst: 5, refillPerSecond: 0.001, dailyRequests: 50, dailyJobs: 3, retrySchedule: [30, 120] };
const logs: Record<string, unknown>[] = [];
const app = createApp({
  db: async () => db,
  defer: (task) => {
    pending.push(task());
  },
  limits,
  allowInsecureWebhooks: true,
  consoleSecret: "test-secret",
  cronSecret: "cron-secret",
  log: (l) => logs.push(l),
});
const settle = async () => {
  while (pending.length) {
    const p = pending;
    pending = [];
    await Promise.all(p);
  }
};

// A console session plus a key, the way the dashboard gets them.
async function newConsole() {
  const res = await app.request(`${ORIGIN}/api/console/session`, { method: "POST", headers: { "X-Console": "1", Origin: ORIGIN } });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`${ORIGIN}${path}`, { ...init, headers: { "X-Console": "1", Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json", ...init.headers } });
  const keyRes = await call("/api/console/keys", { method: "POST", body: JSON.stringify({ name: "Test" }) });
  const { key, id } = (await keyRes.json()) as { key: string; id: string };
  return { cookie, call, key, keyId: id };
}
const api = async (key: string, path: string, init: RequestInit = {}): Promise<Response> =>
  app.request(`${ORIGIN}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });

// A real HTTP server to receive webhooks.
let hook: Server;
let hookUrl = "";
let received: { headers: Record<string, string>; body: string }[] = [];
let failNext = 0;

beforeAll(async () => {
  db = await createPglite();
  hook = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      received.push({ headers: req.headers as Record<string, string>, body });
      if (failNext > 0) {
        failNext--;
        res.writeHead(500).end("nope");
      } else res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
  hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
});
afterAll(async () => {
  hook.close();
  await db.close();
});
beforeEach(() => {
  received = [];
  failNext = 0;
});

describe("authentication", () => {
  it("rejects a missing key with a problem document", async () => {
    const res = await app.request(`${ORIGIN}/v1/usage`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 401, code: "missing_api_key", title: "Missing API key" });
    expect(body.request_id).toBe(res.headers.get("x-request-id"));
  });

  it("rejects malformed, unknown and revoked keys", async () => {
    expect((await api("nope", "/v1/usage")).status).toBe(401);
    expect(((await (await api(`tr_live_${"a".repeat(32)}`, "/v1/usage")).json()) as { code: string }).code).toBe("invalid_api_key");
    const { key, keyId, call } = await newConsole();
    expect((await api(key, "/v1/usage")).status).toBe(200);
    expect((await call(`/api/console/keys/${keyId}`, { method: "DELETE" })).status).toBe(204);
    const res = await api(key, "/v1/usage");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("revoked_api_key");
  });

  it("stores only a hash of the key", async () => {
    const { key } = await newConsole();
    const rows = await db.query<{ n: number }>("select count(*)::int as n from tillread.api_keys where hash = $1 or prefix = $1", [key]);
    expect(rows[0]!.n).toBe(0);
  });

  it("lets anyone call the health check", async () => {
    const res = await app.request(`${ORIGIN}/v1/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });
});

describe("POST /v1/parse", () => {
  it("parses a raw CSV body", async () => {
    const { key } = await newConsole();
    const res = await api(key, "/v1/parse", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactions: { amount: number; raw?: unknown }[]; skipped: unknown[]; summary: Record<string, unknown> };
    expect(body.transactions.map((t) => t.amount)).toEqual([-450, 250000]);
    expect(body.transactions[0]!.raw).toBeUndefined();
    expect(body.skipped).toHaveLength(1); // the "Totals" row has a date but no amount
    expect(body.summary).toMatchObject({ transactions: 2, money_in: 250000, money_out: -450, first_date: "2026-01-02" });
  });

  it("parses raw bytes in another encoding, with options in the query", async () => {
    const { key } = await newConsole();
    const bytes = Buffer.from("Datum;Empfänger;Betrag\n02.03.2026;Bäckerei;-1.234,50\n", "latin1");
    const res = await api(key, "/v1/parse?decimal=,&date_format=DMY", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
    const body = (await res.json()) as { transactions: { date: string; amount: number; description: string }[] };
    expect(body.transactions[0]).toMatchObject({ date: "2026-03-02", amount: -123450, description: "Bäckerei" });
  });

  it("accepts JSON", async () => {
    const { key } = await newConsole();
    const res = await api(key, "/v1/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: CSV, options: { sign: "inverted" } }) });
    const body = (await res.json()) as { transactions: { amount: number }[]; detection: { sign: string } };
    expect(body.detection.sign).toBe("inverted");
    expect(body.transactions[0]!.amount).toBe(450);
  });

  it("refuses bad input clearly", async () => {
    const { key } = await newConsole();
    const big = await api(key, "/v1/parse", { method: "POST", headers: { "Content-Type": "text/csv" }, body: "x".repeat(limits.syncBytes + 1) });
    expect(big.status).toBe(413);
    const type = await api(key, "/v1/parse", { method: "POST", headers: { "Content-Type": "image/png" }, body: "x" });
    expect(type.status).toBe(415);
    const empty = await api(key, "/v1/parse", { method: "POST", headers: { "Content-Type": "text/csv" }, body: "" });
    expect(((await empty.json()) as { code: string }).code).toBe("empty_file");
    const opt = await api(key, "/v1/parse?date_format=XYZ", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    expect(opt.status).toBe(422);
  });
});

describe("rate limits and quotas", () => {
  it("allows a burst, then answers 429 with Retry-After and RateLimit headers", async () => {
    const { key } = await newConsole();
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < limits.burst + 2; i++) {
      last = await api(key, "/v1/usage");
      statuses.push(last.status);
    }
    expect(statuses.slice(0, limits.burst).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(limits.burst)).toEqual([429, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last!.headers.get("ratelimit-policy")).toContain(`"burst";q=${limits.burst};w=60`);
    expect(((await last!.json()) as { code: string }).code).toBe("rate_limited");
  });

  it("can't be overdrawn by concurrent requests", async () => {
    const { key } = await newConsole();
    const results = await Promise.all(Array.from({ length: 12 }, async () => (await api(key, "/v1/usage")).status));
    expect(results.filter((s) => s === 200)).toHaveLength(limits.burst);
  });

  it("enforces the daily quota", async () => {
    const { key, keyId } = await newConsole();
    await db.query("insert into tillread.usage_daily (key_id, day, requests) values ($1, (now() at time zone 'utc')::date, $2)", [keyId, limits.dailyRequests]);
    const res = await api(key, "/v1/usage");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("quota_exceeded");
  });

  it("reports usage", async () => {
    const { key } = await newConsole();
    await api(key, "/v1/parse", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    await settle();
    const body = (await (await api(key, "/v1/usage")).json()) as { days: { requests: number; rows_parsed: number }[]; limits: Record<string, number> };
    expect(body.days.at(-1)).toMatchObject({ requests: 2, rows_parsed: 2 });
    expect(body.limits.requests_per_minute).toBe(limits.burst);
  });
});

describe("jobs", () => {
  it("queues a job, runs it after the response, and returns the result", async () => {
    const { key } = await newConsole();
    const res = await api(key, "/v1/jobs?filename=jan.csv", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    expect(res.status).toBe(202);
    const job = (await res.json()) as { id: string; status: string };
    expect(job.status).toBe("queued");
    expect(res.headers.get("location")).toBe(`/v1/jobs/${job.id}`);
    const early = await api(key, `/v1/jobs/${job.id}/result`);
    expect([200, 409]).toContain(early.status);
    await settle();
    const done = (await (await api(key, `/v1/jobs/${job.id}`)).json()) as { status: string; summary: { transactions: number } };
    expect(done).toMatchObject({ status: "succeeded", summary: { transactions: 2 } });
    const result = (await (await api(key, `/v1/jobs/${job.id}/result`)).json()) as { transactions: unknown[] };
    expect(result.transactions).toHaveLength(2);
    const [row] = await db.query<{ input: unknown }>("select input from tillread.jobs where id = $1", [job.id]);
    expect(row!.input).toBeNull(); // the file isn't kept once it's parsed
  });

  it("returns the same job for a retried request with the same Idempotency-Key", async () => {
    const { key } = await newConsole();
    const send = (body: string) => api(key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv", "Idempotency-Key": "jan-import" }, body });
    const first = await send(CSV);
    const second = await send(CSV);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(((await second.json()) as { id: string }).id).toBe(((await first.json()) as { id: string }).id);
    const other = await send(CSV + "2026-01-05,Tea,-3.00\n");
    expect(other.status).toBe(422);
    expect(((await other.json()) as { code: string }).code).toBe("idempotency_key_reused");
    await settle();
  });

  it("keeps jobs private to their key, lists them and enforces the daily job quota", async () => {
    const a = await newConsole();
    const b = await newConsole();
    const job = (await (await api(a.key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV })).json()) as { id: string };
    expect((await api(b.key, `/v1/jobs/${job.id}`)).status).toBe(404);
    await api(a.key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    await api(a.key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    const over = await api(a.key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    expect(over.status).toBe(429);
    await settle();
    const list = (await (await api(a.key, "/v1/jobs?limit=2")).json()) as { data: unknown[]; has_more: boolean };
    expect(list.data).toHaveLength(2);
    expect(list.has_more).toBe(true);
  });

  it("recovers a job whose function died mid-run", async () => {
    const { key, keyId } = await newConsole();
    await db.query(
      "insert into tillread.jobs (id, key_id, status, bytes, input, started_at) values ('job_stuckstuckstuckstuck', $1, 'processing', 10, $2, now() - interval '5 minutes')",
      [keyId, new TextEncoder().encode(CSV)],
    );
    const tick = await app.request(`${ORIGIN}/api/cron/tick`, { headers: { Authorization: "Bearer cron-secret" } });
    expect(tick.status).toBe(200);
    const job = (await (await api(key, "/v1/jobs/job_stuckstuckstuckstuck")).json()) as { status: string };
    expect(job.status).toBe("succeeded");
    expect((await app.request(`${ORIGIN}/api/cron/tick`)).status).toBe(404);
  });
});

describe("webhooks", () => {
  it("signs and delivers job events", async () => {
    const { key } = await newConsole();
    const ep = (await (await api(key, "/v1/webhook-endpoints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: hookUrl }) })).json()) as {
      id: string;
      secret: string;
    };
    expect(ep.secret).toMatch(/^whsec_/);
    const listed = (await (await api(key, "/v1/webhook-endpoints")).json()) as { data: { secret?: string }[] };
    expect(listed.data[0]!.secret).toBeUndefined();
    await api(key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    await settle();
    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    const event = JSON.parse(body) as { type: string; data: { status: string; summary: { transactions: number } } };
    expect(event.type).toBe("job.succeeded");
    expect(event.data.summary.transactions).toBe(2);
    expect(verifySignature(ep.secret, body, headers["tillread-signature"])).toBe(true);
    expect(await verifyWebhook(body, headers["tillread-signature"]!, ep.secret)).toBe(true);
    expect(await verifyWebhook(body + " ", headers["tillread-signature"]!, ep.secret)).toBe(false);
  });

  it("retries failed deliveries on a schedule, then gives up", async () => {
    const { key, call } = await newConsole();
    await api(key, "/v1/webhook-endpoints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: hookUrl, events: ["job.succeeded"] }) });
    failNext = 10;
    await api(key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
    await settle();
    const due = async () => {
      await db.query("update tillread.webhook_deliveries set next_attempt_at = now() where status = 'pending'");
      await app.request(`${ORIGIN}/api/cron/tick`, { headers: { Authorization: "Bearer cron-secret" } });
    };
    let [d] = await db.query<{ id: string; status: string; attempts: number; last_status_code: number }>("select id, status, attempts, last_status_code from tillread.webhook_deliveries order by created_at desc limit 1");
    expect(d).toMatchObject({ status: "pending", attempts: 1, last_status_code: 500 });
    const [{ wait }] = (await db.query<{ wait: number }>("select extract(epoch from next_attempt_at - now())::int as wait from tillread.webhook_deliveries where id = $1", [d!.id])) as [{ wait: number }];
    expect(wait).toBeGreaterThan(20);
    await due();
    await due();
    [d] = await db.query("select id, status, attempts, last_status_code from tillread.webhook_deliveries where id = $1", [d!.id]);
    expect(d).toMatchObject({ status: "failed", attempts: 3 });
    failNext = 0;
    expect((await call(`/api/console/deliveries/${d!.id}/retry`, { method: "POST" })).status).toBe(200);
    [d] = await db.query("select id, status, attempts, last_status_code from tillread.webhook_deliveries where id = $1", [d!.id]);
    expect(d).toMatchObject({ status: "succeeded" });
  });

  it("refuses private and insecure URLs when not in development mode", async () => {
    const strict = { allowInsecure: false, resolve: async (h: string) => (h === "rebind.example" ? ["10.0.0.5"] : ["93.184.215.14"]) };
    await expect(assertPublicUrl("http://example.com/x", strict)).rejects.toMatchObject({ code: "insecure_url" });
    await expect(assertPublicUrl("https://localhost/x", strict)).rejects.toMatchObject({ code: "private_url" });
    await expect(assertPublicUrl("https://169.254.169.254/latest", strict)).rejects.toMatchObject({ code: "private_url" });
    await expect(assertPublicUrl("https://[::1]/x", strict)).rejects.toMatchObject({ code: "private_url" });
    await expect(assertPublicUrl("https://rebind.example/x", strict)).rejects.toMatchObject({ code: "private_url" });
    await expect(assertPublicUrl("https://user:pw@example.com/x", strict)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(assertPublicUrl("https://example.com/x", strict)).resolves.toBeInstanceOf(URL);
    for (const ip of ["10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "100.64.0.1", "::ffff:10.0.0.1", "fd00::1", "fe80::1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("rejects stale and tampered signatures", () => {
    const body = '{"a":1}';
    const old = signPayload("whsec_x", body, Math.floor(Date.now() / 1000) - 600);
    expect(verifySignature("whsec_x", body, old)).toBe(false);
    expect(verifySignature("whsec_x", body, signPayload("whsec_y", body))).toBe(false);
    expect(verifySignature("whsec_x", body, signPayload("whsec_x", body))).toBe(true);
  });
});

describe("console", () => {
  it("needs the X-Console header and a same-origin request to change anything", async () => {
    const { cookie } = await newConsole();
    const noHeader = await app.request(`${ORIGIN}/api/console/keys`, { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN } });
    expect(noHeader.status).toBe(403);
    const crossSite = await app.request(`${ORIGIN}/api/console/keys`, { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example", "X-Console": "1" } });
    expect(crossSite.status).toBe(403);
  });

  it("ignores a forged session cookie", async () => {
    const res = await app.request(`${ORIGIN}/api/console/overview`, { headers: { Cookie: "tr_console=00000000-0000-0000-0000-000000000000.forged" } });
    expect(res.status).toBe(401);
  });

  it("limits active keys per console", async () => {
    const { call } = await newConsole();
    const statuses: number[] = [];
    for (let i = 0; i < limits.keysPerConsole; i++) statuses.push((await call("/api/console/keys", { method: "POST", body: "{}" })).status);
    expect(statuses.slice(0, limits.keysPerConsole - 1).every((s) => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(409);
  });

  it("runs the built-in test inbox, including a flaky mode", async () => {
    const { call, key } = await newConsole();
    expect((await call("/api/console/inbox", { method: "POST" })).status).toBe(201);
    // The test app talks to itself through app.request, not the network.
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input), init)) as typeof fetch;
    try {
      await call("/api/console/inbox/flaky", { method: "POST", body: JSON.stringify({ fail: 1 }) });
      await api(key, "/v1/jobs", { method: "POST", headers: { "Content-Type": "text/csv" }, body: CSV });
      await settle();
      await db.query("update tillread.webhook_deliveries set next_attempt_at = now() where status = 'pending'");
      await app.request(`${ORIGIN}/api/cron/tick`, { headers: { Authorization: "Bearer cron-secret" } });
      const overview = (await (await call("/api/console/overview")).json()) as {
        inbox: { events: { responded: number; signature_valid: boolean }[] };
        deliveries: { status: string; attempts: number }[];
        requests: unknown[];
        keys: unknown[];
      };
      await settle();
      expect(overview.inbox.events.map((e) => e.responded).sort()).toEqual([200, 500]);
      expect(overview.inbox.events.every((e) => e.signature_valid)).toBe(true);
      expect(overview.deliveries[0]).toMatchObject({ status: "succeeded", attempts: 2 });
      expect(overview.requests.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("OpenAPI", () => {
  it("documents every public route with security and problem responses", async () => {
    const spec = (await (await app.request(`${ORIGIN}/openapi.json`)).json()) as { openapi: string; paths: Record<string, Record<string, { security?: unknown; responses: Record<string, unknown> }>> };
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).sort()).toEqual(
      ["/v1/health", "/v1/jobs", "/v1/jobs/{id}", "/v1/jobs/{id}/result", "/v1/parse", "/v1/usage", "/v1/webhook-endpoints", "/v1/webhook-endpoints/{id}"].sort(),
    );
    expect(spec.paths["/v1/parse"]!.post!.security).toBeTruthy();
    expect(spec.paths["/v1/parse"]!.post!.responses["429"]).toBeTruthy();
  });

  it("logs one structured line per request", () => {
    expect(logs.some((l) => l.path === "/v1/parse" && l.status === 200 && typeof l.ms === "number" && l.request_id)).toBe(true);
  });
});
