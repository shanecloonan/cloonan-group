/**
 * Multiplayer poker turn timer — uses `turn_started_at` so bot actions
 * do not reset the human action clock via `updated_at`.
 */

import { POKER_TURN_MS } from "./poker-constants";
import type { PokerState } from "./poker";

export function activeHumanSeat(state: PokerState): number | null {
  const seat = state.activeSeat;
  if (seat === null) return null;
  return state.players[seat]?.isHuman ? seat : null;
}

export function pokerTurnClockStart(room: {
  turn_started_at?: string | null;
  updated_at: string;
}): number {
  const iso = room.turn_started_at ?? room.updated_at;
  return new Date(iso).getTime();
}

export function pokerTurnElapsedMs(room: {
  turn_started_at?: string | null;
  updated_at: string;
}): number {
  return Date.now() - pokerTurnClockStart(room);
}

export function pokerTurnExpired(
  room: { turn_started_at?: string | null; updated_at: string },
  slackMs = 500,
): boolean {
  const human = room.turn_started_at;
  if (!human) return false;
  return pokerTurnElapsedMs(room) >= POKER_TURN_MS - slackMs;
}

/** Set when the active human seat changes; cleared when bots act. */
export function resolvePokerTurnStartedAt(
  room: { turn_started_at?: string | null },
  prevState: PokerState | null,
  nextState: PokerState,
): string | null {
  const nextHuman = activeHumanSeat(nextState);
  if (nextHuman === null) return null;
  const prevHuman = prevState ? activeHumanSeat(prevState) : null;
  if (nextHuman !== prevHuman) return new Date().toISOString();
  return room.turn_started_at ?? new Date().toISOString();
}
