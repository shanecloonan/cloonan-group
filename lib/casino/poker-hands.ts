/* Texas Hold'em hand evaluation — deterministic, pure. */

import type { Card, Rank } from "./types";

const RANK_VAL: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** 0 = high card … 8 = straight flush */
export interface HandScore {
  category: number;
  tiebreak: number[];
}

function rankVal(rank: Rank): number {
  return RANK_VAL[rank];
}

function eval5(cards: Card[]): HandScore {
  const ranks = cards.map((c) => rankVal(c.rank)).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...counts.keys()].sort((a, b) => b - a);

  let isStraight = false;
  let straightHigh = 0;
  const sortedUnique = [...new Set(ranks)].sort((a, b) => b - a);
  if (sortedUnique.length >= 5) {
    for (let i = 0; i <= sortedUnique.length - 5; i++) {
      let ok = true;
      for (let j = 1; j < 5; j++) {
        if (sortedUnique[i + j] !== sortedUnique[i] - j) {
          ok = false;
          break;
        }
      }
      if (ok) {
        isStraight = true;
        straightHigh = sortedUnique[i];
        break;
      }
    }
    if (!isStraight && sortedUnique.includes(14)) {
      const wheel = [14, 5, 4, 3, 2];
      if (wheel.every((w) => sortedUnique.includes(w))) {
        isStraight = true;
        straightHigh = 5;
      }
    }
  }

  if (isFlush && isStraight) {
    return { category: 8, tiebreak: [straightHigh] };
  }
  if (byCount[0][1] === 4) {
    const quad = byCount[0][0];
    const kicker = unique.find((r) => r !== quad) ?? 0;
    return { category: 7, tiebreak: [quad, kicker] };
  }
  if (byCount[0][1] === 3 && byCount[1]?.[1] === 2) {
    return { category: 6, tiebreak: [byCount[0][0], byCount[1][0]] };
  }
  if (isFlush) {
    return { category: 5, tiebreak: ranks };
  }
  if (isStraight) {
    return { category: 4, tiebreak: [straightHigh] };
  }
  if (byCount[0][1] === 3) {
    const kickers = unique.filter((r) => r !== byCount[0][0]);
    return { category: 3, tiebreak: [byCount[0][0], ...kickers] };
  }
  if (byCount[0][1] === 2 && byCount[1]?.[1] === 2) {
    const highPair = Math.max(byCount[0][0], byCount[1][0]);
    const lowPair = Math.min(byCount[0][0], byCount[1][0]);
    const kicker = unique.find((r) => r !== highPair && r !== lowPair) ?? 0;
    return { category: 2, tiebreak: [highPair, lowPair, kicker] };
  }
  if (byCount[0][1] === 2) {
    const pair = byCount[0][0];
    const kickers = unique.filter((r) => r !== pair);
    return { category: 1, tiebreak: [pair, ...kickers] };
  }
  return { category: 0, tiebreak: ranks };
}

export function compareScores(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const d = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Best 5-card hand from up to 7 cards. */
export function bestHand(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error("bestHand: need at least 5 cards");
  if (cards.length === 5) return eval5(cards);

  let best: HandScore | null = null;
  const n = cards.length;
  const pick: number[] = [0, 1, 2, 3, 4];

  const consider = () => {
    const five = pick.map((i) => cards[i]);
    const score = eval5(five);
    if (!best || compareScores(score, best) > 0) best = score;
  };

  consider();
  while (true) {
    let i = 4;
    while (i >= 0 && pick[i] === i + n - 5) i--;
    if (i < 0) break;
    pick[i]++;
    for (let j = i + 1; j < 5; j++) pick[j] = pick[j - 1] + 1;
    consider();
  }
  return best!;
}

export const HAND_CATEGORY_LABEL = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

export function describeScore(score: HandScore): string {
  return HAND_CATEGORY_LABEL[score.category] ?? "Unknown";
}
