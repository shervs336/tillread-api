import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Db } from "./db";
import { ApiError, hmac, randomId, safeEqual, type Limits } from "./util";

export const EVENTS = ["job.succeeded", "job.failed", "ping"] as const;
export type EventType = (typeof EVENTS)[number];

export interface WebhookDeps {
  db: Db;
  limits: Limits;
  fetch: typeof fetch;
  /** Allow http:// and private addresses. Only for local development and tests. */
  allowInsecure: boolean;
  resolve?: (host: string) => Promise<string[]>;
}

// ---------- Signing ----------

/**
 * `Tillread-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`
 * The timestamp is signed too, so a captured request can't be replayed later.
 */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, `${timestamp}.${body}`)}`;
}

export function verifySignature(secret: string, body: string, header: string | null | undefined, toleranceSeconds = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  return safeEqual(hmac(secret, `${t}.${body}`), parts.v1);
}

// ---------- SSRF protection ----------

const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16],
  [0xac100000, 12], [0xc0000000, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xe0000000, 4], [0xf0000000, 4],
];
const v4ToInt = (ip: string) => ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = v4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  }
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6) || v6.startsWith("64:ff9b:") || v6.startsWith("2001:db8");
}

/**
 * Webhook URLs must be public HTTPS endpoints. Checked when an endpoint is created and again
 * before every delivery, since DNS can change after the check (DNS rebinding).
 */
export async function assertPublicUrl(raw: string, deps: Pick<WebhookDeps, "allowInsecure" | "resolve">): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(422, "invalid_url", "Invalid URL", "Use a full URL such as https://example.com/webhooks/tillread.");
  }
  if (deps.allowInsecure) return url;
  if (url.protocol !== "https:") throw new ApiError(422, "insecure_url", "HTTPS required", "Webhook URLs must use https://.");
  if (url.username || url.password) throw new ApiError(422, "invalid_url", "Invalid URL", "URLs can't contain credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/i.test(host)) {
    throw new ApiError(422, "private_url", "Private address", "Webhook URLs must be reachable on the public internet.");
  }
  const addresses = isIP(host) ? [host] : await (deps.resolve ?? defaultResolve)(host).catch(() => []);
  if (!addresses.length) throw new ApiError(422, "unresolvable_url", "Host not found", `Couldn't resolve ${host}.`);
  if (addresses.some(isPrivateAddress)) throw new ApiError(422, "private_url", "Private address", "Webhook URLs must be reachable on the public internet.");
  return url;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

// ---------- Endpoints ----------

export interface EndpointRow {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  created_at: Date;
  secret?: string;
}

export async function createEndpoint(deps: WebhookDeps, consoleId: string, input: { url: string; events?: string[]; description?: string }) {
  const { db, limits } = deps;
  const url = await assertPublicUrl(input.url, deps);
  const events = input.events?.length ? input.events : ["job.succeeded", "job.failed"];
  const unknown = events.filter((e) => !(EVENTS as readonly string[]).includes(e));
  if (unknown.length) throw new ApiError(422, "invalid_events", "Unknown events", `Not events: ${unknown.join(", ")}. Use ${EVENTS.join(", ")}.`);
  const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from tillread.webhook_endpoints where console_id = $1 and disabled_at is null", [consoleId])) as [{ n: number }];
  if (n >= limits.endpointsPerConsole) throw new ApiError(409, "too_many_endpoints", "Too many endpoints", `A console can have ${limits.endpointsPerConsole} endpoints.`);
  const id = `we_${randomId(20)}`;
  const secret = `whsec_${randomId(32)}`;
  const [row] = await db.query<EndpointRow>(
    "insert into tillread.webhook_endpoints (id, console_id, url, secret, events, description) values ($1, $2, $3, $4, $5, $6) returning id, url, events, description, created_at, secret",
    [id, consoleId, url.toString(), secret, events, input.description?.slice(0, 120) ?? null],
  );
  return row!;
}

export async function listEndpoints(db: Db, consoleId: string) {
  return db.query<EndpointRow>(
    "select id, url, events, description, created_at from tillread.webhook_endpoints where console_id = $1 and disabled_at is null order by created_at",
    [consoleId],
  );
}

export async function deleteEndpoint(db: Db, consoleId: string, id: string) {
  const rows = await db.query("update tillread.webhook_endpoints set disabled_at = now() where id = $1 and console_id = $2 and disabled_at is null returning id", [id, consoleId]);
  if (!rows.length) throw new ApiError(404, "not_found", "Webhook endpoint not found");
}

// ---------- Delivery ----------

/** Queues one delivery per subscribed endpoint and returns their ids. */
export async function emit(db: Db, consoleId: string, type: EventType, data: unknown, onlyEndpoint?: string): Promise<string[]> {
  const endpoints = await db.query<{ id: string }>(
    `select id from tillread.webhook_endpoints where console_id = $1 and disabled_at is null and ($2::text = any(events) or $2 = 'ping') ${onlyEndpoint ? "and id = $3" : ""}`,
    onlyEndpoint ? [consoleId, type, onlyEndpoint] : [consoleId, type],
  );
  const eventId = `evt_${randomId(20)}`;
  const payload = { id: eventId, type, created: Math.floor(Date.now() / 1000), data };
  const ids: string[] = [];
  for (const e of endpoints) {
    const id = `whd_${randomId(20)}`;
    await db.query(
      "insert into tillread.webhook_deliveries (id, endpoint_id, event_id, event_type, payload, status) values ($1, $2, $3, $4, $5::jsonb, 'pending')",
      [id, e.id, eventId, type, payload],
    );
    ids.push(id);
  }
  return ids;
}

/**
 * Attempts one delivery. Claims it first (so two workers can't send it twice), sends it with a
 * 10 s timeout and no redirects, then marks it delivered or schedules the next retry.
 */
export async function attempt(deps: WebhookDeps, deliveryId: string): Promise<"succeeded" | "retrying" | "failed" | "skipped"> {
  const { db, limits } = deps;
  const [d] = await db.query<{ id: string; attempts: number; payload: unknown; url: string; secret: string }>(
    `update tillread.webhook_deliveries d set attempts = d.attempts + 1, next_attempt_at = now() + interval '5 minutes'
     from tillread.webhook_endpoints e
     where d.id = $1 and d.endpoint_id = e.id and d.status = 'pending' and d.next_attempt_at <= now() and e.disabled_at is null
     returning d.id, d.attempts, d.payload, e.url, e.secret`,
    [deliveryId],
  );
  if (!d) return "skipped";
  const body = typeof d.payload === "string" ? d.payload : JSON.stringify(d.payload);
  let status: number | null = null;
  let error: string | null = null;
  try {
    await assertPublicUrl(d.url, deps);
    const res = await deps.fetch(d.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Tillread-Webhooks/1.0",
        "Tillread-Event-Id": (d.payload as { id: string }).id,
        "Tillread-Delivery-Id": d.id,
        "Tillread-Signature": signPayload(d.secret, body),
      },
      body,
    });
    status = res.status;
    await res.body?.cancel().catch(() => {});
    if (res.status >= 200 && res.status < 300) {
      await db.query("update tillread.webhook_deliveries set status = 'succeeded', delivered_at = now(), last_status_code = $2, last_error = null where id = $1", [d.id, status]);
      return "succeeded";
    }
    error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof ApiError ? e.title : e instanceof Error ? (e.name === "TimeoutError" ? "Timed out after 10 s" : e.message) : String(e);
  }
  const wait = limits.retrySchedule[d.attempts - 1];
  if (wait === undefined) {
    await db.query("update tillread.webhook_deliveries set status = 'failed', last_status_code = $2, last_error = $3 where id = $1", [d.id, status, error]);
    return "failed";
  }
  await db.query(
    "update tillread.webhook_deliveries set next_attempt_at = now() + make_interval(secs => $2::int), last_status_code = $3, last_error = $4 where id = $1",
    [d.id, wait, status, error],
  );
  return "retrying";
}

/** Sends every delivery that's due. Run by the cron endpoint and opportunistically after jobs. */
export async function sweepDeliveries(deps: WebhookDeps, max = 25) {
  const due = await deps.db.query<{ id: string }>(
    "select id from tillread.webhook_deliveries where status = 'pending' and next_attempt_at <= now() order by next_attempt_at limit $1",
    [max],
  );
  const results = await Promise.all(due.map((d) => attempt(deps, d.id)));
  return { attempted: results.filter((r) => r !== "skipped").length, succeeded: results.filter((r) => r === "succeeded").length };
}

/** Makes a failed or waiting delivery due now. */
export async function redeliver(db: Db, consoleId: string, id: string) {
  const rows = await db.query(
    `update tillread.webhook_deliveries d set status = 'pending', next_attempt_at = now()
     from tillread.webhook_endpoints e
     where d.id = $1 and d.endpoint_id = e.id and e.console_id = $2 and d.status <> 'succeeded'
     returning d.id`,
    [id, consoleId],
  );
  if (!rows.length) throw new ApiError(404, "not_found", "Delivery not found or already delivered");
}
