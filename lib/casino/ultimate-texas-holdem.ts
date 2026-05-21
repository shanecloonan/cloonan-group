/* ===========================================================================
 *  MoneyFund Casino — Ultimate Texas Hold'em
 *  ---------------------------------------------------------------------------
 *  Texas Hold'em vs the dealer. Ante plus one Play bet (4×, 2×, or 1× ante)
 *  placed on pre-flop, flop, turn, or river after checks. Dealer qualifies
 *  with any pair.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import { bestHand, compareScores, describeScore, type HandScore } from "./poker-hands";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";

export type UltimateTexasHoldemAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "bet_4x" }
  | { type: "bet_2x" }
  | { type: "bet_1x" };

export type UltimateTexasHoldemPhase = "preflop" | "flop" | "turn" | "river" | "settled";

export type UltimateTexasHoldemOutcome =
  | "fold"
  | "dealer_no_qualify"
  | "player_win"
  | "dealer_win"
  | "push";

export interface UltimateTexasHoldemConfig {
  numDecks: number;
}

export const DEFAULT_ULTIMATE_TEXAS_HOLDEM_CONFIG: UltimateTexasHoldemConfig = { numDecks: 6 };

export interface UltimateTexasHoldemState {
  config: UltimateTexasHoldemConfig;
  shoe: Shoe;
  playerHole: Card[];
  dealerHole: Card[];
  board: Card[];
  /** Community cards revealed (0–5). */
  visibleBoard: number;
  playStake: bigint;
  playerScore: HandScore | null;
  dealerScore: HandScore | null;
  dealerQualified: boolean | null;
  outcome: UltimateTexasHoldemOutcome | null;
  stake: bigint;
  phase: UltimateTexasHoldemPhase;
}

function dealerSeven(state: UltimateTexasHoldemState): Card[] {
  return [...state.dealerHole, ...state.board];
}

function playerSeven(state: UltimateTexasHoldemState): Card[] {
  return [...state.playerHole, ...state.board];
}

/** Any pair or better. */
export function ultimateHoldemDealerQualifies(cards: Card[]): boolean {
  return bestHand(cards).category >= 1;
}

function mergeConfig(raw: Record<string, unknown> | undefined): UltimateTexasHoldemConfig {
  if (!raw) return { ...DEFAULT_ULTIMATE_TEXAS_HOLDEM_CONFIG };
  const n = Number((raw as Partial<UltimateTexasHoldemConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_ULTIMATE_TEXAS_HOLDEM_CONFIG.numDecks,
  };
}

function resolveShowdown(state: UltimateTexasHoldemState): UltimateTexasHoldemState {
  const playerScore = bestHand(playerSeven(state));
  const dealerScore = bestHand(dealerSeven(state));
  const qualified = ultimateHoldemDealerQualifies(dealerSeven(state));
  let outcome: UltimateTexasHoldemOutcome;

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
    visibleBoard: 5,
    playerScore,
    dealerScore,
    dealerQualified: qualified,
    outcome,
    phase: "settled",
  };
}

function initialState(bet: Bet, rng: RngStream): UltimateTexasHoldemState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  const playerHole = [drawCard(shoe, rng), drawCard(shoe, rng)];
  const dealerHole = [drawCard(shoe, rng), drawCard(shoe, rng)];
  const board = [
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
    drawCard(shoe, rng),
  ];

  return {
    config,
    shoe,
    playerHole,
    dealerHole,
    board,
    visibleBoard: 0,
    playStake: 0n,
    playerScore: null,
    dealerScore: null,
    dealerQualified: null,
    outcome: null,
    stake: bet.stake,
    phase: "preflop",
  };
}

function legalActions(state: UltimateTexasHoldemState): UltimateTexasHoldemAction[] {
  if (state.phase === "settled") return [];
  if (state.playStake > 0n) return [];

  const base: UltimateTexasHoldemAction[] = [{ type: "fold" }];
  if (state.phase === "preflop") {
    return [...base, { type: "check" }, { type: "bet_4x" }];
  }
  if (state.phase === "flop") {
    return [...base, { type: "check" }, { type: "bet_2x" }];
  }
  if (state.phase === "turn") {
    return [...base, { type: "check" }, { type: "bet_1x" }];
  }
  if (state.phase === "river") {
    return [...base, { type: "bet_1x" }];
  }
  return [];
}

function step(state: UltimateTexasHoldemState, action: UltimateTexasHoldemAction, _rng: RngStream): UltimateTexasHoldemState {
  if (state.phase === "settled") {
    throw new Error("ultimate-texas-holdem.step: already settled");
  }

  if (action.type === "fold") {
    return { ...state, outcome: "fold", phase: "settled" };
  }

  const ante = state.stake;

  if (action.type === "bet_4x" && state.phase === "preflop") {
    return resolveShowdown({ ...state, playStake: ante * 4n, visibleBoard: 5 });
  }
  if (action.type === "bet_2x" && state.phase === "flop") {
    return resolveShowdown({ ...state, playStake: ante * 2n, visibleBoard: 5 });
  }
  if (action.type === "bet_1x" && (state.phase === "turn" || state.phase === "river")) {
    return resolveShowdown({ ...state, playStake: ante, visibleBoard: 5 });
  }

  if (action.type === "check") {
    if (state.phase === "preflop") {
      return { ...state, phase: "flop", visibleBoard: 3 };
    }
    if (state.phase === "flop") {
      return { ...state, phase: "turn", visibleBoard: 4 };
    }
    if (state.phase === "turn") {
      return { ...state, phase: "river", visibleBoard: 5 };
    }
  }

  throw new Error("ultimate-texas-holdem.step: illegal action for phase");
}

function isTerminal(state: UltimateTexasHoldemState): boolean {
  return state.phase === "settled";
}

function settle(state: UltimateTexasHoldemState, _bet: Bet): GameResult {
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
      label = `Dealer no qualify · ${describeScore(state.playerScore!)}`;
      break;
    case "player_win":
      payout = ante * 2n + play * 2n;
      label = `You win · ${describeScore(state.playerScore!)} vs ${describeScore(state.dealerScore!)}`;
      break;
    case "dealer_win":
      payout = 0n;
      label = `Dealer wins · ${describeScore(state.dealerScore!)} vs ${describeScore(state.playerScore!)}`;
      break;
    case "push":
      payout = ante + play;
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

export const ultimateTexasHoldemGame: Game<UltimateTexasHoldemAction, UltimateTexasHoldemState> = {
  id: "ultimate-texas-holdem",
  display: "Ultimate Texas Hold'em",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function ultimateTexasHoldemRtpLabel(): string {
  return "≈97.8%";
}

export function formatUltimateHoldemCards(cards: Card[]): string {
  return cards.map(cardLabel).join(" ");
}
