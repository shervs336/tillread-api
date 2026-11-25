import { z } from "@hono/zod-openapi";

export const Problem = z
  .object({
    type: z.string().url().openapi({ example: "https://tillread-api.vercel.app/docs#errors-rate_limited" }),
    title: z.string().openapi({ example: "Too many requests" }),
    status: z.number().int().openapi({ example: 429 }),
    detail: z.string().optional().openapi({ example: "This key allows 60 requests a minute. Try again in 3s." }),
    code: z.string().openapi({ example: "rate_limited" }),
    request_id: z.string().openapi({ example: "req_8fK2mQx9TzLw" }),
  })
  .openapi("Problem", { description: "An error, as Problem Details for HTTP APIs (RFC 9457)." });

export const ParseOptionsQuery = z.object({
  date_format: z.enum(["YMD", "DMY", "MDY"]).optional().openapi({ description: "Force the date order instead of detecting it." }),
  decimal: z.enum([".", ","]).optional().openapi({ description: "Force the decimal separator." }),
  sign: z.enum(["signed", "inverted", "split", "direction"]).optional().openapi({ description: "Force the sign convention." }),
  delimiter: z.enum([",", ";", "tab", "|"]).optional(),
  minor_units: z.coerce.number().int().min(0).max(4).optional().openapi({ description: "Digits after the decimal point. Default 2." }),
});

export const ParseJsonBody = z
  .object({
    csv: z.string().min(1).openapi({ example: "Date,Description,Amount\n2026-01-02,Coffee,-4.50\n" }),
    options: ParseOptionsQuery.optional(),
  })
  .openapi("ParseRequest");

export const Transaction = z
  .object({
    date: z.string().openapi({ example: "2026-01-02" }),
    amount: z.number().int().openapi({ example: -450, description: "Minor units (cents). Negative is money out." }),
    description: z.string().openapi({ example: "Blue Bottle Coffee" }),
    memo: z.string().optional(),
    balance: z.number().int().optional(),
    currency: z.string().optional().openapi({ example: "USD" }),
    category: z.string().optional(),
    reference: z.string().optional(),
    line: z.number().int().openapi({ example: 2 }),
  })
  .openapi("Transaction");

export const Detection = z
  .object({
    delimiter: z.string(),
    headerRow: z.number().int().nullable(),
    headers: z.array(z.string()),
    columns: z.record(z.string(), z.number().int()),
    dateFormat: z.enum(["YMD", "DMY", "MDY"]),
    decimal: z.enum([".", ","]),
    sign: z.enum(["signed", "inverted", "split", "direction"]),
    order: z.enum(["ascending", "descending", "unknown"]),
    confidence: z.number().openapi({ example: 0.95 }),
    notes: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .openapi("Detection");

export const Summary = z
  .object({
    transactions: z.number().int(),
    skipped: z.number().int(),
    money_in: z.number().int(),
    money_out: z.number().int(),
    first_date: z.string().nullable(),
    last_date: z.string().nullable(),
    confidence: z.number(),
  })
  .openapi("Summary");

export const ParseResponse = z
  .object({
    transactions: z.array(Transaction),
    skipped: z.array(z.object({ line: z.number().int(), reason: z.enum(["date", "amount", "zero"]), message: z.string() })),
    detection: Detection,
    summary: Summary,
  })
  .openapi("ParseResult");

export const Job = z
  .object({
    id: z.string().openapi({ example: "job_3kTq9VwZp2Lx8NcR4bYe" }),
    object: z.literal("job"),
    status: z.enum(["queued", "processing", "succeeded", "failed"]),
    filename: z.string().nullable(),
    bytes: z.number().int(),
    options: z.record(z.string(), z.unknown()),
    summary: Summary.nullable(),
    error: z.string().nullable(),
    created_at: z.string(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
  })
  .openapi("Job");

export const JobList = z.object({ object: z.literal("list"), data: z.array(Job), has_more: z.boolean() }).openapi("JobList");

export const Usage = z
  .object({
    key: z.object({ id: z.string(), name: z.string(), prefix: z.string() }),
    limits: z.object({ requests_per_minute: z.number().int(), requests_per_day: z.number().int(), jobs_per_day: z.number().int() }),
    days: z.array(z.object({ day: z.string(), requests: z.number().int(), rows_parsed: z.number().int(), jobs: z.number().int() })),
  })
  .openapi("Usage");

export const WebhookEndpoint = z
  .object({
    id: z.string().openapi({ example: "we_9QmV2tXc8RkLp4ZsHn1a" }),
    url: z.string().url(),
    events: z.array(z.string()),
    description: z.string().nullable(),
    created_at: z.string(),
    secret: z.string().optional().openapi({ description: "Only returned when the endpoint is created. Use it to verify signatures." }),
  })
  .openapi("WebhookEndpoint");

export const CreateWebhookEndpoint = z
  .object({
    url: z.string().url().openapi({ example: "https://example.com/webhooks/tillread" }),
    events: z.array(z.enum(["job.succeeded", "job.failed"])).optional().openapi({ description: "Defaults to both." }),
    description: z.string().max(120).optional(),
  })
  .openapi("CreateWebhookEndpoint");
