/* ===========================================================================
 *  MoneyFund Casino — European Roulette (Game Layer L3)
 *  ---------------------------------------------------------------------------
 *  37-pocket wheel (single-zero). House edge: exactly 1/37 ≈ 2.703% on every
 *  fair bet type. We don't need an explicit house-edge config: the edge is
 *  baked into each payout being "as if it were a 36-pocket wheel".
 *
 *  Player can place MANY simultaneous placements on a single spin. The
 *  engine sums each placement's payout into a single GameResult.
 *
 *  Bet types and payouts (canonical European rules):
 *
 *     kind             covers (count)   payout (to-1)
 *     straight              1               35
 *     split                 2               17
 *     street                3               11
 *     corner                4                8
 *     six_line              6                5
 *     trio                  3               11   (0,1,2 or 0,2,3)
 *     top_line              4                8   (0,1,2,3)
 *     red                  18                1
 *     black                18                1
 *     odd                  18                1
 *     even                 18                1
 *     low (1-18)           18                1
 *     high (19-36)         18                1
 *     dozen_1/2/3          12                2
 *     column_1/2/3         12                2
 *
 *  Win condition: winningPocket ∈ placement.numbers.
 *  Payout on win: amount × (payoutTo1 + 1). Stake is consumed on loss.
 *
 *  State is terminal on deal — one RNG byte consumed for the spin.
 * ========================================================================= */

import type { Bet, Game, GameResult, RngStream } from "./types";

/* ---------------------------------------------------------------------------
 *  Pocket layout & color map
 * ------------------------------------------------------------------------- */

export const RED_POCKETS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** Pocket color — "green" for 0, "red" / "black" otherwise. */
export function pocketColor(pocket: number): "red" | "black" | "green" {
  if (pocket === 0) return "green";
  return RED_POCKETS.has(pocket) ? "red" : "black";
}

/* ---------------------------------------------------------------------------
 *  Bet placement
 * ------------------------------------------------------------------------- */

export type RoulettePlacementKind =
  | "straight"
  | "split"
  | "street"
  | "corner"
  | "six_line"
  | "trio"
  | "top_line"
  | "red"
  | "black"
  | "odd"
  | "even"
  | "low"
  | "high"
  | "dozen_1"
  | "dozen_2"
  | "dozen_3"
  | "column_1"
  | "column_2"
  | "column_3";

export const PAYOUT_TO_ONE: Record<RoulettePlacementKind, number> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  six_line: 5,
  trio: 11,
  top_line: 8,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
  dozen_1: 2,
  dozen_2: 2,
  dozen_3: 2,
  column_1: 2,
  column_2: 2,
  column_3: 2,
};

/** Validate covered-number count matches the bet kind. */
const EXPECTED_COUNT: Record<RoulettePlacementKind, number> = {
  straight: 1, split: 2, street: 3, corner: 4, six_line: 6, trio: 3, top_line: 4,
  red: 18, black: 18, odd: 18, even: 18, low: 18, high: 18,
  dozen_1: 12, dozen_2: 12, dozen_3: 12,
  column_1: 12, column_2: 12, column_3: 12,
};

export interface RoulettePlacement {
  /** Kind determines the payout multiplier. */
  kind: RoulettePlacementKind;
  /** Concrete pocket numbers this placement covers (0..36). */
  numbers: number[];
  /** Stake in token units. */
  amount: bigint;
}

/**
 * Build a placement object with pre-filled `numbers` for fixed-shape kinds
 * (red/black/odd/even/low/high/dozens/columns). For arbitrary inside bets
 * (straight, split, street, corner, six_line, trio, top_line) the caller
 * must supply the numbers.
 */
export function placementFor(
  kind: RoulettePlacementKind,
  amount: bigint,
  numbers?: number[],
): RoulettePlacement {
  return { kind, amount, numbers: numbers ?? numbersForKind(kind) };
}

function numbersForKind(kind: RoulettePlacementKind): number[] {
  switch (kind) {
    case "red":      return [...RED_POCKETS].sort((a, b) => a - b);
    case "black":    return Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => !RED_POCKETS.has(n));
    case "odd":      return Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => n % 2 === 1);
    case "even":     return Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => n % 2 === 0);
    case "low":      return Array.from({ length: 18 }, (_, i) => i + 1);
    case "high":     return Array.from({ length: 18 }, (_, i) => i + 19);
    case "dozen_1":  return Array.from({ length: 12 }, (_, i) => i + 1);
    case "dozen_2":  return Array.from({ length: 12 }, (_, i) => i + 13);
    case "dozen_3":  return Array.from({ length: 12 }, (_, i) => i + 25);
    case "column_1": return [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
    case "column_2": return [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
    case "column_3": return [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
    default:
      throw new Error(`numbersForKind: ${kind} requires explicit numbers`);
  }
}

/* ---------------------------------------------------------------------------
 *  Game state
 * ------------------------------------------------------------------------- */

export interface RouletteAction {
  type: "noop";
}

export interface RouletteConfig {
  // No tunable house edge — the 0 pocket gives 2.703% on every fair bet.
  _placeholder?: never;
}

export const DEFAULT_ROULETTE_CONFIG: RouletteConfig = {};

export interface RouletteResultPerPlacement {
  kind: RoulettePlacementKind;
  numbers: number[];
  amount: bigint;
  won: boolean;
  /** Per-placement payout (0 if lost, amount*(payout+1) if won). */
  payout: bigint;
}

export interface RouletteState {
  config: RouletteConfig;
  /** Placements as supplied at session-open time. Frozen for the spin. */
  placements: RoulettePlacement[];
  /** Total amount risked = sum of placement.amount. */
  totalStake: bigint;
  /** The pocket the ball landed on. */
  pocket: number;
  /** Color of the landed pocket — denormalized for UI. */
  pocketColor: "red" | "black" | "green";
  /** Per-placement settlement details. */
  perPlacement: RouletteResultPerPlacement[];
  /** Sum of payouts (counts returned stake for wins). */
  totalPayout: bigint;
  stake: bigint;
  phase: "settled";
}

/* ---------------------------------------------------------------------------
 *  Implementation
 * ------------------------------------------------------------------------- */

function validatePlacement(p: RoulettePlacement): void {
  if (!Number.isFinite(Number(p.amount)) || p.amount <= 0n) {
    throw new Error(`roulette: placement.amount must be > 0, got ${p.amount}`);
  }
  if (!Array.isArray(p.numbers) || p.numbers.length === 0) {
    throw new Error(`roulette: placement.numbers must be non-empty for kind=${p.kind}`);
  }
  const expected = EXPECTED_COUNT[p.kind];
  if (p.numbers.length !== expected) {
    throw new Error(
      `roulette: placement kind=${p.kind} requires ${expected} numbers, got ${p.numbers.length}`,
    );
  }
  for (const n of p.numbers) {
    if (!Number.isInteger(n) || n < 0 || n > 36) {
      throw new Error(`roulette: placement number ${n} out of range [0,36]`);
    }
  }
}

interface RouletteBetParams {
  placements?: RoulettePlacement[];
}

function initialState(bet: Bet, rng: RngStream): RouletteState {
  const params = (bet.config ?? {}) as RouletteBetParams & Record<string, unknown>;
  // Placements can arrive with bigint stakes already, or with stake-as-string
  // from URL share-link revivers. Coerce defensively.
  const raw = params.placements ?? [];
  const placements: RoulettePlacement[] = raw.map((p) => ({
    kind: p.kind,
    numbers: p.numbers,
    amount: typeof p.amount === "bigint" ? p.amount : BigInt(p.amount as unknown as string),
  }));
  if (placements.length === 0) throw new Error("roulette: at least one placement required");
  for (const p of placements) validatePlacement(p);

  const totalStake = placements.reduce((s, p) => s + p.amount, 0n);
  if (totalStake !== bet.stake) {
    throw new Error(
      `roulette: sum of placement amounts (${totalStake}) must equal bet stake (${bet.stake})`,
    );
  }

  // Bias-free spin in [0, 37).
  const pocket = rng.nextInt(37);
  const color = pocketColor(pocket);

  const perPlacement: RouletteResultPerPlacement[] = placements.map((p) => {
    const won = p.numbers.includes(pocket);
    const mult = BigInt(PAYOUT_TO_ONE[p.kind] + 1); // payout multiplier including stake return
    const payout = won ? p.amount * mult : 0n;
    return { kind: p.kind, numbers: p.numbers, amount: p.amount, won, payout };
  });

  const totalPayout = perPlacement.reduce((s, r) => s + r.payout, 0n);

  return {
    config: DEFAULT_ROULETTE_CONFIG,
    placements,
    totalStake,
    pocket,
    pocketColor: color,
    perPlacement,
    totalPayout,
    stake: bet.stake,
    phase: "settled",
  };
}

function legalActions(_s: RouletteState): RouletteAction[] {
  return [];
}

function step(_s: RouletteState, _a: RouletteAction, _r: RngStream): RouletteState {
  throw new Error("roulette.step: no actions; terminal on deal");
}

function isTerminal(s: RouletteState): boolean {
  return s.phase === "settled";
}

function settle(state: RouletteState, _bet: Bet): GameResult {
  return {
    totalStakedUnits: state.totalStake,
    totalPayoutUnits: state.totalPayout,
    pnlUnits: state.totalPayout - state.totalStake,
    breakdown: state.perPlacement.map((p) => ({
      label: `${describePlacement(p)} · ${p.won ? "win" : "loss"}`,
      stakedUnits: p.amount,
      payoutUnits: p.payout,
      pnlUnits: p.payout - p.amount,
    })),
  };
}

function describePlacement(p: { kind: RoulettePlacementKind; numbers: number[] }): string {
  switch (p.kind) {
    case "straight": return `Straight ${p.numbers[0]}`;
    case "split": return `Split ${p.numbers.join("/")}`;
    case "street": return `Street ${p.numbers.join("/")}`;
    case "corner": return `Corner ${p.numbers.join("/")}`;
    case "six_line": return `Six-line ${p.numbers.join("/")}`;
    case "trio": return `Trio ${p.numbers.join("/")}`;
    case "top_line": return `Top line ${p.numbers.join("/")}`;
    case "red": return "Red";
    case "black": return "Black";
    case "odd": return "Odd";
    case "even": return "Even";
    case "low": return "1-18";
    case "high": return "19-36";
    case "dozen_1": return "1st 12";
    case "dozen_2": return "2nd 12";
    case "dozen_3": return "3rd 12";
    case "column_1": return "Column 1";
    case "column_2": return "Column 2";
    case "column_3": return "Column 3";
  }
}

export const rouletteGame: Game<RouletteAction, RouletteState> = {
  id: "roulette",
  display: "European Roulette",
  initialState,
  legalActions,
  step,
  isTerminal,
  settle,
};

/* ---------------------------------------------------------------------------
 *  UI helpers
 * ------------------------------------------------------------------------- */

/** Human-readable label, used in history rows and verify modal. */
export { describePlacement };

/** Theoretical RTP per placement kind. Always 36/37 ≈ 97.297% in European. */
export const ROULETTE_RTP_PERCENT = (36 / 37) * 100;
