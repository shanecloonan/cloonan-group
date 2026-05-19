/* ===========================================================================
 *  MoneyFund Casino — Crash (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  The defining crypto-casino game. Each round:
 *
 *    1. Players place a bet during a brief "betting" window. They MAY also
 *       set an `autoCashoutMultiplier` so the cashout fires programmatically.
 *    2. A multiplier curve starts at 1.00× and climbs continuously over
 *       wallclock time according to `curveMultiplierAt(elapsedMs)`.
 *    3. The curve "busts" at a predetermined point `bustAt`, which is
 *       *computed before the round starts* from (server_seed, client_seed,
 *       nonce). Anyone with the revealed seed can verify the bust point.
 *    4. A player who manually cashes out at multiplier M_cashout < bustAt
 *       wins `stake * M_cashout` (paid back stake + winnings). A player
 *       still in the game when the round busts loses their stake.
 *
 *  Why "provably fair" for crash specifically:
 *    - The server publishes `server_seed_hash` BEFORE the round starts.
 *    - All players see the same curve, derived from the same seed.
 *    - After the round, the server reveals `server_seed`. Anyone can
 *      recompute `bustAt` and confirm the curve was honest.
 *
 *  Bust-point formula (52-bit RNG draw `h`, `e = 2^52`):
 *
 *      bust = floor( (100·e - h) / (e - h) ) / 100
 *
 *  Domain analysis:
 *    - h = 0           → bust = 1.00 (minimum)
 *    - h = e/2         → bust = 1.99
 *    - h → e           → bust → ∞
 *    - P(bust > k) = 99 / (100k - 1)   (for k >= 1)
 *    - E[payout/stake | cashout @ k] = 99k / (100k - 1)
 *    - asymptotic edge = 1% at high cashouts; 0.5% at k=2
 *
 *  This matches the other casino games (~99% RTP) within a few basis
 *  points of edge.
 *
 *  The engine itself is single-bet (one player, one wager per session).
 *  Multiplayer synchronization (Supabase Realtime + shared rounds) is a
 *  separate coordinator that wraps this engine — see follow-up phase.
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

/* ---------------------------------------------------------------------------
 *  Public types
 * ------------------------------------------------------------------------- */

export interface CrashConfig {
  /**
   * "House edge in basis points". Currently informational: the natural
   * edge of the formula above is ~1%; this field is reserved for future
   * tuning. We keep it in `state.config` so the verify page can replay
   * the same parameters.
   */
  houseEdgeBps: number;
  /**
   * Curve constant, in `e^(curveK · elapsedSec)` formulation. The
   * standard crash curve uses k ≈ 0.06 → at t=10s multiplier ≈ 1.82×; at
   * t=20s ≈ 3.32×; at t=60s ≈ 36.6×. This is purely a display parameter
   * — it does NOT affect bust point math, only how quickly the curve
   * reaches it.
   */
  curveK: number;
  /**
   * Hard ceiling on bust point (display). The formula can produce
   * astronomical multipliers (e.g. h = e - 1 → bust = e × 100). UIs
   * cap to keep the curve readable; we honor the same cap in payouts.
   */
  maxBust: number;
}

export const DEFAULT_CRASH_CONFIG: CrashConfig = {
  houseEdgeBps: 100,
  curveK: 0.06,
  maxBust: 1_000_000,
};

export interface CrashBetParams {
  /** Optional auto-cashout multiplier. If set, the engine settles
   *  deterministically at min(autoCashoutMultiplier, bustAt). */
  autoCashoutMultiplier?: number;
}

/**
 * Discrete state machine:
 *   placed → running → cashed_out | busted
 *
 * Because Crash is a *real-time* game, the engine doesn't drive the
 * tick loop itself — the UI controls the wallclock animation and emits
 * a single `cashout` action when the player clicks or the auto-cashout
 * threshold is reached. The engine validates the requested multiplier
 * against `bustAt` and settles.
 */
export type CrashPhase = "placed" | "running" | "cashed_out" | "busted";

export interface CrashState {
  config: CrashConfig;
  stake: bigint;
  /** Pre-computed at `initialState`. Players can't see it; the UI gets
   *  it only because client-side animation needs it to render the
   *  curve. In a true server-driven multiplayer setup, this value would
   *  live server-side and the UI would only learn the bust at the
   *  moment the curve crosses some threshold. */
  bustAt: number;
  /** If the bet specified `autoCashoutMultiplier`, the engine resolves
   *  immediately at `min(autoCashout, bustAt)`. */
  autoCashoutMultiplier: number | null;
  /** Resolved multiplier at which the player exited (or busted). */
  exitMultiplier: number | null;
  phase: CrashPhase;
  /** Raw 52-bit RNG draw used to derive bustAt — kept for replay. */
  rngDraw: bigint;
}

export type CrashAction =
  | { type: "cashout"; multiplier: number }
  | { type: "bust" };

/* ---------------------------------------------------------------------------
 *  Provably-fair bust-point derivation
 * ------------------------------------------------------------------------- */

const E = 1n << 52n; // 2^52

/**
 * Pull a 52-bit unsigned integer from the RNG stream. We use two
 * `nextUint32()` calls (32 + 20 = 52 bits) so the stream consumption is
 * deterministic and predictable across implementations.
 */
function draw52Bits(rng: RngStream): bigint {
  const hi = BigInt(rng.nextUint32());            // 32 bits
  const lo = BigInt(rng.nextUint32()) >> 12n;     // top 20 bits of second u32
  return (hi << 20n) | lo;                        // 52-bit unsigned in [0, 2^52)
}

/**
 * Pure function: turn a 52-bit RNG draw into a display bust multiplier.
 *
 *   bust = floor((100·e − h) / (e − h)) / 100
 *
 * Exposed so the verify page can replay bust points without instantiating
 * the entire game state machine.
 */
export function bustFromDraw(h: bigint, maxBust: number = DEFAULT_CRASH_CONFIG.maxBust): number {
  if (h < 0n || h >= E) {
    throw new Error(`crash.bustFromDraw: h=${h} out of range [0, 2^52)`);
  }
  // Edge case: h = e - 1 would give (100e - e + 1)/(1) = 99e + 1, hugely
  // overflowing typical display. We cap at maxBust below.
  const num = 100n * E - h;
  const den = E - h;
  if (den <= 0n) return maxBust;
  const mTimes100 = num / den;            // floor division
  // bigint → number is safe here because mTimes100 < maxBust * 100 after cap
  const m = Number(mTimes100) / 100;
  if (!Number.isFinite(m)) return maxBust;
  return Math.min(m, maxBust);
}

/**
 * Convenience wrapper: derive the bust multiplier directly from a fresh
 * RNG stream. Consumes exactly 8 bytes (two uint32s) from the stream.
 */
export function bustMultiplier(rng: RngStream, config: CrashConfig = DEFAULT_CRASH_CONFIG): number {
  const h = draw52Bits(rng);
  return bustFromDraw(h, config.maxBust);
}

/* ---------------------------------------------------------------------------
 *  Curve math (display only — does NOT affect bust point)
 * ------------------------------------------------------------------------- */

/**
 * Display multiplier at `elapsedMs` since round start. Inverse function
 * `timeToReach(multiplier)` is given below — handy for the UI to schedule
 * its auto-cashout firing.
 */
export function curveMultiplierAt(elapsedMs: number, curveK: number = DEFAULT_CRASH_CONFIG.curveK): number {
  if (elapsedMs <= 0) return 1.0;
  const elapsedSec = elapsedMs / 1000;
  return Math.max(1.0, Math.exp(curveK * elapsedSec));
}

/**
 * Inverse of `curveMultiplierAt`: time at which the curve crosses a given
 * multiplier. Returns wallclock ms relative to round start.
 */
export function timeToReachMultiplier(target: number, curveK: number = DEFAULT_CRASH_CONFIG.curveK): number {
  if (target <= 1.0) return 0;
  return Math.max(0, (Math.log(target) / curveK) * 1000);
}

/* ---------------------------------------------------------------------------
 *  Game implementation
 * ------------------------------------------------------------------------- */

function mergeConfig(raw: Record<string, unknown> | undefined): CrashConfig {
  if (!raw) return { ...DEFAULT_CRASH_CONFIG };
  const merged = { ...DEFAULT_CRASH_CONFIG, ...(raw as Partial<CrashConfig>) };
  if (!Number.isFinite(merged.curveK) || merged.curveK <= 0 || merged.curveK > 1) {
    throw new Error("crash: curveK must be a positive number <= 1");
  }
  if (!Number.isInteger(merged.houseEdgeBps) || merged.houseEdgeBps < 0 || merged.houseEdgeBps > 1000) {
    throw new Error("crash: houseEdgeBps must be integer in [0, 1000]");
  }
  if (!Number.isFinite(merged.maxBust) || merged.maxBust < 100) {
    throw new Error("crash: maxBust must be >= 100");
  }
  return merged;
}

function initialState(bet: Bet, rng: RngStream): CrashState {
  const config = mergeConfig(bet.config);
  const params = (bet.config ?? {}) as CrashBetParams & Record<string, unknown>;

  let autoCashoutMultiplier: number | null = null;
  if (typeof params.autoCashoutMultiplier === "number") {
    if (!Number.isFinite(params.autoCashoutMultiplier) || params.autoCashoutMultiplier <= 1.0) {
      throw new Error("crash: autoCashoutMultiplier must be > 1.0");
    }
    autoCashoutMultiplier = Math.min(params.autoCashoutMultiplier, config.maxBust);
  }

  const rngDraw = draw52Bits(rng);
  const bustAt = bustFromDraw(rngDraw, config.maxBust);

  return {
    config,
    stake: bet.stake,
    bustAt,
    autoCashoutMultiplier,
    exitMultiplier: null,
    phase: "running", // ready to receive cashout / bust action
    rngDraw,
  };
}

function legalActions(state: CrashState): CrashAction[] {
  if (state.phase !== "running") return [];
  return [
    { type: "cashout", multiplier: 1.0 }, // placeholder; UI fills with current m
    { type: "bust" },
  ];
}

function step(state: CrashState, action: CrashAction, _rng: RngStream): CrashState {
  if (state.phase !== "running") {
    throw new Error(`crash.step: state.phase=${state.phase} is terminal`);
  }
  if (action.type === "bust") {
    return {
      ...state,
      phase: "busted",
      exitMultiplier: state.bustAt,
    };
  }
  // cashout action — multiplier must be in (1.0, bustAt). If the UI tries
  // to cash out *after* the bust point, the request is rejected at engine
  // level (server can't pay non-existent winnings).
  if (!Number.isFinite(action.multiplier) || action.multiplier <= 1.0) {
    throw new Error(`crash.cashout: multiplier ${action.multiplier} must be > 1.0`);
  }
  if (action.multiplier >= state.bustAt) {
    // The curve already busted — cashout request comes too late. Settle
    // as a bust at the precomputed point.
    return {
      ...state,
      phase: "busted",
      exitMultiplier: state.bustAt,
    };
  }
  // For auto-cashout deterministic settlement: clamp to the player's
  // configured cap (the engine respects the lower of the two).
  const cap = state.autoCashoutMultiplier ?? Number.POSITIVE_INFINITY;
  const exit = Math.min(action.multiplier, cap);
  return {
    ...state,
    phase: "cashed_out",
    exitMultiplier: exit,
  };
}

function isTerminal(state: CrashState): boolean {
  return state.phase === "cashed_out" || state.phase === "busted";
}

function settle(state: CrashState, _bet: Bet): GameResult {
  if (!isTerminal(state)) {
    throw new Error("crash.settle: state is not terminal");
  }
  const won = state.phase === "cashed_out";
  // Payout = stake * exitMultiplier, rounded down to base units. Use
  // integer math via a 1e6-scaled multiplier so we don't lose precision.
  const exit = state.exitMultiplier ?? 0;
  const exitScaled = BigInt(Math.floor(exit * 1_000_000));
  const payout = won ? (state.stake * exitScaled) / 1_000_000n : 0n;

  const breakdown = [
    {
      label: won
        ? `Cashed out at ${exit.toFixed(2)}× before bust at ${state.bustAt.toFixed(2)}×`
        : `Busted at ${state.bustAt.toFixed(2)}× before cashout`,
      stakedUnits: state.stake,
      payoutUnits: payout,
      pnlUnits: payout - state.stake,
    },
  ];

  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown,
  };
}

export const crashGame: Game<CrashAction, CrashState> = {
  id: "crash",
  display: "Crash",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/* ---------------------------------------------------------------------------
 *  Strategy helpers
 * ------------------------------------------------------------------------- */

/**
 * Expected payout multiplier (RTP) of a cashout-at-k strategy. Useful
 * for the UI to display "if you cash out at 2.0×, your expected return
 * is X% per dollar wagered".
 *
 *   P(bust > k) = 99 / (100k - 1)
 *   E[return | cashout @ k] = k · P(bust > k) = 99k / (100k - 1)
 */
export function expectedRtpAtCashout(k: number): number {
  if (k <= 1) return 1.0;
  return (99 * k) / (100 * k - 1);
}

/**
 * Probability the round busts strictly above `k`. Mirrors the formula in
 * `expectedRtpAtCashout`. Returns a number in [0, 1].
 */
export function probabilityBustAbove(k: number): number {
  if (k <= 1) return 1.0;
  return 99 / (100 * k - 1);
}
