-- Public bet feed: all settled sessions (private players shown as "Private table")

drop function if exists public.casino_public_bet_feed(int);

create or replace function public.casino_public_bet_feed(p_limit int default 50)
returns table (
  session_id uuid,
  game_id text,
  stake numeric,
  pnl numeric,
  token_symbol text,
  display_label text,
  settled_at timestamptz,
  is_public boolean
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
    case
      when coalesce(p.show_on_leaderboard, true) then
        public.casino_display_label(s.user_id, p.display_name)
      else 'Private table'
    end as display_label,
    s.updated_at as settled_at,
    coalesce(p.show_on_leaderboard, true) as is_public
  from public.casino_sessions s
  left join public.casino_profiles p on p.user_id = s.user_id
  where s.status = 'settled'
  order by s.updated_at desc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

grant execute on function public.casino_public_bet_feed(int) to anon, authenticated;
