/**
 * Verifies a Tillread webhook. Uses Web Crypto, so it runs in Node 18+, Deno, Bun, edge
 * functions and browsers.
 *
 * Pass the raw request body exactly as received (not re-serialized JSON).
 *
 * ```ts
 * const body = await request.text();
 * if (!(await verifyWebhook(body, request.headers.get("Tillread-Signature"), process.env.TILLREAD_WEBHOOK_SECRET))) {
 *   return new Response("bad signature", { status: 400 });
 * }
 * ```
 */
export async function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  { toleranceSeconds = 300, now = Date.now() }: { toleranceSeconds?: number; now?: number } = {},
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = new Map(signatureHeader.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time comparison.
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
