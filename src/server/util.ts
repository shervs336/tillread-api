import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const LIMITS = {
  /** Token bucket: burst size and refill per second (60 requests a minute). */
  burst: 60,
  refillPerSecond: 1,
  dailyRequests: 1_000,
  dailyJobs: 100,
  syncBytes: 1024 * 1024,
  jobBytes: 4 * 1024 * 1024, // Vercel's request body limit is 4.5 MB
  keysPerConsole: 5,
  endpointsPerConsole: 5,
  consolesPerIpPerDay: 20,
  /** Seconds to wait before each retry of a failed webhook delivery. */
  retrySchedule: [30, 120, 600, 3600, 6 * 3600],
};

export type Limits = typeof LIMITS;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Random base62 string (unbiased: rejects bytes ≥ 248). */
export function randomId(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export const newApiKey = () => `tr_live_${randomId(32)}`;
export const keyPrefix = (key: string) => key.slice(0, 12);
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Problem Details for HTTP APIs (RFC 9457). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly headers: Record<string, string> = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(title);
  }
}

export const DOCS_URL = "https://tillread-api.vercel.app/docs";
