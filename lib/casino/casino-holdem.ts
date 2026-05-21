/* ===========================================================================
 *  MoneyFund Casino — Casino Hold'em
 *  ---------------------------------------------------------------------------
 *  Texas Hold'em vs the dealer. Ante + Call (2× ante). Shared 5-card board;
 *  best hand from 2 hole + 5 board. Dealer qualifies with pair of 4s or better.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import { bestHand, compareScores, describeScore, type HandScore } from "./poker-hands";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";

export type CasinoHoldemAction = { type: "fold" } | { type: "call" };

export type CasinoHoldemPhase = "player_turn" | "settled";

export type CasinoHoldemOutcome =
  | "fold"
  | "dealer_no_qualify"
  | "player_win"
  | "dealer_win"
  | "push";

export interface CasinoHoldemConfig {
  numDecks: number;
}

export const DEFAULT_CASINO_HOLDEM_CONFIG: CasinoHoldemConfig = { numDecks: 6 };

export interface CasinoHoldemState {
  config: CasinoHoldemConfig;
  shoe: Shoe;
  playerHole: Card[];
  dealerHole: Card[];
  board: Card[];
  playerScore: HandScore | null;
  dealerScore: HandScore | null;
  callStake: bigint;
  dealerQualified: boolean | null;
  outcome: CasinoHoldemOutcome | null;
  stake: bigint;
  phase: CasinoHoldemPhase;
}

function dealerSeven(state: CasinoHoldemState): Card[] {
  return [...state.dealerHole, ...state.board];
}

function playerSeven(state: CasinoHoldemState): Card[] {
  return [...state.playerHole, ...state.board];
}

/** Pair of 4s or better from the dealer's best 5 of 7. */
export function casinoHoldemDealerQualifies(cards: Card[]): boolean {
  const score = bestHand(cards);
  if (score.category >= 2) return true;
  if (score.category === 1) return score.tiebreak[0] >= 4;
  return false;
}

function mergeConfig(raw: Record<string, unknown> | undefined): CasinoHoldemConfig {
  if (!raw) return { ...DEFAULT_CASINO_HOLDEM_CONFIG };
  const n = Number((raw as Partial<CasinoHoldemConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_CASINO_HOLDEM_CONFIG.numDecks,
  };
}

function resolveCall(state: CasinoHoldemState): CasinoHoldemState {
  const playerScore = bestHand(playerSeven(state));
  const dealerScore = bestHand(dealerSeven(state));
  const qualified = casinoHoldemDealerQualifies(dealerSeven(state));
  let outcome: CasinoHoldemOutcome;

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
    callStake: state.stake * 2n,
    playerScore,
    dealerScore,
    dealerQualified: qualified,
    outcome,
    phase: "settled",
  };
}

function initialState(bet: Bet, rng: RngStream): CasinoHoldemState {
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
    playerScore: null,
    dealerScore: null,
    callStake: 0n,
    dealerQualified: null,
    outcome: null,
    stake: bet.stake,
    phase: "player_turn",
  };
}

function legalActions(state: CasinoHoldemState): CasinoHoldemAction[] {
  if (state.phase === "player_turn") {
    return [{ type: "fold" }, { type: "call" }];
  }
  return [];
}

function step(state: CasinoHoldemState, action: CasinoHoldemAction, _rng: RngStream): CasinoHoldemState {
  if (state.phase !== "player_turn") {
    throw new Error("casino-holdem.step: only valid on player_turn");
  }
  if (action.type === "fold") {
    return { ...state, outcome: "fold", phase: "settled" };
  }
  return resolveCall(state);
}

function isTerminal(state: CasinoHoldemState): boolean {
  return state.phase === "settled";
}

function settle(state: CasinoHoldemState, _bet: Bet): GameResult {
  const ante = state.stake;
  const call = state.callStake;
  const totalStaked = ante + call;
  let payout = 0n;
  let label: string;

  switch (state.outcome) {
    case "fold":
      payout = 0n;
      label = "Folded — ante lost";
      break;
    case "dealer_no_qualify":
      payout = ante * 2n + call;
      label = `Dealer no qualify · ${describeScore(state.playerScore!)}`;
      break;
    case "player_win":
      payout = ante * 2n + call * 2n;
      label = `You win · ${describeScore(state.playerScore!)} vs ${describeScore(state.dealerScore!)}`;
      break;
    case "dealer_win":
      payout = 0n;
      label = `Dealer wins · ${describeScore(state.dealerScore!)} vs ${describeScore(state.playerScore!)}`;
      break;
    case "push":
      payout = ante + call;
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

export const casinoHoldemGame: Game<CasinoHoldemAction, CasinoHoldemState> = {
  id: "casino-holdem",
  display: "Casino Hold'em",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function casinoHoldemRtpLabel(): string {
  return "≈97.8%";
}

export function formatCasinoHoldemCards(cards: Card[]): string {
  return cards.map(cardLabel).join(" ");
}
