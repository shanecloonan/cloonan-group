/* ===========================================================================
 *  MoneyFund Casino — Red Dog (Yablon)
 *  ---------------------------------------------------------------------------
 *  Two cards define a spread; a third wins if its rank falls strictly between.
 *  Pair or consecutive ranks push. Ace high. Standard spread pay table.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard, RANKS_ORDERED } from "./deck";
import type { Bet, Card, Game, GameResult, Rank, RngStream, Shoe } from "./types";

export interface RedDogAction {
  type: "noop";
}

export interface RedDogConfig {
  numDecks: number;
  houseEdgeBps: number;
}

export const DEFAULT_RED_DOG_CONFIG: RedDogConfig = { numDecks: 6, houseEdgeBps: 100 };

export interface RedDogState {
  config: RedDogConfig;
  shoe: Shoe;
  card1: Card;
  card2: Card;
  card3: Card | null;
  rank1: number;
  rank2: number;
  spread: number;
  pushed: boolean;
  won: boolean;
  payReturnMult: number;
  stake: bigint;
  phase: "settled";
}

/** Rank index 0 = 2 … 12 = Ace (high). */
export function redDogRankIndex(rank: Rank): number {
  return RANKS_ORDERED.indexOf(rank);
}

/** Total return on stake by spread (1 = one rank between, up to 7). */
const SPREAD_RETURN: Record<number, number> = {
  1: 2,
  2: 3,
  3: 5,
  4: 7,
  5: 11,
  6: 16,
  7: 21,
};

export function evaluateRedDogHand(
  card1: Card,
  card2: Card,
  card3: Card | null,
): { spread: number; pushed: boolean; won: boolean; payReturnMult: number } {
  const rank1 = redDogRankIndex(card1.rank);
  const rank2 = redDogRankIndex(card2.rank);
  if (rank1 === rank2) {
    return { spread: 0, pushed: true, won: false, payReturnMult: 1 };
  }
  const lo = Math.min(rank1, rank2);
  const hi = Math.max(rank1, rank2);
  if (hi - lo === 1) {
    return { spread: 0, pushed: true, won: false, payReturnMult: 1 };
  }
  const spread = hi - lo - 1;
  if (!card3) {
    return { spread, pushed: false, won: false, payReturnMult: 0 };
  }
  const r3 = redDogRankIndex(card3.rank);
  const won = r3 > lo && r3 < hi;
  const payReturnMult = won ? SPREAD_RETURN[Math.min(spread, 7)] ?? 2 : 0;
  return { spread, pushed: false, won, payReturnMult };
}

function mergeConfig(raw: Record<string, unknown> | undefined): RedDogConfig {
  if (!raw) return { ...DEFAULT_RED_DOG_CONFIG };
  const n = Number((raw as Partial<RedDogConfig>).numDecks);
  const h = Number((raw as Partial<RedDogConfig>).houseEdgeBps);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_RED_DOG_CONFIG.numDecks,
    houseEdgeBps: Number.isInteger(h) && h >= 0 && h <= 1000 ? h : DEFAULT_RED_DOG_CONFIG.houseEdgeBps,
  };
}

function initialState(bet: Bet, rng: RngStream): RedDogState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  const card1 = drawCard(shoe, rng);
  const card2 = drawCard(shoe, rng);
  let card3: Card | null = null;
  const pre = evaluateRedDogHand(card1, card2, null);
  let result = pre;
  if (!pre.pushed) {
    card3 = drawCard(shoe, rng);
    result = evaluateRedDogHand(card1, card2, card3);
  }

  return {
    config,
    shoe,
    card1,
    card2,
    card3,
    rank1: redDogRankIndex(card1.rank),
    rank2: redDogRankIndex(card2.rank),
    spread: result.spread,
    pushed: result.pushed,
    won: result.won,
    payReturnMult: result.payReturnMult,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: RedDogState): RedDogAction[] {
  return [];
}

function step(state: RedDogState, _action: RedDogAction, _rng: RngStream): RedDogState {
  throw new Error("red-dog.step: terminal after deal");
}

function isTerminal(state: RedDogState): boolean {
  return state.phase === "settled";
}

function settle(state: RedDogState, _bet: Bet): GameResult {
  const edgeNum = BigInt(10000 - state.config.houseEdgeBps);
  let payout = 0n;
  let label: string;

  if (state.pushed) {
    payout = state.stake;
    label =
      state.rank1 === state.rank2
        ? `Pair ${cardLabel(state.card1)} — push`
        : `Consecutive ${cardLabel(state.card1)} ${cardLabel(state.card2)} — push`;
  } else if (state.won && state.payReturnMult > 0) {
    payout = (state.stake * BigInt(state.payReturnMult) * edgeNum) / 10000n;
    label = `Spread ${state.spread} · ${cardLabel(state.card3!)} between · ${state.payReturnMult}×`;
  } else {
    label = `Spread ${state.spread} · ${state.card3 ? cardLabel(state.card3) : "—"} not between — loss`;
  }

  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [{ label, stakedUnits: state.stake, payoutUnits: payout, pnlUnits: payout - state.stake }],
  };
}

export const redDogGame: Game<RedDogAction, RedDogState> = {
  id: "red-dog",
  display: "Red Dog",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function redDogRtpLabel(spread: number): string {
  if (spread <= 2) return "≈96%";
  if (spread <= 4) return "≈95%";
  return "≈94%";
}

export function spreadReturnHint(spread: number): number {
  if (spread < 1) return 1;
  return SPREAD_RETURN[Math.min(spread, 7)] ?? 2;
}
