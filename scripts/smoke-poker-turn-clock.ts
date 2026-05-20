/* ===========================================================================
 *  Smoke: poker turn clock helpers
 *  Run: npx tsx scripts/smoke-poker-turn-clock.ts
 * ========================================================================= */

import {
  activeHumanSeat,
  pokerTurnExpired,
  resolvePokerTurnStartedAt,
} from "../lib/casino/poker-turn-clock";
import { POKER_TURN_MS } from "../lib/casino/poker-constants";
import type { PokerState } from "../lib/casino/poker";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ FAIL: ${msg}`);
  process.exit(1);
}

function stubState(activeSeat: number | null, humanAt: number | null): PokerState {
  const players = Array.from({ length: 6 }, (_, i) => ({
    seat: i,
    name: `P${i}`,
    stack: 1000n,
    betThisRound: 0n,
    folded: false,
    allIn: false,
    isHuman: humanAt === i,
    hole: [],
  }));
  return {
    phase: "preflop",
    activeSeat,
    players,
    pot: 0n,
    currentBet: 0n,
    minRaise: 2n,
    deck: [],
    board: [],
    message: "",
    config: { bigBlind: 2n, smallBlind: 1n, numSeats: 6, seatMeta: [] },
    winners: [],
  } as unknown as PokerState;
}

console.log("=== smoke-poker-turn-clock ===\n");

const botOnly = stubState(2, null);
if (activeHumanSeat(botOnly) !== null) fail("bot seat is not human");
pass("activeHumanSeat null for bot turn");

const humanTurn = stubState(1, 1);
if (activeHumanSeat(humanTurn) !== 1) fail("human seat detected");
pass("activeHumanSeat finds human");

const t0 = resolvePokerTurnStartedAt({ turn_started_at: null }, null, humanTurn);
if (!t0) fail("should set turn_started_at when human becomes active");
pass("sets turn_started_at on new human turn");

const t1 = resolvePokerTurnStartedAt({ turn_started_at: t0 }, humanTurn, humanTurn);
if (t1 !== t0) fail("same human turn should keep clock");
pass("preserves clock while same human acts");

const afterBot = stubState(3, null);
const t2 = resolvePokerTurnStartedAt({ turn_started_at: t0 }, humanTurn, afterBot);
if (t2 !== null) fail("bot turn clears clock");
pass("clears turn_started_at when bots act");

const room = {
  turn_started_at: new Date(Date.now() - POKER_TURN_MS - 1000).toISOString(),
  updated_at: new Date().toISOString(),
};
if (!pokerTurnExpired(room)) fail("expired clock should fire");
pass("pokerTurnExpired after 45s");

const fresh = {
  turn_started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
if (pokerTurnExpired(fresh)) fail("fresh clock should not expire");
pass("fresh clock not expired");

console.log("\nAll poker turn-clock smoke tests passed ✓");
