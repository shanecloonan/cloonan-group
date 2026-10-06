/* ===========================================================================
 *  MoneyFund Casino — Trente et Quarante
 *  ---------------------------------------------------------------------------
 *  French salon game (Rouge et Noir). Six decks. Aces count 1, faces and
 *  tens count 10. Two rows — Rouge, then Noir — are dealt until each totals
 *  31 or more. The row closer to 31 wins at 1:1.
 *
 *  Ordinary ties push. Both rows at exactly 31 is a refait: half the stake
 *  is returned. Couleur wins when the winning row matches the suit color of
 *  the first card of Rouge; Inverse is the opposite. Published edge ≈ 1.3%.
 * ========================================================================= */

import { buildShoe, cardLabel, drawCard } from "./deck";
import type { Bet, Card, Game, GameResult, Rank, RngStream, Shoe, Suit } from "./types";

export type TrenteSpot = "rouge" | "noir" | "couleur" | "inverse";
export type TrenteOutcome = "rouge" | "noir" | "tie" | "refait";

export interface TrenteEtQuaranteAction {
  type: "noop";
}

export interface TrenteEtQuaranteConfig {
  numDecks: number;
}

export const DEFAULT_TRENTE_CONFIG: TrenteEtQuaranteConfig = { numDecks: 6 };

export interface TrenteEtQuaranteState {
  config: TrenteEtQuaranteConfig;
  betSpot: TrenteSpot;
  rouge: Card[];
  noir: Card[];
  rougeTotal: number;
  noirTotal: number;
  /** Suit color of the first card of the Rouge row. */
  firstSuitRed: boolean;
  outcome: TrenteOutcome;
  /** Null on a tie or refait, when couleur is not decided. */
  couleurWins: boolean | null;
  stake: bigint;
  phase: "settled";
}

/** Ace = 1, ten and faces = 10, pips as printed. */
export function trentePoint(rank: Rank): number {
  if (rank === "A") return 1;
  if (rank === "K" || rank === "Q" || rank === "J" || rank === "10") return 10;
  return parseInt(rank, 10);
}

export function suitIsRed(suit: Suit): boolean {
  return suit === "♥" || suit === "♦";
}

function mergeConfig(raw: Record<string, unknown> | undefined): TrenteEtQuaranteConfig {
  if (!raw) return { ...DEFAULT_TRENTE_CONFIG };
  const n = Number((raw as Partial<TrenteEtQuaranteConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_TRENTE_CONFIG.numDecks,
  };
}

function readSpot(raw: Record<string, unknown> | undefined): TrenteSpot {
  const spot = raw?.betSpot;
  if (spot === "noir" || spot === "couleur" || spot === "inverse" || spot === "rouge") return spot;
  return "rouge";
}

function dealRow(shoe: Shoe, rng: RngStream): { cards: Card[]; total: number } {
  const cards: Card[] = [];
  let total = 0;
  while (total < 31) {
    const card = drawCard(shoe, rng);
    cards.push(card);
    total += trentePoint(card.rank);
  }
  return { cards, total };
}

function resolveOutcome(rougeTotal: number, noirTotal: number): TrenteOutcome {
  if (rougeTotal === 31 && noirTotal === 31) return "refait";
  if (rougeTotal === noirTotal) return "tie";
  return rougeTotal < noirTotal ? "rouge" : "noir";
}

function initialState(bet: Bet, rng: RngStream): TrenteEtQuaranteState {
  const config = mergeConfig(bet.config);
  const betSpot = readSpot(bet.config);
  const shoe = buildShoe(config.numDecks);
  const rouge = dealRow(shoe, rng);
  const noir = dealRow(shoe, rng);
  const first = rouge.cards[0];
  if (!first) throw new Error("trente-et-quarante: empty rouge row");
  const firstSuitRed = suitIsRed(first.suit);
  const outcome = resolveOutcome(rouge.total, noir.total);
  const couleurSide: "rouge" | "noir" = firstSuitRed ? "rouge" : "noir";
  const couleurWins = outcome === "rouge" || outcome === "noir" ? outcome === couleurSide : null;

  return {
    config,
    betSpot,
    rouge: rouge.cards,
    noir: noir.cards,
    rougeTotal: rouge.total,
    noirTotal: noir.total,
    firstSuitRed,
    outcome,
    couleurWins,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: TrenteEtQuaranteState): TrenteEtQuaranteAction[] {
  return [];
}

function step(_state: TrenteEtQuaranteState, _action: TrenteEtQuaranteAction, _rng: RngStream): TrenteEtQuaranteState {
  throw new Error("trente-et-quarante.step: terminal after deal");
}

function isTerminal(state: TrenteEtQuaranteState): boolean {
  return state.phase === "settled";
}

function playerWins(state: TrenteEtQuaranteState): boolean {
  const { betSpot, outcome, couleurWins } = state;
  if (betSpot === "rouge") return outcome === "rouge";
  if (betSpot === "noir") return outcome === "noir";
  if (betSpot === "couleur") return couleurWins === true;
  return couleurWins === false;
}

function rowLabel(cards: Card[], total: number): string {
  return `${cards.map(cardLabel).join(" ")} = ${total}`;
}

function settle(state: TrenteEtQuaranteState, _bet: Bet): GameResult {
  const { stake, outcome } = state;
  let payout = 0n;
  let label: string;

  if (outcome === "refait") {
    payout = stake / 2n;
    label = `Refait — both rows 31 · half returned · ${state.betSpot}`;
  } else if (outcome === "tie") {
    payout = stake;
    label = `Égalité ${state.rougeTotal} · ${state.betSpot} push`;
  } else if (playerWins(state)) {
    payout = stake * 2n;
    label = `${outcome} ${state.rougeTotal}–${state.noirTotal} · ${state.betSpot} wins`;
  } else {
    payout = 0n;
    label = `${outcome} ${state.rougeTotal}–${state.noirTotal} · ${state.betSpot} loses`;
  }

  const detail = `Rouge ${rowLabel(state.rouge, state.rougeTotal)} · Noir ${rowLabel(state.noir, state.noirTotal)}`;
  return {
    totalStakedUnits: stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - stake,
    breakdown: [{ label: `${label} · ${detail}`, stakedUnits: stake, payoutUnits: payout, pnlUnits: payout - stake }],
  };
}

export const trenteEtQuaranteGame: Game<TrenteEtQuaranteAction, TrenteEtQuaranteState> = {
  id: "trente-et-quarante",
  display: "Trente et Quarante",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function trenteRtpLabel(): string {
  return "98.7%";
}
