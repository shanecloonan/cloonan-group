/* ===========================================================================
 *  MoneyFund Casino — Keno
 *  ---------------------------------------------------------------------------
 *  Classic 80-ball keno: pick 1–10 numbers, draw 20 without replacement,
 *  pay from a fixed table (total return × stake). ~92% RTP at max spots.
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

export const KENO_POOL = 80;
export const KENO_DRAW_COUNT = 20;
export const KENO_MIN_PICKS = 1;
export const KENO_MAX_PICKS = 10;

export interface KenoAction {
  type: "noop";
}

export interface KenoConfig {
  houseEdgeBps: number;
}

export const DEFAULT_KENO_CONFIG: KenoConfig = { houseEdgeBps: 100 };

export interface KenoState {
  config: KenoConfig;
  picks: number[];
  drawn: number[];
  hits: number;
  payMultiplier: number;
  stake: bigint;
  phase: "settled";
}

/**
 * Total return multiple on stake for (pickCount, hitCount).
 * Row index = number of picks; column = hits (0..pickCount).
 */
const PAY_TABLE: number[][] = [
  [],
  [0, 3],
  [0, 1, 12],
  [0, 0, 2, 42],
  [0, 0, 1, 4, 100],
  [0, 0, 0, 2, 20, 450],
  [0, 0, 0, 1, 6, 55, 1600],
  [0, 0, 0, 0, 3, 30, 300, 5000],
  [0, 0, 0, 0, 2, 12, 98, 1650, 10000],
  [0, 0, 0, 0, 1, 6, 44, 335, 4700, 10000],
  [0, 0, 0, 0, 0, 3, 20, 110, 1200, 4500, 10000],
];

export function payMultiplierForHits(pickCount: number, hitCount: number): number {
  if (pickCount < KENO_MIN_PICKS || pickCount > KENO_MAX_PICKS) return 0;
  const row = PAY_TABLE[pickCount];
  if (!row || hitCount < 0 || hitCount >= row.length) return 0;
  return row[hitCount] ?? 0;
}

/** Draw `count` distinct numbers in [1, pool] using Fisher–Yates on indices. */
export function drawKenoNumbers(rng: RngStream, pool = KENO_POOL, count = KENO_DRAW_COUNT): number[] {
  if (count < 1 || count > pool) {
    throw new Error(`keno.draw: count=${count} invalid for pool=${pool}`);
  }
  const indices = Array.from({ length: pool }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + rng.nextInt(pool - i);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices.slice(0, count).map((i) => i + 1).sort((a, b) => a - b);
}

export function countHits(picks: number[], drawn: number[]): number {
  const set = new Set(drawn);
  let n = 0;
  for (const p of picks) if (set.has(p)) n++;
  return n;
}

function normalizePicks(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw new Error("keno: picks must be an array");
  const picks = [...new Set(raw.map((n) => Number(n)))].filter(
    (n) => Number.isInteger(n) && n >= 1 && n <= KENO_POOL,
  );
  picks.sort((a, b) => a - b);
  if (picks.length < KENO_MIN_PICKS || picks.length > KENO_MAX_PICKS) {
    throw new Error(`keno: pick ${KENO_MIN_PICKS}–${KENO_MAX_PICKS} numbers (got ${picks.length})`);
  }
  return picks;
}

function initialState(bet: Bet, rng: RngStream): KenoState {
  const config = { ...DEFAULT_KENO_CONFIG, ...(bet.config as Partial<KenoConfig> | undefined) };
  const picks = normalizePicks((bet.config as { picks?: unknown })?.picks);
  const drawn = drawKenoNumbers(rng);
  const hits = countHits(picks, drawn);
  const payMultiplier = payMultiplierForHits(picks.length, hits);

  return {
    config,
    picks,
    drawn,
    hits,
    payMultiplier,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: KenoState): KenoAction[] {
  return [];
}

function step(state: KenoState, _action: KenoAction, _rng: RngStream): KenoState {
  throw new Error("keno.step: terminal after draw");
}

function isTerminal(state: KenoState): boolean {
  return state.phase === "settled";
}

function settle(state: KenoState, _bet: Bet): GameResult {
  const payout =
    state.payMultiplier > 0 ? state.stake * BigInt(state.payMultiplier) : 0n;
  const label =
    state.payMultiplier > 0
      ? `${state.hits}/${state.picks.length} hits · pays ${state.payMultiplier}×`
      : `${state.hits}/${state.picks.length} hits · no win`;

  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [
      {
        label,
        stakedUnits: state.stake,
        payoutUnits: payout,
        pnlUnits: payout - state.stake,
      },
    ],
  };
}

export const kenoGame: Game<KenoAction, KenoState> = {
  id: "keno",
  display: "Keno",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function kenoRtpLabel(pickCount: number): string {
  if (pickCount <= 3) return "≈90%";
  if (pickCount <= 6) return "≈91%";
  return "≈92%";
}
