/* ===========================================================================
 *  MoneyFund Casino — Multiplayer Texas Hold'em (6-max, 1 human + 5 bots)
 *  ---------------------------------------------------------------------------
 *  Provably-fair deck via HMAC RNG. Human is always seat 0; bots act when
 *  it is not the human's turn (UI replays bot actions through the session
 *  driver so every step is auditable).
 * ========================================================================= */

import type { Bet, Card, Game, GameResult, RngStream, Shoe } from "./types";
import { buildShoe, cardLabel, drawCard } from "./deck";
import { bestHand, compareScores, describeScore, type HandScore } from "./poker-hands";

export const HUMAN_SEAT = 0;

export type PokerActionType = "fold" | "check" | "call" | "raise" | "advance_street";

export interface PokerAction {
  type: PokerActionType;
  /** Raise *to* this total bet for the round (not increment). */
  raiseTo?: bigint;
}

export interface PokerConfig {
  numSeats: number;
  smallBlind: bigint;
  bigBlind: bigint;
  /** House rake in basis points (100 = 1%). */
  rakeBps: number;
  humanSeat: number;
}

export const DEFAULT_POKER_CONFIG: PokerConfig = {
  numSeats: 6,
  smallBlind: 0n, // derived from buy-in in initialState
  bigBlind: 0n,
  rakeBps: 100,
  humanSeat: HUMAN_SEAT,
};

export interface PokerPlayer {
  seat: number;
  name: string;
  isHuman: boolean;
  hole: Card[];
  stack: bigint;
  betThisRound: bigint;
  totalCommitted: bigint;
  folded: boolean;
  allIn: boolean;
}

export type PokerPhase =
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "complete";

export interface PokerState {
  config: PokerConfig;
  /** Remaining deck — mutated in place as cards are dealt. */
  shoe: Shoe;
  players: PokerPlayer[];
  community: Card[];
  pot: bigint;
  phase: PokerPhase;
  dealerSeat: number;
  activeSeat: number | null;
  currentBet: bigint;
  minRaise: bigint;
  lastAggressor: number | null;
  /** Seats that still need to act this betting round. */
  actionQueue: number[];
  winners: { seat: number; amount: bigint; hand: string }[];
  startingHumanStack: bigint;
  message: string;
}

const BOT_NAMES = ["Viper", "Oracle", "Silk", "Razor", "Vault"];

function mergeConfig(bet: Bet): PokerConfig {
  const raw = (bet.config ?? {}) as Partial<PokerConfig>;
  const bb = raw.bigBlind ?? bet.stake / 50n;
  const sb = raw.smallBlind ?? bb / 2n;
  return {
    ...DEFAULT_POKER_CONFIG,
    ...raw,
    smallBlind: sb > 0n ? sb : 1n,
    bigBlind: bb > 0n ? bb : 2n,
    numSeats: raw.numSeats ?? 6,
    humanSeat: HUMAN_SEAT,
  };
}

function alivePlayers(state: PokerState): PokerPlayer[] {
  return state.players.filter((p) => !p.folded);
}

function canAct(p: PokerPlayer): boolean {
  return !p.folded && !p.allIn && p.stack > 0n;
}

function seatRight(seat: number, n: number): number {
  return (seat + 1) % n;
}

function firstToActPreflop(state: PokerState): number {
  const n = state.players.length;
  const utg = seatRight(seatRight(state.dealerSeat, n), n);
  return utg;
}

function firstToActPostflop(state: PokerState): number {
  const n = state.players.length;
  let s = seatRight(state.dealerSeat, n);
  for (let i = 0; i < n; i++) {
    const p = state.players[s];
    if (!p.folded && !p.allIn) return s;
    s = seatRight(s, n);
  }
  return s;
}

function buildActionQueue(state: PokerState, firstSeat: number): number[] {
  const n = state.players.length;
  const q: number[] = [];
  let s = firstSeat;
  for (let i = 0; i < n; i++) {
    const p = state.players[s];
    if (canAct(p) && p.betThisRound < state.currentBet) q.push(s);
    s = seatRight(s, n);
  }
  if (q.length === 0) {
    s = firstSeat;
    for (let i = 0; i < n; i++) {
      const p = state.players[s];
      if (canAct(p)) q.push(s);
      s = seatRight(s, n);
    }
  }
  return q;
}

function bettingRoundDone(state: PokerState): boolean {
  const active = alivePlayers(state).filter((p) => canAct(p) || p.allIn);
  if (active.length <= 1) return true;
  return active.every((p) => p.folded || p.allIn || p.betThisRound === state.currentBet);
}

function resetRoundBets(players: PokerPlayer[]): PokerPlayer[] {
  return players.map((p) => ({ ...p, betThisRound: 0n }));
}

function postBlind(players: PokerPlayer[], seat: number, amount: bigint): { players: PokerPlayer[]; pot: bigint } {
  const p = { ...players[seat] };
  const pay = amount > p.stack ? p.stack : amount;
  p.stack -= pay;
  p.betThisRound += pay;
  p.totalCommitted += pay;
  if (p.stack === 0n) p.allIn = true;
  const next = [...players];
  next[seat] = p;
  return { players: next, pot: pay };
}

function dealCommunity(shoe: Shoe, rng: RngStream, count: number): Card[] {
  void drawCard(shoe, rng); // burn
  const dealt: Card[] = [];
  for (let i = 0; i < count; i++) dealt.push(drawCard(shoe, rng));
  return dealt;
}

/** Advance to next street when a betting round is complete (no active seat). */
export function advancePokerRound(state: PokerState, rng: RngStream): PokerState {
  if (state.phase === "complete") return state;
  if (state.activeSeat !== null) return state;
  if (!bettingRoundDone(state)) return state;
  return advancePhase(state, rng);
}

function advancePhase(state: PokerState, rng: RngStream): PokerState {
  let { phase, community, players, pot, dealerSeat, shoe } = state;
  players = resetRoundBets(players);
  let currentBet = 0n;
  let minRaise = state.config.bigBlind;
  let activeSeat: number | null = null;
  let actionQueue: number[] = [];
  let message = state.message;

  if (phase === "preflop") {
    const flop = dealCommunity(shoe, rng, 3);
    phase = "flop";
    community = [...community, ...flop];
    activeSeat = firstToActPostflop({ ...state, community, phase, players });
    actionQueue = buildActionQueue({ ...state, community, phase, players, currentBet }, activeSeat);
    message = "Flop dealt";
  } else if (phase === "flop") {
    const card = dealCommunity(shoe, rng, 1);
    phase = "turn";
    community = [...community, ...card];
    activeSeat = firstToActPostflop({ ...state, community, phase, players });
    actionQueue = buildActionQueue({ ...state, community, phase, players, currentBet }, activeSeat);
    message = "Turn dealt";
  } else if (phase === "turn") {
    const card = dealCommunity(shoe, rng, 1);
    phase = "river";
    community = [...community, ...card];
    activeSeat = firstToActPostflop({ ...state, community, phase, players });
    actionQueue = buildActionQueue({ ...state, community, phase, players, currentBet }, activeSeat);
    message = "River dealt";
  } else if (phase === "river") {
    return runShowdown({ ...state, players, pot, community, phase: "showdown" });
  }

  return {
    ...state,
    shoe,
    phase,
    community,
    players,
    pot,
    dealerSeat,
    currentBet,
    minRaise,
    activeSeat,
    actionQueue,
    lastAggressor: null,
    message,
  };
}

function runShowdown(state: PokerState): PokerState {
  const remaining = alivePlayers(state);
  const scores: { seat: number; score: HandScore; label: string }[] = remaining.map((p) => {
    const cards = [...p.hole, ...state.community];
    const score = bestHand(cards);
    return { seat: p.seat, score, label: describeScore(score) };
  });

  let pot = state.pot;
  const rake = (pot * BigInt(state.config.rakeBps)) / 10000n;
  pot -= rake;

  scores.sort((a, b) => compareScores(b.score, a.score));
  const best = scores[0];
  const winners = scores.filter((s) => compareScores(s.score, best.score) === 0);
  const share = pot / BigInt(winners.length);
  let remainder = pot - share * BigInt(winners.length);

  const players = state.players.map((p) => ({ ...p }));
  const winRows: PokerState["winners"] = [];
  for (const w of winners) {
    const extra = remainder > 0n ? 1n : 0n;
    if (remainder > 0n) remainder -= 1n;
    players[w.seat].stack += share + extra;
    winRows.push({ seat: w.seat, amount: share + extra, hand: w.label });
  }

  const human = players[HUMAN_SEAT];
  const msg =
    winners.length === 1
      ? `${players[winners[0].seat].name} wins ${winRows[0].hand}`
      : `Split pot · ${winRows.map((r) => players[r.seat].name).join(" & ")}`;

  return {
    ...state,
    players,
    pot: 0n,
    phase: "complete",
    activeSeat: null,
    actionQueue: [],
    winners: winRows,
    message: msg + (rake > 0n ? ` · rake ${rake}` : ""),
  };
}

function applyActionToState(state: PokerState, seat: number, action: PokerAction): PokerState {
  const players = state.players.map((p) => ({ ...p }));
  const p = players[seat];
  let pot = state.pot;
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let lastAggressor = state.lastAggressor;
  let message = `${p.name} ${action.type}`;

  const toCall = currentBet - p.betThisRound;

  if (action.type === "fold") {
    p.folded = true;
  } else if (action.type === "check") {
    if (toCall > 0n) throw new Error("cannot check facing a bet");
  } else if (action.type === "call") {
    const pay = toCall > p.stack ? p.stack : toCall;
    p.stack -= pay;
    p.betThisRound += pay;
    p.totalCommitted += pay;
    pot += pay;
    if (p.stack === 0n) p.allIn = true;
  } else if (action.type === "raise") {
    const raiseTo = action.raiseTo ?? currentBet + minRaise;
    if (raiseTo <= currentBet) throw new Error("raise must exceed current bet");
    const need = raiseTo - p.betThisRound;
    const pay = need > p.stack ? p.stack : need;
    p.stack -= pay;
    p.betThisRound += pay;
    p.totalCommitted += pay;
    pot += pay;
    if (raiseTo - currentBet >= minRaise) minRaise = raiseTo - currentBet;
    currentBet = p.betThisRound;
    lastAggressor = seat;
    if (p.stack === 0n) p.allIn = true;
    message = `${p.name} raises to ${currentBet}`;
  }

  players[seat] = p;

  const alive = players.filter((pl) => !pl.folded);
  if (alive.length === 1) {
    const winner = alive[0];
    const rake = (pot * BigInt(state.config.rakeBps)) / 10000n;
    const payout = pot - rake;
    players[winner.seat].stack += payout;
    return {
      ...state,
      players,
      pot: 0n,
      phase: "complete",
      activeSeat: null,
      actionQueue: [],
      winners: [{ seat: winner.seat, amount: payout, hand: "Uncontested" }],
      message: `${winner.name} wins the pot`,
    };
  }

  let actionQueue = state.actionQueue.filter((s) => s !== seat);
  if (action.type === "raise") {
    const n = players.length;
    let s = seatRight(seat, n);
    actionQueue = [];
    for (let i = 0; i < n; i++) {
      const pl = players[s];
      if (canAct(pl) && pl.betThisRound < currentBet) actionQueue.push(s);
      s = seatRight(s, n);
    }
  }

  let activeSeat: number | null = null;
  if (actionQueue.length > 0) {
    activeSeat = actionQueue[0];
  } else if (bettingRoundDone({ ...state, players, currentBet })) {
    return { ...state, players, pot, currentBet, minRaise, lastAggressor, message, actionQueue: [], activeSeat: null };
  } else {
    const n = players.length;
    let s = seatRight(seat, n);
    for (let i = 0; i < n; i++) {
      if (canAct(players[s]) && !actionQueue.includes(s)) {
        activeSeat = s;
        break;
      }
      s = seatRight(s, n);
    }
  }

  return {
    ...state,
    players,
    pot,
    currentBet,
    minRaise,
    lastAggressor,
    message,
    actionQueue,
    activeSeat,
  };
}

function initialState(bet: Bet, rng: RngStream): PokerState {
  const config = mergeConfig(bet);
  const buyIn = bet.stake;
  const n = config.numSeats;

  const shoe = buildShoe(1);
  const players: PokerPlayer[] = [];
  for (let seat = 0; seat < n; seat++) {
    const hole = [drawCard(shoe, rng), drawCard(shoe, rng)];
    players.push({
      seat,
      name: seat === HUMAN_SEAT ? "You" : BOT_NAMES[seat - 1] ?? `Bot ${seat}`,
      isHuman: seat === HUMAN_SEAT,
      hole,
      stack: buyIn,
      betThisRound: 0n,
      totalCommitted: 0n,
      folded: false,
      allIn: false,
    });
  }

  const dealerSeat = rng.nextInt(n);
  const sbSeat = seatRight(dealerSeat, n);
  const bbSeat = seatRight(sbSeat, n);

  let pot = 0n;
  let afterSb = postBlind(players, sbSeat, config.smallBlind);
  pot += afterSb.pot;
  let afterBb = postBlind(afterSb.players, bbSeat, config.bigBlind);
  pot += afterBb.pot;
  const updatedPlayers = afterBb.players;

  const currentBet = updatedPlayers[bbSeat].betThisRound;
  const base: PokerState = {
    config,
    shoe,
    players: updatedPlayers,
    community: [],
    pot,
    phase: "preflop",
    dealerSeat,
    activeSeat: null,
    currentBet,
    minRaise: config.bigBlind,
    lastAggressor: bbSeat,
    actionQueue: [],
    winners: [],
    startingHumanStack: buyIn,
    message: "",
  };
  const activeSeat = firstToActPreflop(base);
  const actionQueue = buildActionQueue({ ...base, activeSeat }, activeSeat);

  return {
    ...base,
    phase: "preflop",
    dealerSeat,
    activeSeat,
    currentBet,
    minRaise: config.bigBlind,
    lastAggressor: bbSeat,
    actionQueue,
    winners: [],
    startingHumanStack: buyIn,
    message: "New hand — good luck",
  };
}

function legalActionsForSeat(state: PokerState, seat: number): PokerAction[] {
  if (state.phase === "complete" || state.phase === "showdown") return [];
  if (state.activeSeat !== seat) return [];
  const p = state.players[seat];
  if (!canAct(p)) return [];

  const toCall = state.currentBet - p.betThisRound;
  const actions: PokerAction[] = [{ type: "fold" }];

  if (toCall === 0n) {
    actions.push({ type: "check" });
  } else {
    actions.push({ type: "call" });
  }

  const minRaiseTo = state.currentBet + state.minRaise;
  const maxRaiseTo = p.betThisRound + p.stack;
  if (maxRaiseTo >= minRaiseTo && p.stack > toCall) {
    actions.push({ type: "raise", raiseTo: minRaiseTo });
    if (maxRaiseTo > minRaiseTo) {
      actions.push({ type: "raise", raiseTo: maxRaiseTo });
    }
  }

  return actions;
}

function legalActions(state: PokerState): PokerAction[] {
  return legalActionsForSeat(state, HUMAN_SEAT);
}

function step(state: PokerState, action: PokerAction, rng: RngStream): PokerState {
  if (state.phase === "complete") throw new Error("hand complete");

  if (action.type === "advance_street") {
    if (state.activeSeat !== null || !bettingRoundDone(state)) {
      throw new Error("advance_street: betting round not complete");
    }
    return advancePhase(state, rng);
  }

  const seat = state.activeSeat;
  if (seat === null) throw new Error("no active seat");

  let next = applyActionToState(state, seat, action);

  if (next.phase === "complete") return next;

  if (bettingRoundDone(next) && next.activeSeat === null) {
    return advancePhase(next, rng);
  }

  return next;
}

function isTerminal(state: PokerState): boolean {
  return state.phase === "complete";
}

function settle(state: PokerState, bet: Bet): GameResult {
  const human = state.players[HUMAN_SEAT];
  const payout = human.stack;
  const staked = state.startingHumanStack;
  return {
    totalStakedUnits: staked,
    totalPayoutUnits: payout,
    pnlUnits: payout - staked,
    breakdown: state.winners.map((w) => ({
      label: `${state.players[w.seat].name}: ${w.hand} · ${w.amount}`,
      stakedUnits: w.seat === HUMAN_SEAT ? staked : 0n,
      payoutUnits: w.seat === HUMAN_SEAT ? payout : 0n,
      pnlUnits: w.seat === HUMAN_SEAT ? payout - staked : 0n,
    })),
  };
}

/** Bot decision — deterministic from public state (audit replay uses logged actions). */
export function pickBotAction(state: PokerState): PokerAction {
  const seat = state.activeSeat;
  if (seat === null || seat === HUMAN_SEAT) return { type: "check" };
  const legal = legalActionsForSeat(state, seat);
  if (legal.length === 0) return { type: "fold" };
  const p = state.players[seat];
  const toCall = state.currentBet - p.betThisRound;
  const roll =
    (Number(state.pot % 1009n) + seat * 97 + state.community.length * 13 + Number(p.stack % 127n)) % 1000;
  let strength = 0.3;
  if (state.community.length >= 3) {
    const score = bestHand([...p.hole, ...state.community]);
    strength = (score.category + 1) / 9;
  } else {
    const r0 = p.hole[0].index % 13;
    const r1 = p.hole[1].index % 13;
    const pair = r0 === r1;
    const hi = Math.max(r0, r1);
    strength = pair ? 0.68 : 0.22 + (hi / 12) * 0.35;
  }
  const canRaise = legal.some((a) => a.type === "raise");
  const minRaise = legal.find((a) => a.type === "raise");

  if (strength < 0.22 && roll < 550 && legal.some((a) => a.type === "fold")) return { type: "fold" };
  if (toCall === 0n) {
    if (canRaise && strength > 0.62 && roll < 90 && minRaise) return minRaise;
    return legal.find((a) => a.type === "check") ?? legal[0];
  }
  if (toCall > p.stack / 3n && strength < 0.35 && legal.some((a) => a.type === "fold")) {
    return { type: "fold" };
  }
  if (canRaise && strength > 0.82 && roll < 60 && minRaise) return minRaise;
  if (strength < 0.18 && roll < 450 && legal.some((a) => a.type === "fold")) return { type: "fold" };
  return legal.find((a) => a.type === "call") ?? legal[0];
}

export const pokerGame: Game<PokerAction, PokerState> = {
  id: "poker",
  display: "Poker",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export { cardLabel };
