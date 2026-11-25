import { afterAll, beforeAll, expect, it } from "vitest";
import { createTillread, TillreadError } from "../packages/api-client/src";
import { createApp } from "../src/server/app";
import { createPglite, type Db } from "../src/server/db";

// The typed SDK against the real app (no network): proves the client, the spec and the server agree.
let db: Db;
const pending: Promise<unknown>[] = [];
const app = createApp({ db: async () => db, defer: (t) => void pending.push(t()), consoleSecret: "s", log: () => {} });
const appFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  input instanceof Request ? app.fetch(input) : app.request(String(input), init)) as typeof fetch;
let key = "";

beforeAll(async () => {
  db = await createPglite();
  const s = await app.request("http://t.local/api/console/session", { method: "POST", headers: { "X-Console": "1" } });
  const cookie = s.headers.get("set-cookie")!.split(";")[0]!;
  key = ((await (await app.request("http://t.local/api/console/keys", { method: "POST", headers: { "X-Console": "1", Cookie: cookie }, body: "{}" })).json()) as { key: string }).key;
});
afterAll(() => db.close());

it("parses, runs a job and reads usage through the SDK", async () => {
  const tillread = createTillread({ apiKey: key, baseUrl: "http://t.local", fetch: appFetch });
  const csv = "Date,Description,Amount\n03/14/2026,Coffee,-4.50\n";
  const parsed = await tillread.parse(new TextEncoder().encode(csv));
  expect(parsed.transactions[0]).toMatchObject({ date: "2026-03-14", amount: -450 });
  expect(parsed.detection.dateFormat).toBe("MDY");

  const job = await tillread.createJob(csv, { idempotencyKey: "sdk-1", filename: "march.csv" });
  expect(job.filename).toBe("march.csv");
  await Promise.all(pending);
  const done = await tillread.waitForJob(job.id, { intervalMs: 10 });
  expect(done.status).toBe("succeeded");
  expect((await tillread.getJobResult(job.id)).summary.transactions).toBe(1);
  expect((await tillread.listJobs()).data).toHaveLength(1);
  expect((await tillread.usage()).days.at(-1)!.requests).toBeGreaterThan(0);
});

it("throws TillreadError with the problem document", async () => {
  const bad = createTillread({ apiKey: `tr_live_${"x".repeat(32)}`, baseUrl: "http://t.local", fetch: appFetch });
  const err = await bad.usage().catch((e) => e);
  expect(err).toBeInstanceOf(TillreadError);
  expect(err.status).toBe(401);
  expect(err.problem.code).toBe("invalid_api_key");
});
