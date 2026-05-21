/* ===========================================================================
 *  MoneyFund Casino — Dragon Tiger
 *  ---------------------------------------------------------------------------
 *  One card each to Dragon and Tiger (highest rank wins, Ace low). Bet Dragon,
 *  Tiger, or Tie. Tie pays 11:1; Dragon/Tiger bets lose half on a tie.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import type { Bet, Card, Game, GameResult, Rank, RngStream, Shoe } from "./types";

export type DragonTigerSpot = "dragon" | "tiger" | "tie";
export type DragonTigerWinner = "dragon" | "tiger" | "tie";

export interface DragonTigerAction {
  type: "noop";
}

export interface DragonTigerConfig {
  numDecks: number;
}

export const DEFAULT_DRAGON_TIGER_CONFIG: DragonTigerConfig = { numDecks: 8 };

export interface DragonTigerState {
  config: DragonTigerConfig;
  betSpot: DragonTigerSpot;
  dragonCard: Card;
  tigerCard: Card;
  dragonRank: number;
  tigerRank: number;
  winner: DragonTigerWinner;
  stake: bigint;
  phase: "settled";
}

/** Ace=1 … King=13 (standard live Dragon Tiger). */
export function dragonTigerRankValue(rank: Rank): number {
  if (rank === "A") return 1;
  if (rank === "K") return 13;
  if (rank === "Q") return 12;
  if (rank === "J") return 11;
  if (rank === "10") return 10;
  return parseInt(rank, 10);
}

function mergeConfig(raw: Record<string, unknown> | undefined): DragonTigerConfig {
  if (!raw) return { ...DEFAULT_DRAGON_TIGER_CONFIG };
  const n = Number((raw as Partial<DragonTigerConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_DRAGON_TIGER_CONFIG.numDecks,
  };
}

function resolveWinner(dragonRank: number, tigerRank: number): DragonTigerWinner {
  if (dragonRank > tigerRank) return "dragon";
  if (tigerRank > dragonRank) return "tiger";
  return "tie";
}

function initialState(bet: Bet, rng: RngStream): DragonTigerState {
  const config = mergeConfig(bet.config);
  const raw = (bet.config ?? {}) as { betSpot?: DragonTigerSpot };
  const betSpot: DragonTigerSpot =
    raw.betSpot === "tiger" || raw.betSpot === "tie" ? raw.betSpot : "dragon";

  const shoe: Shoe = buildShoe(config.numDecks);
  const dragonCard = drawCard(shoe, rng);
  const tigerCard = drawCard(shoe, rng);
  const dragonRank = dragonTigerRankValue(dragonCard.rank);
  const tigerRank = dragonTigerRankValue(tigerCard.rank);
  const winner = resolveWinner(dragonRank, tigerRank);

  return {
    config,
    betSpot,
    dragonCard,
    tigerCard,
    dragonRank,
    tigerRank,
    winner,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: DragonTigerState): DragonTigerAction[] {
  return [];
}

function step(state: DragonTigerState, _action: DragonTigerAction, _rng: RngStream): DragonTigerState {
  throw new Error("dragon-tiger.step: terminal after deal");
}

function isTerminal(state: DragonTigerState): boolean {
  return state.phase === "settled";
}

function settle(state: DragonTigerState, _bet: Bet): GameResult {
  const { betSpot, winner, stake } = state;
  let payout = 0n;
  let label: string;

  if (winner === "tie") {
    if (betSpot === "tie") {
      payout = stake * 12n;
      label = `Tie ${cardLabel(state.dragonCard)} vs ${cardLabel(state.tigerCard)} · tie bet 11:1`;
    } else {
      payout = stake / 2n;
      label = `Tie rank ${state.dragonRank} · ${betSpot} bet loses half`;
    }
  } else if (betSpot === winner) {
    payout = stake * 2n;
    const side = winner === "dragon" ? "Dragon" : "Tiger";
    const winCard = winner === "dragon" ? state.dragonCard : state.tigerCard;
    const loseCard = winner === "dragon" ? state.tigerCard : state.dragonCard;
    label = `${side} ${cardLabel(winCard)} beats ${cardLabel(loseCard)}`;
  } else if (betSpot === "tie") {
    payout = 0n;
    label = `${winner === "dragon" ? "Dragon" : "Tiger"} wins · tie bet lost`;
  } else {
    payout = 0n;
    label = `${winner === "dragon" ? "Dragon" : "Tiger"} wins · ${betSpot} bet lost`;
  }

  return {
    totalStakedUnits: stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - stake,
    breakdown: [{ label, stakedUnits: stake, payoutUnits: payout, pnlUnits: payout - stake }],
  };
}

export const dragonTigerGame: Game<DragonTigerAction, DragonTigerState> = {
  id: "dragon-tiger",
  display: "Dragon Tiger",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function dragonTigerRtpLabel(spot: DragonTigerSpot): string {
  switch (spot) {
    case "dragon":
    case "tiger":
      return "≈96.3%";
    case "tie":
      return "≈89.6%";
  }
}
