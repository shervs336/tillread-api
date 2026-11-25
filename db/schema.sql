-- Tillread API schema. Run once in the Supabase SQL editor (or any Postgres 15+).
-- Everything lives in its own schema so it can share a database with other apps.
-- Row Level Security is on with no policies: the tables are reachable only through the
-- server's direct database connection, never through Supabase's public REST API.

create schema if not exists tillread;

-- A console is an anonymous account: a browser session that owns API keys and webhook endpoints.
create table if not exists tillread.consoles (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists consoles_ip_day on tillread.consoles (ip_hash, created_at);

create table if not exists tillread.api_keys (
  id uuid primary key default gen_random_uuid(),
  console_id uuid not null references tillread.consoles (id) on delete cascade,
  name text not null,
  prefix text not null,
  hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_console on tillread.api_keys (console_id);

-- Token bucket per key. `allowed` records whether the last request took a token.
create table if not exists tillread.rate_buckets (
  key_id uuid primary key references tillread.api_keys (id) on delete cascade,
  tokens double precision not null,
  allowed boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists tillread.usage_daily (
  key_id uuid not null references tillread.api_keys (id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  rows_parsed integer not null default 0,
  jobs integer not null default 0,
  primary key (key_id, day)
);

create table if not exists tillread.request_log (
  id bigint generated always as identity primary key,
  request_id text not null,
  key_id uuid references tillread.api_keys (id) on delete cascade,
  method text not null,
  path text not null,
  status integer not null,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);
create index if not exists request_log_key_time on tillread.request_log (key_id, created_at desc);

create table if not exists tillread.jobs (
  id text primary key,
  key_id uuid not null references tillread.api_keys (id) on delete cascade,
  status text not null check (status in ('queued', 'processing', 'succeeded', 'failed')),
  filename text,
  bytes integer not null,
  options jsonb not null default '{}',
  input bytea,
  summary jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0,
  idempotency_key text,
  request_hash text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (key_id, idempotency_key)
);
create index if not exists jobs_key_time on tillread.jobs (key_id, created_at desc);
create index if not exists jobs_pending on tillread.jobs (status, created_at) where status in ('queued', 'processing');

create table if not exists tillread.webhook_endpoints (
  id text primary key,
  console_id uuid not null references tillread.consoles (id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null,
  description text,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index if not exists webhook_endpoints_console on tillread.webhook_endpoints (console_id);

create table if not exists tillread.webhook_deliveries (
  id text primary key,
  endpoint_id text not null references tillread.webhook_endpoints (id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status_code integer,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists webhook_deliveries_due on tillread.webhook_deliveries (next_attempt_at) where status = 'pending';
create index if not exists webhook_deliveries_endpoint on tillread.webhook_deliveries (endpoint_id, created_at desc);

-- A built-in receiver for trying webhooks without running a server.
create table if not exists tillread.inboxes (
  token text primary key,
  console_id uuid not null references tillread.consoles (id) on delete cascade,
  fail_next integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists tillread.inbox_events (
  id bigint generated always as identity primary key,
  token text not null references tillread.inboxes (token) on delete cascade,
  headers jsonb not null,
  body text not null,
  signature_valid boolean not null,
  responded integer not null,
  created_at timestamptz not null default now()
);
create index if not exists inbox_events_token on tillread.inbox_events (token, created_at desc);

alter table tillread.consoles enable row level security;
alter table tillread.api_keys enable row level security;
alter table tillread.rate_buckets enable row level security;
alter table tillread.usage_daily enable row level security;
alter table tillread.request_log enable row level security;
alter table tillread.jobs enable row level security;
alter table tillread.webhook_endpoints enable row level security;
alter table tillread.webhook_deliveries enable row level security;
alter table tillread.inboxes enable row level security;
alter table tillread.inbox_events enable row level security;
