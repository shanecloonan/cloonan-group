-- ============================================================================
-- PermaWrite items table
-- ============================================================================
--
-- Tracks every PermaWrite entry — both private-to-user uploads living in
-- Supabase Storage and public "permawrite" entries archived on Arweave.
-- Shape matches the `PermawriteItem` interface in `lib/permawrite.ts`.
--
-- The insert is also defensive on the client side (safePermawriteInsert):
-- if this migration has not yet been applied, uploads to Arweave still
-- succeed and we surface a best-effort item back to the UI. Once this
-- runs, uploads start getting logged properly.
-- ============================================================================

create table if not exists public.permawrite_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text,
  description    text,
  category_slug  text not null,
  tags           text[] not null default '{}',
  visibility     text not null default 'private'
                   check (visibility in ('private', 'permawrite')),
  file_name      text,
  file_size      bigint not null default 0,
  content_type   text,
  storage_path   text,
  arweave_tx_id  text,
  arweave_tags   jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Indexes: user-scoped lookups, public feed, category + tag filters --------

create index if not exists permawrite_items_user_idx
  on public.permawrite_items (user_id, created_at desc);

create index if not exists permawrite_items_visibility_idx
  on public.permawrite_items (visibility, created_at desc);

create index if not exists permawrite_items_category_idx
  on public.permawrite_items (category_slug, created_at desc);

create index if not exists permawrite_items_tags_idx
  on public.permawrite_items using gin (tags);

create unique index if not exists permawrite_items_arweave_tx_uidx
  on public.permawrite_items (arweave_tx_id)
  where arweave_tx_id is not null;

-- updated_at bookkeeping ----------------------------------------------------

create or replace function public.permawrite_items_set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists permawrite_items_updated_at on public.permawrite_items;
create trigger permawrite_items_updated_at
  before update on public.permawrite_items
  for each row execute function public.permawrite_items_set_updated_at();

-- RLS -----------------------------------------------------------------------
--
-- Owner can read/write their own rows. Anyone authenticated can read rows
-- where visibility = 'permawrite' (the public PermaWrite feed).

alter table public.permawrite_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'permawrite_items'
      and policyname = 'permawrite_items_own_read'
  ) then
    create policy permawrite_items_own_read on public.permawrite_items
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'permawrite_items'
      and policyname = 'permawrite_items_public_read'
  ) then
    create policy permawrite_items_public_read on public.permawrite_items
      for select using (visibility = 'permawrite');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'permawrite_items'
      and policyname = 'permawrite_items_own_insert'
  ) then
    create policy permawrite_items_own_insert on public.permawrite_items
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'permawrite_items'
      and policyname = 'permawrite_items_own_update'
  ) then
    create policy permawrite_items_own_update on public.permawrite_items
      for update using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'permawrite_items'
      and policyname = 'permawrite_items_own_delete'
  ) then
    create policy permawrite_items_own_delete on public.permawrite_items
      for delete using (auth.uid() = user_id);
  end if;
end $$;
