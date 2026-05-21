/* ===========================================================================
 *  MoneyFund Casino — Three Card Poker
 *  ---------------------------------------------------------------------------
 *  Ante + optional Play (1× ante). Dealer qualifies Queen-Six or better.
 *  Standard 3-card rankings (straight beats flush). Fold loses ante only.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import type { Bet, Card, Game, GameResult, Rank, RngStream, Shoe } from "./types";

export type ThreeCardPokerAction = { type: "fold" } | { type: "play" };

export type ThreeCardPokerPhase = "player_turn" | "settled";

export type ThreeCardPokerOutcome =
  | "fold"
  | "dealer_no_qualify"
  | "player_win"
  | "dealer_win"
  | "push";

export interface ThreeCardPokerConfig {
  numDecks: number;
}

export const DEFAULT_THREE_CARD_POKER_CONFIG: ThreeCardPokerConfig = { numDecks: 6 };

export interface ThreeCardScore {
  /** 0 high … 5 straight flush */
  category: number;
  tiebreak: number[];
}

export interface ThreeCardPokerState {
  config: ThreeCardPokerConfig;
  shoe: Shoe;
  playerCards: Card[];
  dealerCards: Card[];
  playerScore: ThreeCardScore | null;
  dealerScore: ThreeCardScore | null;
  playStake: bigint;
  dealerQualified: boolean | null;
  outcome: ThreeCardPokerOutcome | null;
  stake: bigint;
  phase: ThreeCardPokerPhase;
}

const RANK_VAL: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function rankVal(rank: Rank): number {
  return RANK_VAL[rank];
}

/** Three-card poker: straight beats flush. */
export function evalThreeCardHand(cards: Card[]): ThreeCardScore {
  if (cards.length !== 3) throw new Error("evalThreeCardHand: need 3 cards");
  const ranks = cards.map((c) => rankVal(c.rank)).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const flush = suits[0] === suits[1] && suits[1] === suits[2];

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const trips = [...counts.entries()].find(([, n]) => n === 3);
  if (trips) return { category: 4, tiebreak: [trips[0]] };

  let isStraight = ranks[0] - ranks[1] === 1 && ranks[1] - ranks[2] === 1;
  if (!isStraight && ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2) {
    isStraight = true;
    ranks[0] = 3;
    ranks[1] = 2;
    ranks[2] = 1;
  }
  if (isStraight && flush) return { category: 5, tiebreak: [ranks[0]] };
  if (isStraight) return { category: 3, tiebreak: [ranks[0]] };
  if (flush) return { category: 2, tiebreak: ranks };

  const pair = [...counts.entries()].find(([, n]) => n === 2);
  if (pair) {
    const kicker = ranks.find((r) => r !== pair[0]) ?? 0;
    return { category: 1, tiebreak: [pair[0], kicker] };
  }
  return { category: 0, tiebreak: ranks };
}

export function compareThreeCardHands(a: ThreeCardScore, b: ThreeCardScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const d = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Queen-Six: K/A high always qualifies; Q requires second card ≥ 6. */
export function dealerQualifiesThreeCard(cards: Card[]): boolean {
  const r = cards.map((c) => rankVal(c.rank)).sort((a, b) => b - a);
  if (r[0] >= 13) return true;
  if (r[0] === 12) return r[1] >= 6;
  return false;
}

export function threeCardHandLabel(score: ThreeCardScore): string {
  const names = ["High card", "Pair", "Flush", "Straight", "Three of a kind", "Straight flush"];
  return names[score.category] ?? "Hand";
}

function mergeConfig(raw: Record<string, unknown> | undefined): ThreeCardPokerConfig {
  if (!raw) return { ...DEFAULT_THREE_CARD_POKER_CONFIG };
  const n = Number((raw as Partial<ThreeCardPokerConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_THREE_CARD_POKER_CONFIG.numDecks,
  };
}

function initialState(bet: Bet, rng: RngStream): ThreeCardPokerState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  const playerCards = [drawCard(shoe, rng), drawCard(shoe, rng), drawCard(shoe, rng)];
  const dealerCards = [drawCard(shoe, rng), drawCard(shoe, rng), drawCard(shoe, rng)];

  return {
    config,
    shoe,
    playerCards,
    dealerCards,
    playerScore: null,
    dealerScore: null,
    playStake: 0n,
    dealerQualified: null,
    outcome: null,
    stake: bet.stake,
    phase: "player_turn",
  };
}

function legalActions(state: ThreeCardPokerState): ThreeCardPokerAction[] {
  if (state.phase === "player_turn") {
    return [{ type: "fold" }, { type: "play" }];
  }
  return [];
}

function resolvePlay(state: ThreeCardPokerState): ThreeCardPokerState {
  const playerScore = evalThreeCardHand(state.playerCards);
  const dealerScore = evalThreeCardHand(state.dealerCards);
  const qualified = dealerQualifiesThreeCard(state.dealerCards);
  let outcome: ThreeCardPokerOutcome;

  if (!qualified) {
    outcome = "dealer_no_qualify";
  } else {
    const cmp = compareThreeCardHands(playerScore, dealerScore);
    if (cmp > 0) outcome = "player_win";
    else if (cmp < 0) outcome = "dealer_win";
    else outcome = "push";
  }

  return {
    ...state,
    playStake: state.stake,
    playerScore,
    dealerScore,
    dealerQualified: qualified,
    outcome,
    phase: "settled",
  };
}

function step(state: ThreeCardPokerState, action: ThreeCardPokerAction, _rng: RngStream): ThreeCardPokerState {
  if (state.phase !== "player_turn") {
    throw new Error("three-card-poker.step: only valid on player_turn");
  }
  if (action.type === "fold") {
    return {
      ...state,
      outcome: "fold",
      phase: "settled",
    };
  }
  return resolvePlay(state);
}

function isTerminal(state: ThreeCardPokerState): boolean {
  return state.phase === "settled";
}

function settle(state: ThreeCardPokerState, _bet: Bet): GameResult {
  const ante = state.stake;
  const play = state.playStake;
  const totalStaked = ante + play;
  let payout = 0n;
  let label: string;

  switch (state.outcome) {
    case "fold":
      payout = 0n;
      label = "Folded — ante lost";
      break;
    case "dealer_no_qualify":
      payout = ante * 2n + play;
      label = `Dealer does not qualify · ${threeCardHandLabel(state.playerScore!)}`;
      break;
    case "player_win":
      payout = ante * 2n + play * 2n;
      label = `You win · ${threeCardHandLabel(state.playerScore!)} vs ${threeCardHandLabel(state.dealerScore!)}`;
      break;
    case "dealer_win":
      payout = 0n;
      label = `Dealer wins · ${threeCardHandLabel(state.dealerScore!)} vs ${threeCardHandLabel(state.playerScore!)}`;
      break;
    case "push":
      payout = ante + play;
      label = `Push · ${threeCardHandLabel(state.playerScore!)}`;
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

export const threeCardPokerGame: Game<ThreeCardPokerAction, ThreeCardPokerState> = {
  id: "three-card-poker",
  display: "Three Card Poker",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function threeCardPokerRtpLabel(): string {
  return "≈96.6%";
}

export function formatThreeCardHand(cards: Card[]): string {
  return cards.map(cardLabel).join(" ");
}
