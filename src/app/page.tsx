import Link from "next/link";
import { Code } from "@/components/code";
import { GITHUB, SiteHeader } from "@/components/site-header";

const CURL = `curl https://tillread-api.vercel.app/v1/parse \\
  -H "Authorization: Bearer $TILLREAD_KEY" \\
  -H "Content-Type: text/csv" \\
  --data-binary @statement.csv`;

const RESPONSE = `HTTP/1.1 200 OK
RateLimit: "burst";r=59;t=1, "daily";r=999;t=41218
X-Request-Id: req_8fK2mQx9TzLw

{
  "transactions": [
    { "date": "2026-01-02",
      "amount": -7802,
      "description": "Lidl sagt Danke",
      "currency": "EUR" }, …
  ],
  "summary": { "transactions": 15,
    "money_in": 703894, "money_out": -82112 },
  "detection": { "dateFormat": "DMY", … }
}`;

const SDK = `import { createTillread, verifyWebhook } from "@tillread/api-client";

const tillread = createTillread({ apiKey: process.env.TILLREAD_KEY! });

// Big file: queue it. A retry with the same key never makes a second job.
const job = await tillread.createJob(bytes, { idempotencyKey: "acct-42/2026-01" });

// Then, in your webhook handler:
const ok = await verifyWebhook(rawBody, req.headers.get("Tillread-Signature"), secret);`;

const FEATURES = [
  ["API keys", "Created in the console, shown once, stored only as SHA-256 hashes. Revoke any time."],
  ["Rate limits", "A token bucket per key in one atomic Postgres upsert, so concurrent requests can't overdraw it. IETF RateLimit headers on every response."],
  ["Usage metering", "Requests, rows parsed and jobs per key per day, with daily quotas and a usage endpoint."],
  ["Async jobs", "Queue files up to 4 MB; they run right after the response. A sweeper recovers jobs whose function was killed."],
  ["Idempotency", "Send an Idempotency-Key and a retried POST returns the original job. Reuse it for a different file and you get a clear 422."],
  ["Signed webhooks", "HMAC-SHA256 over a timestamp and the body. Failed deliveries retry for six hours, then you can redeliver."],
  ["SSRF protection", "Webhook URLs must be public HTTPS, checked again before every delivery to defeat DNS rebinding. No redirects followed."],
  ["OpenAPI + SDK", "The spec is generated from the route definitions, and the typed client is generated from the spec. They can't drift apart."],
  ["Errors that help", "RFC 9457 problem documents with a stable code and a request id that matches the logs."],
] as const;

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden">
          <div className="grid-paper pointer-events-none absolute inset-0 opacity-60" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">REST · OpenAPI 3.1 · Typed SDK · Free tier</p>
              <h1 className="mt-5 font-serif text-[2.75rem] leading-[1.02] tracking-tight sm:text-6xl">
                Bank CSV in. <span className="text-accent">Clean JSON out.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Send any bank&apos;s export, in any layout or encoding. Get typed transactions back: ISO dates, integer cents, money out
                negative. Or queue a big file and get a signed webhook when it&apos;s done.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/console" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition hover:opacity-90">
                  Get an API key
                </Link>
                <Link href="/docs" className="rounded-xl border border-line-strong bg-surface px-5 py-2.5 text-sm font-medium transition hover:border-ink">
                  Read the docs
                </Link>
              </div>
              <p className="mt-4 text-sm text-muted">No sign-up: the console gives you a key in one click.</p>
            </div>
            <div className="min-w-0 space-y-3">
              <Code title="request" code={CURL} />
              <div className="overflow-hidden rounded-xl border border-line bg-code-bg text-code-ink">
                <div className="border-b border-white/10 px-4 py-2 font-mono text-xs text-white/55">response</div>
                <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">{RESPONSE}</pre>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-surface-2/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="font-serif text-4xl tracking-tight">What a production API needs, built in</h2>
            <p className="mt-3 max-w-2xl text-muted">The parsing comes from the open-source Tillread library. This project is everything around it.</p>
            <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(([t, b]) => (
                <li key={t} className="bg-surface p-6">
                  <h3 className="font-semibold">{t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 [content-visibility:auto] [contain-intrinsic-size:auto_900px] sm:px-6">
          <h2 className="font-serif text-4xl tracking-tight">How a job moves</h2>
          <p className="mt-3 max-w-2xl text-muted">
            Serverless functions can&apos;t run a worker forever, so work happens after the response and anything left behind is swept up
            by later traffic, the console and a scheduled tick.
          </p>
          <Architecture />
        </section>

        <section className="border-y border-line bg-surface-2/50 [content-visibility:auto] [contain-intrinsic-size:auto_700px]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center [&>*]:min-w-0">
            <div>
              <h2 className="font-serif text-4xl tracking-tight">A typed client from the spec</h2>
              <p className="mt-3 text-muted">
                <code className="font-mono text-[0.9em]">@tillread/api-client</code> wraps every route with types generated from{" "}
                <a href="/openapi.json" className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  openapi.json
                </a>
                . Errors come back as <code className="font-mono text-[0.9em]">TillreadError</code> with the problem document attached, and{" "}
                <code className="font-mono text-[0.9em]">verifyWebhook</code> works anywhere Web Crypto does.
              </p>
              <table className="mt-8 w-full text-sm">
                <caption className="mb-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Free tier limits, per key</caption>
                <tbody>
                  {[
                    ["Requests", "60 a minute, 1,000 a day"],
                    ["Jobs", "100 a day"],
                    ["Sync parse", "1 MB per file"],
                    ["Job", "4 MB per file"],
                    ["Webhook endpoints", "5 per console"],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-t border-line">
                      <th scope="row" className="py-2 pr-4 text-left font-normal text-muted">
                        {k}
                      </th>
                      <td className="py-2 font-mono text-xs">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Code title="sdk" code={SDK} />
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <p>Tillread API · a portfolio project · sample data is invented</p>
          <div className="flex gap-4">
            <a href={GITHUB} className="transition hover:text-ink">
              GitHub
            </a>
            <a href="https://github.com/shervs336/tillread" className="transition hover:text-ink">
              The library
            </a>
            <a href={`${GITHUB}/blob/main/docs/case-study.md`} className="transition hover:text-ink">
              Case study
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

function Architecture() {
  const box = "fill-[var(--surface)] stroke-[var(--line-strong)]";
  const label = "fill-[var(--ink)] text-[13px] font-medium";
  const sub = "fill-[var(--muted)] text-[11px]";
  const arrow = "stroke-[var(--accent)]";
  return (
    <figure className="mt-10 overflow-x-auto rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <svg viewBox="0 0 960 330" className="min-w-[760px] w-full" role="img" aria-labelledby="arch-title arch-desc">
        <title id="arch-title">Architecture</title>
        <desc id="arch-desc">
          Your app sends a file to a Vercel function running Hono. It checks the key and rate limit in Postgres, stores the job and
          answers 202. After the response it parses the file, stores the result and sends a signed webhook to your endpoint. Failed
          deliveries are retried by a sweeper run by later requests, the console and a scheduled tick.
        </desc>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--accent)" />
          </marker>
        </defs>
        {/* Nodes */}
        <rect x="10" y="40" width="150" height="70" rx="12" className={box} />
        <text x="85" y="70" textAnchor="middle" className={label}>Your app</text>
        <text x="85" y="90" textAnchor="middle" className={sub}>SDK or curl</text>

        <rect x="250" y="20" width="250" height="110" rx="12" className={box} />
        <text x="375" y="48" textAnchor="middle" className={label}>Vercel function · Hono</text>
        <text x="375" y="70" textAnchor="middle" className={sub}>auth (key hash) → token bucket → quota</text>
        <text x="375" y="88" textAnchor="middle" className={sub}>validate → insert job → 202 Accepted</text>
        <text x="375" y="108" textAnchor="middle" className={sub}>problem+json errors · JSON logs</text>

        <rect x="600" y="20" width="170" height="110" rx="12" className={box} />
        <text x="685" y="55" textAnchor="middle" className={label}>Postgres</text>
        <text x="685" y="75" textAnchor="middle" className={sub}>Supabase · own schema</text>
        <text x="685" y="93" textAnchor="middle" className={sub}>keys · buckets · usage</text>
        <text x="685" y="111" textAnchor="middle" className={sub}>jobs · deliveries</text>

        <rect x="250" y="200" width="250" height="100" rx="12" className={box} />
        <text x="375" y="228" textAnchor="middle" className={label}>after() · job runner</text>
        <text x="375" y="250" textAnchor="middle" className={sub}>claim job atomically → tillread.parse()</text>
        <text x="375" y="268" textAnchor="middle" className={sub}>store result → queue job.succeeded</text>
        <text x="375" y="286" textAnchor="middle" className={sub}>sign + POST, or schedule a retry</text>

        <rect x="800" y="200" width="150" height="100" rx="12" className={box} />
        <text x="875" y="235" textAnchor="middle" className={label}>Your endpoint</text>
        <text x="875" y="255" textAnchor="middle" className={sub}>verifyWebhook()</text>
        <text x="875" y="273" textAnchor="middle" className={sub}>2xx within 10 s</text>

        <rect x="10" y="215" width="170" height="70" rx="12" className={`${box}`} strokeDasharray="5 4" />
        <text x="95" y="243" textAnchor="middle" className={label}>Sweeper</text>
        <text x="95" y="262" textAnchor="middle" className={sub}>traffic · console · cron</text>

        {/* Edges */}
        <path d="M160 75 H244" className={arrow} strokeWidth="2" fill="none" markerEnd="url(#arrow)" />
        <path d="M500 75 H594" className={arrow} strokeWidth="2" fill="none" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
        <path d="M375 130 V194" className={arrow} strokeWidth="2" fill="none" markerEnd="url(#arrow)" />
        <path d="M500 250 H600 Q640 250 650 200 L680 136" className={arrow} strokeWidth="2" fill="none" markerEnd="url(#arrow)" strokeDasharray="0" />
        <path d="M500 280 H794" className={arrow} strokeWidth="2" fill="none" markerEnd="url(#arrow)" />
        <path d="M180 250 H244" className={arrow} strokeWidth="2" fill="none" markerEnd="url(#arrow)" strokeDasharray="5 4" />
        <text x="202" y="66" textAnchor="middle" className={sub}>POST</text>
        <text x="390" y="168" className={sub}>after the response</text>
        <text x="640" y="296" textAnchor="middle" className={sub}>Tillread-Signature</text>
      </svg>
    </figure>
  );
}
