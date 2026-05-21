/* ===========================================================================
 *  MoneyFund Casino — Chuck-a-Luck (Birdcage)
 *  ---------------------------------------------------------------------------
 *  Three dice; bet on one face (1–6). Pays by how many dice match:
 *  1→1:1, 2→2:1, 3→11:1 (12× return). 1% edge on wins.
 * ========================================================================= */

import { rollSicBoDice } from "./sic-bo";
import type { Bet, Game, GameResult, RngStream } from "./types";

export interface ChuckALuckAction {
  type: "noop";
}

export interface ChuckALuckConfig {
  houseEdgeBps: number;
}

export const DEFAULT_CHUCK_A_LUCK_CONFIG: ChuckALuckConfig = { houseEdgeBps: 100 };

export interface ChuckALuckState {
  config: ChuckALuckConfig;
  pick: number;
  dice: [number, number, number];
  matchCount: number;
  won: boolean;
  /** Total return multiple on stake (includes stake). */
  payReturnMult: number;
  stake: bigint;
  phase: "settled";
}

/** Total-return multiplier by match count (0 = loss). */
const MATCH_RETURN: Record<number, number> = {
  0: 0,
  1: 2,
  2: 3,
  3: 12,
};

export function countChuckALuckMatches(dice: [number, number, number], pick: number): number {
  return dice.filter((d) => d === pick).length;
}

export function chuckALuckPayReturn(matchCount: number): number {
  return MATCH_RETURN[matchCount] ?? 0;
}

function normalizePick(raw: Record<string, unknown> | undefined): number {
  const p = Number(raw?.pick);
  return Number.isInteger(p) && p >= 1 && p <= 6 ? p : 1;
}

function initialState(bet: Bet, rng: RngStream): ChuckALuckState {
  const config = { ...DEFAULT_CHUCK_A_LUCK_CONFIG, ...(bet.config as Partial<ChuckALuckConfig> | undefined) };
  const pick = normalizePick(bet.config as Record<string, unknown> | undefined);
  const dice = rollSicBoDice(rng);
  const matchCount = countChuckALuckMatches(dice, pick);
  const payReturnMult = chuckALuckPayReturn(matchCount);

  return {
    config,
    pick,
    dice,
    matchCount,
    won: payReturnMult > 0,
    payReturnMult,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: ChuckALuckState): ChuckALuckAction[] {
  return [];
}

function step(state: ChuckALuckState, _action: ChuckALuckAction, _rng: RngStream): ChuckALuckState {
  throw new Error("chuck-a-luck.step: terminal after roll");
}

function isTerminal(state: ChuckALuckState): boolean {
  return state.phase === "settled";
}

function settle(state: ChuckALuckState, _bet: Bet): GameResult {
  const edgeNum = BigInt(10000 - state.config.houseEdgeBps);
  const payout =
    state.won && state.payReturnMult > 0
      ? (state.stake * BigInt(state.payReturnMult) * edgeNum) / 10000n
      : 0n;

  const diceStr = state.dice.join("-");
  const label = state.won
    ? `Face ${state.pick} · ${diceStr} · ${state.matchCount} hit${state.matchCount === 1 ? "" : "s"} · ${state.payReturnMult}×`
    : `Face ${state.pick} · ${diceStr} · no match`;

  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [{ label, stakedUnits: state.stake, payoutUnits: payout, pnlUnits: payout - state.stake }],
  };
}

export const chuckALuckGame: Game<ChuckALuckAction, ChuckALuckState> = {
  id: "chuck-a-luck",
  display: "Chuck-a-Luck",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function chuckALuckRtpLabel(): string {
  return "≈94.5%";
}

export function chuckALuckPayHint(matchCount: number): string {
  if (matchCount === 0) return "—";
  if (matchCount === 1) return "1:1";
  if (matchCount === 2) return "2:1";
  return "11:1";
}
