/* ===========================================================================
 *  MoneyFund Casino — Deterministic deck primitives
 *  ---------------------------------------------------------------------------
 *  A "shoe" is the physical stack of multiple decks blackjack is dealt from.
 *  We never pre-shuffle the entire shoe up-front — that would burn O(N)
 *  RNG bytes per session for cards that may never be drawn. Instead we keep
 *  an array of remaining card *indices* and pull one out at a time using
 *  the RNG, which costs exactly 4–8 bytes per card draw (rejection
 *  sampling can re-roll).
 *
 *  The card representation is canonical so verification across systems is
 *  trivial:
 *    index = suit * 13 + rank_value
 *    where rank_value: 0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A
 *    and suit: 0=clubs, 1=diamonds, 2=hearts, 3=spades
 *
 *  This matches the order the rejection-sampling mod-52 mapping produces
 *  and lets us write the verifier in any language identically.
 * ========================================================================= */

import type { Card, Rank, RngStream, Shoe, Suit } from "./types";

export const SUITS_ORDERED: Suit[] = ["♣", "♦", "♥", "♠"];
export const RANKS_ORDERED: Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "J", "Q", "K", "A",
];

/** Canonical card by 0..51 index. */
export function cardFromIndex(index: number): Card {
  if (!Number.isInteger(index) || index < 0 || index >= 52) {
    throw new Error(`cardFromIndex: out of range (${index})`);
  }
  const suit = SUITS_ORDERED[Math.floor(index / 13)];
  const rank = RANKS_ORDERED[index % 13];
  return { rank, suit, index };
}

export function cardLabel(c: Card): string {
  return `${c.rank}${c.suit}`;
}

/**
 * The standard blackjack rank-value table. Aces are reported as 11 here;
 * the *hand* evaluator decides whether to count them as 1 to avoid a bust.
 */
export function rankValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J" || rank === "10") return 10;
  return parseInt(rank, 10);
}

/**
 * Build a fresh `numDecks`-deck shoe with cards in *canonical* order
 * (deck 0, suit 0..3, rank 0..12, then deck 1, etc.). Shuffling happens
 * lazily as cards are drawn via `drawCard`.
 */
export function buildShoe(numDecks: number): Shoe {
  if (!Number.isInteger(numDecks) || numDecks < 1 || numDecks > 8) {
    throw new Error(`buildShoe: numDecks must be 1..8 (got ${numDecks})`);
  }
  const cards: Card[] = new Array(numDecks * 52);
  let p = 0;
  for (let d = 0; d < numDecks; d++) {
    for (let i = 0; i < 52; i++) cards[p++] = cardFromIndex(i);
  }
  return { numDecks, cards };
}

/**
 * Mutate the shoe by removing a random card and returning it. Uses the
 * supplied RNG stream; with rejection sampling the draw is unbiased.
 *
 * NOTE: `shoe.cards` is mutated in place. Callers that need an immutable
 * snapshot should clone before drawing.
 */
export function drawCard(shoe: Shoe, rng: RngStream): Card {
  if (shoe.cards.length === 0) {
    throw new Error("drawCard: shoe is empty");
  }
  const idx = rng.nextInt(shoe.cards.length);
  // Swap-and-pop keeps draw O(1).
  const last = shoe.cards.length - 1;
  const card = shoe.cards[idx];
  shoe.cards[idx] = shoe.cards[last];
  shoe.cards.pop();
  return card;
}

/**
 * Deal `n` cards from the shoe in order. Returns a new array; the shoe is
 * mutated. Used for opening blackjack deals (player + dealer initial 2).
 */
export function dealCards(shoe: Shoe, n: number, rng: RngStream): Card[] {
  if (!Number.isInteger(n) || n < 0) throw new Error(`dealCards: n must be >= 0 (got ${n})`);
  const out: Card[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = drawCard(shoe, rng);
  return out;
}

/**
 * Clone a shoe (deep-copying the card array). Used by the verifier to
 * replay a hand without mutating the canonical state.
 */
export function cloneShoe(shoe: Shoe): Shoe {
  return { numDecks: shoe.numDecks, cards: [...shoe.cards] };
}
