/* ===========================================================================
 *  MoneyFund Casino — Coinflip (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  The simplest provably-fair casino game. Player picks heads or tails,
 *  stakes an amount, the HMAC RNG produces a single byte, byte & 1 selects
 *  the outcome.
 *
 *  Math:
 *    • Even-money game, RTP = 1 - houseEdge.
 *    • Payout multiplier on win: M = 2 * (1 - houseEdge).
 *    • Default 1% house edge → M = 1.98 (you wager 100, win 98 + your 100 back).
 *
 *  The game state is terminal immediately after `initialState` — there are
 *  no follow-up actions. The session driver opens the session, sees the
 *  state is terminal, and settles right away. The UI overlays the coin
 *  animation on top of a pre-determined outcome.
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

/* ---------------------------------------------------------------------------
 *  Public surface
 * ------------------------------------------------------------------------- */

export type CoinSide = "heads" | "tails";

export interface CoinflipAction {
  // Coinflip has no follow-up actions. This type exists only so we can
  // satisfy the `Game<Action, State>` shape and write the action union
  // into audit logs.
  type: "noop";
}

export interface CoinflipConfig {
  /** House edge in basis points. 100 = 1%. Default 100. */
  houseEdgeBps: number;
}

export const DEFAULT_COINFLIP_CONFIG: CoinflipConfig = {
  houseEdgeBps: 100,
};

export interface CoinflipState {
  config: CoinflipConfig;
  /** What the player called before the flip. */
  prediction: CoinSide;
  /** What landed. */
  result: CoinSide;
  /** Raw RNG byte for verification UX. */
  resultByte: number;
  /** Multiplier we'll pay back to the player on a win (denominator = 10000). */
  payoutNum: bigint;
  payoutDen: bigint;
  /** Snapshot of the stake (so settle() doesn't depend on Bet). */
  stake: bigint;
  phase: "settled";
}

/* ---------------------------------------------------------------------------
 *  Implementation
 * ------------------------------------------------------------------------- */

function mergeConfig(raw: Record<string, unknown> | undefined): CoinflipConfig {
  if (!raw) return { ...DEFAULT_COINFLIP_CONFIG };
  return {
    ...DEFAULT_COINFLIP_CONFIG,
    ...(raw as Partial<CoinflipConfig>),
  };
}

/**
 * Build the (immediately terminal) opening state. Consumes exactly one
 * byte of RNG. The prediction comes from `bet.config.prediction` — the
 * UI sets that when constructing the bet.
 */
function initialState(bet: Bet, rng: RngStream): CoinflipState {
  const config = mergeConfig(bet.config);
  const raw = (bet.config ?? {}) as { prediction?: CoinSide };
  const prediction: CoinSide = raw.prediction === "tails" ? "tails" : "heads";

  const resultByte = rng.nextByte();
  // LSB selects the side. We document this exactly here so verifiers in
  // other languages can reproduce: byte & 1 == 0 → heads, == 1 → tails.
  const result: CoinSide = (resultByte & 1) === 0 ? "heads" : "tails";

  // Payout multiplier as exact bigint fraction:
  //   M = (20000 - 2 * houseEdgeBps) / 10000
  // Default: (20000 - 200)/10000 = 19800/10000 = 1.98×
  const payoutNum = BigInt(20000 - 2 * config.houseEdgeBps);
  const payoutDen = 10000n;

  return {
    config,
    prediction,
    result,
    resultByte,
    payoutNum,
    payoutDen,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: CoinflipState): CoinflipAction[] {
  return [];
}

function step(state: CoinflipState, _action: CoinflipAction, _rng: RngStream): CoinflipState {
  throw new Error("coinflip.step: no actions are valid; state is terminal after initialState");
}

function isTerminal(state: CoinflipState): boolean {
  return state.phase === "settled";
}

function settle(state: CoinflipState, _bet: Bet): GameResult {
  const won = state.result === state.prediction;
  const payout = won ? (state.stake * state.payoutNum) / state.payoutDen : 0n;
  return {
    totalStakedUnits: state.stake,
    totalPayoutUnits: payout,
    pnlUnits: payout - state.stake,
    breakdown: [
      {
        label: won
          ? `Called ${state.prediction} · landed ${state.result} · win`
          : `Called ${state.prediction} · landed ${state.result} · loss`,
        stakedUnits: state.stake,
        payoutUnits: payout,
        pnlUnits: payout - state.stake,
      },
    ],
  };
}

export const coinflipGame: Game<CoinflipAction, CoinflipState> = {
  id: "coinflip",
  display: "Coinflip",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/* ---------------------------------------------------------------------------
 *  Helpers exposed for UI (e.g. RTP labels)
 * ------------------------------------------------------------------------- */

export function rtpPercent(config: CoinflipConfig = DEFAULT_COINFLIP_CONFIG): number {
  return 100 - config.houseEdgeBps / 100;
}

export function multiplierFor(config: CoinflipConfig = DEFAULT_COINFLIP_CONFIG): number {
  return (20000 - 2 * config.houseEdgeBps) / 10000;
}
