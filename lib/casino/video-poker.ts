/* ===========================================================================
 *  MoneyFund Casino — Video Poker (Jacks or Better)
 *  ---------------------------------------------------------------------------
 *  Deal 5 cards → player selects holds → draw replacements → standard
 *  9/6-style pay table (800/50/25/9/6/4/3/2/1). Single 52-card deck per hand.
 * ========================================================================= */

import { buildShoe, drawCard } from "./deck";
import { bestHand, describeScore, type HandScore } from "./poker-hands";
import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";

export interface VideoPokerConfig {
  numDecks: number;
}

export const DEFAULT_VIDEO_POKER_CONFIG: VideoPokerConfig = { numDecks: 1 };

export interface VideoPokerAction {
  type: "draw";
  hold: [boolean, boolean, boolean, boolean, boolean];
}

export type VideoPokerPhase = "holding" | "settled";

export interface VideoPokerState {
  config: VideoPokerConfig;
  stake: bigint;
  cards: Card[];
  /** Remaining shoe (mutated across deal + draw for deterministic replay). */
  shoe: Shoe;
  phase: VideoPokerPhase;
  hold?: [boolean, boolean, boolean, boolean, boolean];
  handScore?: HandScore;
  handLabel?: string;
  /** Integer payout multiple on stake (0 = loss). */
  payMultiplier: number;
}

function mergeConfig(raw: Record<string, unknown> | undefined): VideoPokerConfig {
  if (!raw) return { ...DEFAULT_VIDEO_POKER_CONFIG };
  const n = Number((raw as Partial<VideoPokerConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 1 ? 1 : DEFAULT_VIDEO_POKER_CONFIG.numDecks,
  };
}

export function isRoyalFlush(score: HandScore): boolean {
  return score.category === 8 && score.tiebreak[0] === 14;
}

/** Total return multiple on stake (e.g. 2× = Jacks or Better, 800× = Royal). */
export function payMultiplierForHand(score: HandScore): number {
  if (isRoyalFlush(score)) return 800;
  switch (score.category) {
    case 8:
      return 50;
    case 7:
      return 25;
    case 6:
      return 9;
    case 5:
      return 6;
    case 4:
      return 4;
    case 3:
      return 3;
    case 2:
      return 2;
    case 1:
      return score.tiebreak[0] >= 11 ? 2 : 0;
    default:
      return 0;
  }
}

function initialState(bet: Bet, rng: RngStream): VideoPokerState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  const cards: Card[] = [];
  for (let i = 0; i < 5; i++) cards.push(drawCard(shoe, rng));

  return {
    config,
    stake: bet.stake,
    cards,
    shoe,
    phase: "holding",
    payMultiplier: 0,
  };
}

function legalActions(state: VideoPokerState): VideoPokerAction[] {
  if (state.phase !== "holding") return [];
  return [{ type: "draw", hold: [false, false, false, false, false] }];
}

function normalizeHold(hold: boolean[]): [boolean, boolean, boolean, boolean, boolean] {
  if (hold.length !== 5) throw new Error("video-poker: hold must be length 5");
  return [hold[0], hold[1], hold[2], hold[3], hold[4]];
}

function step(state: VideoPokerState, action: VideoPokerAction, rng: RngStream): VideoPokerState {
  if (state.phase !== "holding") {
    throw new Error("video-poker.step: hand already drawn");
  }
  if (action.type !== "draw") {
    throw new Error("video-poker.step: expected draw");
  }

  const hold = normalizeHold(action.hold);
  const cards = [...state.cards];
  for (let i = 0; i < 5; i++) {
    if (!hold[i]) cards[i] = drawCard(state.shoe, rng);
  }

  const handScore = bestHand(cards);
  const payMultiplier = payMultiplierForHand(handScore);
  const label = isRoyalFlush(handScore) ? "Royal flush" : describeScore(handScore);

  return {
    ...state,
    cards,
    hold,
    handScore,
    handLabel: label,
    payMultiplier,
    phase: "settled",
  };
}

function isTerminal(state: VideoPokerState): boolean {
  return state.phase === "settled";
}

function settle(state: VideoPokerState, _bet: Bet): GameResult {
  const payout =
    state.payMultiplier > 0 ? state.stake * BigInt(state.payMultiplier) : 0n;
  const label =
    state.payMultiplier > 0
      ? `${state.handLabel} · pays ${state.payMultiplier}×`
      : `${state.handLabel ?? "No win"}`;

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

export const videoPokerGame: Game<VideoPokerAction, VideoPokerState> = {
  id: "video-poker",
  display: "Video Poker",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function rtpLabel(): string {
  return "≈99.5%";
}

/** Suggested hold: keep cards that form a made hand (optional UI helper). */
export function suggestHold(cards: Card[]): boolean[] {
  if (cards.length !== 5) return [false, false, false, false, false];
  const score = bestHand(cards);
  if (score.category === 0) return [false, false, false, false, false];

  const rankCounts = new Map<string, number>();
  for (const c of cards) rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);

  const suitCounts = new Map<string, number>();
  for (const c of cards) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);

  const flushSuit = [...suitCounts.entries()].find(([, n]) => n >= 5)?.[0];
  const hold = [false, false, false, false, false];

  if (score.category >= 4) {
    for (let i = 0; i < 5; i++) {
      if (flushSuit) {
        if (cards[i].suit === flushSuit) hold[i] = true;
      } else {
        hold[i] = true;
      }
    }
    return hold;
  }

  for (let i = 0; i < 5; i++) {
    const n = rankCounts.get(cards[i].rank) ?? 0;
    if (n >= 2) hold[i] = true;
  }
  return hold;
}
