import { parse, type ParseOptions, type ParseResult } from "tillread";
import type { Db } from "./db";
import { ApiError, randomId, sha256 } from "./util";
import { emit, sweepDeliveries, type WebhookDeps } from "./webhooks";

function withoutRaw<T extends { raw: unknown }>(row: T): Omit<T, "raw"> {
  const copy: Partial<T> = { ...row };
  delete copy.raw;
  return copy as Omit<T, "raw">;
}

/** What the API returns for a parse: the library result without the raw cells (smaller, and no echoing of input). */
export function shapeResult(r: ParseResult) {
  return {
    transactions: r.transactions.map(withoutRaw),
    skipped: r.skipped.map(withoutRaw),
    detection: r.detection,
    summary: summarize(r),
  };
}

export function summarize(r: ParseResult) {
  let moneyIn = 0;
  let moneyOut = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const t of r.transactions) {
    if (t.amount > 0) moneyIn += t.amount;
    else moneyOut += t.amount;
    if (!first || t.date < first) first = t.date;
    if (!last || t.date > last) last = t.date;
  }
  return {
    transactions: r.transactions.length,
    skipped: r.skipped.length,
    money_in: moneyIn,
    money_out: moneyOut,
    first_date: first,
    last_date: last,
    confidence: r.detection.confidence,
  };
}

export interface JobRow {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  filename: string | null;
  bytes: number;
  options: ParseOptions;
  summary: ReturnType<typeof summarize> | null;
  error: string | null;
  attempts: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const JOB_COLUMNS = "id, status, filename, bytes, options, summary, error, attempts, created_at, started_at, finished_at";

export function publicJob(j: JobRow) {
  return {
    id: j.id,
    object: "job" as const,
    status: j.status,
    filename: j.filename,
    bytes: j.bytes,
    options: j.options,
    summary: j.summary,
    error: j.error,
    created_at: j.created_at.toISOString(),
    started_at: j.started_at?.toISOString() ?? null,
    finished_at: j.finished_at?.toISOString() ?? null,
  };
}

/**
 * Creates a job. With an Idempotency-Key, a retry of the same request returns the original job
 * instead of creating a second one; reusing the key for a different file is an error.
 */
export async function createJob(db: Db, keyId: string, input: { bytes: Uint8Array; filename: string | null; options: ParseOptions; idempotencyKey: string | null }, dailyJobs = 100): Promise<{ job: JobRow; replayed: boolean }> {
  const requestHash = sha256(`${Buffer.from(input.bytes).toString("base64")}|${JSON.stringify(input.options)}`);
  if (input.idempotencyKey) {
    const [existing] = await db.query<JobRow & { request_hash: string }>(
      `select ${JOB_COLUMNS}, request_hash from tillread.jobs where key_id = $1 and idempotency_key = $2`,
      [keyId, input.idempotencyKey],
    );
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ApiError(422, "idempotency_key_reused", "Idempotency key reused", "This Idempotency-Key was already used for a different request.");
      }
      return { job: existing, replayed: true };
    }
  }
  const [{ jobs }] = (await db.query<{ jobs: number }>(
    `insert into tillread.usage_daily (key_id, day, jobs) values ($1, (now() at time zone 'utc')::date, 1)
     on conflict (key_id, day) do update set jobs = tillread.usage_daily.jobs + 1 returning jobs`,
    [keyId],
  )) as [{ jobs: number }];
  if (jobs > dailyJobs) throw new ApiError(429, "quota_exceeded", "Daily job quota used up", `This key can create ${dailyJobs} jobs a day (UTC).`);

  const id = `job_${randomId(20)}`;
  try {
    const [job] = await db.query<JobRow>(
      `insert into tillread.jobs (id, key_id, status, filename, bytes, options, input, idempotency_key, request_hash)
       values ($1, $2, 'queued', $3, $4, $5::jsonb, $6, $7, $8) returning ${JOB_COLUMNS}`,
      [id, keyId, input.filename, input.bytes.byteLength, input.options, input.bytes, input.idempotencyKey, requestHash],
    );
    return { job: job!, replayed: false };
  } catch (e) {
    // Two identical requests raced: the unique (key_id, idempotency_key) index let one through.
    if (input.idempotencyKey && String((e as { code?: string }).code) === "23505") return createJob(db, keyId, input, dailyJobs);
    throw e;
  }
}

export async function getJob(db: Db, keyId: string, id: string) {
  const [job] = await db.query<JobRow>(`select ${JOB_COLUMNS} from tillread.jobs where id = $1 and key_id = $2`, [id, keyId]);
  if (!job) throw new ApiError(404, "not_found", "Job not found", `No job ${id} for this key.`);
  return job;
}

export async function getJobResult(db: Db, keyId: string, id: string) {
  const [row] = await db.query<{ status: string; result: unknown }>("select status, result from tillread.jobs where id = $1 and key_id = $2", [id, keyId]);
  if (!row) throw new ApiError(404, "not_found", "Job not found", `No job ${id} for this key.`);
  if (row.status !== "succeeded") throw new ApiError(409, "job_not_ready", "Result not ready", `The job is ${row.status}.`);
  return typeof row.result === "string" ? JSON.parse(row.result) : row.result;
}

export async function listJobs(db: Db, keyId: string, limit: number, before?: string) {
  return db.query<JobRow>(
    `select ${JOB_COLUMNS} from tillread.jobs where key_id = $1 ${before ? "and created_at < (select created_at from tillread.jobs where id = $3 and key_id = $1)" : ""}
     order by created_at desc limit $2`,
    before ? [keyId, limit, before] : [keyId, limit],
  );
}

/**
 * Runs a job. The claim is a single conditional update, so a job picked up twice (by the
 * request that created it and by the sweeper) only runs once. A job stuck in "processing" for
 * two minutes (its function was killed) can be claimed again.
 */
export async function runJob(deps: WebhookDeps, id: string): Promise<void> {
  const { db } = deps;
  const [job] = await db.query<{ id: string; key_id: string; console_id: string; input: Uint8Array; options: ParseOptions; attempts: number }>(
    `update tillread.jobs j set status = 'processing', started_at = now(), attempts = j.attempts + 1
     from tillread.api_keys k
     where j.id = $1 and j.key_id = k.id and (j.status = 'queued' or (j.status = 'processing' and j.started_at < now() - interval '2 minutes'))
     returning j.id, j.key_id, k.console_id, j.input, j.options, j.attempts`,
    [id],
  );
  if (!job) return;
  let finished: JobRow;
  try {
    const result = parse(new Uint8Array(job.input), typeof job.options === "string" ? JSON.parse(job.options) : job.options);
    const shaped = shapeResult(result);
    [finished] = (await db.query<JobRow>(
      `update tillread.jobs set status = 'succeeded', summary = $2::jsonb, result = $3::jsonb, input = null, finished_at = now() where id = $1 returning ${JOB_COLUMNS}`,
      [id, shaped.summary, shaped],
    )) as [JobRow];
    await db.query(
      `update tillread.usage_daily set rows_parsed = rows_parsed + $2 where key_id = $1 and day = (now() at time zone 'utc')::date`,
      [job.key_id, shaped.summary.transactions],
    );
  } catch (e) {
    if (job.attempts < 3) {
      await db.query("update tillread.jobs set status = 'queued' where id = $1", [id]);
      return;
    }
    [finished] = (await db.query<JobRow>(
      `update tillread.jobs set status = 'failed', error = $2, input = null, finished_at = now() where id = $1 returning ${JOB_COLUMNS}`,
      [id, e instanceof Error ? e.message.slice(0, 300) : "Unknown error"],
    )) as [JobRow];
  }
  await emit(db, job.console_id, finished.status === "succeeded" ? "job.succeeded" : "job.failed", publicJob(finished));
  await sweepDeliveries(deps);
}

/** Picks up jobs nobody finished (a killed function) and queued jobs. Run by the cron endpoint. */
export async function sweepJobs(deps: WebhookDeps, max = 10) {
  const due = await deps.db.query<{ id: string }>(
    `select id from tillread.jobs where status = 'queued' or (status = 'processing' and started_at < now() - interval '2 minutes')
     order by created_at limit $1`,
    [max],
  );
  for (const j of due) await runJob(deps, j.id);
  return due.length;
}
