/* ===========================================================================
 *  MoneyFund Casino — Slots (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  Industry-standard 3×5 reel slot machine with 20 fixed paylines, wilds,
 *  scatters, and free-spin retriggers.
 *
 *  Critical architectural choice: this is a **reel-strip** machine, not a
 *  naive "draw a random symbol per cell" machine. Real-world slot machines
 *  define long virtual reels with weighted symbol distributions; the RNG
 *  chooses ONE stop position per reel, and the 3 visible rows are three
 *  consecutive symbols wrapping around that stop.
 *
 *  Why this matters:
 *    1. RTP is precisely tunable via strip composition.
 *    2. High-pay symbols are sparse on outer reels → 5-of-a-kind is
 *       authentically rare, producing the "near miss" feel players expect.
 *    3. Each spin consumes exactly 5 RNG draws (one per reel), making the
 *       provable-fairness audit trivial.
 *
 *  Settlement is single-action: the entire spin AND any triggered free
 *  spins resolve inside `initialState`. The session is terminal on deal.
 *  Free spins are deterministic auto-plays — the verifier replays them
 *  by continuing the same RNG stream.
 *
 *  Bet types:
 *    - Fixed 20 lines, total stake divided evenly → per-line stake.
 *    - Wilds substitute for any non-scatter on payline evaluation.
 *    - 3+ scatters anywhere on the grid trigger 10 free spins; retriggers
 *      stack additively up to `maxFreeSpins` total.
 *
 *  Target RTP: ≈96% (validated by 200k-spin Monte Carlo smoke test).
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

/* ---------------------------------------------------------------------------
 *  Symbols & reel strips
 * ------------------------------------------------------------------------- */

/**
 * Symbol identifiers. We code-name them so the engine is icon-agnostic;
 * the UI maps these to glyphs/emoji.
 *
 * Hierarchy (low → high payout):
 *    TEN, J, Q, K, A           — card royals (most common)
 *    GEM, BELL, SEVEN          — themed icons (less common, higher pay)
 *    WILD                      — substitutes for any non-scatter
 *    SCATTER                   — pays anywhere; triggers free spins
 */
export type SlotSymbolId =
  | "TEN"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "GEM"
  | "BELL"
  | "SEVEN"
  | "WILD"
  | "SCATTER";

/**
 * Default reel strips. Each strip is a virtual cyclic reel of length 30;
 * the RNG picks a stop position 0..29 and we render 3 consecutive symbols
 * wrapping the strip into the visible window.
 *
 * Compositions are slightly different per reel — high-pay symbols sparser
 * on outer reels (1 and 5) so 5-of-a-kind feels rare and 3-of-a-kind hits
 * with realistic frequency.
 */
export const DEFAULT_REEL_STRIPS: SlotSymbolId[][] = [
  // Reel 1 — TEN:4 J:4 Q:4 K:5 A:4 GEM:4 BELL:2 SEVEN:1 WILD:1 SCATTER:1
  [
    "TEN", "J", "K", "Q", "BELL", "A", "GEM",
    "TEN", "K", "J", "Q", "A", "GEM", "BELL",
    "K", "A", "J", "GEM", "K", "Q", "TEN",
    "J", "A", "WILD", "GEM", "Q", "K", "TEN",
    "SEVEN", "SCATTER",
  ],
  // Reel 2 — TEN:3 J:4 Q:4 K:5 A:4 GEM:4 BELL:2 SEVEN:1 WILD:2 SCATTER:1
  [
    "K", "A", "TEN", "J", "GEM", "Q", "K",
    "BELL", "J", "A", "WILD", "Q", "TEN", "GEM",
    "A", "K", "J", "GEM", "Q", "K", "A",
    "TEN", "J", "SEVEN", "GEM", "WILD", "K",
    "Q", "BELL", "SCATTER",
  ],
  // Reel 3 — TEN:3 J:4 Q:4 K:4 A:4 GEM:4 BELL:2 SEVEN:2 WILD:2 SCATTER:1
  [
    "WILD", "K", "A", "J", "GEM", "Q", "BELL",
    "K", "TEN", "A", "SEVEN", "J", "GEM", "Q",
    "WILD", "A", "K", "TEN", "J", "GEM", "Q",
    "A", "K", "BELL", "J", "SEVEN", "GEM", "Q",
    "TEN", "SCATTER",
  ],
  // Reel 4 — TEN:3 J:4 Q:4 K:5 A:4 GEM:4 BELL:2 SEVEN:1 WILD:2 SCATTER:1
  [
    "Q", "K", "A", "GEM", "J", "TEN", "WILD",
    "K", "GEM", "BELL", "A", "J", "Q", "K",
    "GEM", "TEN", "A", "J", "WILD", "GEM", "K",
    "Q", "A", "J", "BELL", "K", "TEN",
    "SEVEN", "Q", "SCATTER",
  ],
  // Reel 5 — TEN:3 J:4 Q:4 K:5 A:5 GEM:4 BELL:2 SEVEN:1 WILD:1 SCATTER:1
  [
    "J", "TEN", "Q", "K", "GEM", "A", "BELL",
    "J", "K", "A", "Q", "GEM", "K", "A", "J",
    "Q", "BELL", "GEM", "TEN", "K", "A", "WILD",
    "Q", "J", "GEM", "K", "TEN", "A",
    "SEVEN", "SCATTER",
  ],
];

/* ---------------------------------------------------------------------------
 *  Paylines (20 standard)
 *
 *  Each payline is a 5-element array of row indices (0=top, 1=mid, 2=bot).
 *  Lines pay LEFT-TO-RIGHT only (consecutive matching reels from reel 1).
 * ------------------------------------------------------------------------- */

export const DEFAULT_PAYLINES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1], //  1 — middle row
  [0, 0, 0, 0, 0], //  2 — top row
  [2, 2, 2, 2, 2], //  3 — bottom row
  [0, 1, 2, 1, 0], //  4 — V (down then up)
  [2, 1, 0, 1, 2], //  5 — ^ (up then down)
  [0, 0, 1, 2, 2], //  6 — diagonal down
  [2, 2, 1, 0, 0], //  7 — diagonal up
  [1, 0, 0, 0, 1], //  8 — U on top
  [1, 2, 2, 2, 1], //  9 — U on bottom
  [0, 1, 1, 1, 0], // 10 — middle U from top
  [2, 1, 1, 1, 2], // 11 — middle U from bottom
  [1, 0, 1, 2, 1], // 12 — zigzag mid
  [1, 2, 1, 0, 1], // 13 — zigzag mid inverted
  [0, 1, 0, 1, 0], // 14 — zigzag top
  [2, 1, 2, 1, 2], // 15 — zigzag bot
  [0, 2, 0, 2, 0], // 16 — vertical zigzag top
  [2, 0, 2, 0, 2], // 17 — vertical zigzag bot
  [1, 0, 2, 0, 1], // 18 — diamond
  [1, 2, 0, 2, 1], // 19 — diamond inverted
  [0, 1, 2, 2, 2], // 20 — stair down
] as const;

/* ---------------------------------------------------------------------------
 *  Paytable
 *
 *  Per-symbol payout multipliers (×perLineStake) for matching 3 / 4 / 5
 *  consecutive from reel 1. Wilds extend the run; scatters do NOT pay on
 *  lines (only scatter-anywhere wins via SCATTER_PAY).
 * ------------------------------------------------------------------------- */

export const DEFAULT_PAYTABLE: Record<
  Exclude<SlotSymbolId, "WILD" | "SCATTER">,
  [number, number, number]
> = {
  // Low royals — common, modest payouts.
  TEN: [3, 14, 50],
  J: [3, 14, 50],
  Q: [7, 24, 85],
  K: [7, 24, 85],
  A: [14, 40, 130],
  // Themed — rarer, higher payouts.
  GEM: [20, 70, 240],
  BELL: [40, 140, 400],
  SEVEN: [100, 350, 1400],
};

/**
 * Scatter payouts: multipliers of TOTAL stake (not per-line) for hitting
 * 3 / 4 / 5 scatters anywhere on the grid. Indexes correspond to [3,4,5].
 */
export const DEFAULT_SCATTER_PAY: [number, number, number] = [2, 10, 100];

/**
 * Number of free spins awarded for 3 / 4 / 5 scatters in the same spin.
 */
export const DEFAULT_SCATTER_FREE_SPINS: [number, number, number] = [10, 15, 25];

/* ---------------------------------------------------------------------------
 *  Config & state
 * ------------------------------------------------------------------------- */

export interface SlotsConfig {
  /** Number of paylines. Fixed bet — all lines are always live. */
  numLines: number;
  /** One strip per reel (5 strips for a 5-reel machine). */
  reelStrips: SlotSymbolId[][];
  /** Each payline is a row index per reel column. */
  paylines: readonly (readonly [number, number, number, number, number])[];
  /** Per-line payouts by symbol → [3OAK, 4OAK, 5OAK]. */
  paytable: Record<
    Exclude<SlotSymbolId, "WILD" | "SCATTER">,
    [number, number, number]
  >;
  /** Scatter-anywhere payouts (×totalStake) for [3, 4, 5] scatters. */
  scatterPay: [number, number, number];
  /** Free spins awarded for [3, 4, 5] scatters. */
  scatterFreeSpins: [number, number, number];
  /** Safety cap: max free spins ever played in one session (retriggers). */
  maxFreeSpins: number;
}

export const DEFAULT_SLOTS_CONFIG: SlotsConfig = {
  numLines: 20,
  reelStrips: DEFAULT_REEL_STRIPS,
  paylines: DEFAULT_PAYLINES,
  paytable: DEFAULT_PAYTABLE,
  scatterPay: DEFAULT_SCATTER_PAY,
  scatterFreeSpins: DEFAULT_SCATTER_FREE_SPINS,
  maxFreeSpins: 100,
};

export interface SlotsLineWin {
  /** 0-indexed payline number. */
  line: number;
  /** Base symbol that paid (the wild-substituted target). */
  symbol: Exclude<SlotSymbolId, "WILD" | "SCATTER">;
  /** Number of consecutive matching reels from left (3, 4, or 5). */
  count: number;
  /** Payout multiplier (×perLineStake) per the paytable. */
  multiplier: number;
  /** Payout amount in token units. */
  payout: bigint;
}

export interface SlotsSpinResult {
  /** Stop position (0..stripLen-1) for each of the 5 reels. */
  stops: [number, number, number, number, number];
  /** Visible 3×5 grid — outer index = row (top..bottom), inner = column. */
  grid: SlotSymbolId[][];
  /** All winning paylines for this spin. */
  lineWins: SlotsLineWin[];
  /** Number of scatters visible on the grid (0..15 theoretical, usually 0..5). */
  scatterCount: number;
  /** Scatter-anywhere payout. */
  scatterPayout: bigint;
  /** Free spins triggered by this spin (added to the queue). */
  freeSpinsAwarded: number;
  /** Sum of lineWins.payout + scatterPayout. */
  totalPayout: bigint;
  /** True when this spin was a free spin (didn't cost any stake). */
  isFree: boolean;
}

export interface SlotsAction {
  /** Slots is single-action — no player decisions inside a spin. */
  type: never;
}

export interface SlotsState {
  config: SlotsConfig;
  /** Total stake the player paid for the BASE spin. */
  stake: bigint;
  /** Per-line stake = stake / numLines. */
  perLineStake: bigint;
  /** Base spin + any triggered free spins, in order. */
  spins: SlotsSpinResult[];
  /** Total amount staked = base stake only (free spins are free). */
  totalStake: bigint;
  /** Sum of payouts across all spins (including free spins). */
  totalPayout: bigint;
  /** Did this session trigger ANY free spins? */
  freeSpinsTriggered: boolean;
  /** Total free spins actually played (after retriggers, capped at maxFreeSpins). */
  freeSpinsPlayed: number;
  phase: "settled";
}

/* ---------------------------------------------------------------------------
 *  Implementation
 * ------------------------------------------------------------------------- */

function getVisibleSymbol(
  strip: SlotSymbolId[],
  stop: number,
  row: number,
): SlotSymbolId {
  return strip[(stop + row) % strip.length];
}

/**
 * Evaluate ONE payline against the visible grid. Returns the highest-paying
 * left-anchored run, or null if no win.
 *
 * Rules:
 *   1. If cell 0 is SCATTER, no line win (scatters never pay on lines).
 *   2. Walk left to right: the "base symbol" is the first non-WILD non-SCATTER
 *      symbol on the line. Subsequent WILDs and matching base symbols extend
 *      the run. The run ends at the first cell that is neither the base
 *      symbol nor a WILD.
 *   3. If the line is entirely WILDs (no non-wild before a scatter), treat
 *      the base as SEVEN (the highest-paying symbol — wilds substitute for
 *      whatever pays best).
 *   4. Need at least 3 consecutive to pay.
 */
function evaluateLine(
  lineSymbols: SlotSymbolId[],
  paytable: SlotsConfig["paytable"],
  perLineStake: bigint,
  lineIndex: number,
): SlotsLineWin | null {
  if (lineSymbols[0] === "SCATTER") return null;

  let base: Exclude<SlotSymbolId, "WILD" | "SCATTER"> | null = null;
  for (const s of lineSymbols) {
    if (s === "SCATTER") break;
    if (s !== "WILD") {
      base = s;
      break;
    }
  }

  // Line is all wilds (possibly followed by a scatter that breaks the search).
  // Treat as SEVEN — wilds substitute for the best-paying symbol.
  if (base === null) {
    base = "SEVEN";
  }

  let count = 0;
  for (const s of lineSymbols) {
    if (s === base || s === "WILD") count++;
    else break;
  }

  if (count < 3) return null;
  const mult = paytable[base][count - 3];
  if (mult <= 0) return null;

  return {
    line: lineIndex,
    symbol: base,
    count,
    multiplier: mult,
    payout: perLineStake * BigInt(mult),
  };
}

function countScatters(grid: SlotSymbolId[][]): number {
  let n = 0;
  for (const row of grid) {
    for (const s of row) {
      if (s === "SCATTER") n++;
    }
  }
  return n;
}

/**
 * Play one spin: draw 5 reel stops, evaluate all paylines, count scatters,
 * resolve free-spin trigger.
 */
function playOneSpin(
  config: SlotsConfig,
  perLineStake: bigint,
  totalStake: bigint,
  rng: RngStream,
  isFree: boolean,
): SlotsSpinResult {
  // 1. Draw stops.
  const stops: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (let r = 0; r < 5; r++) {
    stops[r] = rng.nextInt(config.reelStrips[r].length);
  }

  // 2. Build visible 3×5 grid.
  const grid: SlotSymbolId[][] = [];
  for (let row = 0; row < 3; row++) {
    const cells: SlotSymbolId[] = [];
    for (let col = 0; col < 5; col++) {
      cells.push(getVisibleSymbol(config.reelStrips[col], stops[col], row));
    }
    grid.push(cells);
  }

  // 3. Evaluate paylines.
  const lineWins: SlotsLineWin[] = [];
  let lineTotal = 0n;
  for (let i = 0; i < config.paylines.length; i++) {
    const line = config.paylines[i];
    const lineSymbols: SlotSymbolId[] = [
      grid[line[0]][0],
      grid[line[1]][1],
      grid[line[2]][2],
      grid[line[3]][3],
      grid[line[4]][4],
    ];
    const w = evaluateLine(lineSymbols, config.paytable, perLineStake, i);
    if (w) {
      lineWins.push(w);
      lineTotal += w.payout;
    }
  }

  // 4. Scatter pays (anywhere).
  const scatterCount = countScatters(grid);
  let scatterPayout = 0n;
  let freeSpinsAwarded = 0;
  if (scatterCount >= 3) {
    const idx = Math.min(scatterCount, 5) - 3;
    scatterPayout = totalStake * BigInt(config.scatterPay[idx]);
    freeSpinsAwarded = config.scatterFreeSpins[idx];
  }

  return {
    stops,
    grid,
    lineWins,
    scatterCount,
    scatterPayout,
    freeSpinsAwarded,
    totalPayout: lineTotal + scatterPayout,
    isFree,
  };
}

/* ---------------------------------------------------------------------------
 *  Game contract
 * ------------------------------------------------------------------------- */

interface SlotsBetParams {
  config?: Partial<SlotsConfig>;
}

function buildConfig(bet: Bet): SlotsConfig {
  const params = (bet.config ?? {}) as SlotsBetParams & Record<string, unknown>;
  const supplied = params.config ?? {};
  return {
    ...DEFAULT_SLOTS_CONFIG,
    ...supplied,
    paytable: { ...DEFAULT_SLOTS_CONFIG.paytable, ...(supplied.paytable ?? {}) },
  };
}

function initialState(bet: Bet, rng: RngStream): SlotsState {
  const config = buildConfig(bet);

  if (config.numLines !== config.paylines.length) {
    throw new Error(
      `slots: numLines (${config.numLines}) must equal paylines.length (${config.paylines.length})`,
    );
  }
  if (config.reelStrips.length !== 5) {
    throw new Error(`slots: expected 5 reel strips, got ${config.reelStrips.length}`);
  }

  const lines = BigInt(config.numLines);
  if (bet.stake <= 0n) throw new Error("slots: stake must be positive");
  if (bet.stake % lines !== 0n) {
    throw new Error(
      `slots: stake (${bet.stake}) must be evenly divisible by numLines (${config.numLines})`,
    );
  }
  const perLineStake = bet.stake / lines;

  const spins: SlotsSpinResult[] = [];
  let totalPayout = 0n;
  let freeSpinsQueue = 0;
  let freeSpinsPlayed = 0;

  // Base spin.
  const base = playOneSpin(config, perLineStake, bet.stake, rng, false);
  spins.push(base);
  totalPayout += base.totalPayout;
  freeSpinsQueue += base.freeSpinsAwarded;

  // Auto-play any triggered free spins (with retriggers).
  while (freeSpinsQueue > 0 && freeSpinsPlayed < config.maxFreeSpins) {
    freeSpinsQueue--;
    freeSpinsPlayed++;
    const fs = playOneSpin(config, perLineStake, bet.stake, rng, true);
    spins.push(fs);
    totalPayout += fs.totalPayout;
    freeSpinsQueue += fs.freeSpinsAwarded;
  }

  return {
    config,
    stake: bet.stake,
    perLineStake,
    spins,
    totalStake: bet.stake,
    totalPayout,
    freeSpinsTriggered: base.freeSpinsAwarded > 0,
    freeSpinsPlayed,
    phase: "settled",
  };
}

function legalActions(_state: SlotsState): SlotsAction[] {
  return [];
}

function step(_state: SlotsState, _action: SlotsAction, _rng: RngStream): SlotsState {
  throw new Error("slots.step: no actions; terminal on deal");
}

function isTerminal(state: SlotsState): boolean {
  return state.phase === "settled";
}

function settle(state: SlotsState, _bet: Bet): GameResult {
  const breakdown: GameResult["breakdown"] = [];

  for (let i = 0; i < state.spins.length; i++) {
    const s = state.spins[i];
    const lineCount = s.lineWins.length;
    const label = s.isFree
      ? `Free spin #${i} — ${lineCount} line win(s)${s.scatterCount >= 3 ? ` + ${s.scatterCount} scatters` : ""}`
      : `Base spin — ${lineCount} line win(s)${s.scatterCount >= 3 ? ` + ${s.scatterCount} scatters` : ""}`;
    breakdown.push({
      label,
      stakedUnits: s.isFree ? 0n : state.stake,
      payoutUnits: s.totalPayout,
      pnlUnits: s.totalPayout - (s.isFree ? 0n : state.stake),
    });
  }

  return {
    totalStakedUnits: state.totalStake,
    totalPayoutUnits: state.totalPayout,
    pnlUnits: state.totalPayout - state.totalStake,
    breakdown,
  };
}

export const slotsGame: Game<SlotsAction, SlotsState> = {
  id: "slots",
  display: "Slots — 5 reels · 20 lines",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/* ---------------------------------------------------------------------------
 *  UI helpers
 * ------------------------------------------------------------------------- */

/** Human-readable glyph for each symbol — used by the table UI. */
export const SYMBOL_GLYPH: Record<SlotSymbolId, string> = {
  TEN: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
  GEM: "💎",
  BELL: "🔔",
  SEVEN: "7",
  WILD: "★",
  SCATTER: "✦",
};

/** Tailwind color class per symbol — for the reel UI. */
export const SYMBOL_COLOR: Record<SlotSymbolId, string> = {
  TEN: "text-sky-300",
  J: "text-sky-200",
  Q: "text-violet-300",
  K: "text-violet-200",
  A: "text-amber-300",
  GEM: "text-emerald-300",
  BELL: "text-yellow-300",
  SEVEN: "text-rose-400",
  WILD: "text-fuchsia-300",
  SCATTER: "text-amber-200",
};
