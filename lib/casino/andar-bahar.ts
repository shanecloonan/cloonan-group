/* ===========================================================================
 *  MoneyFund Casino — Andar Bahar
 *  ---------------------------------------------------------------------------
 *  Joker card sets the target rank. Cards alternate to Bahar (first) then Andar
 *  until a matching rank lands. Bet Andar (0.9:1) or Bahar (1:1), 1% edge on wins.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import type { Bet, Card, Game, GameResult, Rank, RngStream, Shoe } from "./types";

export type AndarBaharSide = "andar" | "bahar";

export interface AndarBaharAction {
  type: "noop";
}

export interface AndarBaharConfig {
  numDecks: number;
  houseEdgeBps: number;
}

export const DEFAULT_ANDAR_BAHAR_CONFIG: AndarBaharConfig = { numDecks: 6, houseEdgeBps: 100 };

export interface AndarBaharState {
  config: AndarBaharConfig;
  shoe: Shoe;
  jokerCard: Card;
  betSide: AndarBaharSide;
  andarCards: Card[];
  baharCards: Card[];
  winner: AndarBaharSide;
  winningCard: Card;
  won: boolean;
  payReturnMult: number;
  stake: bigint;
  phase: "settled";
}

/** Total return multiple on stake (before edge). */
export function andarBaharPayReturn(side: AndarBaharSide): number {
  return side === "andar" ? 1.9 : 2;
}

export function ranksMatch(a: Rank, b: Rank): boolean {
  return a === b;
}

/**
 * Deal alternating from Bahar first until rank matches joker.
 * Returns piles and which side won.
 */
export function dealAndarBahar(
  shoe: Shoe,
  rng: RngStream,
  joker: Card,
): { andarCards: Card[]; baharCards: Card[]; winner: AndarBaharSide; winningCard: Card } {
  const andarCards: Card[] = [];
  const baharCards: Card[] = [];
  let turn: AndarBaharSide = "bahar";

  for (let safety = 0; safety < shoe.cards.length; safety++) {
    const c = drawCard(shoe, rng);
    if (turn === "andar") andarCards.push(c);
    else baharCards.push(c);

    if (ranksMatch(c.rank, joker.rank)) {
      return { andarCards, baharCards, winner: turn, winningCard: c };
    }
    turn = turn === "andar" ? "bahar" : "andar";
  }

  throw new Error("andar-bahar: shoe exhausted without match");
}

function mergeConfig(raw: Record<string, unknown> | undefined): AndarBaharConfig {
  if (!raw) return { ...DEFAULT_ANDAR_BAHAR_CONFIG };
  const n = Number((raw as Partial<AndarBaharConfig>).numDecks);
  const h = Number((raw as Partial<AndarBaharConfig>).houseEdgeBps);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_ANDAR_BAHAR_CONFIG.numDecks,
    houseEdgeBps: Number.isInteger(h) && h >= 0 && h <= 1000 ? h : DEFAULT_ANDAR_BAHAR_CONFIG.houseEdgeBps,
  };
}

function initialState(bet: Bet, rng: RngStream): AndarBaharState {
  const config = mergeConfig(bet.config);
  const raw = (bet.config ?? {}) as { betSide?: AndarBaharSide };
  const betSide: AndarBaharSide = raw.betSide === "bahar" ? "bahar" : "andar";

  const shoe = buildShoe(config.numDecks);
  const jokerCard = drawCard(shoe, rng);
  const { andarCards, baharCards, winner, winningCard } = dealAndarBahar(shoe, rng, jokerCard);
  const won = winner === betSide;
  const payReturnMult = won ? andarBaharPayReturn(betSide) : 0;

  return {
    config,
    shoe,
    jokerCard,
    betSide,
    andarCards,
    baharCards,
    winner,
    winningCard,
    won,
    payReturnMult,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: AndarBaharState): AndarBaharAction[] {
  return [];
}

function step(state: AndarBaharState, _action: AndarBaharAction, _rng: RngStream): AndarBaharState {
  throw new Error("andar-bahar.step: terminal after deal");
}

function isTerminal(state: AndarBaharState): boolean {
  return state.phase === "settled";
}

function settle(state: AndarBaharState, _bet: Bet): GameResult {
  const edgeNum = BigInt(10000 - state.config.houseEdgeBps);
  let payout = 0n;
  if (state.won) {
    payout =
      state.betSide === "andar"
        ? (state.stake * 19n * edgeNum) / 100000n
        : (state.stake * 2n * edgeNum) / 10000n;
  }

  const label = state.won
    ? `${state.betSide} wins · ${cardLabel(state.winningCard)} matched joker ${cardLabel(state.jokerCard)}`
    : `${state.winner} wins · you bet ${state.betSide}`;

  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [{ label, stakedUnits: state.stake, payoutUnits: payout, pnlUnits: payout - state.stake }],
  };
}

export const andarBaharGame: Game<AndarBaharAction, AndarBaharState> = {
  id: "andar-bahar",
  display: "Andar Bahar",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function andarBaharRtpLabel(side: AndarBaharSide): string {
  return side === "andar" ? "≈95%" : "≈99%";
}
