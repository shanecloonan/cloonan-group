/* ===========================================================================
 *  MoneyFund Casino — Dice / Limbo (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  The crypto-casino staple. Player picks:
 *    • A target T in [0.01, 99.98] (resolution 0.01).
 *    • A direction: "under" (win if roll < T) or "over" (win if roll > T).
 *
 *  Engine rolls a uniform integer in {0, 1, …, 9999} and we display it as
 *  `roll = index / 100` (so 0.00 → 99.99).
 *
 *  Win probabilities (exact, in basis points out of 10,000):
 *    • under T_bps: winCount = T_bps                 → P = T_bps/10000
 *    • over  T_bps: winCount = 9999 - T_bps          → P = (9999-T_bps)/10000
 *
 *  Multiplier formula (exact bigint arithmetic):
 *    M = (10000 - houseEdgeBps) / winCount
 *  ⇒ payout = stake * (10000 - houseEdgeBps) / winCount
 *
 *  Limbo mode is just the same engine with a different UI: the user picks
 *  a target multiplier M, and we derive `target` such that the win chance
 *  matches the requested M (with 1% edge).
 *
 *  State terminal on deal (no follow-up actions). RNG consumption: one
 *  `nextInt(10000)` call (rejection-sampled, ~1 uint32 most of the time).
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

export type DiceDirection = "under" | "over";

export interface DiceAction {
  type: "noop";
}

export interface DiceConfig {
  houseEdgeBps: number; // default 100 = 1%
}

export const DEFAULT_DICE_CONFIG: DiceConfig = {
  houseEdgeBps: 100,
};

export interface DiceState {
  config: DiceConfig;
  /** Player target in basis points of the [0, 100) range. 1 = 0.01. */
  targetBps: number;
  direction: DiceDirection;
  /** Out of 10,000 possible roll values, how many are wins. */
  winCount: number;
  /** Payout multiplier as exact fraction: payout = stake * num / den. */
  multiplierNum: bigint;
  multiplierDen: bigint;
  /** The actual roll value, basis-points (0-9999). Display as / 100. */
  rollBps: number;
  won: boolean;
  stake: bigint;
  phase: "settled";
}

/* ---------------------------------------------------------------------------
 *  Helpers
 * ------------------------------------------------------------------------- */

const ROLL_DOMAIN = 10000; // possible roll outcomes
const HOUSE_BPS_BASE = 10000n; // 1.0000 in bps

function winCountFor(direction: DiceDirection, targetBps: number): number {
  if (direction === "under") {
    return targetBps;
  }
  // direction === "over": roll > target, so winning values are
  // {targetBps + 1, …, 9999}.  That's (10000 - targetBps - 1) values.
  return ROLL_DOMAIN - targetBps - 1;
}

/**
 * Compute the exact bigint multiplier (num/den) for a given win count.
 * Examples (1% edge, denom = winCount):
 *   winCount = 5000 → M = 9900 / 5000 = 1.98×
 *   winCount = 9000 → M = 9900 / 9000 = 1.10×
 *   winCount = 100  → M = 9900 / 100  = 99.00×
 *   winCount = 1    → M = 9900 / 1    = 9900.00×
 */
function multiplierFraction(houseEdgeBps: number, winCount: number): { num: bigint; den: bigint } {
  if (winCount <= 0) {
    return { num: 0n, den: 1n }; // unreachable — UI guards against impossible bets
  }
  const num = HOUSE_BPS_BASE - BigInt(houseEdgeBps);
  const den = BigInt(winCount);
  return { num, den };
}

/**
 * Given a target multiplier M (as a number, e.g. 2.5), derive (targetBps,
 * direction="over") that closest matches M with the configured edge. Used
 * by Limbo mode.
 *
 *   winCount = (10000 - houseEdgeBps) / M
 *   ⇒ targetBps = 10000 - winCount - 1   (rounded so winCount is integer)
 *
 * Returns `null` for unreachable multipliers (winCount < 1 or > 9998).
 */
export function limboTargetForMultiplier(
  multiplier: number,
  config: DiceConfig = DEFAULT_DICE_CONFIG,
): { targetBps: number; direction: DiceDirection } | null {
  if (!Number.isFinite(multiplier) || multiplier <= 1) return null;
  // Maximum theoretical multiplier is (10000 - houseEdge) / 1 winning roll.
  const maxM = 10000 - config.houseEdgeBps;
  if (multiplier > maxM) return null;
  const winCountFloat = (10000 - config.houseEdgeBps) / multiplier;
  const winCount = Math.max(1, Math.floor(winCountFloat));
  const targetBps = ROLL_DOMAIN - winCount - 1;
  if (targetBps < 1 || targetBps > ROLL_DOMAIN - 2) return null;
  return { targetBps, direction: "over" };
}

/* ---------------------------------------------------------------------------
 *  Pure game implementation
 * ------------------------------------------------------------------------- */

function mergeConfig(raw: Record<string, unknown> | undefined): DiceConfig {
  if (!raw) return { ...DEFAULT_DICE_CONFIG };
  const merged = { ...DEFAULT_DICE_CONFIG, ...(raw as Partial<DiceConfig>) };
  if (!Number.isInteger(merged.houseEdgeBps) || merged.houseEdgeBps < 0 || merged.houseEdgeBps > 5000) {
    throw new Error("dice: houseEdgeBps must be an integer in [0, 5000]");
  }
  return merged;
}

interface DiceBetParams {
  targetBps?: number;
  direction?: DiceDirection;
  /** Convenience: if provided, overrides target+direction (Limbo mode). */
  limboMultiplier?: number;
}

function initialState(bet: Bet, rng: RngStream): DiceState {
  const config = mergeConfig(bet.config);
  const params = (bet.config ?? {}) as DiceBetParams & Record<string, unknown>;

  let targetBps: number;
  let direction: DiceDirection;

  if (typeof params.limboMultiplier === "number") {
    const derived = limboTargetForMultiplier(params.limboMultiplier, config);
    if (!derived) {
      throw new Error(`dice: limboMultiplier ${params.limboMultiplier} out of reachable range`);
    }
    targetBps = derived.targetBps;
    direction = derived.direction;
  } else {
    targetBps = Number.isInteger(params.targetBps) ? Number(params.targetBps) : 5000;
    direction = params.direction === "under" ? "under" : "over";
  }

  if (targetBps < 1 || targetBps > ROLL_DOMAIN - 2) {
    throw new Error(`dice: targetBps ${targetBps} must be in [1, ${ROLL_DOMAIN - 2}]`);
  }

  const winCount = winCountFor(direction, targetBps);
  if (winCount <= 0) {
    throw new Error(`dice: degenerate bet (winCount=${winCount})`);
  }
  const { num: multiplierNum, den: multiplierDen } = multiplierFraction(config.houseEdgeBps, winCount);

  // Bias-free roll in [0, 10000).
  const rollBps = rng.nextInt(ROLL_DOMAIN);
  const won = direction === "under" ? rollBps < targetBps : rollBps > targetBps;

  return {
    config,
    targetBps,
    direction,
    winCount,
    multiplierNum,
    multiplierDen,
    rollBps,
    won,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: DiceState): DiceAction[] {
  return [];
}

function step(_state: DiceState, _action: DiceAction, _rng: RngStream): DiceState {
  throw new Error("dice.step: no actions are valid; state is terminal after initialState");
}

function isTerminal(state: DiceState): boolean {
  return state.phase === "settled";
}

function settle(state: DiceState, _bet: Bet): GameResult {
  const payout = state.won ? (state.stake * state.multiplierNum) / state.multiplierDen : 0n;
  const rollDisplay = (state.rollBps / 100).toFixed(2);
  const targetDisplay = (state.targetBps / 100).toFixed(2);
  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [
      {
        label: state.won
          ? `Roll ${rollDisplay} ${state.direction === "under" ? "<" : ">"} ${targetDisplay} · win`
          : `Roll ${rollDisplay} ${state.direction === "under" ? ">=" : "<="} ${targetDisplay} · loss`,
        stakedUnits: state.stake,
        payoutUnits: payout,
        pnlUnits: payout - state.stake,
      },
    ],
  };
}

export const diceGame: Game<DiceAction, DiceState> = {
  id: "dice",
  display: "Dice",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/* ---------------------------------------------------------------------------
 *  UI-friendly helpers
 * ------------------------------------------------------------------------- */

export function diceWinChancePercent(direction: DiceDirection, targetBps: number): number {
  return (winCountFor(direction, targetBps) / ROLL_DOMAIN) * 100;
}

export function diceMultiplier(
  direction: DiceDirection,
  targetBps: number,
  config: DiceConfig = DEFAULT_DICE_CONFIG,
): number {
  const winCount = winCountFor(direction, targetBps);
  if (winCount <= 0) return 0;
  return (10000 - config.houseEdgeBps) / winCount;
}
