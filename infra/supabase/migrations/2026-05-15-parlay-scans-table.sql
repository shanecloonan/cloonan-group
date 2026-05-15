-- ============================================================================
-- Parlay scan history
-- ============================================================================
--
-- Persists each run of `scanDailyParlays()` from lib/parlay-scanner.ts so the
-- /parlays UI can show "today's run vs. yesterday's run" diffs, and we can
-- later backtest the engine against settled outcomes.
--
-- The table is OPTIONAL infrastructure: `persistScanReport` silently no-ops
-- if the table is missing, so a fresh dev environment never needs to run
-- this migration just to use the scanner.
-- ============================================================================

create table if not exists public.parlay_scans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,
  source            text not null,                 -- 'odds-api' | 'mock'
  events_considered integer not null default 0,
  picks             jsonb  not null default '[]'::jsonb,
  warnings          jsonb  not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists parlay_scans_created_idx
  on public.parlay_scans (created_at desc);

create index if not exists parlay_scans_user_idx
  on public.parlay_scans (user_id, created_at desc);

-- RLS -----------------------------------------------------------------------

alter table public.parlay_scans enable row level security;

do $$
begin
  -- Anonymous + authenticated users can read any scan (it's quant alpha,
  -- not PII), but only the owner (or service role) can insert.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'parlay_scans'
      and policyname = 'parlay_scans_public_read'
  ) then
    create policy parlay_scans_public_read on public.parlay_scans
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'parlay_scans'
      and policyname = 'parlay_scans_anon_insert'
  ) then
    -- Allow client-side inserts; we tag user_id from auth.uid() when available.
    create policy parlay_scans_anon_insert on public.parlay_scans
      for insert with check (
        user_id is null or auth.uid() = user_id
      );
  end if;
end $$;
