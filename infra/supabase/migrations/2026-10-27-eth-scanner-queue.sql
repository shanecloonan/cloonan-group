-- ============================================================================
-- ETH invariant scanner — queue, artifacts, results
-- ============================================================================
--
-- Durable Lane A/B storage for the Ethereum-only defensive scanner
-- (eth-scanner/). Service-role writes only; not exposed on the public site.
-- Canonical copy also lives at
--   eth-scanner/supabase/migrations/20261027_eth_scanner_queue.sql
-- so `npm run db:migrate:all` (infra/supabase/migrations) applies it.
--
-- Buckets (automation outputs, never a human verdict):
--   lane-a-cool | lane-b-queue | manual-review
--   | human-no-candidate | human-yes-candidate
--
-- Idempotent. Re-running is a no-op.
-- ============================================================================

create table if not exists public.eth_scan_targets (
  address          text primary key
                   check (address ~ '^0x[0-9a-f]{40}$'),
  bytecode_hash    text,
  tvl_usd          numeric,
  status           text not null default 'pending'
                   check (status in ('pending', 'running', 'done', 'skipped', 'error')),
  src_confidence   text check (src_confidence in ('high', 'med', 'low')),
  ir_confidence    text check (ir_confidence in ('high', 'med', 'low')),
  heat             integer not null default 0,
  bucket           text check (bucket in (
                     'lane-a-cool',
                     'lane-b-queue',
                     'manual-review',
                     'human-no-candidate',
                     'human-yes-candidate'
                   )),
  claimed_by       text,
  claimed_at       timestamptz,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists eth_scan_targets_bucket_status_idx
  on public.eth_scan_targets (bucket, status);

create index if not exists eth_scan_targets_bytecode_hash_idx
  on public.eth_scan_targets (bytecode_hash);

create index if not exists eth_scan_targets_claim_idx
  on public.eth_scan_targets (status, claimed_at);

create table if not exists public.eth_scan_artifacts (
  id               uuid primary key default gen_random_uuid(),
  address          text not null
                   references public.eth_scan_targets (address) on delete cascade,
  kind             text not null check (kind in ('source', 'decompile', 'ir', 'report')),
  path_or_json     jsonb not null default '{}'::jsonb,
  confidence       text check (confidence in ('high', 'med', 'low')),
  created_at       timestamptz not null default now()
);

create index if not exists eth_scan_artifacts_address_kind_idx
  on public.eth_scan_artifacts (address, kind, created_at desc);

create table if not exists public.eth_scan_results (
  id               uuid primary key default gen_random_uuid(),
  address          text not null
                   references public.eth_scan_targets (address) on delete cascade,
  bucket           text not null check (bucket in (
                     'lane-a-cool',
                     'lane-b-queue',
                     'manual-review',
                     'human-no-candidate',
                     'human-yes-candidate'
                   )),
  heat             integer not null default 0,
  stage_trace      jsonb not null default '[]'::jsonb,
  hypotheses       jsonb not null default '[]'::jsonb,
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists eth_scan_results_address_idx
  on public.eth_scan_results (address, created_at desc);

create index if not exists eth_scan_results_bucket_idx
  on public.eth_scan_results (bucket, created_at desc);

-- Touch updated_at on target writes -----------------------------------------

create or replace function public.eth_scan_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists eth_scan_targets_touch on public.eth_scan_targets;
create trigger eth_scan_targets_touch
  before update on public.eth_scan_targets
  for each row
  execute function public.eth_scan_touch_updated_at();

-- RLS: no anon/authenticated access. Service role bypasses RLS. -------------

alter table public.eth_scan_targets enable row level security;
alter table public.eth_scan_artifacts enable row level security;
alter table public.eth_scan_results enable row level security;

revoke all on public.eth_scan_targets from anon, authenticated;
revoke all on public.eth_scan_artifacts from anon, authenticated;
revoke all on public.eth_scan_results from anon, authenticated;

grant all on public.eth_scan_targets to service_role;
grant all on public.eth_scan_artifacts to service_role;
grant all on public.eth_scan_results to service_role;
