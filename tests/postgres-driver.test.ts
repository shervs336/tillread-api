import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { createPostgres, type Db } from "../src/server/db";
import { SCHEMA_SQL } from "../src/server/schema-sql";

// Production talks to Postgres through postgres.js, not PGlite's in-process API. This runs the
// main flow through that driver, over the real Postgres wire protocol (PGlite's socket server),
// to check parameter types end to end: uuid, bytea, jsonb, text[] and timestamps.
let pg: PGlite;
let server: PGLiteSocketServer;
let db: Db;
const pending: Promise<unknown>[] = [];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA_SQL);
  server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1" });
  await server.start();
  const port = Number(server.getServerConn().split(":").pop());
  db = await createPostgres(`postgres://postgres@127.0.0.1:${port}/postgres`, 1);
});
afterAll(async () => {
  await db?.close();
  await server?.stop();
  await pg?.close();
});

it("runs keys, parse, jobs and webhooks through postgres.js", async () => {
  const app = createApp({ db: async () => db, defer: (t) => void pending.push(t()), consoleSecret: "s", allowInsecureWebhooks: true, log: () => {} });
  const s = await app.request("http://t.local/api/console/session", { method: "POST", headers: { "X-Console": "1" } });
  expect(s.status).toBe(200);
  const cookie = s.headers.get("set-cookie")!.split(";")[0]!;
  const console_ = (path: string, init: RequestInit = {}) => app.request(`http://t.local${path}`, { ...init, headers: { "X-Console": "1", Cookie: cookie, ...init.headers } });
  const { key } = (await (await console_("/api/console/keys", { method: "POST", body: "{}" })).json()) as { key: string };
  const auth = { Authorization: `Bearer ${key}` };

  const parsed = await app.request("http://t.local/v1/parse", { method: "POST", headers: { ...auth, "Content-Type": "text/csv" }, body: "Date,Description,Amount\n2026-01-02,Tea,-3.10\n" });
  expect(parsed.status).toBe(200);

  expect((await console_("/api/console/inbox", { method: "POST" })).status).toBe(201); // text[] events

  const job = await app.request("http://t.local/v1/jobs", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/octet-stream", "Idempotency-Key": "pg-1" },
    body: Buffer.from("Datum;Betrag\n02.01.2026;-1,50\n", "latin1"), // bytea
  });
  expect(job.status).toBe(202);
  const { id } = (await job.json()) as { id: string };
  while (pending.length) await pending.shift();
  const done = (await (await app.request(`http://t.local/v1/jobs/${id}`, { headers: auth })).json()) as { status: string; summary: { transactions: number }; created_at: string };
  expect(done.status).toBe("succeeded");
  expect(done.summary.transactions).toBe(1); // jsonb
  expect(Number.isNaN(Date.parse(done.created_at))).toBe(false); // timestamptz
  const usage = (await (await app.request("http://t.local/v1/usage", { headers: auth })).json()) as { days: { requests: number; jobs: number }[] };
  expect(usage.days[0]).toMatchObject({ jobs: 1 });
  const overview = (await (await console_("/api/console/overview")).json()) as { deliveries: unknown[]; keys: unknown[] };
  expect(overview.keys).toHaveLength(1);
  expect(overview.deliveries.length).toBeGreaterThan(0);
  while (pending.length) await pending.shift();
});
