export const DESCRIPTION = `Bank CSV in, clean JSON out. The Tillread API reads exports from any bank (any delimiter, encoding, date order, decimal style or sign convention) and returns typed transactions: ISO dates, amounts in integer cents, money out negative.

It's built on the open-source [tillread](https://github.com/shervs336/tillread) library.

## Quick start

1. Open the [console](/console) and create an API key. You'll see it once.
2. Send a file:

\`\`\`bash
curl https://tillread-api.vercel.app/v1/parse \\
  -H "Authorization: Bearer $TILLREAD_KEY" \\
  -H "Content-Type: text/csv" \\
  --data-binary @statement.csv
\`\`\`

## Authentication

Every \`/v1\` request except \`/v1/health\` needs \`Authorization: Bearer tr_live_…\`. Keys are stored only as SHA-256 hashes, so a lost key can't be shown again: revoke it and create another.

## Limits

| | Limit |
|---|---|
| Requests | 60 a minute (burst), 1,000 a day per key |
| Jobs | 100 a day per key |
| \`POST /v1/parse\` | 1 MB per file |
| \`POST /v1/jobs\` | 4 MB per file |

Every response carries \`RateLimit-Policy\` and \`RateLimit\` headers (IETF draft), plus \`X-RateLimit-*\`. A \`429\` includes \`Retry-After\` in seconds.

## Errors

Errors are [Problem Details](https://www.rfc-editor.org/rfc/rfc9457) with \`Content-Type: application/problem+json\`:

\`\`\`json
{
  "type": "https://tillread-api.vercel.app/docs#errors-rate_limited",
  "title": "Too many requests",
  "status": 429,
  "detail": "This key allows 60 requests a minute. Try again in 3s.",
  "code": "rate_limited",
  "request_id": "req_8fK2mQx9TzLw"
}
\`\`\`

Branch on \`code\`, which is stable. Every response has an \`X-Request-Id\`; include it if you report a problem.

| code | status |
|---|---|
| \`missing_api_key\`, \`invalid_api_key\`, \`revoked_api_key\` | 401 |
| \`not_found\` | 404 |
| \`job_not_ready\` | 409 |
| \`payload_too_large\` | 413 |
| \`unsupported_media_type\` | 415 |
| \`validation_error\`, \`empty_file\`, \`idempotency_key_reused\`, \`invalid_url\`, \`insecure_url\`, \`private_url\` | 422 |
| \`rate_limited\`, \`quota_exceeded\` | 429 |
| \`internal_error\` | 500 |

## Idempotency

Send \`Idempotency-Key: <any unique string>\` with \`POST /v1/jobs\`. If the network drops and you retry, you get the original job back (status \`200\` with \`Idempotent-Replayed: true\`) instead of a second job. Reusing a key for a different file returns \`422 idempotency_key_reused\`.

## Webhooks

Create an endpoint (public HTTPS only) and Tillread will \`POST\` an event when a job finishes:

\`\`\`json
{ "id": "evt_…", "type": "job.succeeded", "created": 1767312000, "data": { "id": "job_…", "status": "succeeded", "summary": { … } } }
\`\`\`

Each request is signed: \`Tillread-Signature: t=<unix seconds>,v1=<hex>\`, where \`v1\` is HMAC-SHA256 of \`"<t>.<raw body>"\` with your endpoint's secret. Reject requests whose timestamp is more than five minutes old. The \`@tillread/api-client\` package has \`verifyWebhook()\`; in plain Node:

\`\`\`js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
\`\`\`

Respond with any \`2xx\` within 10 seconds. Anything else is retried after 30 s, 2 min, 10 min, 1 h and 6 h, then marked failed; you can redeliver from the console. Deliveries can arrive more than once or out of order, so use the event \`id\` to ignore repeats.
`;
