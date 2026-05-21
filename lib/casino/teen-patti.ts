/* ===========================================================================
 *  MoneyFund Casino — Teen Patti
 *  ---------------------------------------------------------------------------
 *  Indian 3-card poker vs the dealer. Ante + Play (1× ante). Teen Patti
 *  rankings (straight beats flush). Always compare on play — no qualify rule.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";
import {
  compareThreeCardHands,
  evalThreeCardHand,
  formatThreeCardHand,
  threeCardHandLabel,
  type ThreeCardScore,
} from "./three-card-poker";

export type TeenPattiAction = { type: "fold" } | { type: "play" };

export type TeenPattiPhase = "player_turn" | "settled";

export type TeenPattiOutcome = "fold" | "player_win" | "dealer_win" | "push";

export interface TeenPattiConfig {
  numDecks: number;
}

export const DEFAULT_TEEN_PATTI_CONFIG: TeenPattiConfig = { numDecks: 6 };

export interface TeenPattiState {
  config: TeenPattiConfig;
  shoe: Shoe;
  playerCards: Card[];
  dealerCards: Card[];
  playerScore: ThreeCardScore | null;
  dealerScore: ThreeCardScore | null;
  playStake: bigint;
  outcome: TeenPattiOutcome | null;
  stake: bigint;
  phase: TeenPattiPhase;
}

function mergeConfig(raw: Record<string, unknown> | undefined): TeenPattiConfig {
  if (!raw) return { ...DEFAULT_TEEN_PATTI_CONFIG };
  const n = Number((raw as Partial<TeenPattiConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_TEEN_PATTI_CONFIG.numDecks,
  };
}

function resolvePlay(state: TeenPattiState): TeenPattiState {
  const playerScore = evalThreeCardHand(state.playerCards);
  const dealerScore = evalThreeCardHand(state.dealerCards);
  const cmp = compareThreeCardHands(playerScore, dealerScore);
  let outcome: TeenPattiOutcome;
  if (cmp > 0) outcome = "player_win";
  else if (cmp < 0) outcome = "dealer_win";
  else outcome = "push";

  return {
    ...state,
    playStake: state.stake,
    playerScore,
    dealerScore,
    outcome,
    phase: "settled",
  };
}

function initialState(bet: Bet, rng: RngStream): TeenPattiState {
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
    outcome: null,
    stake: bet.stake,
    phase: "player_turn",
  };
}

function legalActions(state: TeenPattiState): TeenPattiAction[] {
  if (state.phase === "player_turn") {
    return [{ type: "fold" }, { type: "play" }];
  }
  return [];
}

function step(state: TeenPattiState, action: TeenPattiAction, _rng: RngStream): TeenPattiState {
  if (state.phase !== "player_turn") {
    throw new Error("teen-patti.step: only valid on player_turn");
  }
  if (action.type === "fold") {
    return { ...state, outcome: "fold", phase: "settled" };
  }
  return resolvePlay(state);
}

function isTerminal(state: TeenPattiState): boolean {
  return state.phase === "settled";
}

function settle(state: TeenPattiState, _bet: Bet): GameResult {
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

export const teenPattiGame: Game<TeenPattiAction, TeenPattiState> = {
  id: "teen-patti",
  display: "Teen Patti",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function teenPattiRtpLabel(): string {
  return "≈96.2%";
}

export function formatTeenPattiHand(cards: Card[]): string {
  return formatThreeCardHand(cards);
}
