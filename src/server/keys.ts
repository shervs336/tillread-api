import type { Db } from "./db";
import { ApiError, keyPrefix, newApiKey, sha256, type Limits } from "./util";

export interface KeyRow {
  id: string;
  console_id: string;
  name: string;
  prefix: string;
}

/** Looks up a key by the SHA-256 of its full value. Keys are never stored in plain text. */
export async function authenticate(db: Db, header: string | undefined): Promise<KeyRow> {
  const key = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key) {
    throw new ApiError(401, "missing_api_key", "Missing API key", "Send your key as `Authorization: Bearer tr_live_…`.", {
      "WWW-Authenticate": 'Bearer realm="tillread"',
    });
  }
  if (!/^tr_live_[0-9A-Za-z]{32}$/.test(key)) {
    throw new ApiError(401, "invalid_api_key", "Invalid API key", "That isn't a Tillread API key.", { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  }
  const [row] = await db.query<KeyRow & { revoked_at: Date | null }>(
    "select id, console_id, name, prefix, revoked_at from tillread.api_keys where hash = $1",
    [sha256(key)],
  );
  if (!row) throw new ApiError(401, "invalid_api_key", "Invalid API key", "No key matches. It may have been typed wrong.", { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  if (row.revoked_at) throw new ApiError(401, "revoked_api_key", "Revoked API key", `The key ${row.prefix}… was revoked. Create a new one in the console.`);
  return { id: row.id, console_id: row.console_id, name: row.name, prefix: row.prefix };
}

export interface RateState {
  limit: number;
  remaining: number;
  /** Seconds until the next token. */
  reset: number;
  dailyLimit: number;
  dailyUsed: number;
  /** Seconds until midnight UTC. */
  dailyReset: number;
}

/**
 * Token bucket in one atomic upsert: refills by elapsed time, takes a token if there is one,
 * and records whether it did. Concurrent requests serialize on the row lock, so the bucket
 * can't be overdrawn. Then the daily quota is counted in the same way.
 */
export async function consume(db: Db, keyId: string, limits: Limits): Promise<RateState> {
  const [bucket] = await db.query<{ tokens: number; allowed: boolean }>(
    `insert into tillread.rate_buckets as b (key_id, tokens, allowed, updated_at)
     values ($1, $2::float8 - 1, true, now())
     on conflict (key_id) do update set
       tokens = case
         when least($2::float8, b.tokens + extract(epoch from now() - b.updated_at) * $3::float8) >= 1
         then least($2::float8, b.tokens + extract(epoch from now() - b.updated_at) * $3::float8) - 1
         else least($2::float8, b.tokens + extract(epoch from now() - b.updated_at) * $3::float8)
       end,
       allowed = least($2::float8, b.tokens + extract(epoch from now() - b.updated_at) * $3::float8) >= 1,
       updated_at = now()
     returning tokens, allowed`,
    [keyId, limits.burst, limits.refillPerSecond],
  );
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const dailyReset = Math.ceil((midnight - now.getTime()) / 1000);
  const tokens = Number(bucket!.tokens);
  const reset = Math.max(0, Math.ceil((1 - (tokens % 1)) / limits.refillPerSecond));

  if (!bucket!.allowed) {
    const wait = Math.max(1, Math.ceil((1 - tokens) / limits.refillPerSecond));
    throw new ApiError(429, "rate_limited", "Too many requests", `This key allows ${limits.burst} requests a minute. Try again in ${wait}s.`, {
      "Retry-After": String(wait),
      ...rateHeaders({ limit: limits.burst, remaining: 0, reset: wait, dailyLimit: limits.dailyRequests, dailyUsed: -1, dailyReset }),
    });
  }

  const [usage] = await db.query<{ requests: number }>(
    `insert into tillread.usage_daily (key_id, day, requests) values ($1, (now() at time zone 'utc')::date, 1)
     on conflict (key_id, day) do update set requests = tillread.usage_daily.requests + 1
     returning requests`,
    [keyId],
  );
  await db.query("update tillread.api_keys set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')", [keyId]);

  const state: RateState = {
    limit: limits.burst,
    remaining: Math.max(0, Math.floor(tokens)),
    reset,
    dailyLimit: limits.dailyRequests,
    dailyUsed: usage!.requests,
    dailyReset,
  };
  if (usage!.requests > limits.dailyRequests) {
    throw new ApiError(429, "quota_exceeded", "Daily quota used up", `This key allows ${limits.dailyRequests} requests a day (UTC).`, {
      "Retry-After": String(dailyReset),
      ...rateHeaders(state),
    });
  }
  return state;
}

/** IETF RateLimit header fields (draft-ietf-httpapi-ratelimit-headers), plus the common X- versions. */
export function rateHeaders(s: RateState): Record<string, string> {
  const dailyRemaining = s.dailyUsed < 0 ? 0 : Math.max(0, s.dailyLimit - s.dailyUsed);
  return {
    "RateLimit-Policy": `"burst";q=${s.limit};w=60, "daily";q=${s.dailyLimit};w=86400`,
    RateLimit: `"burst";r=${s.remaining};t=${s.reset}, "daily";r=${dailyRemaining};t=${s.dailyReset}`,
    "X-RateLimit-Limit": String(s.limit),
    "X-RateLimit-Remaining": String(s.remaining),
    "X-RateLimit-Reset": String(s.reset),
  };
}

export async function createKey(db: Db, consoleId: string, name: string, limits: Limits) {
  const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from tillread.api_keys where console_id = $1 and revoked_at is null", [consoleId])) as [{ n: number }];
  if (n >= limits.keysPerConsole) throw new ApiError(409, "too_many_keys", "Too many keys", `Revoke a key first; a console can have ${limits.keysPerConsole} active keys.`);
  const key = newApiKey();
  const [row] = await db.query<{ id: string; created_at: Date }>(
    "insert into tillread.api_keys (console_id, name, prefix, hash) values ($1, $2, $3, $4) returning id, created_at",
    [consoleId, name.trim().slice(0, 60) || "Untitled key", keyPrefix(key), sha256(key)],
  );
  return { id: row!.id, key, prefix: keyPrefix(key), created_at: row!.created_at };
}

export async function revokeKey(db: Db, consoleId: string, id: string) {
  const rows = await db.query("update tillread.api_keys set revoked_at = now() where id = $1 and console_id = $2 and revoked_at is null returning id", [id, consoleId]);
  if (!rows.length) throw new ApiError(404, "not_found", "Key not found");
}
