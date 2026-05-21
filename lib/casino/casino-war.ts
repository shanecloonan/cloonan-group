/* ===========================================================================
 *  MoneyFund Casino — Casino War
 *  ---------------------------------------------------------------------------
 *  One card each; higher rank wins (Ace high). On a tie the player surrenders
 *  (half back) or goes to war (match bet, burn three, re-deal).
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard, RANKS_ORDERED } from "./deck";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";

export type CasinoWarAction = { type: "war" } | { type: "surrender" };

export type CasinoWarPhase = "tie_choice" | "settled";

export type CasinoWarResolution =
  | "player_win"
  | "dealer_win"
  | "surrender"
  | "war_win"
  | "war_loss";

export interface CasinoWarConfig {
  numDecks: number;
}

export const DEFAULT_CASINO_WAR_CONFIG: CasinoWarConfig = { numDecks: 6 };

export interface CasinoWarState {
  config: CasinoWarConfig;
  shoe: Shoe;
  playerCard: Card;
  dealerCard: Card;
  warPlayerCard: Card | null;
  warDealerCard: Card | null;
  /** Extra stake locked when going to war (equals base stake). */
  warStake: bigint;
  resolution: CasinoWarResolution | null;
  stake: bigint;
  phase: CasinoWarPhase;
}

export function casinoWarCompare(player: Card, dealer: Card): "player" | "dealer" | "tie" {
  const p = RANKS_ORDERED.indexOf(player.rank);
  const d = RANKS_ORDERED.indexOf(dealer.rank);
  if (p > d) return "player";
  if (d > p) return "dealer";
  return "tie";
}

function mergeConfig(raw: Record<string, unknown> | undefined): CasinoWarConfig {
  if (!raw) return { ...DEFAULT_CASINO_WAR_CONFIG };
  const n = Number((raw as Partial<CasinoWarConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_CASINO_WAR_CONFIG.numDecks,
  };
}

function initialState(bet: Bet, rng: RngStream): CasinoWarState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  const playerCard = drawCard(shoe, rng);
  const dealerCard = drawCard(shoe, rng);
  const cmp = casinoWarCompare(playerCard, dealerCard);

  if (cmp === "player") {
    return {
      config,
      shoe,
      playerCard,
      dealerCard,
      warPlayerCard: null,
      warDealerCard: null,
      warStake: 0n,
      resolution: "player_win",
      stake: bet.stake,
      phase: "settled",
    };
  }
  if (cmp === "dealer") {
    return {
      config,
      shoe,
      playerCard,
      dealerCard,
      warPlayerCard: null,
      warDealerCard: null,
      warStake: 0n,
      resolution: "dealer_win",
      stake: bet.stake,
      phase: "settled",
    };
  }

  return {
    config,
    shoe,
    playerCard,
    dealerCard,
    warPlayerCard: null,
    warDealerCard: null,
    warStake: 0n,
    resolution: null,
    stake: bet.stake,
    phase: "tie_choice",
  };
}

function legalActions(state: CasinoWarState): CasinoWarAction[] {
  if (state.phase === "tie_choice") {
    return [{ type: "war" }, { type: "surrender" }];
  }
  return [];
}

function step(state: CasinoWarState, action: CasinoWarAction, rng: RngStream): CasinoWarState {
  if (state.phase !== "tie_choice") {
    throw new Error("casino-war.step: only valid during tie_choice");
  }

  if (action.type === "surrender") {
    return {
      ...state,
      resolution: "surrender",
      phase: "settled",
    };
  }

  const warStake = state.stake;
  drawCard(state.shoe, rng);
  drawCard(state.shoe, rng);
  drawCard(state.shoe, rng);
  const warPlayerCard = drawCard(state.shoe, rng);
  const warDealerCard = drawCard(state.shoe, rng);
  const cmp = casinoWarCompare(warPlayerCard, warDealerCard);
  const resolution: CasinoWarResolution =
    cmp === "dealer" ? "war_loss" : "war_win";

  return {
    ...state,
    warPlayerCard,
    warDealerCard,
    warStake,
    resolution,
    phase: "settled",
  };
}

function isTerminal(state: CasinoWarState): boolean {
  return state.phase === "settled";
}

function settle(state: CasinoWarState, _bet: Bet): GameResult {
  const { stake, warStake, resolution } = state;
  const totalStaked = stake + warStake;
  let payout = 0n;
  let label: string;

  switch (resolution) {
    case "player_win":
      payout = stake * 2n;
      label = `You ${cardLabel(state.playerCard)} beat ${cardLabel(state.dealerCard)}`;
      break;
    case "dealer_win":
      payout = 0n;
      label = `Dealer ${cardLabel(state.dealerCard)} beats ${cardLabel(state.playerCard)}`;
      break;
    case "surrender":
      payout = stake / 2n;
      label = `Tie ${cardLabel(state.playerCard)} — surrendered (half back)`;
      break;
    case "war_win":
      payout = stake + warStake * 2n;
      label = `War win ${cardLabel(state.warPlayerCard!)} vs ${cardLabel(state.warDealerCard!)} · ante pushes`;
      break;
    case "war_loss":
      payout = 0n;
      label = `War loss ${cardLabel(state.warDealerCard!)} vs ${cardLabel(state.warPlayerCard!)}`;
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

export const casinoWarGame: Game<CasinoWarAction, CasinoWarState> = {
  id: "casino-war",
  display: "Casino War",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function casinoWarRtpLabel(): string {
  return "≈97.1%";
}
