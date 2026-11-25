// Load test: node scripts/loadtest.mjs [baseUrl]
// 1. Health check (one database round trip per request): raw throughput and latency.
// 2. 50 connections hammering POST /v1/parse with one key for 15 s: the rate limiter must let
//    through no more than the burst plus the refill, and answer the rest with fast 429s.
import autocannon from "autocannon";

const base = process.argv[2] ?? "http://localhost:3000";
const csv = "Date,Description,Amount\n2026-01-02,Coffee,-4.50\n2026-01-03,Payroll,2500.00\n";

const session = await fetch(`${base}/api/console/session`, { method: "POST", headers: { "X-Console": "1" } });
const cookie = session.headers.get("set-cookie").split(";")[0];
const { key } = await (await fetch(`${base}/api/console/keys`, { method: "POST", headers: { "X-Console": "1", Cookie: cookie, "Content-Type": "application/json" }, body: '{"name":"load test"}' })).json();

const run = (opts) => new Promise((resolve, reject) => autocannon(opts, (err, res) => (err ? reject(err) : resolve(res))));
const fmt = (r) => `${Math.round(r.requests.average)} req/s · p50 ${r.latency.p50} ms · p99 ${r.latency.p99} ms · errors ${r.errors} · timeouts ${r.timeouts}`;

const health = await run({ url: `${base}/v1/health`, connections: 20, duration: 10 });
console.log(`GET /v1/health      ${fmt(health)} · ${health.requests.total} total`);

const duration = 15;
const statuses = {};
const parse = await run({
  url: `${base}/v1/parse`,
  method: "POST",
  connections: 50,
  duration,
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "text/csv" },
  body: csv,
  setupClient: (client) => client.on("response", (status) => (statuses[status] = (statuses[status] ?? 0) + 1)),
});
const allowed = statuses[200] ?? 0;
const ceiling = 60 + duration * 1 + 2; // burst + refill over the run (+2 for timing at the edges)
console.log(`POST /v1/parse      ${fmt(parse)} · ${parse.requests.total} total`);
console.log(`  status codes      ${JSON.stringify(statuses)}`);
console.log(`  rate limiter      ${allowed} allowed (ceiling ${ceiling}) → ${allowed <= ceiling ? "PASS" : "FAIL"}`);
process.exit(allowed <= ceiling && parse.errors === 0 ? 0 : 1);
