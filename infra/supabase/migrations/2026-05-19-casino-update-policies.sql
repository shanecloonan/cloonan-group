-- ============================================================================
-- MoneyFund Casino — additional UPDATE policies for upsert flows
-- ============================================================================
--
-- The original casino migration (2026-05-19-casino-tables.sql) only added
-- INSERT policies for `casino_users` and `casino_seed_pairs`. The Supabase
-- session driver does idempotent upserts (e.g. flipping a seed pair from
-- `active` → `retired` to publish the server seed on rotate), which under
-- the existing policy set fails with `new row violates RLS policy ...
-- INSERT` because PostgREST tries an UPDATE half on conflict.
--
-- This migration adds:
--   • UPDATE policy on `casino_users` so the bootstrap upsert succeeds
--     when the row already exists.
--   • UPDATE policy on `casino_seed_pairs` scoped to `auth.uid()` so the
--     user can retire their own seed pairs (recording the reveal) but
--     cannot mutate someone else's.
--
-- Idempotent (uses `if not exists` guards) — safe to re-run.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'casino_users'
      and policyname = 'casino_users_own_update'
  ) then
    create policy casino_users_own_update
      on public.casino_users
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'casino_seed_pairs'
      and policyname = 'casino_seed_pairs_own_update'
  ) then
    create policy casino_seed_pairs_own_update
      on public.casino_seed_pairs
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
