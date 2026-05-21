/* ===========================================================================
 *  MoneyFund Casino — Let It Ride
 *  ---------------------------------------------------------------------------
 *  Three equal bets; 3 hole cards + 2 community. Pull bet 1 after hole cards,
 *  pull bet 2 after the first community (bet 3 always rides). Pays pair of 10s+.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import { bestHand, describeScore, type HandScore } from "./poker-hands";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";

export type LetItRideAction =
  | { type: "pull_bet1" }
  | { type: "ride_bet1" }
  | { type: "pull_bet2" }
  | { type: "ride_bet2" };

export type LetItRidePhase = "decision_1" | "decision_2" | "settled";

export interface LetItRideConfig {
  numDecks: number;
}

export const DEFAULT_LET_IT_RIDE_CONFIG: LetItRideConfig = { numDecks: 6 };

export interface LetItRideState {
  config: LetItRideConfig;
  shoe: Shoe;
  playerCards: Card[];
  community: Card[];
  bet1Active: boolean;
  bet2Active: boolean;
  /** Bet 3 always rides once dealt. */
  bet3Active: boolean;
  handScore: HandScore | null;
  unitStake: bigint;
  stake: bigint;
  phase: LetItRidePhase;
}

function allFive(state: LetItRideState): Card[] {
  return [...state.playerCards, ...state.community];
}

/** Pair of 10s or better. */
export function letItRideQualifies(score: HandScore): boolean {
  if (score.category >= 2) return true;
  if (score.category === 1) return score.tiebreak[0] >= 10;
  return false;
}

/** Total return multiplier per riding unit (includes stake). */
export function letItRidePayReturn(score: HandScore): number {
  if (!letItRideQualifies(score)) return 0;
  switch (score.category) {
    case 8:
      return 26;
    case 7:
      return 16;
    case 6:
      return 9;
    case 5:
      return 6;
    case 4:
      return 5;
    case 3:
      return 4;
    case 2:
      return 3;
    case 1:
      return 2;
    default:
      return 0;
  }
}

function mergeConfig(raw: Record<string, unknown> | undefined): LetItRideConfig {
  if (!raw) return { ...DEFAULT_LET_IT_RIDE_CONFIG };
  const n = Number((raw as Partial<LetItRideConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_LET_IT_RIDE_CONFIG.numDecks,
  };
}

function settleHand(state: LetItRideState): LetItRideState {
  const handScore = bestHand(allFive(state));
  return { ...state, handScore, phase: "settled" };
}

function initialState(bet: Bet, rng: RngStream): LetItRideState {
  const config = mergeConfig(bet.config);
  if (bet.stake % 3n !== 0n) {
    throw new Error("let-it-ride: stake must be divisible by 3 (three equal bets)");
  }
  const unitStake = bet.stake / 3n;
  const shoe = buildShoe(config.numDecks);
  const playerCards = [drawCard(shoe, rng), drawCard(shoe, rng), drawCard(shoe, rng)];
  const community = [drawCard(shoe, rng), drawCard(shoe, rng)];

  return {
    config,
    shoe,
    playerCards,
    community,
    bet1Active: true,
    bet2Active: true,
    bet3Active: true,
    handScore: null,
    unitStake,
    stake: bet.stake,
    phase: "decision_1",
  };
}

function legalActions(state: LetItRideState): LetItRideAction[] {
  if (state.phase === "decision_1") {
    return [{ type: "pull_bet1" }, { type: "ride_bet1" }];
  }
  if (state.phase === "decision_2") {
    return [{ type: "pull_bet2" }, { type: "ride_bet2" }];
  }
  return [];
}

function step(state: LetItRideState, action: LetItRideAction, _rng: RngStream): LetItRideState {
  if (state.phase === "decision_1") {
    const next =
      action.type === "pull_bet1"
        ? { ...state, bet1Active: false, phase: "decision_2" as const }
        : { ...state, phase: "decision_2" as const };
    return next;
  }
  if (state.phase === "decision_2") {
    const next =
      action.type === "pull_bet2" ? { ...state, bet2Active: false } : state;
    return settleHand(next);
  }
  throw new Error("let-it-ride.step: invalid phase");
}

function isTerminal(state: LetItRideState): boolean {
  return state.phase === "settled";
}

function settle(state: LetItRideState, _bet: Bet): GameResult {
  const u = state.unitStake;
  const score = state.handScore!;
  const mult = letItRidePayReturn(score);
  const qualified = letItRideQualifies(score);
  const active = [state.bet1Active, state.bet2Active, state.bet3Active].filter(Boolean).length;
  const pulled = 3 - active;
  /** Full session lock (three bets); pulled units refund in payout. */
  const totalStaked = state.stake;

  let payout = u * BigInt(pulled);
  if (state.bet1Active) payout += qualified ? u * BigInt(mult) : 0n;
  if (state.bet2Active) payout += qualified ? u * BigInt(mult) : 0n;
  if (state.bet3Active) payout += qualified ? u * BigInt(mult) : 0n;

  const label = qualified
    ? `${describeScore(score)} · ${mult}:1 on ${active} riding${pulled ? ` · ${pulled} pulled` : ""}`
    : `${describeScore(score)} · below pair of 10s${pulled ? ` · ${pulled} pulled` : ""}`;

  return {
    totalStakedUnits: totalStaked,
    totalPayoutUnits: payout,
    pnlUnits: payout - totalStaked,
    breakdown: [{ label, stakedUnits: totalStaked, payoutUnits: payout, pnlUnits: payout - totalStaked }],
  };
}

export const letItRideGame: Game<LetItRideAction, LetItRideState> = {
  id: "let-it-ride",
  display: "Let It Ride",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function letItRideRtpLabel(): string {
  return "≈97.0%";
}

export function formatLetItRideCards(cards: Card[]): string {
  return cards.map(cardLabel).join(" ");
}
