/* ===========================================================================
 *  MoneyFund Casino — Blackjack basic-strategy advisor
 *  ---------------------------------------------------------------------------
 *  Hand → optimal action lookup using the canonical multi-deck basic strategy
 *  table (Hi-Lo / dealer-stands-on-soft-17 / DAS-allowed / no-surrender base).
 *
 *  This is a UX layer — purely informational. The game engine still validates
 *  every move; this just tells the player what *would be* optimal.
 *
 *  Returns: a `BlackjackActionType` and a short human explanation.
 *
 *  Adapted from Stanford's "Optimal Blackjack Basic Strategy" chart
 *  (Schlesinger / Wong) — 6-deck, H17 default, with split + surrender rules.
 * ========================================================================= */

import { evaluateHand } from "./blackjack";
import type { BlackjackActionType, BlackjackState } from "./blackjack";
import type { Card, Rank } from "./types";

export interface StrategyAdvice {
  action: BlackjackActionType;
  /** Human-readable rationale. */
  explanation: string;
  /** If the suggested action isn't available, this is the fallback. */
  fallback?: BlackjackActionType;
}

/** Dealer up-card value: A counts as 11 (for chart lookup). */
function dealerUpValue(c: Card): number {
  if (c.rank === "A") return 11;
  if (c.rank === "K" || c.rank === "Q" || c.rank === "J" || c.rank === "10") return 10;
  return parseInt(c.rank, 10);
}

function isPair(cards: Card[]): { isPair: boolean; rank: Rank | null } {
  if (cards.length !== 2) return { isPair: false, rank: null };
  // Treat 10/J/Q/K as the same "10" pair.
  const v = (r: Rank) => (r === "K" || r === "Q" || r === "J" ? "10" : r);
  if (v(cards[0].rank) === v(cards[1].rank)) {
    return { isPair: true, rank: cards[0].rank };
  }
  return { isPair: false, rank: null };
}

/* ---------------------------------------------------------------------------
 *  Strategy tables — each row maps player situation × dealer up to action.
 *  Letter code:  H=hit, S=stand, D=double-else-hit, Ds=double-else-stand,
 *                P=split, Ph=split if DAS else hit, R=surrender-else-hit,
 *                Rs=surrender-else-stand
 *  Dealer up index: 0='2' ... 8='10', 9='A'  (10 columns)
 * ------------------------------------------------------------------------- */

type Move = "H" | "S" | "D" | "Ds" | "P" | "Ph" | "R" | "Rs";

const PAIR_TABLE: Record<string, Move[]> = {
  "A,A": ["P","P","P","P","P","P","P","P","P","P"],
  "10,10": ["S","S","S","S","S","S","S","S","S","S"],
  "9,9": ["P","P","P","P","P","S","P","P","S","S"],
  "8,8": ["P","P","P","P","P","P","P","P","P","R"],
  "7,7": ["P","P","P","P","P","P","H","H","H","H"],
  "6,6": ["Ph","P","P","P","P","H","H","H","H","H"],
  "5,5": ["D","D","D","D","D","D","D","D","H","H"], // never split 5s
  "4,4": ["H","H","H","Ph","Ph","H","H","H","H","H"],
  "3,3": ["Ph","Ph","P","P","P","P","H","H","H","H"],
  "2,2": ["Ph","Ph","P","P","P","P","H","H","H","H"],
};

// Soft totals: A + n where n = 2..9 (A8/9 etc.)
// Row "A,X" means soft 1X.
const SOFT_TABLE: Record<string, Move[]> = {
  "A,9": ["S","S","S","S","S","S","S","S","S","S"],  // soft 20
  "A,8": ["S","S","S","S","Ds","S","S","S","S","S"], // soft 19
  "A,7": ["Ds","Ds","Ds","Ds","Ds","S","S","H","H","H"], // soft 18
  "A,6": ["H","D","D","D","D","H","H","H","H","H"],  // soft 17
  "A,5": ["H","H","D","D","D","H","H","H","H","H"],  // soft 16
  "A,4": ["H","H","D","D","D","H","H","H","H","H"],  // soft 15
  "A,3": ["H","H","H","D","D","H","H","H","H","H"],  // soft 14
  "A,2": ["H","H","H","D","D","H","H","H","H","H"],  // soft 13
};

// Hard totals 5..21
const HARD_TABLE: Record<number, Move[]> = {
  21: ["S","S","S","S","S","S","S","S","S","S"],
  20: ["S","S","S","S","S","S","S","S","S","S"],
  19: ["S","S","S","S","S","S","S","S","S","S"],
  18: ["S","S","S","S","S","S","S","S","S","S"],
  17: ["S","S","S","S","S","S","S","S","S","Rs"],
  16: ["S","S","S","S","S","H","H","R","R","R"],
  15: ["S","S","S","S","S","H","H","H","R","R"],
  14: ["S","S","S","S","S","H","H","H","H","H"],
  13: ["S","S","S","S","S","H","H","H","H","H"],
  12: ["H","H","S","S","S","H","H","H","H","H"],
  11: ["D","D","D","D","D","D","D","D","D","D"],
  10: ["D","D","D","D","D","D","D","D","H","H"],
  9:  ["H","D","D","D","D","H","H","H","H","H"],
  8:  ["H","H","H","H","H","H","H","H","H","H"],
  7:  ["H","H","H","H","H","H","H","H","H","H"],
  6:  ["H","H","H","H","H","H","H","H","H","H"],
  5:  ["H","H","H","H","H","H","H","H","H","H"],
};

function dealerColumn(upValue: number): number {
  if (upValue === 11) return 9;
  return upValue - 2;
}

function decodeMove(
  m: Move,
  allowed: Set<BlackjackActionType>,
  cards: Card[],
  config: { allowDoubleAfterSplit: boolean; allowSurrender: boolean },
  fromSplit: boolean,
): { action: BlackjackActionType; explanation: string; fallback?: BlackjackActionType } {
  const twoCard = cards.length === 2;
  switch (m) {
    case "H": return { action: "hit", explanation: "Hit — the math favours another card." };
    case "S": return { action: "stand", explanation: "Stand — the dealer is likely to bust this hand." };
    case "D":
      if (twoCard && allowed.has("double") && (!fromSplit || config.allowDoubleAfterSplit)) {
        return { action: "double", explanation: "Double — your equity is highest doubling on two cards." };
      }
      return { action: "hit", explanation: "Double if allowed; otherwise hit.", fallback: "hit" };
    case "Ds":
      if (twoCard && allowed.has("double") && (!fromSplit || config.allowDoubleAfterSplit)) {
        return { action: "double", explanation: "Double — soft hand, push more money in." };
      }
      return { action: "stand", explanation: "Double if allowed; otherwise stand.", fallback: "stand" };
    case "P":
      if (allowed.has("split")) {
        return { action: "split", explanation: "Split — separating these is a clear gain." };
      }
      return { action: "hit", explanation: "Split if allowed; otherwise hit.", fallback: "hit" };
    case "Ph":
      if (allowed.has("split") && config.allowDoubleAfterSplit) {
        return { action: "split", explanation: "Split — only because DAS is allowed." };
      }
      return { action: "hit", explanation: "Hit — only split if DAS is allowed.", fallback: "hit" };
    case "R":
      if (allowed.has("surrender") && config.allowSurrender) {
        return { action: "surrender", explanation: "Surrender — claim half-stake back before disaster." };
      }
      return { action: "hit", explanation: "Surrender if available; otherwise hit.", fallback: "hit" };
    case "Rs":
      if (allowed.has("surrender") && config.allowSurrender) {
        return { action: "surrender", explanation: "Surrender vs Ace; otherwise stand." };
      }
      return { action: "stand", explanation: "Stand — only surrender if available.", fallback: "stand" };
  }
}

/**
 * Look up the optimal action for the active hand in the current state.
 * Returns the suggested action plus a one-sentence rationale. Returns null
 * if no advice is appropriate (e.g. dealer turn, settled, no legal moves).
 */
export function advise(
  state: BlackjackState,
  legalActions: { type: BlackjackActionType }[],
): StrategyAdvice | null {
  if (state.phase !== "player_turn" && state.phase !== "insurance_offered") return null;

  // Insurance is a -EV side bet. Always decline (unless card-counting).
  if (state.phase === "insurance_offered") {
    return {
      action: "decline_insurance",
      explanation: "Decline insurance — long-run -EV at every count except deep negative.",
    };
  }

  const hand = state.hands[state.activeHand];
  if (!hand) return null;
  const allowed = new Set(legalActions.map((a) => a.type));
  const upVal = dealerUpValue(state.dealer[1]);
  const col = dealerColumn(upVal);
  const cards = hand.cards;

  const pair = isPair(cards);
  if (pair.isPair && cards.length === 2 && !hand.fromSplit && allowed.has("split")) {
    const key = `${pair.rank === "K" || pair.rank === "Q" || pair.rank === "J" ? "10" : pair.rank},${pair.rank === "K" || pair.rank === "Q" || pair.rank === "J" ? "10" : pair.rank}`;
    const row = PAIR_TABLE[key];
    if (row) return decodeMove(row[col], allowed, cards, state.config, hand.fromSplit);
  }

  const val = evaluateHand(cards);
  // Soft totals: at least one ace counted as 11. Soft total = 13..20.
  if (val.soft && val.total >= 13 && val.total <= 20) {
    const other = val.total - 11; // non-ace component
    const key = `A,${other}`;
    const row = SOFT_TABLE[key];
    if (row) return decodeMove(row[col], allowed, cards, state.config, hand.fromSplit);
  }

  // Hard totals.
  const table = HARD_TABLE[Math.min(21, Math.max(5, val.total))];
  if (table) return decodeMove(table[col], allowed, cards, state.config, hand.fromSplit);

  return { action: "hit", explanation: "No chart entry — defaulting to hit." };
}
