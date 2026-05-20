-- Multiplayer poker rooms (shared table state + realtime-friendly version column)

create table if not exists public.casino_poker_rooms (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null unique,
  status        text not null default 'waiting' check (status in ('waiting', 'active', 'complete')),
  max_seats     int not null default 6 check (max_seats between 2 and 6),
  big_blind     text not null,
  small_blind   text not null,
  buy_in        text not null,
  seat_users    jsonb not null default '{}'::jsonb,
  session_json  jsonb,
  version       int not null default 0,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists casino_poker_rooms_status_idx
  on public.casino_poker_rooms (status, updated_at desc);

create index if not exists casino_poker_rooms_code_idx
  on public.casino_poker_rooms (room_code);

alter table public.casino_poker_rooms enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'casino_poker_rooms' and policyname = 'casino_poker_rooms_read'
  ) then
    create policy casino_poker_rooms_read on public.casino_poker_rooms
      for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'casino_poker_rooms' and policyname = 'casino_poker_rooms_insert'
  ) then
    create policy casino_poker_rooms_insert on public.casino_poker_rooms
      for insert to authenticated with check (created_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'casino_poker_rooms' and policyname = 'casino_poker_rooms_update'
  ) then
    create policy casino_poker_rooms_update on public.casino_poker_rooms
      for update to authenticated using (true) with check (true);
  end if;
end $$;
