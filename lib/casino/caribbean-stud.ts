/* ===========================================================================
 *  MoneyFund Casino — Caribbean Stud Poker
 *  ---------------------------------------------------------------------------
 *  Five-card stud vs the dealer. Ante + optional Raise (2× ante). Dealer
 *  qualifies with any pair or Ace-King. Standard 5-card hand rankings.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import { bestHand, compareScores, describeScore, type HandScore } from "./poker-hands";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";

export type CaribbeanStudAction = { type: "fold" } | { type: "raise" };

export type CaribbeanStudPhase = "player_turn" | "settled";

export type CaribbeanStudOutcome =
  | "fold"
  | "dealer_no_qualify"
  | "player_win"
  | "dealer_win"
  | "push";

export interface CaribbeanStudConfig {
  numDecks: number;
}

export const DEFAULT_CARIBBEAN_STUD_CONFIG: CaribbeanStudConfig = { numDecks: 6 };

export interface CaribbeanStudState {
  config: CaribbeanStudConfig;
  shoe: Shoe;
  playerCards: Card[];
  dealerCards: Card[];
  playerScore: HandScore | null;
  dealerScore: HandScore | null;
  raiseStake: bigint;
  dealerQualified: boolean | null;
  outcome: CaribbeanStudOutcome | null;
  stake: bigint;
  phase: CaribbeanStudPhase;
}

/** Pair or better, or Ace and King in the five cards. */
export function caribbeanStudDealerQualifies(cards: Card[]): boolean {
  const score = bestHand(cards);
  if (score.category >= 1) return true;
  let hasAce = false;
  let hasKing = false;
  for (const c of cards) {
    if (c.rank === "A") hasAce = true;
    if (c.rank === "K") hasKing = true;
  }
  return hasAce && hasKing;
}

function mergeConfig(raw: Record<string, unknown> | undefined): CaribbeanStudConfig {
  if (!raw) return { ...DEFAULT_CARIBBEAN_STUD_CONFIG };
  const n = Number((raw as Partial<CaribbeanStudConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_CARIBBEAN_STUD_CONFIG.numDecks,
  };
}

function dealFive(shoe: Shoe, rng: RngStream): Card[] {
  return [
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
  ];
}

function resolveRaise(state: CaribbeanStudState): CaribbeanStudState {
  const playerScore = bestHand(state.playerCards);
  const dealerScore = bestHand(state.dealerCards);
  const qualified = caribbeanStudDealerQualifies(state.dealerCards);
  let outcome: CaribbeanStudOutcome;

  if (!qualified) {
    outcome = "dealer_no_qualify";
  } else {
    const cmp = compareScores(playerScore, dealerScore);
    if (cmp > 0) outcome = "player_win";
    else if (cmp < 0) outcome = "dealer_win";
    else outcome = "push";
  }

  return {
    ...state,
    raiseStake: state.stake,
    playerScore,
    dealerScore,
    dealerQualified: qualified,
    outcome,
    phase: "settled",
  };
}

function initialState(bet: Bet, rng: RngStream): CaribbeanStudState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  const playerCards = dealFive(shoe, rng);
  const dealerCards = dealFive(shoe, rng);

  return {
    config,
    shoe,
    playerCards,
    dealerCards,
    playerScore: null,
    dealerScore: null,
    raiseStake: 0n,
    dealerQualified: null,
    outcome: null,
    stake: bet.stake,
    phase: "player_turn",
  };
}

function legalActions(state: CaribbeanStudState): CaribbeanStudAction[] {
  if (state.phase === "player_turn") {
    return [{ type: "fold" }, { type: "raise" }];
  }
  return [];
}

function step(state: CaribbeanStudState, action: CaribbeanStudAction, _rng: RngStream): CaribbeanStudState {
  if (state.phase !== "player_turn") {
    throw new Error("caribbean-stud.step: only valid on player_turn");
  }
  if (action.type === "fold") {
    return { ...state, outcome: "fold", phase: "settled" };
  }
  return resolveRaise(state);
}

function isTerminal(state: CaribbeanStudState): boolean {
  return state.phase === "settled";
}

function settle(state: CaribbeanStudState, _bet: Bet): GameResult {
  const ante = state.stake;
  const raise = state.raiseStake;
  const totalStaked = ante + raise;
  let payout = 0n;
  let label: string;

  switch (state.outcome) {
    case "fold":
      payout = 0n;
      label = "Folded — ante lost";
      break;
    case "dealer_no_qualify":
      payout = ante * 2n + raise;
      label = `Dealer no qualify · ${describeScore(state.playerScore!)}`;
      break;
    case "player_win":
      payout = ante * 2n + raise * 2n;
      label = `You win · ${describeScore(state.playerScore!)} vs ${describeScore(state.dealerScore!)}`;
      break;
    case "dealer_win":
      payout = 0n;
      label = `Dealer wins · ${describeScore(state.dealerScore!)} vs ${describeScore(state.playerScore!)}`;
      break;
    case "push":
      payout = ante + raise;
      label = `Push · ${describeScore(state.playerScore!)}`;
      break;
    default:
      label = "unsettled";
  }

  return {
    totalStakedUnits: totalStaked,
    totalPayoutUnits: payout,
    pnlUnits: payout - totalStaked,
    breakdown: [{ label, stakedUnits: totalStaked, payoutUnits: payout, pnlUnits: payout - totalStaked }],
  };
}

export const caribbeanStudGame: Game<CaribbeanStudAction, CaribbeanStudState> = {
  id: "caribbean-stud",
  display: "Caribbean Stud",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function caribbeanStudRtpLabel(): string {
  return "≈94.8%";
}

export function formatCaribbeanStudHand(cards: Card[]): string {
  return cards.map(cardLabel).join(" ");
}
