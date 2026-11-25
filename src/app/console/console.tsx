"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/ui";

interface Overview {
  limits: { requests_per_minute: number; requests_per_day: number; jobs_per_day: number };
  keys: { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
  usage: { day: string; requests: number; rows_parsed: number; jobs: number }[];
  requests: { request_id: string; method: string; path: string; status: number; duration_ms: number; created_at: string; prefix: string }[];
  jobs: { id: string; status: string; filename: string | null; bytes: number; summary: { transactions: number } | null; error: string | null; created_at: string }[];
  endpoints: { id: string; url: string; events: string[]; created_at: string }[];
  deliveries: {
    id: string;
    endpoint_id: string;
    event_type: string;
    status: string;
    attempts: number;
    next_attempt_at: string;
    last_status_code: number | null;
    last_error: string | null;
    created_at: string;
  }[];
  inbox: {
    token: string;
    fail_next: number;
    events: { id: number; headers: Record<string, string | null>; body: string; signature_valid: boolean; responded: number; created_at: string }[];
  } | null;
}

type TryResult = { status: number; ms: number; headers: [string, string][]; body: string };

const SAMPLES = [
  ["sparkasse", "Sparkasse (semicolons, 1.234,56, Windows-1252)"],
  ["chase-checking", "Chase (newest first, trailing commas)"],
  ["monzo", "Monzo (18 columns)"],
] as const;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "X-Console": "1", "Content-Type": "application/json", ...init.headers } });
  if (!res.ok) {
    const p = (await res.json().catch(() => ({}))) as { title?: string; detail?: string };
    throw new Error(p.detail ?? p.title ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? null : res.json()) as T;
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return `in ${fmtSpan(-s)}`;
  if (s < 5) return "just now";
  return `${fmtSpan(s)} ago`;
};
const fmtSpan = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);

export function Console() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  // The plain key is only ever in memory: it's needed for "Try it" and gone on reload.
  const [liveKey, setLiveKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setData(await call<Overview>("/api/console/overview", { headers: {} }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    call("/api/console/session", { method: "POST" })
      .then(() => {
        if (alive) void refresh();
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [refresh]);

  // Poll faster while something is in flight; the console's polling also moves retries along.
  const pending = !!data && (data.deliveries.some((d) => d.status === "pending") || data.jobs.some((j) => j.status === "queued" || j.status === "processing"));
  useEffect(() => {
    const id = setInterval(() => {
      void refresh();
      tick((n) => n + 1);
    }, pending ? 3000 : 15000);
    return () => clearInterval(id);
  }, [pending, refresh]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const activeKeys = data?.keys.filter((k) => !k.revoked_at) ?? [];

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      {error && (
        <p role="alert" className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn lg:col-span-2">
          {error}
        </p>
      )}

      {/* Keys */}
      <Card title="API keys" subtitle={data ? `${activeKeys.length} of 5 active` : undefined}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "");
            const form = e.currentTarget;
            void act("key", async () => {
              const k = await call<{ key: string }>("/api/console/keys", { method: "POST", body: JSON.stringify({ name }) });
              setNewKey({ key: k.key, name: name || "Untitled key" });
              setLiveKey(k.key);
              form.reset();
            });
          }}
        >
          <label className="sr-only" htmlFor="key-name">
            Key name
          </label>
          <input id="key-name" name="name" placeholder="Key name, e.g. Staging" maxLength={60} className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
          <button disabled={busy === "key" || !data} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50">
            Create key
          </button>
        </form>
        {newKey && (
          <div className="mt-4 rounded-xl border border-accent bg-accent-soft p-4" role="status">
            <p className="text-sm font-medium">Copy “{newKey.name}” now. It won&apos;t be shown again.</p>
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="new-key">
                {newKey.key}
              </code>
              <CopyButton text={newKey.key} className="shrink-0 bg-accent text-accent-ink hover:opacity-90" />
            </div>
            <button type="button" onClick={() => setNewKey(null)} className="mt-2 text-xs text-muted underline">
              I&apos;ve saved it
            </button>
          </div>
        )}
        <ul className="mt-4 divide-y divide-line">
          {data?.keys.length === 0 && <li className="py-6 text-center text-sm text-muted">No keys yet. Create one to start.</li>}
          {data?.keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className={`font-medium ${k.revoked_at ? "text-muted line-through" : ""}`}>{k.name}</span>
              <code className="font-mono text-xs text-muted">{k.prefix}…</code>
              <span className="ml-auto text-xs text-muted">{k.revoked_at ? `revoked ${ago(k.revoked_at)}` : `used ${ago(k.last_used_at)}`}</span>
              {!k.revoked_at && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Revoke “${k.name}”? Requests with it will fail right away.`)) {
                      void act(`revoke-${k.id}`, () => call(`/api/console/keys/${k.id}`, { method: "DELETE" }));
                    }
                  }}
                  className="rounded-md px-2 py-1 text-xs text-neg transition hover:bg-surface-2"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {/* Usage */}
      <Card title="Usage, last 14 days" subtitle={data ? `limits: ${data.limits.requests_per_minute}/min · ${data.limits.requests_per_day.toLocaleString()}/day` : undefined}>
        {data ? <UsageChart usage={data.usage} /> : <div className="h-44 animate-pulse rounded-lg bg-surface-2" aria-hidden />}
      </Card>

      {/* Try it */}
      <TryIt apiKey={liveKey} onDone={refresh} />

      {/* Webhooks */}
      <Card title="Webhooks" subtitle="job.succeeded · job.failed">
        <div className="flex flex-wrap gap-2">
          {data && !data.inbox && (
            <button
              type="button"
              disabled={busy === "inbox"}
              onClick={() => void act("inbox", () => call("/api/console/inbox", { method: "POST" }))}
              className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
            >
              Add a test inbox
            </button>
          )}
          {data?.inbox && (
            <button
              type="button"
              onClick={() => void act("flaky", () => call("/api/console/inbox/flaky", { method: "POST", body: JSON.stringify({ fail: 2 }) }))}
              className="rounded-lg border border-line px-3 py-2 text-sm transition hover:border-line-strong"
              title="The inbox answers 500 to the next two deliveries, so you can watch retries"
            >
              {data.inbox.fail_next ? `Inbox will fail the next ${data.inbox.fail_next}` : "Make the inbox fail twice"}
            </button>
          )}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const url = String(new FormData(form).get("url") ?? "");
            void act("endpoint", async () => {
              const ep = await call<{ secret: string }>("/api/console/webhooks", { method: "POST", body: JSON.stringify({ url }) });
              alert(`Endpoint added. Its signing secret (shown once):\n\n${ep.secret}`);
              form.reset();
            });
          }}
        >
          <label className="sr-only" htmlFor="hook-url">
            Your webhook URL
          </label>
          <input id="hook-url" name="url" type="url" required placeholder="https://your-app.com/webhooks/tillread" className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
          <button disabled={busy === "endpoint"} className="rounded-lg border border-line px-3 py-2 text-sm transition hover:border-line-strong disabled:opacity-50">
            Add
          </button>
        </form>
        <ul className="mt-3 space-y-1.5">
          {data?.endpoints.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
              <code className="min-w-0 flex-1 truncate font-mono" title={e.url}>
                {e.url.includes("/api/inbox/") ? "Test inbox (this site)" : e.url}
              </code>
              <button type="button" onClick={() => void act(`ping-${e.id}`, () => call(`/api/console/webhooks/${e.id}/test`, { method: "POST" }))} className="rounded px-2 py-1 transition hover:bg-surface">
                Send test
              </button>
              <button type="button" onClick={() => void act(`del-${e.id}`, () => call(`/api/console/webhooks/${e.id}`, { method: "DELETE" }))} className="rounded px-2 py-1 text-neg transition hover:bg-surface">
                Remove
              </button>
            </li>
          ))}
        </ul>
        {data && data.deliveries.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[440px] text-xs">
              <caption className="mb-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted">Deliveries</caption>
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-medium">Event</th>
                  <th className="py-1 font-medium">Status</th>
                  <th className="py-1 font-medium">Tries</th>
                  <th className="py-1 font-medium">Last answer</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {data.deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="py-1.5 font-mono">{d.event_type}</td>
                    <td className="py-1.5">
                      <Pill tone={d.status === "succeeded" ? "ok" : d.status === "failed" ? "bad" : "wait"}>
                        {d.status === "pending" ? `retry ${ago(d.next_attempt_at)}` : d.status}
                      </Pill>
                    </td>
                    <td className="py-1.5 tabular">{d.attempts}</td>
                    <td className="py-1.5 text-muted">{d.last_status_code ?? d.last_error ?? "—"}</td>
                    <td className="py-1.5 text-right">
                      {d.status !== "succeeded" && (
                        <button type="button" onClick={() => void act(`retry-${d.id}`, () => call(`/api/console/deliveries/${d.id}/retry`, { method: "POST" }))} className="rounded px-2 py-0.5 transition hover:bg-surface-2">
                          Retry now
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.inbox && data.inbox.events.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Test inbox received</p>
            <ul className="mt-1 space-y-1.5">
              {data.inbox.events.map((ev) => (
                <li key={ev.id}>
                  <details className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <Pill tone={ev.responded === 200 ? "ok" : "bad"}>answered {ev.responded}</Pill>
                      <span className={ev.signature_valid ? "text-pos" : "text-neg"}>{ev.signature_valid ? "✓ signature valid" : "✗ bad signature"}</span>
                      <span className="ml-auto text-muted">{ago(ev.created_at)}</span>
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted">
                      {`Tillread-Signature: ${ev.headers["tillread-signature"]}\n\n${prettyJson(ev.body)}`}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Requests */}
      <Card title="Recent requests" className="lg:col-span-2">
        {data?.requests.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-medium">Time</th>
                  <th className="py-1 font-medium">Request</th>
                  <th className="py-1 font-medium">Status</th>
                  <th className="py-1 text-right font-medium">Duration</th>
                  <th className="py-1 pl-4 font-medium">Key</th>
                  <th className="py-1 font-medium">Request id</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.requests.map((r) => (
                  <tr key={r.request_id} className="border-t border-line">
                    <td className="py-1.5 font-sans text-muted">{ago(r.created_at)}</td>
                    <td className="py-1.5">
                      {r.method} {r.path}
                    </td>
                    <td className="py-1.5">
                      <Pill tone={r.status < 300 ? "ok" : r.status === 429 ? "wait" : "bad"}>{r.status}</Pill>
                    </td>
                    <td className="py-1.5 text-right tabular">{r.duration_ms} ms</td>
                    <td className="py-1.5 pl-4 text-muted">{r.prefix}…</td>
                    <td className="py-1.5 text-muted">{r.request_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted">Requests made with your keys show up here.</p>
        )}
        {data && data.jobs.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Jobs</p>
            <ul className="mt-1 divide-y divide-line">
              {data.jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                  <code className="font-mono">{j.id}</code>
                  <Pill tone={j.status === "succeeded" ? "ok" : j.status === "failed" ? "bad" : "wait"}>{j.status}</Pill>
                  <span className="text-muted">{j.filename ?? "unnamed"} · {(j.bytes / 1024).toFixed(1)} KB</span>
                  {j.summary && <span className="text-muted">{j.summary.transactions} transactions</span>}
                  <span className="ml-auto text-muted">{ago(j.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

const prettyJson = (s: string) => {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Pill({ tone, children }: { tone: "ok" | "bad" | "wait"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-accent-soft text-pos" : tone === "bad" ? "bg-[color-mix(in_oklab,var(--neg)_14%,transparent)] text-neg" : "bg-warn-soft text-warn";
  return <span className={`inline-block rounded-full px-2 py-0.5 font-sans text-[11px] font-medium ${cls}`}>{children}</span>;
}

function UsageChart({ usage }: { usage: Overview["usage"] }) {
  const days = useMemo(() => {
    const out: { day: string; requests: number; rows: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
      const u = usage.find((x) => x.day === d);
      out.push({ day: d, requests: u?.requests ?? 0, rows: u?.rows_parsed ?? 0 });
    }
    return out;
  }, [usage]);
  const max = Math.max(10, ...days.map((d) => d.requests));
  const total = days.reduce((s, d) => s + d.requests, 0);
  const rows = days.reduce((s, d) => s + d.rows, 0);
  return (
    <div>
      <dl className="flex gap-8">
        <div>
          <dt className="text-xs text-muted">Requests</dt>
          <dd className="font-serif text-3xl tabular">{total.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Rows parsed</dt>
          <dd className="font-serif text-3xl tabular">{rows.toLocaleString()}</dd>
        </div>
      </dl>
      <div className="mt-4 flex h-28 items-end gap-1" role="img" aria-label={`Requests per day for the last 14 days, ${total} in total`}>
        {days.map((d) => (
          <div key={d.day} className="group relative flex-1" title={`${d.day}: ${d.requests} requests, ${d.rows} rows`}>
            <div className="rounded-t bg-accent/80 transition group-hover:bg-accent" style={{ height: `${Math.max(2, (d.requests / max) * 112)}px`, opacity: d.requests ? 1 : 0.25 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{days[0]!.day.slice(5)}</span>
        <span>today</span>
      </div>
    </div>
  );
}

function TryIt({ apiKey, onDone }: { apiKey: string | null; onDone: () => void }) {
  const [sample, setSample] = useState<string>(SAMPLES[0][0]);
  const [result, setResult] = useState<TryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"parse" | "jobs">("parse");

  const run = async () => {
    if (!apiKey) return;
    setRunning(true);
    try {
      const bytes = await (await fetch(`/samples/${sample}.csv`)).arrayBuffer();
      const t = performance.now();
      const res = await fetch(mode === "parse" ? "/v1/parse" : `/v1/jobs?filename=${sample}.csv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "text/csv" },
        body: bytes,
      });
      const ms = Math.round(performance.now() - t);
      const text = await res.text();
      const keep = ["content-type", "ratelimit", "ratelimit-policy", "x-request-id", "location", "retry-after"];
      setResult({ status: res.status, ms, headers: [...res.headers].filter(([k]) => keep.includes(k)), body: text });
      onDone();
    } finally {
      setRunning(false);
    }
  };

  const curl = `curl -X POST ${typeof window === "undefined" ? "" : window.location.origin}/v1/${mode === "parse" ? "parse" : "jobs"} \\\n  -H "Authorization: Bearer ${apiKey ? `${apiKey.slice(0, 12)}…` : "$TILLREAD_KEY"}" \\\n  -H "Content-Type: text/csv" \\\n  --data-binary @${sample}.csv`;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-label="Try it">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Try it</h2>
        <span className="text-xs text-muted">real requests with your new key</span>
      </div>
      {!apiKey ? (
        <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-muted">Create a key and it can be used here until you reload the page.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div role="radiogroup" aria-label="Endpoint" className="flex rounded-lg border border-line p-0.5 text-sm">
              {(["parse", "jobs"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 font-mono text-xs transition ${mode === m ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
                  POST /v1/{m}
                </button>
              ))}
            </div>
            <select aria-label="Sample file" value={sample} onChange={(e) => setSample(e.target.value)} className="min-w-0 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm">
              {SAMPLES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void run()} disabled={running} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50">
              {running ? "Sending…" : "Send"}
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-code-bg p-3 font-mono text-[11.5px] leading-relaxed text-code-ink">{curl}</pre>
          {result && (
            <div className="mt-3 overflow-hidden rounded-lg border border-line" data-testid="try-result">
              <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5 text-xs">
                <Pill tone={result.status < 300 ? "ok" : result.status === 429 ? "wait" : "bad"}>{result.status}</Pill>
                <span className="text-muted">{result.ms} ms</span>
              </div>
              <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
                {result.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
                {"\n\n"}
                {prettyJson(result.body).slice(0, 4000)}
              </pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
