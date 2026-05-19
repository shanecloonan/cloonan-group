/* ===========================================================================
 *  MoneyFund Casino — Mines (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  The flagship crypto-casino skill game. A 5×5 grid hides M mines (player
 *  picks M ∈ [1, 24]). The player reveals tiles one at a time. Each safe
 *  reveal advances a live multiplier; one mine ends the round at 0×.
 *  At any point the player may cash out for `stake × multiplier`.
 *
 *  Provable fairness:
 *    - Mine positions are committed BEFORE the player makes any pick.
 *    - The engine consumes a Fisher–Yates shuffle of `[0, 25)` from the
 *      RNG stream, then takes the first M positions as mines.
 *    - The server seed hash is published at session open. When the seed
 *      is revealed, anyone can recompute the exact mine layout and verify
 *      that the dealer didn't move mines to dodge the player.
 *
 *  Multiplier math (1% house edge):
 *    After k safe picks with M mines on a 25-tile grid, the chance of
 *    surviving k picks from a fresh board is:
 *        P(survive k | M mines) = C(25-M, k) / C(25, k)
 *    A fair payout would be `1 / P(survive k)`. We apply a 1% edge:
 *        m_k = 0.99 · C(25, k) / C(25-M, k)
 *    so the expected return of "pick exactly k, then cash out" is
 *    P(survive k) · m_k = 0.99 — independent of k. The house edge is a
 *    flat 1% no matter how the player plays.
 *
 *  RNG consumption: one Fisher–Yates shuffle of 25 tiles up front. The
 *  shuffle deterministically locks the layout at session open, so picks
 *  themselves consume no further RNG (the layout is already revealed in
 *  state for the engine, just hidden from the UI).
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

/* ---------------------------------------------------------------------------
 *  Public types
 * ------------------------------------------------------------------------- */

export interface MinesConfig {
  /** Grid is GRID×GRID. Locked at 5 for v1 — the math + UI is sized for it. */
  gridSize: number;
  /** Number of mines. Must be in [1, gridSize² - 1]. */
  mines: number;
  /** House edge in basis points (default 100 = 1%). */
  houseEdgeBps: number;
}

export const GRID_SIZE = 5;
export const TOTAL_TILES = GRID_SIZE * GRID_SIZE; // 25
export const MAX_MINES = TOTAL_TILES - 1; // 24
export const MIN_MINES = 1;

export const DEFAULT_MINES_CONFIG: MinesConfig = {
  gridSize: GRID_SIZE,
  mines: 3,
  houseEdgeBps: 100,
};

export interface MinesBetParams {
  mines?: number;
  houseEdgeBps?: number;
}

export type MinesPhase = "running" | "cashed_out" | "exploded";

export interface MinesState {
  config: MinesConfig;
  stake: bigint;
  /** Sorted list of mine tile indices in [0, 25). Hidden from the UI until
   *  terminal (the table component reads only `revealed`). */
  mineLayout: number[];
  /** Tile indices the player has revealed (in pick order). */
  revealed: number[];
  /** How many safe picks the player has made (`revealed.length` unless
   *  the last pick hit a mine). */
  picks: number;
  /** Current cash-out multiplier (display). 0× if exploded. */
  multiplier: number;
  /** Multiplier scaled by 1e6 for exact bigint payout math. */
  multiplierMicro: bigint;
  phase: MinesPhase;
  /** If the player exploded, the tile that ended the round. */
  hitMine: number | null;
}

export type MinesAction =
  | { type: "pick"; tile: number }
  | { type: "cashout" };

/* ---------------------------------------------------------------------------
 *  Combinatorial multiplier math
 * ------------------------------------------------------------------------- */

/** C(n, k) as exact bigint. Cached. */
const BINOM_CACHE = new Map<string, bigint>();
export function minesBinomial(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  if (k === 0 || k === n) return 1n;
  if (k > n - k) k = n - k;
  const key = `${n}:${k}`;
  const hit = BINOM_CACHE.get(key);
  if (hit !== undefined) return hit;
  let num = 1n;
  let den = 1n;
  for (let i = 0; i < k; i++) {
    num *= BigInt(n - i);
    den *= BigInt(i + 1);
  }
  const out = num / den;
  BINOM_CACHE.set(key, out);
  return out;
}

/**
 * Probability of surviving exactly k safe picks with M mines on a
 * `gridSize²` board, from a fresh layout:
 *
 *   P = C(T - M, k) / C(T, k)
 *
 * where T = gridSize². Returns 0 if the request is infeasible (k > T-M).
 */
export function minesSurvivalProbability(
  mines: number,
  picks: number,
  gridSize = GRID_SIZE,
): number {
  const T = gridSize * gridSize;
  if (picks <= 0) return 1.0;
  if (picks > T - mines) return 0;
  const num = minesBinomial(T - mines, picks);
  const den = minesBinomial(T, picks);
  return Number(num) / Number(den);
}

/**
 * Display multiplier after k safe picks (1% edge by default):
 *
 *   m_k = (10000 - houseEdgeBps) / 10000  ·  C(T, k) / C(T - M, k)
 *
 * Returned as both a `number` (for UI) and `micro` scaled by 1e6 for
 * exact bigint payout math.
 */
export function minesMultiplier(
  mines: number,
  picks: number,
  houseEdgeBps: number = DEFAULT_MINES_CONFIG.houseEdgeBps,
  gridSize: number = GRID_SIZE,
): { value: number; micro: bigint } {
  if (picks <= 0) {
    return { value: 1.0, micro: 1_000_000n };
  }
  const T = gridSize * gridSize;
  if (picks > T - mines) {
    return { value: 0, micro: 0n };
  }
  const cTotal = minesBinomial(T, picks);
  const cSafe = minesBinomial(T - mines, picks);
  // Exact bigint math, scaled by 1e6:
  //   micro = floor( (10000 - hbp) · cTotal · 1_000_000 / (10000 · cSafe) )
  const edgeNum = BigInt(10000 - houseEdgeBps);
  const edgeDen = 10000n;
  const micro = (edgeNum * cTotal * 1_000_000n) / (edgeDen * cSafe);
  const value = Number(micro) / 1_000_000;
  return { value, micro };
}

/**
 * Full payout table: multiplier after each possible safe-pick count
 * `k = 1, 2, …, T-M`. UI uses this to render the "next-pick" multiplier
 * column. Returns plain numbers (use `minesMultiplier` for bigint).
 */
export function minesPayoutTable(
  mines: number,
  houseEdgeBps: number = DEFAULT_MINES_CONFIG.houseEdgeBps,
  gridSize: number = GRID_SIZE,
): number[] {
  const T = gridSize * gridSize;
  const out: number[] = [];
  for (let k = 1; k <= T - mines; k++) {
    out.push(minesMultiplier(mines, k, houseEdgeBps, gridSize).value);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 *  Provably-fair mine layout
 * ------------------------------------------------------------------------- */

/**
 * Fisher–Yates shuffle of `[0, T)` driven by the RNG stream, then take
 * the first M indices as mines. The shuffle uses unbiased rejection
 * sampling via `rng.nextInt(...)`, so the mine layout is uniformly
 * distributed over C(25, M) possibilities. Returns a sorted array of
 * mine tile indices.
 */
export function deriveMineLayout(rng: RngStream, mines: number, gridSize = GRID_SIZE): number[] {
  const T = gridSize * gridSize;
  if (mines < 1 || mines > T - 1) {
    throw new Error(`mines.deriveMineLayout: mines=${mines} out of [1, ${T - 1}]`);
  }
  const indices = Array.from({ length: T }, (_, i) => i);
  // We only need the first M of the shuffle, so we run M iterations.
  for (let i = 0; i < mines; i++) {
    const j = i + rng.nextInt(T - i); // pick from [i, T)
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices.slice(0, mines).sort((a, b) => a - b);
}

/* ---------------------------------------------------------------------------
 *  Game implementation
 * ------------------------------------------------------------------------- */

function mergeConfig(raw: Record<string, unknown> | undefined): MinesConfig {
  if (!raw) return { ...DEFAULT_MINES_CONFIG };
  const params = raw as MinesBetParams & Record<string, unknown>;
  const merged: MinesConfig = {
    gridSize: GRID_SIZE,
    mines: Number.isInteger(params.mines) ? Number(params.mines) : DEFAULT_MINES_CONFIG.mines,
    houseEdgeBps: Number.isInteger(params.houseEdgeBps)
      ? Number(params.houseEdgeBps)
      : DEFAULT_MINES_CONFIG.houseEdgeBps,
  };
  if (merged.mines < MIN_MINES || merged.mines > MAX_MINES) {
    throw new Error(`mines: mines=${merged.mines} must be in [${MIN_MINES}, ${MAX_MINES}]`);
  }
  if (merged.houseEdgeBps < 0 || merged.houseEdgeBps > 1000) {
    throw new Error(`mines: houseEdgeBps must be in [0, 1000]`);
  }
  return merged;
}

function initialState(bet: Bet, rng: RngStream): MinesState {
  const config = mergeConfig(bet.config);
  const mineLayout = deriveMineLayout(rng, config.mines, config.gridSize);
  return {
    config,
    stake: bet.stake,
    mineLayout,
    revealed: [],
    picks: 0,
    multiplier: 1.0,
    multiplierMicro: 1_000_000n,
    phase: "running",
    hitMine: null,
  };
}

function legalActions(state: MinesState): MinesAction[] {
  if (state.phase !== "running") return [];
  const out: MinesAction[] = [];
  const mineSet = new Set(state.mineLayout);
  const revealedSet = new Set(state.revealed);
  const T = state.config.gridSize * state.config.gridSize;
  // Cashout is only available after at least one safe pick.
  if (state.picks > 0) out.push({ type: "cashout" });
  // Any unrevealed tile is a legal pick. (We don't pre-filter mines —
  // picking a mine is a legal *action*, it just terminates the round.)
  for (let i = 0; i < T; i++) {
    if (!revealedSet.has(i)) out.push({ type: "pick", tile: i });
  }
  // ESLint-friendly: reference mineSet so it's not flagged as unused. The
  // distinction between mine/safe tiles is enforced inside `step`.
  void mineSet;
  return out;
}

function step(state: MinesState, action: MinesAction, _rng: RngStream): MinesState {
  if (state.phase !== "running") {
    throw new Error(`mines.step: state.phase=${state.phase} is terminal`);
  }
  if (action.type === "cashout") {
    if (state.picks === 0) {
      throw new Error("mines.cashout: must reveal at least one tile first");
    }
    return { ...state, phase: "cashed_out" };
  }
  // Pick action
  const T = state.config.gridSize * state.config.gridSize;
  if (!Number.isInteger(action.tile) || action.tile < 0 || action.tile >= T) {
    throw new Error(`mines.pick: tile ${action.tile} out of range [0, ${T})`);
  }
  if (state.revealed.includes(action.tile)) {
    throw new Error(`mines.pick: tile ${action.tile} already revealed`);
  }
  const isMine = state.mineLayout.includes(action.tile);
  if (isMine) {
    return {
      ...state,
      revealed: [...state.revealed, action.tile],
      phase: "exploded",
      hitMine: action.tile,
      multiplier: 0,
      multiplierMicro: 0n,
    };
  }
  // Safe pick — advance multiplier.
  const newPicks = state.picks + 1;
  const { value, micro } = minesMultiplier(
    state.config.mines,
    newPicks,
    state.config.houseEdgeBps,
    state.config.gridSize,
  );
  // If the player has cleared every safe tile (newPicks == T - mines),
  // we auto-cash-out — there's nothing left to pick.
  const allSafeCleared = newPicks >= T - state.config.mines;
  return {
    ...state,
    revealed: [...state.revealed, action.tile],
    picks: newPicks,
    multiplier: value,
    multiplierMicro: micro,
    phase: allSafeCleared ? "cashed_out" : "running",
  };
}

function isTerminal(state: MinesState): boolean {
  return state.phase === "cashed_out" || state.phase === "exploded";
}

function settle(state: MinesState, _bet: Bet): GameResult {
  if (!isTerminal(state)) {
    throw new Error("mines.settle: state is not terminal");
  }
  const won = state.phase === "cashed_out";
  const payout = won ? (state.stake * state.multiplierMicro) / 1_000_000n : 0n;
  const label = won
    ? `Cashed out at ${state.multiplier.toFixed(2)}× after ${state.picks} safe pick${state.picks === 1 ? "" : "s"}`
    : `Hit mine at tile ${state.hitMine} after ${state.picks} safe pick${state.picks === 1 ? "" : "s"}`;
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

export const minesGame: Game<MinesAction, MinesState> = {
  id: "mines",
  display: "Mines",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/* ---------------------------------------------------------------------------
 *  Strategy helpers
 * ------------------------------------------------------------------------- */

/**
 * Expected return of a "pick exactly k tiles then cash out" strategy.
 * With a flat 1% edge this equals 0.99 for every k. Useful sanity probe
 * for the UI and smoke test.
 */
export function expectedReturnAtK(mines: number, picks: number, houseEdgeBps = 100, gridSize = GRID_SIZE): number {
  if (picks <= 0) return 1.0;
  const survival = minesSurvivalProbability(mines, picks, gridSize);
  const m = minesMultiplier(mines, picks, houseEdgeBps, gridSize).value;
  return survival * m;
}
