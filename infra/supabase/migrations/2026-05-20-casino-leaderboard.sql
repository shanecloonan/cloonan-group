-- Casino profiles + public leaderboard / bet feed RPCs

create table if not exists public.casino_profiles (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  display_name         text,
  show_on_leaderboard  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function public.casino_session_pnl(p_result jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce((p_result->>'pnlUnits')::numeric, 0);
$$;

create or replace function public.casino_display_label(p_user_id uuid, p_display_name text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(trim(p_display_name), ''),
    'Player #' || left(replace(p_user_id::text, '-', ''), 6)
  );
$$;

create or replace function public.casino_leaderboard_overall(
  p_limit int default 25,
  p_winners boolean default true
)
returns table (
  user_id uuid,
  display_label text,
  total_pnl numeric,
  session_count bigint,
  token_symbol text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    public.casino_display_label(s.user_id, p.display_name) as display_label,
    sum(public.casino_session_pnl(s.result)) as total_pnl,
    count(*)::bigint as session_count,
    max(s.token_symbol) as token_symbol
  from public.casino_sessions s
  left join public.casino_profiles p on p.user_id = s.user_id
  where s.status = 'settled'
    and coalesce(p.show_on_leaderboard, true)
  group by s.user_id, p.display_name
  order by total_pnl desc nulls last
  limit greatest(coalesce(p_limit, 25), 1);
$$;

create or replace function public.casino_leaderboard_losers(p_limit int default 25)
returns table (
  user_id uuid,
  display_label text,
  total_pnl numeric,
  session_count bigint,
  token_symbol text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    public.casino_display_label(s.user_id, p.display_name) as display_label,
    sum(public.casino_session_pnl(s.result)) as total_pnl,
    count(*)::bigint as session_count,
    max(s.token_symbol) as token_symbol
  from public.casino_sessions s
  left join public.casino_profiles p on p.user_id = s.user_id
  where s.status = 'settled'
    and coalesce(p.show_on_leaderboard, true)
  group by s.user_id, p.display_name
  having sum(public.casino_session_pnl(s.result)) < 0
  order by total_pnl asc nulls last
  limit greatest(coalesce(p_limit, 25), 1);
$$;

create or replace function public.casino_leaderboard_records(
  p_limit int default 25,
  p_kind text default 'biggest_win'
)
returns table (
  session_id uuid,
  user_id uuid,
  display_label text,
  game_id text,
  stake numeric,
  pnl numeric,
  token_symbol text,
  settled_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id as session_id,
    s.user_id,
    public.casino_display_label(s.user_id, p.display_name) as display_label,
    s.game_id,
    s.stake,
    public.casino_session_pnl(s.result) as pnl,
    s.token_symbol,
    s.updated_at as settled_at
  from public.casino_sessions s
  left join public.casino_profiles p on p.user_id = s.user_id
  where s.status = 'settled'
    and coalesce(p.show_on_leaderboard, true)
    and (
      (p_kind = 'biggest_win' and public.casino_session_pnl(s.result) > 0)
      or (p_kind = 'biggest_loss' and public.casino_session_pnl(s.result) < 0)
    )
  order by
    case when p_kind = 'biggest_loss' then public.casino_session_pnl(s.result) end asc nulls last,
    case when p_kind <> 'biggest_loss' then public.casino_session_pnl(s.result) end desc nulls last
  limit greatest(coalesce(p_limit, 25), 1);
$$;

create or replace function public.casino_public_bet_feed(p_limit int default 50)
returns table (
  session_id uuid,
  game_id text,
  stake numeric,
  pnl numeric,
  token_symbol text,
  display_label text,
  settled_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id as session_id,
    s.game_id,
    s.stake,
    public.casino_session_pnl(s.result) as pnl,
    s.token_symbol,
    public.casino_display_label(s.user_id, p.display_name) as display_label,
    s.updated_at as settled_at
  from public.casino_sessions s
  left join public.casino_profiles p on p.user_id = s.user_id
  where s.status = 'settled'
    and coalesce(p.show_on_leaderboard, true)
  order by s.updated_at desc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

grant execute on function public.casino_leaderboard_overall(int, boolean) to anon, authenticated;
grant execute on function public.casino_leaderboard_losers(int) to anon, authenticated;
grant execute on function public.casino_leaderboard_records(int, text) to anon, authenticated;
grant execute on function public.casino_public_bet_feed(int) to anon, authenticated;

alter table public.casino_profiles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_profiles' and policyname='casino_profiles_read') then
    create policy casino_profiles_read on public.casino_profiles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_profiles' and policyname='casino_profiles_own_write') then
    create policy casino_profiles_own_write on public.casino_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists casino_sessions_settled_idx
  on public.casino_sessions (updated_at desc)
  where status = 'settled';
