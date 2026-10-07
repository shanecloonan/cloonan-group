-- Shared salon tables: European roulette, punto banco, and sic bo.
-- House chips live on the row. The server seed lives in casino_salon_secrets,
-- which is not added to supabase_realtime.
--
-- Keep the draw and payout functions in lockstep with lib/casino/salon-games.ts.
-- One HMAC-SHA256 per integer. Message is client || ':' || nonce || ':' || cursor.
-- First four bytes are a big-endian uint32. Rejection limit is
-- floor(2^32 / span) * span. Client seed is the room code. Nonce is the round.
-- Golden draw: seed of 32 bytes of 0x11, client ROOM01, nonce 0, cursor 0, span 37 → 32.
-- Baccarat is an infinite shoe (draw with replacement), dealt P, B, P, B.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.casino_salon_tables (
  id                uuid primary key default gen_random_uuid(),
  room_code         text not null unique,
  game              text not null check (game in ('roulette', 'baccarat', 'sicbo')),
  status            text not null default 'open' check (status in ('open', 'closed')),
  phase             text not null default 'betting' check (phase in ('betting', 'resolved')),
  max_seats         int not null default 6 check (max_seats between 2 and 8),
  seats             jsonb not null default '[]'::jsonb,
  bets              jsonb not null default '[]'::jsonb,
  round             int not null default 0,
  result            jsonb,
  payouts           jsonb,
  server_seed_hash  text not null,
  revealed_seed     text,
  version           int not null default 0,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists casino_salon_tables_open_idx
  on public.casino_salon_tables (status, updated_at desc);

create table if not exists public.casino_salon_secrets (
  table_id     uuid primary key references public.casino_salon_tables (id) on delete cascade,
  server_seed  text not null,
  cursor       int not null default 0
);

alter table public.casino_salon_tables replica identity full;

alter table public.casino_salon_tables enable row level security;
alter table public.casino_salon_secrets enable row level security;

revoke all on public.casino_salon_secrets from public, anon, authenticated;
revoke update, delete on public.casino_salon_tables from anon, authenticated;
grant select, insert on public.casino_salon_tables to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'casino_salon_tables' and policyname = 'casino_salon_tables_read'
  ) then
    create policy casino_salon_tables_read on public.casino_salon_tables
      for select to anon, authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'casino_salon_tables' and policyname = 'casino_salon_tables_insert'
  ) then
    create policy casino_salon_tables_insert on public.casino_salon_tables
      for insert to anon, authenticated with check (true);
  end if;
end $$;

-- Fresh seed is stashed in a transaction-local GUC so the row the client
-- gets back never contains it. The hash is overwritten here; a client cannot
-- choose the commitment.
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
  if new.game not in ('roulette', 'baccarat', 'sicbo') then
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

create or replace function public.salon_tables_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_seed text;
begin
  v_seed := current_setting('salon.seed', true);
  if v_seed is null or length(v_seed) <> 64 then
    raise exception 'Salon seed was not staged';
  end if;
  insert into public.casino_salon_secrets (table_id, server_seed, cursor)
  values (new.id, v_seed, 0);
  return new;
end;
$fn$;

drop trigger if exists casino_salon_tables_before_insert on public.casino_salon_tables;
create trigger casino_salon_tables_before_insert
  before insert on public.casino_salon_tables
  for each row
  execute function public.salon_tables_before_insert();

drop trigger if exists casino_salon_tables_after_insert on public.casino_salon_tables;
create trigger casino_salon_tables_after_insert
  after insert on public.casino_salon_tables
  for each row
  execute function public.salon_tables_after_insert();

create or replace function public.salon_draw(
  p_seed text,
  p_client text,
  p_nonce int,
  p_cursor int,
  p_span int
)
returns table(draw_value int, draw_cursor int)
language plpgsql
stable
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_lim bigint;
  v_u bigint;
  v_i int;
  v_hash bytea;
  v_cursor int;
begin
  if p_span is null or p_span < 1 then
    raise exception 'bad span';
  end if;
  v_lim := (4294967296::bigint / p_span) * p_span;
  v_cursor := p_cursor;
  for v_i in 1..64 loop
    v_hash := hmac(
      convert_to(p_client || ':' || p_nonce::text || ':' || v_cursor::text, 'UTF8'),
      decode(p_seed, 'hex'),
      'sha256'
    );
    v_cursor := v_cursor + 1;
    v_u := get_byte(v_hash, 0)::bigint * 16777216
         + get_byte(v_hash, 1)::bigint * 65536
         + get_byte(v_hash, 2)::bigint * 256
         + get_byte(v_hash, 3)::bigint;
    if v_u < v_lim then
      draw_value := (v_u % p_span)::int;
      draw_cursor := v_cursor;
      return next;
      return;
    end if;
  end loop;
  v_hash := hmac(
    convert_to(p_client || ':' || p_nonce::text || ':' || v_cursor::text, 'UTF8'),
    decode(p_seed, 'hex'),
    'sha256'
  );
  v_u := get_byte(v_hash, 0)::bigint * 16777216
       + get_byte(v_hash, 1)::bigint * 65536
       + get_byte(v_hash, 2)::bigint * 256
       + get_byte(v_hash, 3)::bigint;
  draw_value := (v_u % p_span)::int;
  draw_cursor := v_cursor + 1;
  return next;
end;
$fn$;

create or replace function public.salon_pip(p_index int)
returns int
language sql
immutable
as $fn$
  select case
    when (p_index % 13) = 12 then 1
    when (p_index % 13) >= 8 then 0
    else (p_index % 13) + 2
  end;
$fn$;

-- Same tableau as bankerDrawsThird in lib/casino/baccarat.ts.
-- p_third is the third-card pip, or null when Player stood.
create or replace function public.salon_banker_draws(p_banker int, p_third int)
returns boolean
language plpgsql
immutable
as $fn$
begin
  if p_third is null then
    return p_banker <= 5;
  end if;
  if p_banker in (0, 1, 2) then
    return true;
  elsif p_banker = 3 then
    return p_third <> 8;
  elsif p_banker = 4 then
    return p_third between 2 and 7;
  elsif p_banker = 5 then
    return p_third between 4 and 7;
  elsif p_banker = 6 then
    return p_third in (6, 7);
  end if;
  return false;
end;
$fn$;

create or replace function public.salon_clean_name(p_name text)
returns text
language plpgsql
immutable
as $fn$
declare
  v_name text;
begin
  v_name := left(regexp_replace(coalesce(nullif(trim(p_name), ''), 'Guest'), '[[:cntrl:]]', '', 'g'), 24);
  if v_name is null or length(v_name) = 0 then
    return 'Guest';
  end if;
  return v_name;
end;
$fn$;

create or replace function public.salon_shift_stack(p_seats jsonb, p_player text, p_delta int)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_out jsonb := '[]'::jsonb;
  v_seat jsonb;
  v_found boolean := false;
  v_stack int;
begin
  for v_seat in select jsonb_array_elements(p_seats) loop
    if v_seat->>'playerId' = p_player then
      v_found := true;
      v_stack := coalesce((v_seat->>'stack')::int, 0) + p_delta;
      if v_stack < 0 then
        raise exception 'Not enough house chips';
      end if;
      v_seat := jsonb_set(v_seat, '{stack}', to_jsonb(v_stack));
    end if;
    v_out := v_out || jsonb_build_array(v_seat);
  end loop;
  if not v_found then
    raise exception 'You are not seated';
  end if;
  return v_out;
end;
$fn$;

create or replace function public.salon_open(
  p_game text,
  p_player text,
  p_name text,
  p_code text,
  p_max_seats int
)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
begin
  insert into public.casino_salon_tables (room_code, game, max_seats, created_by, seats, server_seed_hash)
  values (
    p_code,
    p_game,
    coalesce(p_max_seats, 6),
    p_player,
    jsonb_build_array(jsonb_build_object('name', public.salon_clean_name(p_name))),
    'pending'
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.salon_join(p_id uuid, p_player text, p_name text)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
  v_seat jsonb;
  v_taken int[];
  v_pick int;
  v_i int;
  v_name text;
  v_next jsonb;
  v_already boolean := false;
begin
  if p_player is null or length(p_player) < 1 or length(p_player) > 80 then
    raise exception 'A player id is required';
  end if;
  v_name := public.salon_clean_name(p_name);
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Table is closed';
  end if;
  for v_seat in select jsonb_array_elements(v_row.seats) loop
    if v_seat->>'playerId' = p_player then
      v_already := true;
      exit;
    end if;
  end loop;
  if v_already then
    v_next := '[]'::jsonb;
    for v_seat in select jsonb_array_elements(v_row.seats) loop
      if v_seat->>'playerId' = p_player then
        v_seat := jsonb_set(v_seat, '{name}', to_jsonb(v_name));
      end if;
      v_next := v_next || jsonb_build_array(v_seat);
    end loop;
    update public.casino_salon_tables
    set seats = v_next,
        version = version + 1,
        updated_at = now()
    where id = p_id
    returning * into v_row;
    return v_row;
  end if;
  if jsonb_array_length(v_row.seats) >= v_row.max_seats then
    raise exception 'This table is full';
  end if;
  v_taken := array(
    select (s->>'seat')::int from jsonb_array_elements(v_row.seats) s
  );
  v_pick := null;
  for v_i in 0..(v_row.max_seats - 1) loop
    if v_taken is null or not (v_i = any (v_taken)) then
      v_pick := v_i;
      exit;
    end if;
  end loop;
  if v_pick is null then
    raise exception 'This table is full';
  end if;
  update public.casino_salon_tables
  set seats = seats || jsonb_build_array(jsonb_build_object(
        'seat', v_pick,
        'playerId', p_player,
        'name', v_name,
        'stack', 1000
      )),
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
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
    raise exception 'Wait for the next coup';
  end if;
  if v_row.game = 'roulette' then
    if p_kind = 'straight' then
      v_ok := p_n is not null and p_n between 0 and 36;
    elsif p_n is null and p_kind in ('red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3') then
      v_ok := true;
    end if;
  elsif v_row.game = 'baccarat' then
    v_ok := p_n is null and p_kind in ('player', 'banker', 'tie');
  elsif v_row.game = 'sicbo' then
    v_ok := p_n is null and p_kind in ('big', 'small', 'odd', 'even', 'any_triple');
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
    if v_bet->>'playerId' = p_player
       and v_bet->>'kind' = p_kind
       and ((v_bet->>'n')::int is not distinct from p_n) then
      v_bet := jsonb_set(v_bet, '{stake}', to_jsonb((v_bet->>'stake')::int + p_stake));
      v_merged := true;
    end if;
    v_next := v_next || jsonb_build_array(v_bet);
  end loop;
  if not v_merged then
    if v_count >= 8 then
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

create or replace function public.salon_spin(p_id uuid, p_player text)
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
  v_pocket int;
  v_color text;
  v_p0 int;
  v_b0 int;
  v_p1 int;
  v_b1 int;
  v_p_third int;
  v_b_third int;
  v_pt int;
  v_bt int;
  v_bt_two int;
  v_natural boolean;
  v_third_pip int;
  v_winner text;
  v_d1 int;
  v_d2 int;
  v_d3 int;
  v_sum int;
  v_triple boolean;
  v_player jsonb := '[]'::jsonb;
  v_banker jsonb := '[]'::jsonb;
  v_result jsonb;
  v_payouts jsonb := '[]'::jsonb;
  v_bet jsonb;
  v_kind text;
  v_stake int;
  v_n int;
  v_who text;
  v_mult int;
  v_pay int;
  v_hit boolean;
  v_seats jsonb;
begin
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Table is closed';
  end if;
  if v_row.phase <> 'betting' then
    raise exception 'Wait for the next coup';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_row.seats) s where s->>'playerId' = p_player) then
    raise exception 'You are not seated';
  end if;
  if jsonb_array_length(v_row.bets) = 0 then
    raise exception 'Place a bet before the coup';
  end if;
  select server_seed into v_seed from public.casino_salon_secrets where table_id = p_id for update;
  if v_seed is null then
    raise exception 'Salon seed is missing';
  end if;

  if v_row.game = 'roulette' then
    select d.draw_value, d.draw_cursor into v_pocket, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, 0, 37) d;
    if v_pocket = 0 then
      v_color := 'green';
    elsif v_pocket = any (array[1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]) then
      v_color := 'red';
    else
      v_color := 'black';
    end if;
    v_result := jsonb_build_object(
      'pocket', v_pocket,
      'color', v_color,
      'committedHash', v_row.server_seed_hash
    );
  elsif v_row.game = 'baccarat' then
    -- Lazy draws so a stand does not consume a card the other hand needs.
    select d.draw_value, d.draw_cursor into v_p0, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 52) d;
    select d.draw_value, d.draw_cursor into v_b0, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 52) d;
    select d.draw_value, d.draw_cursor into v_p1, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 52) d;
    select d.draw_value, d.draw_cursor into v_b1, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 52) d;
    v_pt := (public.salon_pip(v_p0) + public.salon_pip(v_p1)) % 10;
    v_bt := (public.salon_pip(v_b0) + public.salon_pip(v_b1)) % 10;
    v_bt_two := v_bt;
    v_natural := v_pt >= 8 or v_bt >= 8;
    v_player := jsonb_build_array(v_p0, v_p1);
    v_banker := jsonb_build_array(v_b0, v_b1);
    v_third_pip := null;
    if not v_natural and v_pt <= 5 then
      select d.draw_value, d.draw_cursor into v_p_third, v_cursor
      from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 52) d;
      v_player := v_player || jsonb_build_array(v_p_third);
      v_third_pip := public.salon_pip(v_p_third);
      v_pt := (v_pt + v_third_pip) % 10;
    end if;
    if not v_natural and public.salon_banker_draws(v_bt_two, v_third_pip) then
      select d.draw_value, d.draw_cursor into v_b_third, v_cursor
      from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 52) d;
      v_banker := v_banker || jsonb_build_array(v_b_third);
      v_bt := (v_bt + public.salon_pip(v_b_third)) % 10;
    end if;
    if v_pt > v_bt then
      v_winner := 'player';
    elsif v_bt > v_pt then
      v_winner := 'banker';
    else
      v_winner := 'tie';
    end if;
    v_result := jsonb_build_object(
      'player', v_player,
      'banker', v_banker,
      'playerTotal', v_pt,
      'bankerTotal', v_bt,
      'winner', v_winner,
      'natural', v_natural,
      'committedHash', v_row.server_seed_hash
    );
  else
    select d.draw_value, d.draw_cursor into v_d1, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, 0, 6) d;
    select d.draw_value, d.draw_cursor into v_d2, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 6) d;
    select d.draw_value, d.draw_cursor into v_d3, v_cursor
    from public.salon_draw(v_seed, v_row.room_code, v_row.round, v_cursor, 6) d;
    v_d1 := v_d1 + 1;
    v_d2 := v_d2 + 1;
    v_d3 := v_d3 + 1;
    v_sum := v_d1 + v_d2 + v_d3;
    v_triple := v_d1 = v_d2 and v_d2 = v_d3;
    v_result := jsonb_build_object(
      'dice', jsonb_build_array(v_d1, v_d2, v_d3),
      'sum', v_sum,
      'triple', v_triple,
      'committedHash', v_row.server_seed_hash
    );
  end if;

  v_seats := v_row.seats;
  for v_bet in select jsonb_array_elements(v_row.bets) loop
    v_kind := v_bet->>'kind';
    v_stake := (v_bet->>'stake')::int;
    v_who := v_bet->>'playerId';
    v_n := (v_bet->>'n')::int;
    v_mult := 0;
    if v_row.game = 'roulette' then
      v_hit := false;
      if v_kind = 'straight' then
        v_hit := v_n = v_pocket;
        v_mult := 36;
      elsif v_kind = 'red' then
        v_hit := v_color = 'red';
        v_mult := 2;
      elsif v_kind = 'black' then
        v_hit := v_color = 'black';
        v_mult := 2;
      elsif v_kind = 'odd' then
        v_hit := v_pocket <> 0 and v_pocket % 2 = 1;
        v_mult := 2;
      elsif v_kind = 'even' then
        v_hit := v_pocket <> 0 and v_pocket % 2 = 0;
        v_mult := 2;
      elsif v_kind = 'low' then
        v_hit := v_pocket between 1 and 18;
        v_mult := 2;
      elsif v_kind = 'high' then
        v_hit := v_pocket between 19 and 36;
        v_mult := 2;
      elsif v_kind = 'dozen1' then
        v_hit := v_pocket between 1 and 12;
        v_mult := 3;
      elsif v_kind = 'dozen2' then
        v_hit := v_pocket between 13 and 24;
        v_mult := 3;
      elsif v_kind = 'dozen3' then
        v_hit := v_pocket between 25 and 36;
        v_mult := 3;
      end if;
      v_pay := case when v_hit then v_stake * v_mult else 0 end;
    elsif v_row.game = 'baccarat' then
      if v_winner = 'tie' then
        if v_kind = 'tie' then
          v_pay := v_stake * 9;
        elsif v_kind in ('player', 'banker') then
          v_pay := v_stake;
        else
          v_pay := 0;
        end if;
      elsif v_kind = v_winner and v_kind = 'player' then
        v_pay := v_stake * 2;
      elsif v_kind = v_winner and v_kind = 'banker' then
        v_pay := (v_stake * 195) / 100;
      else
        v_pay := 0;
      end if;
    else
      v_mult := 0;
      if v_kind = 'big' and not v_triple and v_sum between 11 and 17 then
        v_mult := 2;
      elsif v_kind = 'small' and not v_triple and v_sum between 4 and 10 then
        v_mult := 2;
      elsif v_kind = 'odd' and not v_triple and v_sum % 2 = 1 then
        v_mult := 2;
      elsif v_kind = 'even' and not v_triple and v_sum % 2 = 0 then
        v_mult := 2;
      elsif v_kind = 'any_triple' and v_triple then
        v_mult := 31;
      end if;
      v_pay := v_stake * v_mult;
    end if;
    if v_pay > 0 then
      v_seats := public.salon_shift_stack(v_seats, v_who, v_pay);
    end if;
    v_payouts := v_payouts || jsonb_build_array(jsonb_build_object(
      'playerId', v_who,
      'kind', v_kind,
      'stake', v_stake,
      'payout', v_pay,
      'n', v_n
    ));
  end loop;

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

create or replace function public.salon_next(p_id uuid, p_player text)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
begin
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_row.seats) s where s->>'playerId' = p_player) then
    raise exception 'You are not seated';
  end if;
  if v_row.phase <> 'resolved' then
    raise exception 'The coup is still open';
  end if;
  update public.casino_salon_tables
  set phase = 'betting',
      bets = '[]'::jsonb,
      round = round + 1,
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.salon_leave(p_id uuid, p_player text)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
  v_bet jsonb;
  v_seat jsonb;
  v_refund int := 0;
  v_bets jsonb := '[]'::jsonb;
  v_seats jsonb := '[]'::jsonb;
begin
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if v_row.phase = 'betting' then
    for v_bet in select jsonb_array_elements(v_row.bets) loop
      if v_bet->>'playerId' = p_player then
        v_refund := v_refund + (v_bet->>'stake')::int;
      else
        v_bets := v_bets || jsonb_build_array(v_bet);
      end if;
    end loop;
  else
    v_bets := v_row.bets;
  end if;
  if v_refund > 0 then
    v_row.seats := public.salon_shift_stack(v_row.seats, p_player, v_refund);
  end if;
  for v_seat in select jsonb_array_elements(v_row.seats) loop
    if v_seat->>'playerId' <> p_player then
      v_seats := v_seats || jsonb_build_array(v_seat);
    end if;
  end loop;
  update public.casino_salon_tables
  set seats = coalesce(v_seats, '[]'::jsonb),
      bets = v_bets,
      status = case when coalesce(jsonb_array_length(v_seats), 0) = 0 then 'closed' else status end,
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.salon_rebuy(p_id uuid, p_player text)
returns public.casino_salon_tables
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_row public.casino_salon_tables;
  v_stack int;
  v_seat jsonb;
  v_next jsonb := '[]'::jsonb;
begin
  select * into v_row from public.casino_salon_tables where id = p_id for update;
  if not found then
    raise exception 'Table not found';
  end if;
  if v_row.phase <> 'betting' then
    raise exception 'Rebuy waits until the next coup';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_row.bets) b where b->>'playerId' = p_player
  ) then
    raise exception 'Lift your bets before a rebuy';
  end if;
  select (s->>'stack')::int into v_stack
  from jsonb_array_elements(v_row.seats) s
  where s->>'playerId' = p_player
  limit 1;
  if v_stack is null then
    raise exception 'You are not seated';
  end if;
  if v_stack >= 1000 then
    raise exception 'Rebuy is only up to 1,000';
  end if;
  for v_seat in select jsonb_array_elements(v_row.seats) loop
    if v_seat->>'playerId' = p_player then
      v_seat := jsonb_set(v_seat, '{stack}', '1000'::jsonb);
    end if;
    v_next := v_next || jsonb_build_array(v_seat);
  end loop;
  update public.casino_salon_tables
  set seats = v_next,
      version = version + 1,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.salon_draw(text, text, int, int, int) from public, anon, authenticated;
revoke all on function public.salon_pip(int) from public, anon, authenticated;
revoke all on function public.salon_banker_draws(int, int) from public, anon, authenticated;
revoke all on function public.salon_clean_name(text) from public, anon, authenticated;
revoke all on function public.salon_shift_stack(jsonb, text, int) from public, anon, authenticated;
grant execute on function public.salon_draw(text, text, int, int, int) to current_user;
grant execute on function public.salon_pip(int) to current_user;
grant execute on function public.salon_banker_draws(int, int) to current_user;
grant execute on function public.salon_clean_name(text) to current_user;
grant execute on function public.salon_shift_stack(jsonb, text, int) to current_user;

grant execute on function public.salon_open(text, text, text, text, int) to anon, authenticated;
grant execute on function public.salon_join(uuid, text, text) to anon, authenticated;
grant execute on function public.salon_bet(uuid, text, text, int, int) to anon, authenticated;
grant execute on function public.salon_spin(uuid, text) to anon, authenticated;
grant execute on function public.salon_next(uuid, text) to anon, authenticated;
grant execute on function public.salon_leave(uuid, text) to anon, authenticated;
grant execute on function public.salon_rebuy(uuid, text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.casino_salon_tables;
exception
  when duplicate_object then null;
end $$;
