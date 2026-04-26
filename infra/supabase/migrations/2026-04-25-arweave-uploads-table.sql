-- ============================================================================
-- Arweave upload log
-- ============================================================================
--
-- Tracks every Arweave transaction the app initiates — both L1 direct
-- submissions and Turbo-bundled ones. Used by the Arweave history UI to
-- merge locally-known uploads with what the chain returns via GQL.
--
-- The table is optional infrastructure: ArweaveGateway.safeUploadLog /
-- safeUploadUpdate silently no-op if the table isn't there, so missing
-- migrations never block actual uploads.
-- ============================================================================

create table if not exists public.arweave_uploads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tx_id       text not null,
  filename    text,
  description text,
  content_type text,
  data_size   bigint not null default 0,
  tags        jsonb not null default '[]'::jsonb,
  status      text not null default 'preparing',
  cost_winston text,
  cost_ar     text,
  upload_method text,
  bundle_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists arweave_uploads_tx_id_uidx
  on public.arweave_uploads (tx_id);

create index if not exists arweave_uploads_user_idx
  on public.arweave_uploads (user_id, created_at desc);

-- updated_at bookkeeping ----------------------------------------------------

create or replace function public.arweave_uploads_set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists arweave_uploads_updated_at on public.arweave_uploads;
create trigger arweave_uploads_updated_at
  before update on public.arweave_uploads
  for each row execute function public.arweave_uploads_set_updated_at();

-- RLS -----------------------------------------------------------------------

alter table public.arweave_uploads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'arweave_uploads'
      and policyname = 'arweave_uploads_own_read'
  ) then
    create policy arweave_uploads_own_read on public.arweave_uploads
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'arweave_uploads'
      and policyname = 'arweave_uploads_own_write'
  ) then
    create policy arweave_uploads_own_write on public.arweave_uploads
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'arweave_uploads'
      and policyname = 'arweave_uploads_own_update'
  ) then
    create policy arweave_uploads_own_update on public.arweave_uploads
      for update using (auth.uid() = user_id);
  end if;
end $$;
