/* ===========================================================================
 *  MoneyFund Casino — Baccarat (Punto Banco)
 *  ---------------------------------------------------------------------------
 *  Classic two-hand game: Player vs Banker, optional Tie side bet.
 *  Standard third-card tableau, 8-deck shoe, provably fair card draws.
 *
 *  Payouts (on winning spot):
 *    Player  1:1  (total return 2× stake)
 *    Banker  0.95:1 net (5% commission → 1.95× total return)
 *    Tie     8:1  (9× total return)
 *  Player/Banker bets push when the hand ties.
 * ========================================================================= */

import { buildShoe, drawCard, cardLabel } from "./deck";
import type { Bet, Card, Game, GameResult, Rank, RngStream, Shoe } from "./types";

export type BaccaratSpot = "player" | "banker" | "tie";
export type BaccaratWinner = "player" | "banker" | "tie";

export interface BaccaratAction {
  type: "noop";
}

export interface BaccaratConfig {
  numDecks: number;
}

export const DEFAULT_BACCARAT_CONFIG: BaccaratConfig = { numDecks: 8 };

export interface BaccaratState {
  config: BaccaratConfig;
  betSpot: BaccaratSpot;
  playerCards: Card[];
  bankerCards: Card[];
  winner: BaccaratWinner;
  playerTotal: number;
  bankerTotal: number;
  /** Whether a natural (8/9) ended drawing early. */
  natural: boolean;
  stake: bigint;
  phase: "settled";
}

function mergeConfig(raw: Record<string, unknown> | undefined): BaccaratConfig {
  if (!raw) return { ...DEFAULT_BACCARAT_CONFIG };
  const n = Number((raw as Partial<BaccaratConfig>).numDecks);
  return {
    numDecks: Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_BACCARAT_CONFIG.numDecks,
  };
}

/** Baccarat rank value: A=1, 2–9 face, 10/J/Q/K=0. */
export function baccaratCardValue(rank: Rank): number {
  if (rank === "A") return 1;
  if (rank === "10" || rank === "J" || rank === "Q" || rank === "K") return 0;
  return parseInt(rank, 10);
}

export function handTotal(cards: Card[]): number {
  let sum = 0;
  for (const c of cards) sum += baccaratCardValue(c.rank);
  return sum % 10;
}

function playerDrawsThird(playerTotal: number): boolean {
  return playerTotal <= 5;
}

function bankerDrawsThird(bankerTotal: number, playerThird: Card | null): boolean {
  if (playerThird === null) {
    return bankerTotal <= 5;
  }
  const p3 = baccaratCardValue(playerThird.rank);
  switch (bankerTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return p3 !== 8;
    case 4:
      return p3 >= 2 && p3 <= 7;
    case 5:
      return p3 >= 4 && p3 <= 7;
    case 6:
      return p3 === 6 || p3 === 7;
    default:
      return false;
  }
}

function dealHand(shoe: Shoe, rng: RngStream): { player: Card[]; banker: Card[]; natural: boolean } {
  const player: Card[] = [drawCard(shoe, rng), drawCard(shoe, rng)];
  const banker: Card[] = [drawCard(shoe, rng), drawCard(shoe, rng)];

  let pTotal = handTotal(player);
  let bTotal = handTotal(banker);

  if (pTotal >= 8 || bTotal >= 8) {
    return { player, banker, natural: true };
  }

  let playerThird: Card | null = null;
  if (playerDrawsThird(pTotal)) {
    playerThird = drawCard(shoe, rng);
    player.push(playerThird);
    pTotal = handTotal(player);
  }

  if (bankerDrawsThird(bTotal, playerThird)) {
    banker.push(drawCard(shoe, rng));
  }

  return { player, banker, natural: false };
}

function resolveWinner(playerTotal: number, bankerTotal: number): BaccaratWinner {
  if (playerTotal > bankerTotal) return "player";
  if (bankerTotal > playerTotal) return "banker";
  return "tie";
}

function initialState(bet: Bet, rng: RngStream): BaccaratState {
  const config = mergeConfig(bet.config);
  const raw = (bet.config ?? {}) as { betSpot?: BaccaratSpot };
  const betSpot: BaccaratSpot =
    raw.betSpot === "banker" || raw.betSpot === "tie" ? raw.betSpot : "player";

  const shoe = buildShoe(config.numDecks);
  const { player, banker, natural } = dealHand(shoe, rng);
  const playerTotal = handTotal(player);
  const bankerTotal = handTotal(banker);
  const winner = resolveWinner(playerTotal, bankerTotal);

  return {
    config,
    betSpot,
    playerCards: player,
    bankerCards: banker,
    winner,
    playerTotal,
    bankerTotal,
    natural,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: BaccaratState): BaccaratAction[] {
  return [];
}

function step(state: BaccaratState, _action: BaccaratAction, _rng: RngStream): BaccaratState {
  throw new Error("baccarat.step: terminal after deal");
}

function isTerminal(state: BaccaratState): boolean {
  return state.phase === "settled";
}

function settle(state: BaccaratState, _bet: Bet): GameResult {
  const { betSpot, winner, stake } = state;
  let payout = 0n;
  let label: string;

  if (winner === "tie") {
    if (betSpot === "tie") {
      payout = (stake * 9n) / 1n;
      label = `Tie ${state.playerTotal}–${state.bankerTotal} · tie bet wins 8:1`;
    } else {
      payout = stake;
      label = `Tie ${state.playerTotal}–${state.bankerTotal} · ${betSpot} bet pushes`;
    }
  } else if (betSpot === winner) {
    if (betSpot === "player") {
      payout = stake * 2n;
      label = `Player ${state.playerTotal} beats Banker ${state.bankerTotal}`;
    } else if (betSpot === "banker") {
      payout = (stake * 195n) / 100n;
      label = `Banker ${state.bankerTotal} beats Player ${state.playerTotal} (5% commission)`;
    } else {
      payout = 0n;
      label = `Tie bet lost — hand went ${winner}`;
    }
  } else if (betSpot === "tie") {
    payout = 0n;
    label = `${winner === "player" ? "Player" : "Banker"} wins · tie bet lost`;
  } else {
    payout = 0n;
    label = `${winner === "player" ? "Player" : "Banker"} wins · ${betSpot} bet lost`;
  }

  return {
    totalStakedUnits: stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - stake,
    breakdown: [
      {
        label,
        stakedUnits: stake,
        payoutUnits: payout,
        pnlUnits: payout - stake,
      },
    ],
  };
}

export const baccaratGame: Game<BaccaratAction, BaccaratState> = {
  id: "baccarat",
  display: "Baccarat",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/** Approximate RTP labels for UI (8-deck punto banco). */
export function baccaratRtpLabel(spot: BaccaratSpot): string {
  switch (spot) {
    case "player":
      return "≈98.76%";
    case "banker":
      return "≈98.94%";
    case "tie":
      return "≈85.64%";
  }
}

export function formatBaccaratCards(cards: Card[]): string {
  return cards.map(cardLabel).join(" ");
}
