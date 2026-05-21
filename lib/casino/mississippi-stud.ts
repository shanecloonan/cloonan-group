/* ===========================================================================
 *  MoneyFund Casino — Mississippi Stud
 *  ---------------------------------------------------------------------------
 *  Ante plus three optional street bets (1×, 2×, 3× ante) after the 2nd, 3rd,
 *  and 4th cards. Five-card pay table from pair of 6s up to royal flush.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import { bestHand, describeScore, type HandScore } from "./poker-hands";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";

export type MississippiStudAction =
  | { type: "fold" }
  | { type: "bet_1" }
  | { type: "bet_2" }
  | { type: "bet_3" };

export type MississippiStudPhase = "street_2" | "street_3" | "street_4" | "settled";

export type MississippiStudOutcome = "fold" | "pay";

export interface MississippiStudConfig {
  numDecks: number;
}

export const DEFAULT_MISSISSIPPI_STUD_CONFIG: MississippiStudConfig = { numDecks: 6 };

export interface MississippiStudState {
  config: MississippiStudConfig;
  shoe: Shoe;
  playerCards: Card[];
  /** Cards revealed to the player (2–5). */
  visibleCount: number;
  streetBet1: bigint;
  streetBet2: bigint;
  streetBet3: bigint;
  handScore: HandScore | null;
  outcome: MississippiStudOutcome | null;
  stake: bigint;
  phase: MississippiStudPhase;
}

/** Pair of 6s or better. */
export function mississippiStudQualifies(score: HandScore): boolean {
  if (score.category >= 2) return true;
  if (score.category === 1) return score.tiebreak[0] >= 6;
  return false;
}

/** Total return multiplier per staked unit (includes stake). */
export function mississippiStudPayReturn(score: HandScore): number {
  if (!mississippiStudQualifies(score)) return 0;
  switch (score.category) {
    case 8:
      return 501;
    case 7:
      return 101;
    case 6:
      return 41;
    case 5:
      return 11;
    case 4:
      return 7;
    case 3:
      return 5;
    case 2:
      return 3;
    case 1:
      return 2;
    default:
      return 0;
  }
}

function mergeConfig(raw: Record<string, unknown> | undefined): MississippiStudConfig {
  if (!raw) return { ...DEFAULT_MISSISSIPPI_STUD_CONFIG };
  const n = Number((raw as Partial<MississippiStudConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_MISSISSIPPI_STUD_CONFIG.numDecks,
  };
}

function finishPay(state: MississippiStudState): MississippiStudState {
  const handScore = bestHand(state.playerCards);
  return {
    ...state,
    visibleCount: 5,
    handScore,
    outcome: "pay",
    phase: "settled",
  };
}

function initialState(bet: Bet, rng: RngStream): MississippiStudState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  const playerCards = [
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
  ];

  return {
    config,
    shoe,
    playerCards,
    visibleCount: 2,
    streetBet1: 0n,
    streetBet2: 0n,
    streetBet3: 0n,
    handScore: null,
    outcome: null,
    stake: bet.stake,
    phase: "street_2",
  };
}

function legalActions(state: MississippiStudState): MississippiStudAction[] {
  if (state.phase === "street_2") return [{ type: "fold" }, { type: "bet_1" }];
  if (state.phase === "street_3") return [{ type: "fold" }, { type: "bet_2" }];
  if (state.phase === "street_4") return [{ type: "fold" }, { type: "bet_3" }];
  return [];
}

function step(state: MississippiStudState, action: MississippiStudAction, _rng: RngStream): MississippiStudState {
  if (action.type === "fold") {
    return { ...state, outcome: "fold", phase: "settled" };
  }
  const ante = state.stake;
  if (state.phase === "street_2" && action.type === "bet_1") {
    return {
      ...state,
      streetBet1: ante,
      visibleCount: 3,
      phase: "street_3",
    };
  }
  if (state.phase === "street_3" && action.type === "bet_2") {
    return {
      ...state,
      streetBet2: ante * 2n,
      visibleCount: 4,
      phase: "street_4",
    };
  }
  if (state.phase === "street_4" && action.type === "bet_3") {
    return finishPay({
      ...state,
      streetBet3: ante * 3n,
    });
  }
  throw new Error("mississippi-stud.step: illegal action for phase");
}

function isTerminal(state: MississippiStudState): boolean {
  return state.phase === "settled";
}

function totalStakedUnits(state: MississippiStudState): bigint {
  return state.stake + state.streetBet1 + state.streetBet2 + state.streetBet3;
}

function settle(state: MississippiStudState, _bet: Bet): GameResult {
  const totalStaked = totalStakedUnits(state);
  let payout = 0n;
  let label: string;

  if (state.outcome === "fold") {
    payout = 0n;
    label = `Folded on street · lost ${formatStakedBreakdown(state)}`;
  } else {
    const score = state.handScore!;
    const mult = mississippiStudPayReturn(score);
    const u = state.stake;
    payout = u * BigInt(mult);
    if (state.streetBet1 > 0n) payout += state.streetBet1 * BigInt(mult);
    if (state.streetBet2 > 0n) payout += state.streetBet2 * BigInt(mult);
    if (state.streetBet3 > 0n) payout += state.streetBet3 * BigInt(mult);
    label =
      mult > 0
        ? `${describeScore(score)} · ${mult - 1}:1 on ${formatStakedBreakdown(state)}`
        : `${describeScore(score)} · below pair of 6s`;
  }

  return {
    totalStakedUnits: totalStaked,
    totalPayoutUnits: payout,
    pnlUnits: payout - totalStaked,
    breakdown: [{ label, stakedUnits: totalStaked, payoutUnits: payout, pnlUnits: payout - totalStaked }],
  };
}

function formatStakedBreakdown(state: MississippiStudState): string {
  const parts = ["ante"];
  if (state.streetBet1 > 0n) parts.push("1×");
  if (state.streetBet2 > 0n) parts.push("2×");
  if (state.streetBet3 > 0n) parts.push("3×");
  return parts.join(" + ");
}

export const mississippiStudGame: Game<MississippiStudAction, MississippiStudState> = {
  id: "mississippi-stud",
  display: "Mississippi Stud",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function mississippiStudRtpLabel(): string {
  return "≈95.9%";
}

export function formatMississippiStudCards(cards: Card[]): string {
  return cards.map(cardLabel).join(" ");
}
