-- Parallel Procurement Dashboard schema (BYOK Gateway edition)
--
-- Multi-tenant Postgres schema. Authentication is paste-key only:
-- the user signs up by pasting their own Parallel API key, which is
-- stored as one row in `integrations`. Slack + Email integrations follow
-- the same pattern (every external-provider call uses a key the user
-- brought themselves; the platform never holds a managed key).
--
-- A signed JWT cookie (set in app code, not Supabase Auth) carries the
-- account id. RLS scopes every table to that account.
--
-- Apply with:  supabase db push    (or)    psql $SUPABASE_DB_URL -f schema.sql
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_account_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.account_id', true), '')::uuid
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- accounts
-- Identity is the user's email. Per-provider secrets live in `integrations`.
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  email_hash    text not null unique,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  onboarded_at  timestamptz
);

-- Backfill columns from the previous OAuth-based schema, then drop them.
alter table public.accounts drop column if exists parallel_key_hash;
alter table public.accounts drop column if exists parallel_api_key_encrypted;

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- integrations  (BYOK secrets per provider per account)
-- ---------------------------------------------------------------------------
create table if not exists public.integrations (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  provider           text not null check (provider in ('parallel','slack','email')),
  label              text not null default 'default',
  encrypted_secret   bytea not null,
  secret_hash        text not null,
  metadata           jsonb not null default '{}'::jsonb,
  status             text not null default 'active' check (status in ('active','revoked','failed')),
  is_default         boolean not null default true,
  last_used_at       timestamptz,
  last_test_at       timestamptz,
  last_test_ok       boolean,
  last_test_error    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (account_id, provider, label)
);

drop trigger if exists trg_integrations_updated_at on public.integrations;
create trigger trg_integrations_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

create index if not exists idx_integrations_account_provider
  on public.integrations (account_id, provider, is_default desc, status);

-- Drop the old PKCE state table; paste-key flow does not need it.
drop table if exists public.oauth_pkce;

-- ---------------------------------------------------------------------------
-- vendors
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  vendor_name           text not null,
  vendor_domain         text not null,
  vendor_category       text not null default 'other',
  relationship_owner    text,
  region                text,
  monitoring_priority   text not null default 'medium' check (monitoring_priority in ('low','medium','high')),
  risk_tier_override    text check (risk_tier_override in ('LOW','MEDIUM','HIGH','CRITICAL')),
  next_research_date    date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (account_id, vendor_domain)
);

drop trigger if exists trg_vendors_updated_at on public.vendors;
create trigger trg_vendors_updated_at
before update on public.vendors
for each row execute function public.set_updated_at();

create index if not exists idx_vendors_account_id on public.vendors (account_id);

-- ---------------------------------------------------------------------------
-- risk_assessments
-- ---------------------------------------------------------------------------
create table if not exists public.risk_assessments (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  vendor_id           uuid not null references public.vendors(id) on delete cascade,
  parallel_run_id     text,
  task_group_id       text,
  status              text not null default 'pending' check (status in ('pending','running','completed','failed')),
  risk_level          text check (risk_level in ('LOW','MEDIUM','HIGH','CRITICAL')),
  score               int,
  recommendation      text,
  adverse_flag        boolean default false,
  action_required     boolean default false,
  dimensions          jsonb,
  adverse_events      jsonb,
  triggered_overrides jsonb,
  summary             text,
  raw_output          jsonb,
  assessment_date     date not null default current_date,
  movement            int default 0,
  previous_score      int,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_risk_assessments_updated_at on public.risk_assessments;
create trigger trg_risk_assessments_updated_at
before update on public.risk_assessments
for each row execute function public.set_updated_at();

create unique index if not exists idx_risk_assessments_run_id
  on public.risk_assessments (parallel_run_id)
  where parallel_run_id is not null;

create index if not exists idx_risk_assessments_account on public.risk_assessments (account_id);
create index if not exists idx_risk_assessments_vendor on public.risk_assessments (vendor_id);
create index if not exists idx_risk_assessments_task_group on public.risk_assessments (task_group_id);

-- ---------------------------------------------------------------------------
-- task_groups
-- ---------------------------------------------------------------------------
create table if not exists public.task_groups (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  task_group_id       text not null unique,
  total_runs          int not null default 0,
  completed_runs      int not null default 0,
  failed_runs         int not null default 0,
  status              text not null default 'running' check (status in ('running','completed','failed')),
  kind                text not null default 'research',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_task_groups_updated_at on public.task_groups;
create trigger trg_task_groups_updated_at
before update on public.task_groups
for each row execute function public.set_updated_at();

create index if not exists idx_task_groups_account on public.task_groups (account_id);

-- ---------------------------------------------------------------------------
-- monitors
-- ---------------------------------------------------------------------------
create table if not exists public.monitors (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  vendor_id            uuid not null references public.vendors(id) on delete cascade,
  parallel_monitor_id  text not null unique,
  dimension            text not null,
  monitor_category     text,
  cadence              text not null,
  query                text not null,
  -- Parallel V1 spells it "cancelled" (double-l); keep our column in lock-step
  -- so a future "mirror remote status" feature doesn't fail the CHECK. The
  -- legacy 'watching' and 'needs_review' values were never written by code,
  -- so we drop them from the allowed set too.
  status               text not null default 'active' check (status in ('active','cancelled','failed')),
  last_event_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_monitors_updated_at on public.monitors;
create trigger trg_monitors_updated_at
before update on public.monitors
for each row execute function public.set_updated_at();

create index if not exists idx_monitors_account on public.monitors (account_id);
create index if not exists idx_monitors_vendor on public.monitors (vendor_id);

-- ---------------------------------------------------------------------------
-- monitor_events
-- ---------------------------------------------------------------------------
create table if not exists public.monitor_events (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  vendor_id                uuid not null references public.vendors(id) on delete cascade,
  monitor_id               uuid references public.monitors(id) on delete set null,
  parallel_event_id        text unique,
  parallel_event_group_id  text,
  parallel_monitor_id      text,
  severity                 text check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  dimension                text,
  title                    text not null,
  detail                   text,
  source_url               text,
  raw_payload              jsonb,
  received_at              timestamptz not null default now()
);

create index if not exists idx_monitor_events_account on public.monitor_events (account_id);
create index if not exists idx_monitor_events_vendor on public.monitor_events (vendor_id, received_at desc);
create index if not exists idx_monitor_events_received_at on public.monitor_events (received_at desc);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  actor       text,
  action      text not null,
  subject     text,
  metadata    jsonb,
  at          timestamptz not null default now()
);

create index if not exists idx_audit_log_account_at
  on public.audit_log (account_id, at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.accounts          enable row level security;
alter table public.integrations      enable row level security;
alter table public.vendors           enable row level security;
alter table public.risk_assessments  enable row level security;
alter table public.task_groups       enable row level security;
alter table public.monitors          enable row level security;
alter table public.monitor_events    enable row level security;
alter table public.audit_log         enable row level security;

drop policy if exists "accounts_self" on public.accounts;
create policy "accounts_self" on public.accounts
  using (id = public.current_account_id())
  with check (id = public.current_account_id());

drop policy if exists "integrations_account" on public.integrations;
create policy "integrations_account" on public.integrations
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

drop policy if exists "vendors_account" on public.vendors;
create policy "vendors_account" on public.vendors
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

drop policy if exists "risk_assessments_account" on public.risk_assessments;
create policy "risk_assessments_account" on public.risk_assessments
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

drop policy if exists "task_groups_account" on public.task_groups;
create policy "task_groups_account" on public.task_groups
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

drop policy if exists "monitors_account" on public.monitors;
create policy "monitors_account" on public.monitors
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

drop policy if exists "monitor_events_account" on public.monitor_events;
create policy "monitor_events_account" on public.monitor_events
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

drop policy if exists "audit_log_account" on public.audit_log;
create policy "audit_log_account" on public.audit_log
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());
