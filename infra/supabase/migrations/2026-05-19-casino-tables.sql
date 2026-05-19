-- ============================================================================
-- MoneyFund Casino — schema (Phase 0 foundation)
-- ============================================================================
--
-- Eight tables that back the casino engine described in
-- `docs/CASINO_ARCHITECTURE.md`. Every table is RLS-locked, append-only
-- where applicable, and idempotent — re-running this migration is a no-op.
--
-- The casino library uses `safe-fallback` reads/writes: if these tables
-- don't exist yet, `lib/casino/balance.ts` (Supabase impl) silently no-ops
-- and the dev path (`InMemoryLedger`) carries the load. Applying this
-- migration unlocks the production code path.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
--  1. casino_users — per-user KYC / status + active seed reference
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_users (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  kyc_level        smallint not null default 0,
  banned           boolean not null default false,
  active_seed_id   uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────
--  2. casino_seed_pairs — server seed (hash now, value revealed on rotate)
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_seed_pairs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  server_seed_hash  text not null,
  server_seed       text,                    -- nullable while active
  client_seed       text not null,
  nonce             bigint not null default 0,
  status            text not null check (status in ('active','retired')),
  created_at        timestamptz not null default now(),
  retired_at        timestamptz
);
create index if not exists casino_seed_pairs_user_idx on public.casino_seed_pairs (user_id, status);

-- ────────────────────────────────────────────────────────────────────────
--  3. casino_balances — per (user, chain, token) ledger row
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_balances (
  user_id          uuid not null references auth.users(id) on delete cascade,
  chain_id         text not null,
  token_symbol     text not null,
  token_address    text not null,
  token_decimals   smallint not null,
  available        numeric(78,0) not null default 0,
  locked           numeric(78,0) not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (user_id, chain_id, token_symbol, token_address)
);

-- ────────────────────────────────────────────────────────────────────────
--  4. casino_balance_mutations — append-only ledger journal
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_balance_mutations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  chain_id         text not null,
  token_symbol     text not null,
  token_address    text not null,
  op               text not null check (op in ('credit','lock','unlock','burn')),
  delta            numeric(78,0) not null,
  reason           text not null,
  session_id       uuid,
  tx_hash          text,
  created_at       timestamptz not null default now()
);
create index if not exists casino_balance_mut_user_idx on public.casino_balance_mutations (user_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────
--  5. casino_deposits — on-chain deposit receipts
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_deposits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  chain_id         text not null,
  token_symbol     text not null,
  token_address    text not null,
  amount           numeric(78,0) not null,
  tx_hash          text not null unique,
  confirmations    integer not null default 0,
  finalized        boolean not null default false,
  credited         boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────
--  6. casino_withdrawals — on-chain withdraw receipts
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_withdrawals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  chain_id         text not null,
  token_symbol     text not null,
  token_address    text not null,
  amount           numeric(78,0) not null,
  tx_hash          text not null unique,
  confirmations    integer not null default 0,
  finalized        boolean not null default false,
  debited          boolean not null default false,
  operator_sig     text,
  created_at       timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────
--  7. casino_sessions — one row per hand / roll / pull
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_sessions (
  id                  uuid primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  game_id             text not null,
  chain_id            text not null,
  token_symbol        text not null,
  token_address       text not null,
  stake               numeric(78,0) not null,
  seed_pair_id        uuid not null references public.casino_seed_pairs(id),
  server_seed_hash    text not null,
  client_seed         text not null,
  start_nonce         bigint not null,
  end_nonce           bigint not null,
  status              text not null check (status in ('open','settled','voided')),
  state               jsonb not null,
  result              jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists casino_sessions_user_idx on public.casino_sessions (user_id, created_at desc);
create index if not exists casino_sessions_game_idx on public.casino_sessions (game_id, status);

-- ────────────────────────────────────────────────────────────────────────
--  8. casino_actions — append-only action log (cannot update/delete)
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.casino_actions (
  session_id       uuid not null references public.casino_sessions(id) on delete cascade,
  ordinal          integer not null,
  actor            text not null check (actor in ('player','dealer','system')),
  action           jsonb not null,
  nonce_after      bigint not null,
  state_hash       text,
  created_at       timestamptz not null default now(),
  primary key (session_id, ordinal)
);

-- ============================================================================
-- Atomic mutation RPC — used by the Supabase ledger to apply credit/lock/
-- unlock/burn under a row-level lock so concurrent tabs can't double-spend.
-- ============================================================================

create or replace function public.casino_apply_balance_mutation(
  p_user_id         uuid,
  p_chain_id        text,
  p_token_symbol    text,
  p_token_address   text,
  p_token_decimals  smallint,
  p_op              text,
  p_delta           numeric,
  p_reason          text,
  p_session_id      uuid,
  p_tx_hash         text
)
returns json
language plpgsql
security definer
as $fn$
declare
  v_row public.casino_balances%rowtype;
begin
  if p_delta <= 0 then
    raise exception 'delta must be positive';
  end if;

  insert into public.casino_balances (user_id, chain_id, token_symbol, token_address, token_decimals, available, locked)
  values (p_user_id, p_chain_id, p_token_symbol, p_token_address, p_token_decimals, 0, 0)
  on conflict do nothing;

  -- Row-level lock for the duration of this transaction.
  select * into v_row from public.casino_balances
    where user_id = p_user_id and chain_id = p_chain_id
      and token_symbol = p_token_symbol and token_address = p_token_address
    for update;

  if p_op = 'credit' then
    update public.casino_balances set available = available + p_delta, updated_at = now()
      where user_id = p_user_id and chain_id = p_chain_id
        and token_symbol = p_token_symbol and token_address = p_token_address
      returning available, locked into v_row.available, v_row.locked;
  elsif p_op = 'lock' then
    if v_row.available < p_delta then raise exception 'insufficient available'; end if;
    update public.casino_balances
      set available = available - p_delta, locked = locked + p_delta, updated_at = now()
      where user_id = p_user_id and chain_id = p_chain_id
        and token_symbol = p_token_symbol and token_address = p_token_address
      returning available, locked into v_row.available, v_row.locked;
  elsif p_op = 'unlock' then
    if v_row.locked < p_delta then raise exception 'insufficient locked'; end if;
    update public.casino_balances
      set available = available + p_delta, locked = locked - p_delta, updated_at = now()
      where user_id = p_user_id and chain_id = p_chain_id
        and token_symbol = p_token_symbol and token_address = p_token_address
      returning available, locked into v_row.available, v_row.locked;
  elsif p_op = 'burn' then
    if v_row.locked < p_delta then raise exception 'insufficient locked'; end if;
    update public.casino_balances
      set locked = locked - p_delta, updated_at = now()
      where user_id = p_user_id and chain_id = p_chain_id
        and token_symbol = p_token_symbol and token_address = p_token_address
      returning available, locked into v_row.available, v_row.locked;
  else
    raise exception 'unknown op %', p_op;
  end if;

  insert into public.casino_balance_mutations
    (user_id, chain_id, token_symbol, token_address, op, delta, reason, session_id, tx_hash)
  values
    (p_user_id, p_chain_id, p_token_symbol, p_token_address, p_op, p_delta, p_reason, p_session_id, p_tx_hash);

  return json_build_object('available', v_row.available::text, 'locked', v_row.locked::text);
end
$fn$;

-- ============================================================================
-- RLS policies
-- ============================================================================

alter table public.casino_users              enable row level security;
alter table public.casino_seed_pairs         enable row level security;
alter table public.casino_balances           enable row level security;
alter table public.casino_balance_mutations  enable row level security;
alter table public.casino_deposits           enable row level security;
alter table public.casino_withdrawals        enable row level security;
alter table public.casino_sessions           enable row level security;
alter table public.casino_actions            enable row level security;

do $$
begin
  -- Users can read their own rows in every table.
  perform 1;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_users'              and policyname='casino_users_own_read')              then create policy casino_users_own_read              on public.casino_users              for select using (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_seed_pairs'         and policyname='casino_seed_pairs_own_read')         then create policy casino_seed_pairs_own_read         on public.casino_seed_pairs         for select using (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_balances'           and policyname='casino_balances_own_read')           then create policy casino_balances_own_read           on public.casino_balances           for select using (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_balance_mutations'  and policyname='casino_balance_mutations_own_read')  then create policy casino_balance_mutations_own_read  on public.casino_balance_mutations  for select using (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_deposits'           and policyname='casino_deposits_own_read')           then create policy casino_deposits_own_read           on public.casino_deposits           for select using (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_withdrawals'        and policyname='casino_withdrawals_own_read')        then create policy casino_withdrawals_own_read        on public.casino_withdrawals        for select using (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_sessions'           and policyname='casino_sessions_own_read')           then create policy casino_sessions_own_read           on public.casino_sessions           for select using (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_actions'            and policyname='casino_actions_own_read')            then create policy casino_actions_own_read            on public.casino_actions            for select using (exists (select 1 from public.casino_sessions s where s.id = session_id and s.user_id = auth.uid())); end if;

  -- Users may insert their own user row + seed pairs + sessions + actions
  -- (the dev path; production replaces these with edge-function-only writes).
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_users'              and policyname='casino_users_own_write')              then create policy casino_users_own_write              on public.casino_users              for insert with check (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_seed_pairs'         and policyname='casino_seed_pairs_own_write')         then create policy casino_seed_pairs_own_write         on public.casino_seed_pairs         for insert with check (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_sessions'           and policyname='casino_sessions_own_write')           then create policy casino_sessions_own_write           on public.casino_sessions           for insert with check (auth.uid() = user_id); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='casino_actions'            and policyname='casino_actions_own_write')            then create policy casino_actions_own_write            on public.casino_actions            for insert with check (exists (select 1 from public.casino_sessions s where s.id = session_id and s.user_id = auth.uid())); end if;

  -- Balances / mutations / deposits / withdrawals are *only* mutated by
  -- the `casino_apply_balance_mutation` security-definer function or by
  -- service-role inserts from edge functions. No write policies for the
  -- anon role.
end $$;
