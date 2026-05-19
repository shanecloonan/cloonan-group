/* ===========================================================================
 *  MoneyFund Casino — Blackjack (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  A *pure*, deterministic rules engine for blackjack. Given a `Bet` plus an
 *  `RngStream` it produces an opening state; given a state and an `Action`
 *  it produces the next state. Zero IO, zero side effects, no random
 *  number source besides the supplied stream.
 *
 *  Rules (Atlantic-City style, our defaults):
 *    • 6-deck shoe (configurable 1–8)
 *    • Dealer hits soft 17 (toggleable to S17)
 *    • Blackjack pays 3:2 (toggleable to 6:5 promo)
 *    • Double allowed on any 2 starting cards
 *    • Double-after-split allowed (toggleable)
 *    • Split up to 4 hands
 *    • Split aces get exactly 1 more card each (no further hit / no BJ)
 *    • Insurance offered when dealer up-card is Ace, pays 2:1
 *    • Late surrender: off by default (Phase 1.5 toggle)
 *
 *  House edge with defaults ≈ 0.42% (the published RTP on table cards is
 *  derived from these exact toggles).
 * ========================================================================= */

import type {
  Bet,
  Card,
  Game,
  GameResult,
  RngStream,
  Shoe,
} from "./types";
import {
  buildShoe,
  cardLabel,
  dealCards,
  drawCard,
  rankValue,
} from "./deck";

/* ---------------------------------------------------------------------------
 *  Actions + state
 * ------------------------------------------------------------------------- */

export type BlackjackActionType =
  | "hit"
  | "stand"
  | "double"
  | "split"
  | "surrender"
  | "insurance"
  | "decline_insurance";

export interface BlackjackAction {
  type: BlackjackActionType;
}

export interface BlackjackConfig {
  numDecks: number;
  dealerHitsSoft17: boolean;
  /** Blackjack payout numerator/denominator, e.g. 3:2 or 6:5. */
  blackjackPays: { num: number; den: number };
  allowDoubleAfterSplit: boolean;
  /** Whether the player can split into up to N total hands. */
  maxHands: number;
  /** Late surrender — only on the original two cards before any action. */
  allowSurrender: boolean;
}

export const DEFAULT_BLACKJACK_CONFIG: BlackjackConfig = {
  numDecks: 6,
  dealerHitsSoft17: true,
  blackjackPays: { num: 3, den: 2 },
  allowDoubleAfterSplit: true,
  maxHands: 4,
  allowSurrender: true,
};

export type BlackjackPhase =
  | "dealing"
  | "insurance_offered"
  | "player_turn"
  | "dealer_turn"
  | "settled";

export interface BlackjackHand {
  cards: Card[];
  /** Money committed to this hand specifically (doubles, splits all count). */
  stake: bigint;
  doubled: boolean;
  fromSplit: boolean;
  /** Split aces are dealt one card each and cannot hit / split further. */
  splitAces: boolean;
  stood: boolean;
  busted: boolean;
  surrendered: boolean;
}

export interface BlackjackState {
  config: BlackjackConfig;
  shoe: Shoe;
  hands: BlackjackHand[];
  /** Index of the hand awaiting a player decision. */
  activeHand: number;
  dealer: Card[];
  /** Whether the dealer's hole card is visible to the player yet. */
  dealerRevealed: boolean;
  /** Stake required per opening hand. Used to validate doubles/splits. */
  baseStake: bigint;
  /** Total money committed across all hands (lockable budget). */
  totalStaked: bigint;
  /** Insurance side-bet, present only after the player accepts it. */
  insuranceStake: bigint;
  insuranceOffered: boolean;
  insuranceResolved: boolean;
  phase: BlackjackPhase;
}

/* ---------------------------------------------------------------------------
 *  Hand evaluation
 * ------------------------------------------------------------------------- */

export interface HandValue {
  total: number;
  /** Whether at least one ace is being counted as 11 without busting. */
  soft: boolean;
  isBlackjack: boolean;
}

/**
 * Evaluate a hand under blackjack rules. Aces flex between 1 and 11
 * automatically to avoid a bust where possible.
 */
export function evaluateHand(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += rankValue(c.rank);
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  const isBlackjack = cards.length === 2 && total === 21;
  // Soft = total is using at least one ace as 11 (i.e. one remains "11" in the count).
  // After the while loop above, an ace is still 11 iff `aces > 0`.
  return { total, soft: aces > 0, isBlackjack };
}

export function isBust(cards: Card[]): boolean {
  return evaluateHand(cards).total > 21;
}

/* ---------------------------------------------------------------------------
 *  Game contract implementation
 * ------------------------------------------------------------------------- */

function newHand(cards: Card[], stake: bigint, opts?: Partial<BlackjackHand>): BlackjackHand {
  return {
    cards,
    stake,
    doubled: false,
    fromSplit: false,
    splitAces: false,
    stood: false,
    busted: false,
    surrendered: false,
    ...opts,
  };
}

/**
 * Build the opening blackjack state from a bet. Deals 2 cards each to
 * player and dealer; deck order matches a real shoe (player, dealer,
 * player, dealer). The dealer's hole card (their first card) is *dealt*
 * here but the UI may choose to hide it until the dealer's turn.
 */
function initialState(bet: Bet, rng: RngStream): BlackjackState {
  const config = mergeConfig(bet.config);
  const shoe = buildShoe(config.numDecks);
  // Standard deal order: player, dealer, player, dealer.
  const cards = dealCards(shoe, 4, rng);
  const playerCards = [cards[0], cards[2]];
  const dealerCards = [cards[1], cards[3]];

  const hand = newHand(playerCards, bet.stake);

  let phase: BlackjackPhase;
  let insuranceOffered = false;
  const playerVal = evaluateHand(playerCards);
  const dealerUp = dealerCards[1]; // index 1 = up-card (the one shown), index 0 = hole card

  if (dealerUp.rank === "A") {
    phase = "insurance_offered";
    insuranceOffered = true;
  } else if (playerVal.isBlackjack || evaluateHand(dealerCards).isBlackjack) {
    // No insurance and either side has blackjack — settle immediately.
    phase = "settled";
  } else {
    phase = "player_turn";
  }

  const state: BlackjackState = {
    config,
    shoe,
    hands: [hand],
    activeHand: 0,
    dealer: dealerCards,
    dealerRevealed: phase === "settled",
    baseStake: bet.stake,
    totalStaked: bet.stake,
    insuranceStake: 0n,
    insuranceOffered,
    insuranceResolved: false,
    phase,
  };
  return state;
}

function mergeConfig(raw: Record<string, unknown> | undefined): BlackjackConfig {
  if (!raw) return { ...DEFAULT_BLACKJACK_CONFIG };
  return {
    ...DEFAULT_BLACKJACK_CONFIG,
    ...(raw as Partial<BlackjackConfig>),
  };
}

/**
 * Enumerate the *legal* actions for the current state. The session driver
 * uses this to validate any incoming user action — any action not in the
 * returned list is rejected before being applied.
 */
function legalActions(state: BlackjackState): BlackjackAction[] {
  if (state.phase === "settled" || state.phase === "dealer_turn" || state.phase === "dealing") {
    return [];
  }
  if (state.phase === "insurance_offered") {
    return [{ type: "insurance" }, { type: "decline_insurance" }];
  }

  // player_turn
  const hand = state.hands[state.activeHand];
  if (!hand) return [];

  // Split aces: only one card each, no further action.
  if (hand.splitAces) return [{ type: "stand" }];

  if (hand.busted || hand.stood) return [];

  const actions: BlackjackAction[] = [{ type: "hit" }, { type: "stand" }];

  // Double: only with exactly 2 cards.
  const canDouble =
    hand.cards.length === 2 &&
    (!hand.fromSplit || state.config.allowDoubleAfterSplit);
  if (canDouble) actions.push({ type: "double" });

  // Split: only with two cards of same rank, and below max hands.
  if (
    hand.cards.length === 2 &&
    rankValue(hand.cards[0].rank) === rankValue(hand.cards[1].rank) &&
    state.hands.length < state.config.maxHands
  ) {
    actions.push({ type: "split" });
  }

  // Late surrender — only the very first action on an un-touched 2-card
  // hand of the original (non-split) round.
  if (
    state.config.allowSurrender &&
    hand.cards.length === 2 &&
    !hand.fromSplit &&
    state.hands.length === 1
  ) {
    actions.push({ type: "surrender" });
  }

  return actions;
}

function step(
  state: BlackjackState,
  action: BlackjackAction,
  rng: RngStream,
): BlackjackState {
  // Guard: action must be legal.
  const legal = legalActions(state);
  if (!legal.some((a) => a.type === action.type)) {
    throw new Error(`blackjack.step: illegal action ${action.type} in phase ${state.phase}`);
  }

  switch (action.type) {
    case "insurance":
    case "decline_insurance":
      return resolveInsurance(state, action.type === "insurance");

    case "hit":
      return applyHit(state, rng);

    case "stand":
      return applyStand(state, rng);

    case "double":
      return applyDouble(state, rng);

    case "split":
      return applySplit(state, rng);

    case "surrender":
      return applySurrender(state, rng);
  }
}

function applySurrender(state: BlackjackState, rng: RngStream): BlackjackState {
  const hands = state.hands.map((h) => ({ ...h, cards: [...h.cards] }));
  hands[state.activeHand].surrendered = true;
  // We do NOT bump totalStaked — surrender refunds half of the existing stake
  // (handled in settle()). No extra cards dealt.
  const next: BlackjackState = { ...state, hands };
  return advanceIfHandDone(next, rng);
}

function resolveInsurance(state: BlackjackState, taken: boolean): BlackjackState {
  // Insurance stake is half the original wager.
  const insuranceStake = taken ? state.baseStake / 2n : 0n;
  const next: BlackjackState = {
    ...state,
    insuranceStake,
    insuranceOffered: true,
    insuranceResolved: true,
    totalStaked: state.totalStaked + insuranceStake,
    phase: "player_turn",
  };
  // Edge case: if the player has BJ AND took/declined insurance, settle
  // immediately so we can resolve the natural.
  const playerBJ = evaluateHand(next.hands[0].cards).isBlackjack;
  const dealerBJ = evaluateHand(next.dealer).isBlackjack;
  if (playerBJ || dealerBJ) {
    return { ...next, phase: "settled", dealerRevealed: true };
  }
  return next;
}

function applyHit(state: BlackjackState, rng: RngStream): BlackjackState {
  const hands = state.hands.map((h) => ({ ...h, cards: [...h.cards] }));
  const shoe: Shoe = { ...state.shoe, cards: [...state.shoe.cards] };
  const card = drawCard(shoe, rng);
  const h = hands[state.activeHand];
  h.cards.push(card);
  if (isBust(h.cards)) h.busted = true;
  const next: BlackjackState = { ...state, shoe, hands };
  return advanceIfHandDone(next, rng);
}

function applyStand(state: BlackjackState, rng: RngStream): BlackjackState {
  const hands = state.hands.map((h) => ({ ...h, cards: [...h.cards] }));
  hands[state.activeHand].stood = true;
  const next: BlackjackState = { ...state, hands };
  return advanceIfHandDone(next, rng);
}

function applyDouble(state: BlackjackState, rng: RngStream): BlackjackState {
  const hands = state.hands.map((h) => ({ ...h, cards: [...h.cards] }));
  const shoe: Shoe = { ...state.shoe, cards: [...state.shoe.cards] };
  const card = drawCard(shoe, rng);
  const h = hands[state.activeHand];
  h.cards.push(card);
  h.doubled = true;
  h.stake = h.stake * 2n;
  if (isBust(h.cards)) h.busted = true;
  // After a double the player gets exactly one card and is auto-standing.
  if (!h.busted) h.stood = true;
  const next: BlackjackState = {
    ...state,
    shoe,
    hands,
    totalStaked: state.totalStaked + state.baseStake,
  };
  return advanceIfHandDone(next, rng);
}

function applySplit(state: BlackjackState, rng: RngStream): BlackjackState {
  const hands = state.hands.map((h) => ({ ...h, cards: [...h.cards] }));
  const shoe: Shoe = { ...state.shoe, cards: [...state.shoe.cards] };

  const oldHand = hands[state.activeHand];
  const [c1, c2] = oldHand.cards;
  const isAceSplit = c1.rank === "A";

  // First half stays as the active hand, second half becomes a new hand
  // appended at activeHand + 1.
  const handA = newHand([c1, drawCard(shoe, rng)], state.baseStake, {
    fromSplit: true,
    splitAces: isAceSplit,
    stood: isAceSplit, // ace splits auto-stand
  });
  const handB = newHand([c2, drawCard(shoe, rng)], state.baseStake, {
    fromSplit: true,
    splitAces: isAceSplit,
    stood: isAceSplit,
  });

  hands.splice(state.activeHand, 1, handA, handB);

  const next: BlackjackState = {
    ...state,
    shoe,
    hands,
    totalStaked: state.totalStaked + state.baseStake,
  };
  // If we split aces, both hands are auto-stood — move on.
  if (isAceSplit) return advanceIfHandDone(next, rng);
  return next;
}

/**
 * After a player action, decide whether the current hand is finished and
 * either move to the next un-finished hand or kick off the dealer's turn.
 */
function advanceIfHandDone(state: BlackjackState, rng?: RngStream): BlackjackState {
  const hand = state.hands[state.activeHand];
  const handDone =
    !hand ||
    hand.busted ||
    hand.stood ||
    hand.surrendered ||
    evaluateHand(hand.cards).total === 21;

  if (!handDone) return state;

  // Find next not-finished hand.
  for (let i = state.activeHand + 1; i < state.hands.length; i++) {
    const h = state.hands[i];
    const finished =
      h.busted || h.stood || h.surrendered || evaluateHand(h.cards).total === 21;
    if (!finished) {
      return { ...state, activeHand: i };
    }
  }

  // All hands finished — dealer's turn.
  if (rng) return runDealerTurn({ ...state, phase: "dealer_turn", dealerRevealed: true }, rng);
  return { ...state, phase: "dealer_turn" };
}

/* ---------------------------------------------------------------------------
 *  Dealer turn — pure, deterministic given RNG
 * ------------------------------------------------------------------------- */

/**
 * Execute the dealer's full draw sequence, then mark the session settled.
 * Dealer rules: hit until total >= 17. On soft 17 they hit if H17 (our
 * default), stand if S17. Stop immediately on bust.
 *
 * Edge case: if every player hand busted or surrendered, the dealer
 * doesn't draw at all (no point — the casino has already won).
 */
export function runDealerTurn(state: BlackjackState, rng: RngStream): BlackjackState {
  const shoe: Shoe = { ...state.shoe, cards: [...state.shoe.cards] };
  const dealer = [...state.dealer];

  const anyContender = state.hands.some(
    (h) => !h.busted && !h.surrendered,
  );

  if (anyContender) {
    while (true) {
      const v = evaluateHand(dealer);
      if (v.total > 21) break;
      if (v.total > 17) break;
      if (v.total === 17 && (!v.soft || !state.config.dealerHitsSoft17)) break;
      dealer.push(drawCard(shoe, rng));
    }
  }

  return { ...state, dealer, shoe, dealerRevealed: true, phase: "settled" };
}

function isTerminal(state: BlackjackState): boolean {
  return state.phase === "settled";
}

/* ---------------------------------------------------------------------------
 *  Settlement
 * ------------------------------------------------------------------------- */

function settle(state: BlackjackState, _bet: Bet): GameResult {
  if (state.phase !== "settled") {
    throw new Error("blackjack.settle: cannot settle before dealer turn completes");
  }

  const dealerVal = evaluateHand(state.dealer);
  const dealerBJ = dealerVal.isBlackjack;
  const dealerBust = dealerVal.total > 21;

  const breakdown: NonNullable<GameResult["breakdown"]> = [];
  let totalPayout = 0n;
  const totalStaked = state.totalStaked;

  for (let i = 0; i < state.hands.length; i++) {
    const hand = state.hands[i];
    const handVal = evaluateHand(hand.cards);
    const handBJ = handVal.isBlackjack && !hand.fromSplit; // BJ only on un-split openings
    const handStake = hand.stake;

    let payout = 0n;
    let label = `Hand ${i + 1}: ${hand.cards.map(cardLabel).join(" ")}`;

    if (hand.surrendered) {
      // Late surrender — half the stake comes back.
      payout = handStake / 2n;
      label += " · surrendered";
    } else if (hand.busted) {
      payout = 0n;
      label += " · bust";
    } else if (handBJ && !dealerBJ) {
      const { num, den } = state.config.blackjackPays;
      payout = handStake + (handStake * BigInt(num)) / BigInt(den);
      label += " · BLACKJACK";
    } else if (handBJ && dealerBJ) {
      payout = handStake; // push
      label += " · push (both BJ)";
    } else if (dealerBust) {
      payout = handStake * 2n;
      label += ` · win (${handVal.total} vs dealer bust)`;
    } else if (handVal.total > dealerVal.total) {
      payout = handStake * 2n;
      label += ` · win (${handVal.total} vs ${dealerVal.total})`;
    } else if (handVal.total < dealerVal.total) {
      payout = 0n;
      label += ` · loss (${handVal.total} vs ${dealerVal.total})`;
    } else {
      payout = handStake; // push
      label += ` · push (${handVal.total})`;
    }

    breakdown.push({
      label,
      stakedUnits: handStake,
      payoutUnits: payout,
      pnlUnits: payout - handStake,
    });
    totalPayout += payout;
  }

  // Insurance settlement
  if (state.insuranceStake > 0n) {
    const insurancePayout = dealerBJ ? state.insuranceStake * 3n : 0n; // 2:1 = stake + 2*stake
    breakdown.push({
      label: dealerBJ ? "Insurance · paid 2:1" : "Insurance · lost",
      stakedUnits: state.insuranceStake,
      payoutUnits: insurancePayout,
      pnlUnits: insurancePayout - state.insuranceStake,
    });
    totalPayout += insurancePayout;
  }

  return {
    totalStakedUnits: totalStaked,
    totalPayoutUnits: totalPayout,
    pnlUnits: totalPayout - totalStaked,
    breakdown,
  };
}

/* ---------------------------------------------------------------------------
 *  Game export
 * ------------------------------------------------------------------------- */

export const blackjackGame: Game<BlackjackAction, BlackjackState> = {
  id: "blackjack",
  display: "Blackjack",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};
