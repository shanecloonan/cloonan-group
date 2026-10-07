-- Salon arcade: four more shared games on the salon tables.
--
--   derby   The Derby. Six horses, fixed morning line, a race replayed tick by tick.
--   nerve   Nerve. Everyone seals a cash-out multiplier. One bust point for the table.
--   oddone  Odd One Out. Everyone seals a number 1-10. Lowest unique number takes the pot.
--   ticker  Ticker. Up or down on BTC-USD over sixty seconds, settled on the Coinbase spot price.
--
-- Requires 2026-10-07-casino-salon-tables.sql. Safe to re-run.
-- Keep draws in lockstep with lib/casino/salon-games.ts.
--
-- Derby draw order: winner from span 1000 against weights {300,230,180,130,95,65},
-- then twelve ticks of six steps each from span 3 (step = value + 1), tick-major.
-- If the winner's total is not strictly ahead, its final step is raised by the gap + 1.
-- Returns in tenths: {32,42,54,75,102,149}. Payout = stake * tenths / 10.
--
-- Nerve bust: u = raw uint32 at cursor 0. bust_cents = max(100, floor(99 * 2^32 / (2^32 - u))).
-- A sealed target (cents, 110..5000) survives when target <= bust. Payout = stake * target / 100.
--
-- Odd One Out and Ticker consume no house randomness. The seed is not rotated for them.

create extension if not exists http with schema extensions;

alter table public.casino_salon_tables add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.casino_salon_tables drop constraint if exists casino_salon_tables_game_check;
alter table public.casino_salon_tables
  add constraint casino_salon_tables_game_check
  check (game in ('roulette', 'baccarat', 'sicbo', 'derby', 'nerve', 'oddone', 'ticker'));

alter table public.casino_salon_tables drop constraint if exists casino_salon_tables_phase_check;
alter table public.casino_salon_tables
  add constraint casino_salon_tables_phase_check
  check (phase in ('betting', 'locked', 'resolved'));

-- Sealed picks. Never replicated, never readable from a client.
create table if not exists public.casino_salon_picks (
  table_id   uuid not null references public.casino_salon_tables (id) on delete cascade,
  player_id  text not null,
  round      int not null,
  kind       text not null,
  n          int not null,
  stake      int not null,
  primary key (table_id, player_id)
);

alter table public.casino_salon_picks enable row level security;
revoke all on public.casino_salon_picks from public, anon, authenticated;

-- Replace the insert guard so it knows the new games and clears meta.
create or replace function public.salon_tables_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_seed text;
  v_name text;
begin
  if new.created_by is null or length(new.created_by) < 1 or length(new.created_by) > 80 then
    raise exception 'A player id is required';
  end if;
  if new.room_code is null or new.room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'Room code must be 6 letters';
  end if;
  if new.game not in ('roulette', 'baccarat', 'sicbo', 'derby', 'nerve', 'oddone', 'ticker') then
    raise exception 'Unknown salon game';
  end if;
  if new.max_seats is null or new.max_seats < 2 or new.max_seats > 8 then
    new.max_seats := 6;
  end if;
  v_name := left(regexp_replace(coalesce(nullif(trim(new.seats->0->>'name'), ''), 'Guest'), '[[:cntrl:]]', '', 'g'), 24);
  if v_name is null or length(v_name) = 0 then
    v_name := 'Guest';
  end if;
  v_seed := encode(gen_random_bytes(32), 'hex');
  perform set_config('salon.seed', v_seed, true);
  new.server_seed_hash := encode(digest(decode(v_seed, 'hex'), 'sha256'), 'hex');
  new.revealed_seed := null;
  new.phase := 'betting';
  new.status := 'open';
  new.round := 0;
  new.bets := '[]'::jsonb;
  new.result := null;
  new.payouts := null;
  new.meta := '{}'::jsonb;
  new.version := 0;
  new.created_by := left(new.created_by, 80);
  new.seats := jsonb_build_array(jsonb_build_object(
    'seat', 0,
    'playerId', new.created_by,
    'name', v_name,
    'stack', 1000
  ));
  new.updated_at := now();
  return new;
end;
$fn$;

-- Raw uint32 at a cursor. Nerve uses this directly.
create or replace function public.salon_draw_u32(
  p_seed text,
  p_client text,
  p_nonce int,
  p_cursor int
)
returns bigint
language plpgsql
stable
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_hash bytea;
begin
  v_hash := hmac(
    convert_to(p_client || ':' || p_nonce::text || ':' || p_cursor::text, 'UTF8'),
    decode(p_seed, 'hex'),
    'sha256'
  );
  return get_byte(v_hash, 0)::bigint * 16777216
       + get_byte(v_hash, 1)::bigint * 65536
       + get_byte(v_hash, 2)::bigint * 256
       + get_byte(v_hash, 3)::bigint;
end;
$fn$;

-- Pays a stack if the player is still seated. A player who left forfeits.
create or replace function public.salon_shift_stack_soft(p_seats jsonb, p_player text, p_delta int)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_out jsonb := '[]'::jsonb;
  v_seat jsonb;
  v_stack int;
begin
  for v_seat in select jsonb_array_elements(p_seats) loop
    if v_seat->>'playerId' = p_player then
      v_stack := greatest(0, coalesce((v_seat->>'stack')::int, 0) + p_delta);
      v_seat := jsonb_set(v_seat, '{stack}', to_jsonb(v_stack));
    end if;
    v_out := v_out || jsonb_build_array(v_seat);
  end loop;
  return v_out;
end;
$fn$;

create or replace function public.salon_fetch_btc_usd()
returns numeric
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_resp extensions.http_response;
  v_amount text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000');
  select * into v_resp from extensions.http_get('https://api.coinbase.com/v2/prices/BTC-USD/spot');
  if v_resp.status <> 200 then
    raise exception 'Price feed answered %', v_resp.status;
  end if;
  v_amount := (v_resp.content::jsonb)->'data'->>'amount';
  if v_amount is null then
    raise exception 'Price feed had no amount';
  end if;
  return v_amount::numeric;
exception
  when others then
    raise exception 'Price feed unavailable. Try the settle again. (%)', sqlerrm;
end;
$fn$;

-- Move the classic functions aside once; the public names become dispatchers.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'salon_spin_classic'
  ) then
    alter function public.salon_spin(uuid, text) rename to salon_spin_classic;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'salon_bet_classic'
  ) then
    alter function public.salon_bet(uuid, text, text, int, int) rename to salon_bet_classic;
  end if;
end $$;

revoke all on function public.salon_spin_classic(uuid, text) from public, anon, authenticated;
revoke all on function public.salon_bet_classic(uuid, text, text, int, int) from public, anon, authenticated;

-- Open bets for the Derby and Ticker.
create or replace function public.salon_bet_arcade(
  p_id uuid,
  p_player text,
  p_kind text,
  p_stake int,
  p_n int
)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
  v_bet jsonb;
  v_next jsonb := '[]'::jsonb;
  v_count int := 0;
  v_merged boolean := false;
  v_ok boolean := false;
  v_stack int;
begin
  if p_stake is null or p_stake < 1 or p_stake > 100000 then
    raise exception 'Stake must be between 1 and 100000';
  end if;
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Table is closed';
  end if;
  if v_row.phase <> 'betting' then
    raise exception 'Wait for the next round';
  end if;
  if v_row.game = 'derby' then
    v_ok := p_kind = 'win' and p_n is not null and p_n between 1 and 6;
  elsif v_row.game = 'ticker' then
    v_ok := p_n is null and p_kind in ('up', 'down');
  end if;
  if not v_ok then
    raise exception 'That spot is not on this game';
  end if;
  select coalesce((s->>'stack')::int, 0) into v_stack
  from jsonb_array_elements(v_row.seats) s
  where s->>'playerId' = p_player
  limit 1;
  if v_stack is null then
    raise exception 'You are not seated';
  end if;
  if v_stack < p_stake then
    raise exception 'Not enough house chips';
  end if;
  for v_bet in select jsonb_array_elements(v_row.bets) loop
    if v_bet->>'playerId' = p_player then
      v_count := v_count + 1;
    end if;
    if v_row.game = 'ticker'
       and v_bet->>'playerId' = p_player
       and v_bet->>'kind' <> p_kind then
      raise exception 'Pick one side';
    end if;
    if v_bet->>'playerId' = p_player
       and v_bet->>'kind' = p_kind
       and ((v_bet->>'n')::int is not distinct from p_n) then
      v_bet := jsonb_set(v_bet, '{stake}', to_jsonb((v_bet->>'stake')::int + p_stake));
      v_merged := true;
    end if;
    v_next := v_next || jsonb_build_array(v_bet);
  end loop;
  if not v_merged then
    if v_count >= 6 then
      raise exception 'Too many spots';
    end if;
    v_next := v_next || jsonb_build_array(jsonb_build_object(
      'playerId', p_player,
      'kind', p_kind,
      'stake', p_stake,
      'n', p_n
    ));
  end if;
  update public.casino_salon_tables
  set bets = v_next,
      seats = public.salon_shift_stack(seats, p_player, -p_stake),
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$fn$;

-- Sealed commits for Nerve and Odd One Out. One per player per round; a new commit replaces the old.
create or replace function public.salon_commit(
  p_id uuid,
  p_player text,
  p_kind text,
  p_stake int,
  p_n int
)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
  v_bet jsonb;
  v_next jsonb := '[]'::jsonb;
  v_old int := 0;
  v_stack int;
begin
  if p_stake is null or p_stake < 1 or p_stake > 100000 then
    raise exception 'Stake must be between 1 and 100000';
  end if;
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Table is closed';
  end if;
  if v_row.phase <> 'betting' then
    raise exception 'Wait for the next round';
  end if;
  if v_row.game = 'nerve' then
    if p_kind <> 'nerve' or p_n is null or p_n < 110 or p_n > 5000 then
      raise exception 'Target must be between 1.10x and 50.00x';
    end if;
  elsif v_row.game = 'oddone' then
    if p_kind <> 'pick' or p_n is null or p_n < 1 or p_n > 10 then
      raise exception 'Pick a number from 1 to 10';
    end if;
  else
    raise exception 'This table takes open bets';
  end if;
  select coalesce((s->>'stack')::int, 0) into v_stack
  from jsonb_array_elements(v_row.seats) s
  where s->>'playerId' = p_player
  limit 1;
  if v_stack is null then
    raise exception 'You are not seated';
  end if;
  for v_bet in select jsonb_array_elements(v_row.bets) loop
    if v_bet->>'playerId' = p_player then
      v_old := v_old + (v_bet->>'stake')::int;
    else
      v_next := v_next || jsonb_build_array(v_bet);
    end if;
  end loop;
  if v_stack + v_old < p_stake then
    raise exception 'Not enough house chips';
  end if;
  v_next := v_next || jsonb_build_array(jsonb_build_object(
    'playerId', p_player,
    'kind', p_kind,
    'stake', p_stake,
    'n', null
  ));
  insert into public.casino_salon_picks (table_id, player_id, round, kind, n, stake)
  values (p_id, p_player, v_row.round, p_kind, p_n, p_stake)
  on conflict (table_id, player_id) do update
    set round = excluded.round, kind = excluded.kind, n = excluded.n, stake = excluded.stake;
  update public.casino_salon_tables
  set bets = v_next,
      seats = public.salon_shift_stack(seats, p_player, v_old - p_stake),
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.salon_spin_arcade(p_id uuid, p_player text)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
  v_seed text;
  v_new_seed text;
  v_cursor int := 0;
  v_val int;
  v_u bigint;
  v_weights int[] := array[300, 230, 180, 130, 95, 65];
  v_tenths int[] := array[32, 42, 54, 75, 102, 149];
  v_acc int := 0;
  v_winner int;
  v_totals int[] := array[0, 0, 0, 0, 0, 0];
  v_ticks jsonb := '[]'::jsonb;
  v_tick jsonb;
  v_step int;
  v_t int;
  v_h int;
  v_max_other int := 0;
  v_gap int;
  v_last int;
  v_bust bigint;
  v_commits jsonb := '[]'::jsonb;
  v_picks jsonb := '[]'::jsonb;
  v_target int;
  v_counts int[] := array[0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  v_number int;
  v_pot int := 0;
  v_carry int := 0;
  v_who_wins text;
  v_open numeric;
  v_close numeric;
  v_locked_at timestamptz;
  v_direction text;
  v_win_pool int := 0;
  v_lose_pool int := 0;
  v_result jsonb;
  v_payouts jsonb := '[]'::jsonb;
  v_bet jsonb;
  v_kind text;
  v_stake int;
  v_n int;
  v_who text;
  v_pay int;
  v_seats jsonb;
  v_rotate boolean := false;
begin
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Table is closed';
  end if;
  if v_row.phase = 'resolved' then
    raise exception 'Wait for the next round';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_row.seats) s where s->>'playerId' = p_player) then
    raise exception 'You are not seated';
  end if;
  if jsonb_array_length(v_row.bets) = 0 then
    raise exception 'Nobody is in yet';
  end if;
  v_seats := v_row.seats;

  if v_row.game = 'ticker' and v_row.phase = 'betting' then
    v_open := public.salon_fetch_btc_usd();
    update public.casino_salon_tables
    set phase = 'locked',
        meta = jsonb_build_object('open', v_open::text, 'lockedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        version = version + 1,
        updated_at = now()
    where id = p_id
    returning * into v_row;
    return v_row;
  end if;

  if v_row.phase = 'locked' and v_row.game <> 'ticker' then
    raise exception 'This table is not waiting on a window';
  end if;

  if v_row.game = 'ticker' then
    v_locked_at := (v_row.meta->>'lockedAt')::timestamptz;
    v_open := (v_row.meta->>'open')::numeric;
    if v_locked_at is null or v_open is null then
      raise exception 'The window was not locked';
    end if;
    if now() < v_locked_at + interval '60 seconds' then
      raise exception 'The window closes in % seconds', ceil(extract(epoch from (v_locked_at + interval '60 seconds' - now())))::int;
    end if;
    v_close := public.salon_fetch_btc_usd();
    v_direction := case when v_close > v_open then 'up' when v_close < v_open then 'down' else 'flat' end;
    for v_bet in select jsonb_array_elements(v_row.bets) loop
      if v_direction <> 'flat' and v_bet->>'kind' = v_direction then
        v_win_pool := v_win_pool + (v_bet->>'stake')::int;
      elsif v_direction <> 'flat' then
        v_lose_pool := v_lose_pool + (v_bet->>'stake')::int;
      end if;
    end loop;
    for v_bet in select jsonb_array_elements(v_row.bets) loop
      v_kind := v_bet->>'kind';
      v_stake := (v_bet->>'stake')::int;
      v_who := v_bet->>'playerId';
      if v_direction = 'flat' then
        v_pay := v_stake;
      elsif v_kind = v_direction then
        v_pay := v_stake + (v_stake::bigint * v_lose_pool / v_win_pool)::int;
      else
        v_pay := 0;
      end if;
      if v_pay > 0 then
        v_seats := public.salon_shift_stack_soft(v_seats, v_who, v_pay);
      end if;
      v_payouts := v_payouts || jsonb_build_array(jsonb_build_object(
        'playerId', v_who, 'kind', v_kind, 'stake', v_stake, 'payout', v_pay, 'n', null
      ));
    end loop;
    v_result := jsonb_build_object(
      'open', v_open::text,
      'close', v_close::text,
      'lockedAt', v_row.meta->>'lockedAt',
      'settledAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'direction', v_direction
    );
    update public.casino_salon_tables
    set phase = 'resolved',
        result = v_result,
        payouts = v_payouts,
        seats = v_seats,
        meta = '{}'::jsonb,
        version = version + 1,
        updated_at = now()
    where id = p_id
    returning * into v_row;
    return v_row;
  end if;

  if v_row.game = 'oddone' then
    if jsonb_array_length(v_row.bets) < 2 then
      raise exception 'Odd One Out needs two sealed numbers';
    end if;
    v_carry := coalesce((v_row.meta->>'carry')::int, 0);
    v_pot := v_carry;
    for v_bet in select jsonb_array_elements(v_row.bets) loop
      v_who := v_bet->>'playerId';
      v_stake := (v_bet->>'stake')::int;
      v_n := null;
      select n into v_n from public.casino_salon_picks
      where table_id = p_id and player_id = v_who and round = v_row.round and kind = 'pick';
      v_pot := v_pot + v_stake;
      if v_n is not null then
        v_counts[v_n] := v_counts[v_n] + 1;
      end if;
      v_picks := v_picks || jsonb_build_array(jsonb_build_object('playerId', v_who, 'n', v_n, 'stake', v_stake));
    end loop;
    v_number := null;
    for v_h in 1..10 loop
      if v_counts[v_h] = 1 then
        v_number := v_h;
        exit;
      end if;
    end loop;
    v_who_wins := null;
    if v_number is not null then
      select p->>'playerId' into v_who_wins
      from jsonb_array_elements(v_picks) p
      where (p->>'n')::int = v_number
      limit 1;
    end if;
    for v_bet in select jsonb_array_elements(v_picks) loop
      v_who := v_bet->>'playerId';
      v_stake := (v_bet->>'stake')::int;
      v_pay := case when v_who_wins is not null and v_who = v_who_wins then v_pot else 0 end;
      if v_pay > 0 then
        v_seats := public.salon_shift_stack_soft(v_seats, v_who, v_pay);
      end if;
      v_payouts := v_payouts || jsonb_build_array(jsonb_build_object(
        'playerId', v_who, 'kind', 'pick', 'stake', v_stake, 'payout', v_pay, 'n', (v_bet->>'n')::int
      ));
    end loop;
    v_result := jsonb_build_object(
      'picks', v_picks,
      'winner', v_who_wins,
      'number', v_number,
      'pot', v_pot,
      'carry', case when v_who_wins is null then v_pot else 0 end
    );
    delete from public.casino_salon_picks where table_id = p_id;
    update public.casino_salon_tables
    set phase = 'resolved',
        result = v_result,
        payouts = v_payouts,
        seats = v_seats,
        meta = jsonb_build_object('carry', case when v_who_wins is null then v_pot else 0 end),
        version = version + 1,
        updated_at = now()
    where id = p_id
    returning * into v_row;
    return v_row;
  end if;

  select server_seed into v_seed from public.casino_salon_secrets where table_id = p_id for update;
  if v_seed is null then
    raise exception 'Salon seed is missing';
  end if;
  v_rotate := true;

  if v_row.game = 'derby' then
    select d.draw_value, d.draw_cursor into v_val, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, 0, 1000) d;
    v_winner := 6;
    for v_h in 1..6 loop
      v_acc := v_acc + v_weights[v_h];
      if v_val < v_acc then
        v_winner := v_h;
        exit;
      end if;
    end loop;
    for v_t in 1..12 loop
      v_tick := '[]'::jsonb;
      for v_h in 1..6 loop
        select d.draw_value, d.draw_cursor into v_val, v_cursor
        from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 3) d;
        v_step := v_val + 1;
        v_totals[v_h] := v_totals[v_h] + v_step;
        v_tick := v_tick || to_jsonb(v_step);
      end loop;
      v_ticks := v_ticks || jsonb_build_array(v_tick);
    end loop;
    for v_h in 1..6 loop
      if v_h <> v_winner and v_totals[v_h] > v_max_other then
        v_max_other := v_totals[v_h];
      end if;
    end loop;
    if v_totals[v_winner] <= v_max_other then
      v_gap := v_max_other - v_totals[v_winner] + 1;
      v_last := (v_ticks->11->>(v_winner - 1))::int;
      v_ticks := jsonb_set(v_ticks, array['11', (v_winner - 1)::text], to_jsonb(v_last + v_gap));
      v_totals[v_winner] := v_totals[v_winner] + v_gap;
    end if;
    for v_bet in select jsonb_array_elements(v_row.bets) loop
      v_kind := v_bet->>'kind';
      v_stake := (v_bet->>'stake')::int;
      v_who := v_bet->>'playerId';
      v_n := (v_bet->>'n')::int;
      v_pay := case when v_kind = 'win' and v_n = v_winner then (v_stake::bigint * v_tenths[v_winner] / 10)::int else 0 end;
      if v_pay > 0 then
        v_seats := public.salon_shift_stack_soft(v_seats, v_who, v_pay);
      end if;
      v_payouts := v_payouts || jsonb_build_array(jsonb_build_object(
        'playerId', v_who, 'kind', v_kind, 'stake', v_stake, 'payout', v_pay, 'n', v_n
      ));
    end loop;
    v_result := jsonb_build_object(
      'winner', v_winner,
      'ticks', v_ticks,
      'totals', to_jsonb(v_totals),
      'committedHash', v_row.server_seed_hash
    );
  elsif v_row.game = 'nerve' then
    v_u := public.salon_draw_u32(v_seed, v_row.room_code, v_row.round, 0);
    v_bust := greatest(100::bigint, (99::bigint * 4294967296) / (4294967296 - v_u));
    for v_bet in select jsonb_array_elements(v_row.bets) loop
      v_who := v_bet->>'playerId';
      v_stake := (v_bet->>'stake')::int;
      v_target := null;
      select n into v_target from public.casino_salon_picks
      where table_id = p_id and player_id = v_who and round = v_row.round and kind = 'nerve';
      v_pay := case when v_target is not null and v_target <= v_bust then (v_stake::bigint * v_target / 100)::int else 0 end;
      if v_pay > 0 then
        v_seats := public.salon_shift_stack_soft(v_seats, v_who, v_pay);
      end if;
      v_commits := v_commits || jsonb_build_array(jsonb_build_object('playerId', v_who, 'target', v_target, 'stake', v_stake));
      v_payouts := v_payouts || jsonb_build_array(jsonb_build_object(
        'playerId', v_who, 'kind', 'nerve', 'stake', v_stake, 'payout', v_pay, 'n', v_target
      ));
    end loop;
    delete from public.casino_salon_picks where table_id = p_id;
    v_result := jsonb_build_object(
      'bust', v_bust,
      'commits', v_commits,
      'committedHash', v_row.server_seed_hash
    );
  else
    raise exception 'Unknown arcade game';
  end if;

  v_new_seed := encode(gen_random_bytes(32), 'hex');
  update public.casino_salon_secrets
  set server_seed = v_new_seed,
      cursor = 0
  where table_id = p_id;

  update public.casino_salon_tables
  set phase = 'resolved',
      result = v_result,
      payouts = v_payouts,
      seats = v_seats,
      revealed_seed = v_seed,
      server_seed_hash = encode(digest(decode(v_new_seed, 'hex'), 'sha256'), 'hex'),
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.salon_spin(p_id uuid, p_player text)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_game text;
begin
  select game into v_game from public.casino_salon_tables where id = p_id;
  if v_game is null then
    raise exception 'Table not found';
  end if;
  if v_game in ('derby', 'nerve', 'oddone', 'ticker') then
    return public.salon_spin_arcade(p_id, p_player);
  end if;
  return public.salon_spin_classic(p_id, p_player);
end;
$fn$;

create or replace function public.salon_bet(
  p_id uuid,
  p_player text,
  p_kind text,
  p_stake int,
  p_n int
)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_game text;
begin
  select game into v_game from public.casino_salon_tables where id = p_id;
  if v_game is null then
    raise exception 'Table not found';
  end if;
  if v_game in ('derby', 'ticker') then
    return public.salon_bet_arcade(p_id, p_player, p_kind, p_stake, p_n);
  end if;
  if v_game in ('nerve', 'oddone') then
    raise exception 'This table takes sealed commits';
  end if;
  return public.salon_bet_classic(p_id, p_player, p_kind, p_stake, p_n);
end;
$fn$;

revoke all on function public.salon_draw_u32(text, text, int, int) from public, anon, authenticated;
revoke all on function public.salon_shift_stack_soft(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.salon_fetch_btc_usd() from public, anon, authenticated;
revoke all on function public.salon_bet_arcade(uuid, text, text, int, int) from public, anon, authenticated;
revoke all on function public.salon_spin_arcade(uuid, text) from public, anon, authenticated;

grant execute on function public.salon_spin(uuid, text) to anon, authenticated;
grant execute on function public.salon_bet(uuid, text, text, int, int) to anon, authenticated;
grant execute on function public.salon_commit(uuid, text, text, int, int) to anon, authenticated;
