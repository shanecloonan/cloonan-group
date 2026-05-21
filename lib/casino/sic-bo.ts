/* ===========================================================================
 *  MoneyFund Casino — Sic Bo
 *  ---------------------------------------------------------------------------
 *  Three dice. Standard online bet types: Big/Small, Odd/Even, Any Triple,
 *  Specific Triple, and Total (4–17). Triples void Big/Small/Odd/Even.
 *  Payouts follow common live-casino tables; 1% edge applied on wins.
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

export type SicBoBetType =
  | "big"
  | "small"
  | "odd"
  | "even"
  | "any_triple"
  | "triple"
  | "total";

export interface SicBoAction {
  type: "noop";
}

export interface SicBoConfig {
  houseEdgeBps: number;
}

export const DEFAULT_SIC_BO_CONFIG: SicBoConfig = { houseEdgeBps: 100 };

export interface SicBoState {
  config: SicBoConfig;
  betType: SicBoBetType;
  /** Face 1–6 for `triple`; sum 4–17 for `total`. */
  betValue: number | null;
  dice: [number, number, number];
  sum: number;
  isTriple: boolean;
  won: boolean;
  /** Total return multiple on stake (e.g. 2 = double money). */
  payReturnMult: number;
  stake: bigint;
  phase: "settled";
}

/** Total-return multiplier for a winning total bet (industry-standard). */
const TOTAL_RETURN: Record<number, number> = {
  4: 61,
  5: 31,
  6: 18,
  7: 13,
  8: 9,
  9: 7,
  10: 7,
  11: 7,
  12: 7,
  13: 9,
  14: 13,
  15: 18,
  16: 31,
  17: 61,
};

export function rollSicBoDice(rng: RngStream): [number, number, number] {
  return [rng.nextInt(6) + 1, rng.nextInt(6) + 1, rng.nextInt(6) + 1];
}

export function sicBoSum(dice: [number, number, number]): number {
  return dice[0] + dice[1] + dice[2];
}

export function sicBoIsTriple(dice: [number, number, number]): boolean {
  return dice[0] === dice[1] && dice[1] === dice[2];
}

export function totalReturnForBet(
  betType: SicBoBetType,
  dice: [number, number, number],
  betValue: number | null,
): { won: boolean; payReturnMult: number } {
  const sum = sicBoSum(dice);
  const triple = sicBoIsTriple(dice);

  switch (betType) {
    case "big":
      return { won: !triple && sum >= 11 && sum <= 17, payReturnMult: 2 };
    case "small":
      return { won: !triple && sum >= 4 && sum <= 10, payReturnMult: 2 };
    case "odd":
      return { won: !triple && sum % 2 === 1, payReturnMult: 2 };
    case "even":
      return { won: !triple && sum % 2 === 0, payReturnMult: 2 };
    case "any_triple":
      return { won: triple, payReturnMult: 31 };
    case "triple": {
      const face = betValue ?? 1;
      const won = triple && dice[0] === face;
      return { won, payReturnMult: 181 };
    }
    case "total": {
      const t = betValue ?? 10;
      const won = sum === t;
      const payReturnMult = TOTAL_RETURN[t] ?? 0;
      return { won, payReturnMult: won ? payReturnMult : 0 };
    }
    default:
      return { won: false, payReturnMult: 0 };
  }
}

function normalizeBet(raw: Record<string, unknown> | undefined): { betType: SicBoBetType; betValue: number | null } {
  const betType = raw?.betType as SicBoBetType;
  const valid: SicBoBetType[] = ["big", "small", "odd", "even", "any_triple", "triple", "total"];
  const type = valid.includes(betType) ? betType : "big";
  let betValue: number | null = null;
  if (type === "triple") {
    const f = Number(raw?.betValue);
    betValue = Number.isInteger(f) && f >= 1 && f <= 6 ? f : 1;
  } else if (type === "total") {
    const t = Number(raw?.betValue);
    betValue = Number.isInteger(t) && t >= 4 && t <= 17 ? t : 10;
  }
  return { betType: type, betValue };
}

function initialState(bet: Bet, rng: RngStream): SicBoState {
  const config = { ...DEFAULT_SIC_BO_CONFIG, ...(bet.config as Partial<SicBoConfig> | undefined) };
  const { betType, betValue } = normalizeBet(bet.config as Record<string, unknown> | undefined);
  const dice = rollSicBoDice(rng);
  const sum = sicBoSum(dice);
  const isTriple = sicBoIsTriple(dice);
  const { won, payReturnMult } = totalReturnForBet(betType, dice, betValue);

  return {
    config,
    betType,
    betValue,
    dice,
    sum,
    isTriple,
    won,
    payReturnMult: won ? payReturnMult : 0,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: SicBoState): SicBoAction[] {
  return [];
}

function step(state: SicBoState, _action: SicBoAction, _rng: RngStream): SicBoState {
  throw new Error("sic-bo.step: terminal after roll");
}

function isTerminal(state: SicBoState): boolean {
  return state.phase === "settled";
}

function settle(state: SicBoState, _bet: Bet): GameResult {
  const edgeNum = BigInt(10000 - state.config.houseEdgeBps);
  const payout =
    state.won && state.payReturnMult > 0
      ? (state.stake * BigInt(state.payReturnMult) * edgeNum) / 10000n
      : 0n;

  const betLabel =
    state.betType === "triple"
      ? `Triple ${state.betValue}`
      : state.betType === "total"
        ? `Total ${state.betValue}`
        : state.betType.replace("_", " ");
  const diceStr = state.dice.join("-");
  const label = state.won
    ? `${betLabel} · ${diceStr} (sum ${state.sum}) · ${state.payReturnMult}×`
    : `${betLabel} · ${diceStr} (sum ${state.sum}) · loss`;

  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [{ label, stakedUnits: state.stake, payoutUnits: payout, pnlUnits: payout - state.stake }],
  };
}

export const sicBoGame: Game<SicBoAction, SicBoState> = {
  id: "sic-bo",
  display: "Sic Bo",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function sicBoRtpLabel(): string {
  return "≈97%";
}

export function sicBoPayReturnHint(betType: SicBoBetType, betValue: number | null): number {
  if (betType === "triple") return 181;
  if (betType === "any_triple") return 31;
  if (betType === "total" && betValue != null) return TOTAL_RETURN[betValue] ?? 0;
  if (["big", "small", "odd", "even"].includes(betType)) return 2;
  return 0;
}

export function sicBoBetLabel(betType: SicBoBetType, betValue: number | null): string {
  if (betType === "triple") return `Triple ${betValue}`;
  if (betType === "total") return `Total ${betValue}`;
  if (betType === "any_triple") return "Any triple";
  return betType.charAt(0).toUpperCase() + betType.slice(1);
}
