-- Realtime global bet feed: denormalized rows anon can subscribe to (without exposing casino_sessions).

create table if not exists public.casino_feed_events (
  session_id    uuid primary key references public.casino_sessions(id) on delete cascade,
  game_id         text not null,
  stake           numeric(78,0) not null,
  pnl             numeric(78,0) not null,
  token_symbol    text not null,
  display_label   text not null,
  is_public       boolean not null default true,
  settled_at      timestamptz not null
);

create index if not exists casino_feed_events_settled_idx
  on public.casino_feed_events (settled_at desc);

alter table public.casino_feed_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'casino_feed_events' and policyname = 'casino_feed_events_public_read'
  ) then
    create policy casino_feed_events_public_read
      on public.casino_feed_events
      for select
      using (true);
  end if;
end $$;

create or replace function public.casino_upsert_feed_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_public boolean;
  v_label text;
begin
  if new.status <> 'settled' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'settled' then
    return new;
  end if;

  select coalesce(p.show_on_leaderboard, true), p.display_name
  into v_public, v_label
  from public.casino_profiles p
  where p.user_id = new.user_id;

  v_public := coalesce(v_public, true);
  v_label := case
    when v_public then public.casino_display_label(new.user_id, v_label)
    else 'Private table'
  end;

  insert into public.casino_feed_events (
    session_id, game_id, stake, pnl, token_symbol, display_label, is_public, settled_at
  ) values (
    new.id,
    new.game_id,
    new.stake,
    public.casino_session_pnl(new.result),
    new.token_symbol,
    v_label,
    v_public,
    new.updated_at
  )
  on conflict (session_id) do update set
    game_id = excluded.game_id,
    stake = excluded.stake,
    pnl = excluded.pnl,
    token_symbol = excluded.token_symbol,
    display_label = excluded.display_label,
    is_public = excluded.is_public,
    settled_at = excluded.settled_at;

  return new;
end;
$$;

drop trigger if exists casino_sessions_feed_event on public.casino_sessions;
create trigger casino_sessions_feed_event
  after insert or update of status, result, updated_at on public.casino_sessions
  for each row
  execute function public.casino_upsert_feed_event();

-- Backfill settled sessions for existing deployments.
insert into public.casino_feed_events (
  session_id, game_id, stake, pnl, token_symbol, display_label, is_public, settled_at
)
select
  s.id,
  s.game_id,
  s.stake,
  public.casino_session_pnl(s.result),
  s.token_symbol,
  case
    when coalesce(p.show_on_leaderboard, true) then
      public.casino_display_label(s.user_id, p.display_name)
    else 'Private table'
  end,
  coalesce(p.show_on_leaderboard, true),
  s.updated_at
from public.casino_sessions s
left join public.casino_profiles p on p.user_id = s.user_id
where s.status = 'settled'
on conflict (session_id) do nothing;

-- Supabase Realtime publication (no-op if already added).
do $$
begin
  alter publication supabase_realtime add table public.casino_feed_events;
exception
  when duplicate_object then null;
end $$;
