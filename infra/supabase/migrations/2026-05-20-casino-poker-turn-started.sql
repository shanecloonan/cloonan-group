-- Dedicated turn clock for human actions (not reset by bot `updated_at` bumps)

alter table public.casino_poker_rooms
  add column if not exists turn_started_at timestamptz;
