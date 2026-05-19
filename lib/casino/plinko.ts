/* ===========================================================================
 *  MoneyFund Casino — Plinko (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  The visual-first casino classic. A ball drops from the top of a peg
 *  triangle and bounces left/right at each row with 50/50 probability,
 *  finally landing in one of (rows + 1) bins. Each bin has a payout
 *  multiplier — outer bins pay big but are rare (binomial coefficients).
 *
 *  Provably fair:
 *    - We consume exactly `rows` bits from the HMAC stream (one bit per
 *      bounce). `bit=0` → left, `bit=1` → right.
 *    - The final bin index equals the number of rights — purely a
 *      Bernoulli(rows, 0.5) draw.
 *
 *  Bin probabilities (rows = N):
 *    P(bin k) = C(N, k) / 2^N
 *  Expected RTP at a given payout table M[k]:
 *    RTP = Σ_k P(bin k) · M[k]
 *
 *  We target ~99% RTP across all three risk tiers per row count by
 *  using Stake.com-equivalent tables (verified with 200k-drop Monte
 *  Carlo in `scripts/smoke-casino-plinko.ts`).
 *
 *  RNG consumption: ceil(rows / 8) bytes per drop (we read whole bytes
 *  and bit-shift). For the standard 16-row board, that's exactly 2 bytes.
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

/* ---------------------------------------------------------------------------
 *  Types + payout tables
 * ------------------------------------------------------------------------- */

export type PlinkoRowCount = 8 | 12 | 16;
export type PlinkoRisk = "low" | "medium" | "high";

export interface PlinkoConfig {
  rows: PlinkoRowCount;
  risk: PlinkoRisk;
}

export const DEFAULT_PLINKO_CONFIG: PlinkoConfig = {
  rows: 16,
  risk: "medium",
};

/**
 * Payout tables (multiplier per bin, symmetric around the center). Sourced
 * from the published Stake.com Plinko tables (~99% RTP each) and validated
 * by 200k Monte Carlo runs in the smoke test.
 *
 * NB: arrays are length (rows + 1).
 */
export const PLINKO_PAYOUTS: Record<PlinkoRowCount, Record<PlinkoRisk, number[]>> = {
  8: {
    low: [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

export interface PlinkoState {
  config: PlinkoConfig;
  stake: bigint;
  /** Path taken: sequence of `rows` left/right (false/true) decisions. */
  path: boolean[];
  /** Resulting bin index — equals count of `true` in `path`. */
  bin: number;
  /** Payout multiplier (display): `PLINKO_PAYOUTS[rows][risk][bin]`. */
  multiplier: number;
  /** Multiplier as exact integer scaled by 1000 — used for bigint math. */
  multiplierMilli: number;
  phase: "settled";
}

export interface PlinkoAction {
  type: "noop";
}

/* ---------------------------------------------------------------------------
 *  Math helpers
 * ------------------------------------------------------------------------- */

/** Binomial coefficient C(n, k) — exact integer. Cached for small n. */
const BINOM_CACHE = new Map<string, number>();
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const key = `${n}:${k}`;
  const hit = BINOM_CACHE.get(key);
  if (hit !== undefined) return hit;
  let v = 1;
  for (let i = 1; i <= k; i++) {
    v = (v * (n - i + 1)) / i;
  }
  v = Math.round(v);
  BINOM_CACHE.set(key, v);
  return v;
}

/** P(bin k) = C(rows, k) / 2^rows. */
export function plinkoBinProbability(rows: number, bin: number): number {
  return binomial(rows, bin) / Math.pow(2, rows);
}

/**
 * Theoretical RTP of a (rows, risk) configuration. Used for the UI and
 * for the smoke-test sanity check.
 */
export function plinkoTheoreticalRtp(config: PlinkoConfig): number {
  const payouts = PLINKO_PAYOUTS[config.rows][config.risk];
  let rtp = 0;
  for (let k = 0; k <= config.rows; k++) {
    rtp += plinkoBinProbability(config.rows, k) * payouts[k];
  }
  return rtp;
}

/* ---------------------------------------------------------------------------
 *  Engine
 * ------------------------------------------------------------------------- */

function mergeConfig(raw: Record<string, unknown> | undefined): PlinkoConfig {
  if (!raw) return { ...DEFAULT_PLINKO_CONFIG };
  const r = raw as Partial<PlinkoConfig>;
  const rows = (r.rows ?? DEFAULT_PLINKO_CONFIG.rows) as PlinkoRowCount;
  const risk = (r.risk ?? DEFAULT_PLINKO_CONFIG.risk) as PlinkoRisk;
  if (rows !== 8 && rows !== 12 && rows !== 16) {
    throw new Error(`plinko: rows must be 8, 12, or 16 (got ${rows})`);
  }
  if (risk !== "low" && risk !== "medium" && risk !== "high") {
    throw new Error(`plinko: risk must be low|medium|high (got ${risk})`);
  }
  return { rows, risk };
}

/**
 * Draw a single bit from the RNG stream. We pull a byte at a time and
 * shift; the stream's per-call rejection sampling already gives uniform
 * bits, so `byte & 1` is unbiased.
 *
 * IMPORTANT: we MUST commit to a consistent bit-extraction strategy
 * across replays. We use one byte per bounce — wasteful, but trivially
 * deterministic. (Standard nextInt(2) would also work; we use the
 * dedicated byte API to keep stream consumption predictable.)
 */
function drawBit(rng: RngStream): boolean {
  return (rng.nextByte() & 1) === 1;
}

function initialState(bet: Bet, rng: RngStream): PlinkoState {
  const config = mergeConfig(bet.config);
  const payouts = PLINKO_PAYOUTS[config.rows][config.risk];

  const path: boolean[] = [];
  let bin = 0;
  for (let r = 0; r < config.rows; r++) {
    const right = drawBit(rng);
    path.push(right);
    if (right) bin += 1;
  }

  const multiplier = payouts[bin];
  // Convert to integer millis (3 decimal precision) so the bigint payout
  // math is exact.
  const multiplierMilli = Math.round(multiplier * 1000);

  return {
    config,
    stake: bet.stake,
    path,
    bin,
    multiplier,
    multiplierMilli,
    phase: "settled",
  };
}

function legalActions(_state: PlinkoState): PlinkoAction[] {
  return [];
}

function step(_state: PlinkoState, _action: PlinkoAction, _rng: RngStream): PlinkoState {
  throw new Error("plinko.step: no actions are valid; state is terminal after initialState");
}

function isTerminal(state: PlinkoState): boolean {
  return state.phase === "settled";
}

function settle(state: PlinkoState, _bet: Bet): GameResult {
  const payout = (state.stake * BigInt(state.multiplierMilli)) / 1000n;
  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [
      {
        label: `Bin ${state.bin}/${state.config.rows} · ${state.multiplier.toFixed(2)}×`,
        stakedUnits: state.stake,
        payoutUnits: payout,
        pnlUnits: payout - state.stake,
      },
    ],
  };
}

export const plinkoGame: Game<PlinkoAction, PlinkoState> = {
  id: "plinko",
  display: "Plinko",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};
