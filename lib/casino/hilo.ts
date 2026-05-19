/* ===========================================================================
 *  MoneyFund Casino — HiLo (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  The card-counting crypto-casino classic. Each round:
 *    1. A starting card is drawn uniformly at random from a full 52-card
 *       deck (HMAC-SHA256 RNG). The card is face-up.
 *    2. The player guesses whether the *next* card will be HIGHER-OR-SAME
 *       rank or LOWER-OR-SAME rank than the visible card.
 *    3. A new card is drawn — INDEPENDENTLY from the full 52-card deck
 *       (i.e. with replacement). This keeps the win-probability formula
 *       depend only on the visible rank and lets the multiplier math be
 *       exact:
 *
 *         P(higher_or_same | rank r) = 4·(13 - r) / 52      (r = 0..12)
 *         P(lower_or_same  | rank r) = 4·(r + 1)  / 52
 *
 *       Both options tie-on-equal, so ranks of the visible card count
 *       for *both* — the overlap is what makes the per-pick edge work.
 *    4. On a correct guess, the live multiplier compounds by
 *           m_new = m_old · (10000 − houseEdgeBps) / 10000 / p
 *       and the new card becomes the visible card. On a loss the round
 *       ends at 0×. At any point with at least one pick made, the player
 *       may cash out for `stake × multiplier`.
 *
 *  Why with-replacement: makes the per-pick edge a *flat* 1% regardless
 *  of game history. With a finite-deck (no-replacement) model the
 *  probabilities drift as cards are consumed and any naive 1/p multiplier
 *  formula compounds a hidden card-counting error.
 *
 *  Compound-edge identity: by linearity of expectation, the EV of any
 *  strategy that ends with a cashout after k successful picks is
 *  exactly `0.99^k · stake`. Smoke test verifies this empirically.
 *
 *  RNG consumption: one unbiased `rng.nextInt(52)` call per drawn card
 *  (initial card + one per pick).
 * ========================================================================= */

import type { Bet, Card, Game, GameResult, RngStream } from "./types";
import { cardFromIndex, RANKS_ORDERED } from "./deck";

/* ---------------------------------------------------------------------------
 *  Public types
 * ------------------------------------------------------------------------- */

export type HiloDirection = "higher" | "lower";

export interface HiloConfig {
  /** House edge in basis points. Default 100 = 1% per pick. */
  houseEdgeBps: number;
}

export const DEFAULT_HILO_CONFIG: HiloConfig = {
  houseEdgeBps: 100,
};

export interface HiloPick {
  direction: HiloDirection;
  /** Canonical card index 0..51 visible *before* this pick. */
  fromCardIndex: number;
  /** Canonical card index 0..51 revealed by this pick. */
  toCardIndex: number;
  won: boolean;
  /** Win probability used to compute the multiplier on this pick. */
  probability: number;
  /** Multiplier (display) after this pick — equals previous multiplier on a loss. */
  multiplierAfter: number;
}

export interface HiloState {
  config: HiloConfig;
  stake: bigint;
  /** Canonical card index 0..51 of the card currently face-up. */
  currentCardIndex: number;
  /** All cards revealed so far, in order. `revealedHistory[0]` is the
   *  starting card; `revealedHistory[i]` (i > 0) is the card revealed by
   *  the i-th pick. `currentCardIndex` always equals the last entry. */
  revealedHistory: number[];
  /** History of every pick the player made this round, in order. */
  picks: HiloPick[];
  /** Live cashout multiplier (display). 0 if the round was lost. */
  multiplier: number;
  /** Multiplier scaled by 1e6 for exact bigint payout math. */
  multiplierMicro: bigint;
  phase: "running" | "cashed_out" | "lost";
}

export type HiloAction =
  | { type: "guess"; direction: HiloDirection }
  | { type: "cashout" };

/* ---------------------------------------------------------------------------
 *  Rank math
 * ------------------------------------------------------------------------- */

/** Returns the rank index 0..12 (2 = 0, A = 12) of a canonical card index 0..51. */
export function rankIndexOf(cardIndex: number): number {
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= 52) {
    throw new Error(`hilo.rankIndexOf: index ${cardIndex} out of range`);
  }
  return cardIndex % 13;
}

/**
 * Win probability for a HiLo guess given the rank of the visible card.
 * Both options count the visible-card rank as a "tie wins" — `P_high + P_low =
 * 56/52 > 1` due to the shared tie share. The multiplier formula accounts
 * for this; see file header.
 */
export function hiloWinProbability(direction: HiloDirection, currentRankIdx: number): number {
  if (currentRankIdx < 0 || currentRankIdx > 12) {
    throw new Error(`hilo.hiloWinProbability: rank idx ${currentRankIdx} out of [0,12]`);
  }
  if (direction === "higher") {
    return (4 * (13 - currentRankIdx)) / 52;
  }
  return (4 * (currentRankIdx + 1)) / 52;
}

/**
 * Multiplier delta for a winning pick: `Δ = (10000 - hbp) / 10000 / p`.
 * Used to compound the live multiplier.
 *
 * Edge cases:
 *  - p = 1 (e.g. "higher" on a 2): Δ = 0.99 — the player loses 1% by
 *    pressing a guaranteed-win button. UIs typically disable these.
 *  - p = 0 (e.g. "higher" on an A using a stricter rule): we use the
 *    "or-same" rule so p is never zero — the lowest possible p is 4/52.
 */
export function hiloMultiplierStep(
  p: number,
  houseEdgeBps: number = DEFAULT_HILO_CONFIG.houseEdgeBps,
): number {
  if (p <= 0) return 0;
  return ((10000 - houseEdgeBps) / 10000) / p;
}

/* ---------------------------------------------------------------------------
 *  Card draw — unbiased uniform [0, 52)
 * ------------------------------------------------------------------------- */

/**
 * Draw a single card from a fresh full 52-card deck. Returns the canonical
 * card index 0..51. Uses rejection-sampling via `rng.nextInt(...)` so the
 * draw is unbiased.
 *
 * Exposed so the verify page can replay individual draws from a revealed
 * seed without instantiating the entire game state.
 */
export function drawHiloCard(rng: RngStream): number {
  return rng.nextInt(52);
}

/* ---------------------------------------------------------------------------
 *  Game implementation
 * ------------------------------------------------------------------------- */

function mergeConfig(raw: Record<string, unknown> | undefined): HiloConfig {
  if (!raw) return { ...DEFAULT_HILO_CONFIG };
  const hbp = (raw as { houseEdgeBps?: number }).houseEdgeBps;
  const merged: HiloConfig = {
    houseEdgeBps: Number.isInteger(hbp) ? Number(hbp) : DEFAULT_HILO_CONFIG.houseEdgeBps,
  };
  if (merged.houseEdgeBps < 0 || merged.houseEdgeBps > 1000) {
    throw new Error("hilo: houseEdgeBps must be in [0, 1000]");
  }
  return merged;
}

function initialState(bet: Bet, rng: RngStream): HiloState {
  const config = mergeConfig(bet.config);
  const startingCard = drawHiloCard(rng);
  return {
    config,
    stake: bet.stake,
    currentCardIndex: startingCard,
    revealedHistory: [startingCard],
    picks: [],
    multiplier: 1.0,
    multiplierMicro: 1_000_000n,
    phase: "running",
  };
}

function legalActions(state: HiloState): HiloAction[] {
  if (state.phase !== "running") return [];
  const out: HiloAction[] = [
    { type: "guess", direction: "higher" },
    { type: "guess", direction: "lower" },
  ];
  if (state.picks.length > 0) out.push({ type: "cashout" });
  return out;
}

function step(state: HiloState, action: HiloAction, rng: RngStream): HiloState {
  if (state.phase !== "running") {
    throw new Error(`hilo.step: state.phase=${state.phase} is terminal`);
  }
  if (action.type === "cashout") {
    if (state.picks.length === 0) {
      throw new Error("hilo.cashout: must make at least one pick first");
    }
    return { ...state, phase: "cashed_out" };
  }

  const fromCardIndex = state.currentCardIndex;
  const toCardIndex = drawHiloCard(rng);
  const fromRank = rankIndexOf(fromCardIndex);
  const toRank = rankIndexOf(toCardIndex);
  const p = hiloWinProbability(action.direction, fromRank);

  const won =
    action.direction === "higher" ? toRank >= fromRank : toRank <= fromRank;

  if (!won) {
    const pick: HiloPick = {
      direction: action.direction,
      fromCardIndex,
      toCardIndex,
      won: false,
      probability: p,
      multiplierAfter: 0,
    };
    return {
      ...state,
      currentCardIndex: toCardIndex,
      revealedHistory: [...state.revealedHistory, toCardIndex],
      picks: [...state.picks, pick],
      multiplier: 0,
      multiplierMicro: 0n,
      phase: "lost",
    };
  }

  // Won — compound multiplier.
  const stepFactor = hiloMultiplierStep(p, state.config.houseEdgeBps);
  const newMultiplier = state.multiplier * stepFactor;
  // Bigint micro update via integer arithmetic to avoid float drift.
  //   p = winCount / 52, multiplier_step = (10000 - hbp) · 52 / (10000 · winCount)
  // So:
  //   micro_new = micro_old · (10000 - hbp) · 52 / (10000 · winCount)
  const winCount =
    action.direction === "higher" ? 4 * (13 - fromRank) : 4 * (fromRank + 1);
  const edgeNum = BigInt(10000 - state.config.houseEdgeBps);
  const newMicro = (state.multiplierMicro * edgeNum * 52n) / (10000n * BigInt(winCount));

  const pick: HiloPick = {
    direction: action.direction,
    fromCardIndex,
    toCardIndex,
    won: true,
    probability: p,
    multiplierAfter: newMultiplier,
  };
  return {
    ...state,
    currentCardIndex: toCardIndex,
    revealedHistory: [...state.revealedHistory, toCardIndex],
    picks: [...state.picks, pick],
    multiplier: newMultiplier,
    multiplierMicro: newMicro,
    phase: "running",
  };
}

function isTerminal(state: HiloState): boolean {
  return state.phase === "cashed_out" || state.phase === "lost";
}

function settle(state: HiloState, _bet: Bet): GameResult {
  if (!isTerminal(state)) {
    throw new Error("hilo.settle: state is not terminal");
  }
  const won = state.phase === "cashed_out";
  const payout = won ? (state.stake * state.multiplierMicro) / 1_000_000n : 0n;
  const last = state.picks[state.picks.length - 1];
  const label = won
    ? `Cashed out at ${state.multiplier.toFixed(2)}× after ${state.picks.length} correct pick${state.picks.length === 1 ? "" : "s"}`
    : `Lost ${last?.direction ?? "?"} on ${cardLabelShort(last?.fromCardIndex ?? 0)} → ${cardLabelShort(last?.toCardIndex ?? 0)}`;
  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [
      {
        label,
        stakedUnits: state.stake,
        payoutUnits: payout,
        pnlUnits: payout - state.stake,
      },
    ],
  };
}

export const hiloGame: Game<HiloAction, HiloState> = {
  id: "hilo",
  display: "HiLo",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/* ---------------------------------------------------------------------------
 *  UI helpers
 * ------------------------------------------------------------------------- */

export function hiloCardOf(cardIndex: number): Card {
  return cardFromIndex(cardIndex);
}

export function rankLabelOf(rankIdx: number): string {
  return RANKS_ORDERED[rankIdx];
}

function cardLabelShort(cardIndex: number): string {
  const c = cardFromIndex(cardIndex);
  return `${c.rank}${c.suit}`;
}

/**
 * Expected return of a "guess-then-cashout" strategy at the current card,
 * for a given direction. Equals `(1 − houseEdge)`. Useful sanity probe.
 */
export function expectedReturnAtPick(
  direction: HiloDirection,
  currentRankIdx: number,
  houseEdgeBps: number = DEFAULT_HILO_CONFIG.houseEdgeBps,
): number {
  const p = hiloWinProbability(direction, currentRankIdx);
  const m = hiloMultiplierStep(p, houseEdgeBps);
  return p * m;
}
