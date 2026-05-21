/* ===========================================================================
 *  MoneyFund Casino — Craps (Pass Line)
 *  ---------------------------------------------------------------------------
 *  Classic pass-line wager. Come-out: 7/11 win, 2/3/12 lose, else point set.
 *  Point round: roll the point before 7 to win. 1% edge on wins.
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

export type CrapsBetType = "pass";

export interface CrapsRoll {
  die1: number;
  die2: number;
  sum: number;
}

export interface CrapsAction {
  type: "noop";
}

export interface CrapsConfig {
  houseEdgeBps: number;
  betType: CrapsBetType;
}

export const DEFAULT_CRAPS_CONFIG: CrapsConfig = { houseEdgeBps: 100, betType: "pass" };

export type CrapsOutcome = "come_out_win" | "come_out_lose" | "point_win" | "point_lose";

export interface CrapsState {
  config: CrapsConfig;
  betType: CrapsBetType;
  rolls: CrapsRoll[];
  point: number | null;
  outcome: CrapsOutcome;
  won: boolean;
  stake: bigint;
  phase: "settled";
}

export function rollCrapsDice(rng: RngStream): CrapsRoll {
  const die1 = rng.nextInt(6) + 1;
  const die2 = rng.nextInt(6) + 1;
  return { die1, die2, sum: die1 + die2 };
}

/** Resolve a full pass-line round (consumes one or more RNG draws). */
export function playCrapsPassLine(rng: RngStream): {
  rolls: CrapsRoll[];
  point: number | null;
  outcome: CrapsOutcome;
  won: boolean;
} {
  const rolls: CrapsRoll[] = [];
  const comeOut = rollCrapsDice(rng);
  rolls.push(comeOut);
  const s0 = comeOut.sum;

  if (s0 === 7 || s0 === 11) {
    return { rolls, point: null, outcome: "come_out_win", won: true };
  }
  if (s0 === 2 || s0 === 3 || s0 === 12) {
    return { rolls, point: null, outcome: "come_out_lose", won: false };
  }

  const point = s0;
  while (true) {
    const r = rollCrapsDice(rng);
    rolls.push(r);
    if (r.sum === point) {
      return { rolls, point, outcome: "point_win", won: true };
    }
    if (r.sum === 7) {
      return { rolls, point, outcome: "point_lose", won: false };
    }
  }
}

function normalizeConfig(raw: Record<string, unknown> | undefined): CrapsConfig {
  const betType = raw?.betType === "pass" ? "pass" : "pass";
  const h = Number((raw as Partial<CrapsConfig>)?.houseEdgeBps);
  return {
    betType,
    houseEdgeBps: Number.isInteger(h) && h >= 0 && h <= 1000 ? h : DEFAULT_CRAPS_CONFIG.houseEdgeBps,
  };
}

function initialState(bet: Bet, rng: RngStream): CrapsState {
  const config = normalizeConfig(bet.config as Record<string, unknown> | undefined);
  const resolved = playCrapsPassLine(rng);

  return {
    config,
    betType: config.betType,
    rolls: resolved.rolls,
    point: resolved.point,
    outcome: resolved.outcome,
    won: resolved.won,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: CrapsState): CrapsAction[] {
  return [];
}

function step(state: CrapsState, _action: CrapsAction, _rng: RngStream): CrapsState {
  throw new Error("craps.step: terminal after roll");
}

function isTerminal(state: CrapsState): boolean {
  return state.phase === "settled";
}

function outcomeLabel(outcome: CrapsOutcome, point: number | null): string {
  switch (outcome) {
    case "come_out_win":
      return "Come-out winner (7 or 11)";
    case "come_out_lose":
      return "Craps (2, 3, or 12)";
    case "point_win":
      return `Point ${point} made`;
    case "point_lose":
      return `Seven out (point was ${point})`;
    default:
      return outcome;
  }
}

function settle(state: CrapsState, _bet: Bet): GameResult {
  const edgeNum = BigInt(10000 - state.config.houseEdgeBps);
  const payout = state.won ? (state.stake * 2n * edgeNum) / 10000n : 0n;
  const rollStr = state.rolls.map((r) => `${r.die1}+${r.die2}=${r.sum}`).join(" → ");
  const label = state.won
    ? `Pass line · ${outcomeLabel(state.outcome, state.point)} · ${rollStr}`
    : `Pass line · ${outcomeLabel(state.outcome, state.point)} · ${rollStr}`;

  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [{ label, stakedUnits: state.stake, payoutUnits: payout, pnlUnits: payout - state.stake }],
  };
}

export const crapsGame: Game<CrapsAction, CrapsState> = {
  id: "craps",
  display: "Craps",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function crapsRtpLabel(): string {
  return "≈98.6%";
}

export function formatCrapsRoll(r: CrapsRoll): string {
  return `${r.die1} + ${r.die2} = ${r.sum}`;
}
