/* ===========================================================================
 *  MoneyFund Casino — Money Wheel (Dream Catcher layout)
 *  ---------------------------------------------------------------------------
 *  54-segment wheel: bet on 1×, 2×, 5×, 10×, 20×, or 40×. One RNG index
 *  picks the landing segment; win pays stake × multiplier (1% edge on wins).
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

export type WheelBetMult = 1 | 2 | 5 | 10 | 20 | 40;

export const WHEEL_BET_OPTIONS: readonly WheelBetMult[] = [1, 2, 5, 10, 20, 40] as const;

/** Standard live-casino segment counts (54 total). */
function buildSegments(): number[] {
  const seg: number[] = [];
  for (let i = 0; i < 24; i++) seg.push(1);
  for (let i = 0; i < 15; i++) seg.push(2);
  for (let i = 0; i < 7; i++) seg.push(5);
  for (let i = 0; i < 4; i++) seg.push(10);
  for (let i = 0; i < 2; i++) seg.push(20);
  for (let i = 0; i < 2; i++) seg.push(40);
  return seg;
}

export const WHEEL_SEGMENT_MULTS: readonly number[] = buildSegments();
export const WHEEL_SEGMENT_COUNT = WHEEL_SEGMENT_MULTS.length;

export interface WheelAction {
  type: "noop";
}

export interface WheelConfig {
  houseEdgeBps: number;
}

export const DEFAULT_WHEEL_CONFIG: WheelConfig = { houseEdgeBps: 100 };

export interface WheelState {
  config: WheelConfig;
  betOn: WheelBetMult;
  segmentIndex: number;
  landedMult: WheelBetMult;
  won: boolean;
  payoutNum: bigint;
  payoutDen: bigint;
  stake: bigint;
  phase: "settled";
}

export function segmentCountForMult(mult: WheelBetMult): number {
  return WHEEL_SEGMENT_MULTS.filter((m) => m === mult).length;
}

export function wheelWinChancePercent(mult: WheelBetMult): number {
  return (segmentCountForMult(mult) / WHEEL_SEGMENT_COUNT) * 100;
}

function normalizeBetMult(raw: unknown): WheelBetMult {
  const n = Number(raw);
  if (WHEEL_BET_OPTIONS.includes(n as WheelBetMult)) return n as WheelBetMult;
  return 1;
}

function initialState(bet: Bet, rng: RngStream): WheelState {
  const config = { ...DEFAULT_WHEEL_CONFIG, ...(bet.config as Partial<WheelConfig> | undefined) };
  const betOn = normalizeBetMult((bet.config as { betOn?: unknown })?.betOn);
  const segmentIndex = rng.nextInt(WHEEL_SEGMENT_COUNT);
  const landedMult = WHEEL_SEGMENT_MULTS[segmentIndex] as WheelBetMult;
  const won = landedMult === betOn;
  const payoutNum = BigInt(10000 - config.houseEdgeBps);
  const payoutDen = 10000n;

  return {
    config,
    betOn,
    segmentIndex,
    landedMult,
    won,
    payoutNum,
    payoutDen,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_state: WheelState): WheelAction[] {
  return [];
}

function step(state: WheelState, _action: WheelAction, _rng: RngStream): WheelState {
  throw new Error("wheel.step: terminal after spin");
}

function isTerminal(state: WheelState): boolean {
  return state.phase === "settled";
}

function settle(state: WheelState, _bet: Bet): GameResult {
  const payout = state.won
    ? (state.stake * BigInt(state.landedMult) * state.payoutNum) / state.payoutDen
    : 0n;
  const label = state.won
    ? `Bet ${state.betOn}× · landed ${state.landedMult}× · win`
    : `Bet ${state.betOn}× · landed ${state.landedMult}× · loss`;

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

export const wheelGame: Game<WheelAction, WheelState> = {
  id: "wheel",
  display: "Money Wheel",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

export function wheelRtpLabel(): string {
  return "≈96%";
}
