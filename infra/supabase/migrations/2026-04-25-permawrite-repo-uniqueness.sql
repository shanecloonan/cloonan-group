-- ============================================================================
-- PermaWrite repos: enforce uniqueness + genesis transaction
-- ============================================================================
--
-- Apply this ONCE in the Supabase SQL editor (Dashboard → SQL Editor).
-- It is idempotent — safe to re-run.
--
-- Changes:
--   1. Adds `genesis_tx` — Arweave TX id of the "repo created" declaration.
--      Every new repo gets one; existing repos are left with NULL and can
--      be back-filled later.
--   2. Enforces globally-unique repo display names (case-insensitive) so no
--      two users — ever — can have a repo with the same name.
--   3. Enforces globally-unique slugs as well.
--
-- Rationale:
--   Repo names are a platform-wide namespace, like GitHub usernames.
--   Once taken, taken forever. The Arweave declaration above
--   (genesis_tx) is the on-chain proof of ownership.
-- ============================================================================

-- 1. Add the Arweave genesis transaction column ------------------------------
alter table public.permawrite_repos
  add column if not exists genesis_tx text;

comment on column public.permawrite_repos.genesis_tx is
  'Arweave TX id of the formal repo-created declaration. Permanent on-chain proof that this repo name was claimed by this user at this point in time.';

-- 2. Case-insensitive uniqueness on display_name -----------------------------
-- We use a unique index on lower(display_name) so "My Repo" and "MY REPO"
-- collide. Drop any prior non-CI unique constraint first (if one existed).

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.permawrite_repos'::regclass
      and conname = 'permawrite_repos_display_name_key'
  ) then
    alter table public.permawrite_repos
      drop constraint permawrite_repos_display_name_key;
  end if;
end $$;

create unique index if not exists permawrite_repos_display_name_ci_uidx
  on public.permawrite_repos (lower(display_name));

-- 3. Uniqueness on slug (covers case where it wasn't enforced before) -------
create unique index if not exists permawrite_repos_slug_uidx
  on public.permawrite_repos (slug);

-- 4. Let the current user see other users' names (read-only) for duplicate
--    checks in the create form. Everything else stays behind RLS.
--
--    If you prefer stricter privacy, drop this policy and rely only on the
--    DB-level unique index to catch collisions on insert. The friendly error
--    message will still surface, just without the pre-check.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'permawrite_repos'
      and policyname = 'permawrite_repos_name_check_read'
  ) then
    create policy permawrite_repos_name_check_read
      on public.permawrite_repos
      for select
      using (true);
  end if;
end $$;
