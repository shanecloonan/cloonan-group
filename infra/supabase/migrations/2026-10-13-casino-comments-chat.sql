-- Casino social: per-game comments + global live chat.
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- Public read, anonymous insert with length limits, no update/delete for anon/authenticated.
-- created_at is always set server-side; a trigger throttles each poster to one message per 3 seconds.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.casino_game_comments (
  id          bigint generated always as identity primary key,
  game_id     text        not null check (game_id ~ '^[a-z0-9-]{1,40}$'),
  username    text        not null check (char_length(btrim(username)) between 1 and 40),
  poster_id   text        not null check (char_length(poster_id) between 8 and 64),
  body        text        not null check (char_length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists casino_game_comments_game_created_idx
  on public.casino_game_comments (game_id, created_at desc, id desc);
create index if not exists casino_game_comments_poster_created_idx
  on public.casino_game_comments (poster_id, created_at desc);

create table if not exists public.casino_chat_messages (
  id          bigint generated always as identity primary key,
  username    text        not null check (char_length(btrim(username)) between 1 and 40),
  poster_id   text        not null check (char_length(poster_id) between 8 and 64),
  body        text        not null check (char_length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists casino_chat_messages_created_idx
  on public.casino_chat_messages (created_at desc, id desc);
create index if not exists casino_chat_messages_poster_created_idx
  on public.casino_chat_messages (poster_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Server-side timestamp + anti-spam throttle (1 post / 3 s per poster per table)
-- ---------------------------------------------------------------------------

create or replace function public.casino_social_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  new.created_at := now();
  new.username := btrim(new.username);
  new.body := btrim(new.body);

  if tg_table_name = 'casino_game_comments' then
    select count(*) into recent from public.casino_game_comments
      where poster_id = new.poster_id and created_at > now() - interval '3 seconds';
  else
    select count(*) into recent from public.casino_chat_messages
      where poster_id = new.poster_id and created_at > now() - interval '3 seconds';
  end if;

  if recent > 0 then
    raise exception 'Slow down: one message every few seconds.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists casino_game_comments_before_insert on public.casino_game_comments;
create trigger casino_game_comments_before_insert
  before insert on public.casino_game_comments
  for each row execute function public.casino_social_before_insert();

drop trigger if exists casino_chat_messages_before_insert on public.casino_chat_messages;
create trigger casino_chat_messages_before_insert
  before insert on public.casino_chat_messages
  for each row execute function public.casino_social_before_insert();

-- ---------------------------------------------------------------------------
-- RLS: public read, insert only; no update/delete
-- ---------------------------------------------------------------------------

alter table public.casino_game_comments enable row level security;
alter table public.casino_chat_messages enable row level security;

drop policy if exists casino_game_comments_public_read on public.casino_game_comments;
create policy casino_game_comments_public_read
  on public.casino_game_comments for select
  to anon, authenticated
  using (true);

drop policy if exists casino_game_comments_public_insert on public.casino_game_comments;
create policy casino_game_comments_public_insert
  on public.casino_game_comments for insert
  to anon, authenticated
  with check (
    char_length(btrim(body)) between 1 and 500
    and char_length(btrim(username)) between 1 and 40
  );

drop policy if exists casino_chat_messages_public_read on public.casino_chat_messages;
create policy casino_chat_messages_public_read
  on public.casino_chat_messages for select
  to anon, authenticated
  using (true);

drop policy if exists casino_chat_messages_public_insert on public.casino_chat_messages;
create policy casino_chat_messages_public_insert
  on public.casino_chat_messages for insert
  to anon, authenticated
  with check (
    char_length(btrim(body)) between 1 and 500
    and char_length(btrim(username)) between 1 and 40
  );

revoke update, delete, truncate on public.casino_game_comments from anon, authenticated;
revoke update, delete, truncate on public.casino_chat_messages from anon, authenticated;
grant select, insert on public.casino_game_comments to anon, authenticated;
grant select, insert on public.casino_chat_messages to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast chat inserts
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'casino_chat_messages'
  ) then
    alter publication supabase_realtime add table public.casino_chat_messages;
  end if;
end $$;
