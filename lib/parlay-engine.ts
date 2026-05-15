/* ===========================================================================
 *  MoneyFund Parlay Engine — the quantitative core
 *  ---------------------------------------------------------------------------
 *  This module implements the four mathematical pillars that turn a parlay
 *  card from a "sucker bet" into a +EV instrument:
 *
 *    1. Positive Expected Value  ─ implied probability vs. de-vigged true price.
 *    2. Parlay Math               ─ how Edge and Vig compound across legs.
 *    3. Correlation Logic         ─ Gaussian-copula Monte Carlo for SGP legs.
 *    4. Kelly Criterion           ─ optimal fractional stake sizing.
 *
 *  Everything is done in arbitrary-precision Decimal arithmetic via decimal.js
 *  so probability / odds drift never accumulates over long pipelines.
 *
 *  The engine is *pure* — no network, no I/O, no React. It is exclusively
 *  numerical primitives plus the high-level `calculateParlayAlpha` function
 *  that orchestrates them. Scanner / service code lives in `parlay-scanner.ts`
 *  and the UI in `app/parlays/`.
 * ========================================================================= */

import { Decimal } from "decimal.js";

// 32 significant figures is overkill for sportsbook math but it costs us
// nothing and protects against pathological compounded losses of precision.
Decimal.set({ precision: 32 });

/* ---------------------------------------------------------------------------
 *  Public types
 * ------------------------------------------------------------------------- */

export type AmericanOdds = number;
export type DecimalOdds = number;
export type Probability = number;

export type DevigMethod = "multiplicative" | "power" | "additive" | "auto";

/**
 * A single leg of a parlay. The minimum required field is `americanOdds`
 * (the price the book is offering you). Everything else is optional and
 * unlocks more accurate analysis:
 *
 *   - `oppositeAmericanOdds`   → enables 2-way de-vigging on this single book.
 *   - `marketProbabilities`    → for 3+ way markets (e.g. 3-way moneyline).
 *   - `sharpAmericanOdds`      → if you have a sharp/consensus price, we use
 *                                its de-vigged probability as `trueProbability`.
 *   - `trueProbability`        → override directly from your own model.
 *
 * If none of those are present we fall back to using `impliedProbability`
 * as `trueProbability` (and warn loudly — that is *not* a winning strategy).
 */
export interface Leg {
  id?: string;
  description?: string;
  sport?: string;
  game?: string;
  market?: string;
  bookName?: string;

  americanOdds: AmericanOdds;
  decimalOdds?: DecimalOdds;

  /** Opposite side of a 2-way market at the SAME book (for single-book de-vig). */
  oppositeAmericanOdds?: AmericanOdds;

  /** Full set of implied probs for a multi-way market (already as probs). */
  marketProbabilities?: number[];

  /** Sharp / consensus American odds — used to derive a fairer trueProb. */
  sharpAmericanOdds?: AmericanOdds;
  sharpOppositeAmericanOdds?: AmericanOdds;

  /** External model probability — short-circuits the de-vig pipeline. */
  trueProbability?: Probability;
}

export interface LegAnalysis {
  leg: Leg;
  decimalOdds: number;
  americanOdds: number;
  impliedProbability: number;
  trueProbability: number;
  /** Source of `trueProbability`: explicit, sharp-devig, market-devig, or implied (no devig). */
  trueProbabilitySource: "explicit" | "sharp-devig" | "market-devig" | "implied";
  /** Raw edge in probability space, p_true - p_implied. */
  edge: number;
  /** Relative edge, (p_true / p_implied - 1) * 100. */
  edgePct: number;
  /** EV per 1 unit staked on this leg in isolation. */
  expectedValue: number;
  /** Fair American odds implied by trueProbability. */
  fairAmericanOdds: number;
  fairDecimalOdds: number;
}

export interface CalculateParlayAlphaOptions {
  /** Bankroll for Kelly sizing. Defaults to 1 unit (returns fractions). */
  bankroll?: number;
  /**
   * Pairwise correlation matrix of leg outcomes, expressed in *latent normal*
   * space (Gaussian copula). Square matrix sized to `legs.length`. If omitted,
   * legs are treated as independent. Values in [-1, 1]; diagonal must be 1.
   */
  correlationMatrix?: number[][];
  /** Number of Monte Carlo trials. Defaults to 10,000. */
  monteCarloTrials?: number;
  /**
   * Kelly fraction. 1 = full Kelly, 0.25 = quarter Kelly (recommended).
   * Default = 0.25.
   */
  kellyFraction?: number;
  /** De-vig method used when deriving trueProb from market or sharp odds. */
  devigMethod?: DevigMethod;
  /** Optional seed for the PRNG so MC is reproducible. */
  randomSeed?: number;
}

export interface ParlayResult {
  legs: LegAnalysis[];

  /* --- Combined odds --------------------------------------------------- */
  combinedDecimalOdds: number;
  combinedAmericanOdds: number;
  offeredDecimalOdds: number;
  offeredAmericanOdds: number;

  /* --- Joint probabilities -------------------------------------------- */
  independentJointProbability: number;
  independentFairDecimalOdds: number;
  independentFairAmericanOdds: number;

  monteCarloJointProbability: number;
  monteCarloFairDecimalOdds: number;
  monteCarloFairAmericanOdds: number;
  monteCarloTrials: number;

  /* --- EV / Alpha ------------------------------------------------------ */
  /** EV per 1 unit staked using Monte-Carlo joint prob. */
  expectedValue: number;
  /** Same but assuming independent legs (no correlation). */
  expectedValueIndependent: number;
  /** Relative edge over the book's offered price, in percent. */
  alphaPercent: number;
  /** ROI projection ((offered_decimal * p_true) - 1) * 100. */
  expectedRoiPercent: number;

  /* --- Vig / Edge diagnostics ----------------------------------------- */
  /** Product of (1 / implied) → indicates juice compounding. */
  vigCompoundingFactor: number;
  /** Product of (p_true / p_implied) → indicates edge compounding. */
  edgeCompoundingFactor: number;

  /* --- Kelly ----------------------------------------------------------- */
  fullKellyFraction: number;
  fractionalKellyMultiplier: number;
  recommendedStakeFraction: number;
  recommendedStake: number;
  bankroll: number;

  /* --- Flags / meta ---------------------------------------------------- */
  isProfitable: boolean;
  isHighlyCorrelated: boolean;
  correlationUsed: boolean;
  warnings: string[];
}

/* ===========================================================================
 *  PILLAR 0 — Odds conversion primitives
 * ========================================================================= */

/**
 * American → Decimal odds.
 *  +120 → 2.20
 *  -150 → 1.6666…
 */
export function americanToDecimal(american: AmericanOdds): number {
  if (american === 0 || !Number.isFinite(american)) {
    throw new Error(`americanToDecimal: invalid odds ${american}`);
  }
  if (american > 0) {
    return new Decimal(american).div(100).plus(1).toNumber();
  }
  return new Decimal(100).div(new Decimal(american).abs()).plus(1).toNumber();
}

/**
 * Decimal → American odds.
 *  2.20 → +120
 *  1.50 → -200
 */
export function decimalToAmerican(decimal: DecimalOdds): number {
  const d = new Decimal(decimal);
  if (d.lte(1)) {
    throw new Error(`decimalToAmerican: decimal odds must be > 1 (got ${decimal})`);
  }
  if (d.gte(2)) {
    return d.minus(1).times(100).toDecimalPlaces(0).toNumber();
  }
  return new Decimal(-100).div(d.minus(1)).toDecimalPlaces(0).toNumber();
}

/** American → implied probability (without de-vig). */
export function americanToImpliedProbability(american: AmericanOdds): number {
  if (american > 0) {
    return new Decimal(100).div(new Decimal(american).plus(100)).toNumber();
  }
  const abs = new Decimal(american).abs();
  return abs.div(abs.plus(100)).toNumber();
}

/** Decimal → implied probability. */
export function decimalToImpliedProbability(decimal: DecimalOdds): number {
  return new Decimal(1).div(decimal).toNumber();
}

/** Probability → fair decimal odds (no vig). */
export function probabilityToDecimal(p: Probability): number {
  if (p <= 0 || p >= 1) {
    throw new Error(`probabilityToDecimal: probability must be in (0,1), got ${p}`);
  }
  return new Decimal(1).div(p).toNumber();
}

/** Probability → fair American odds. */
export function probabilityToAmerican(p: Probability): number {
  return decimalToAmerican(probabilityToDecimal(p));
}

/* ===========================================================================
 *  PILLAR 1 — De-vigging (multiplicative / power / additive / auto)
 * ===========================================================================
 *
 *  Sportsbook implied probabilities sum to more than 1 because of the vig.
 *  De-vigging redistributes that "overround" back across the outcomes so they
 *  sum to exactly 1. Different methods make different assumptions about
 *  where the juice lives:
 *
 *  • Multiplicative — assume juice is proportional to each leg's implied prob.
 *    Simple, fast, decent for ~3+ way markets.
 *
 *  • Power           — find k such that Σ p_i^k = 1. Tends to *shrink favorites
 *    more aggressively*, which lines up well with empirical sharp-book studies
 *    for 2-way markets.
 *
 *  • Additive        — subtract an equal share of the overround from each leg.
 *    Worst overall, but kept for completeness / comparison.
 *
 *  • Auto            — power for 2-way markets, multiplicative for 3+ way.
 * ========================================================================= */

export interface DevigResult {
  method: Exclude<DevigMethod, "auto">;
  trueProbabilities: number[];
  impliedProbabilities: number[];
  overround: number;
  vigPercent: number;
}

export function devig(
  impliedProbabilities: number[],
  method: DevigMethod = "auto",
): DevigResult {
  if (impliedProbabilities.length < 2) {
    throw new Error("devig: need at least 2 outcomes");
  }
  for (const p of impliedProbabilities) {
    if (p <= 0 || p >= 1) {
      throw new Error(`devig: probability out of range (got ${p})`);
    }
  }

  const sum = impliedProbabilities.reduce((a, b) => a + b, 0);
  const overround = sum - 1;
  const vigPercent = overround * 100;

  const chosen: Exclude<DevigMethod, "auto"> =
    method === "auto"
      ? impliedProbabilities.length === 2
        ? "power"
        : "multiplicative"
      : method;

  let trueProbabilities: number[];
  switch (chosen) {
    case "multiplicative":
      trueProbabilities = devigMultiplicative(impliedProbabilities);
      break;
    case "power":
      trueProbabilities = devigPower(impliedProbabilities);
      break;
    case "additive":
      trueProbabilities = devigAdditive(impliedProbabilities);
      break;
  }

  return {
    method: chosen,
    trueProbabilities,
    impliedProbabilities: [...impliedProbabilities],
    overround,
    vigPercent,
  };
}

/** Divide each implied prob by their sum so the vector sums to 1. */
export function devigMultiplicative(implied: number[]): number[] {
  const total = new Decimal(implied.reduce((a, b) => a + b, 0));
  return implied.map((p) => new Decimal(p).div(total).toNumber());
}

/** Subtract an equal slice of the overround from each leg. */
export function devigAdditive(implied: number[]): number[] {
  const sum = implied.reduce((a, b) => a + b, 0);
  const slice = (sum - 1) / implied.length;
  return implied.map((p) => {
    const adjusted = new Decimal(p).minus(slice);
    // Clamp paranoia — shouldn't happen with valid books but guard anyway.
    return Decimal.max(adjusted, new Decimal("0.0001")).toNumber();
  });
}

/**
 * Solve for k such that Σ p_i^k = 1 (bisection). For typical overrounds
 * k lives in (0, 1]; we widen the search range generously and converge to
 * ~1e-12 accuracy in <40 iterations.
 */
export function devigPower(implied: number[]): number[] {
  const decimals = implied.map((p) => new Decimal(p));
  const sumPow = (k: Decimal): Decimal =>
    decimals.reduce((acc, p) => acc.plus(p.pow(k)), new Decimal(0));

  let lo = new Decimal("0.0001");
  let hi = new Decimal(10);

  // Σ p^lo ≥ legs.length (very large), Σ p^hi ≈ 0. We want sum=1.
  for (let i = 0; i < 200; i++) {
    const mid = lo.plus(hi).div(2);
    const s = sumPow(mid);
    if (s.minus(1).abs().lt("1e-14")) {
      lo = hi = mid;
      break;
    }
    if (s.gt(1)) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi.minus(lo).lt("1e-15")) break;
  }
  const k = lo.plus(hi).div(2);
  return decimals.map((p) => p.pow(k).toNumber());
}

/* ===========================================================================
 *  PILLAR 1 (cont.) — Expected Value
 * ========================================================================= */

/** EV per 1 unit staked at `decimalOdds` given `trueProbability`. */
export function expectedValue(
  trueProbability: Probability,
  decimalOdds: DecimalOdds,
): number {
  // EV = p*(b) - (1-p)*1, where b = decimal - 1.
  // Algebraically = p*decimal - 1.
  return new Decimal(trueProbability).times(decimalOdds).minus(1).toNumber();
}

/**
 * Alpha = relative edge over the offered price.
 *   alpha = (offered_decimal / fair_decimal - 1) * 100%
 * Equivalent to (p_true * offered_decimal - 1) * 100%, since fair_decimal = 1/p_true.
 */
export function alphaPercent(
  trueProbability: Probability,
  offeredDecimalOdds: DecimalOdds,
): number {
  return new Decimal(trueProbability).times(offeredDecimalOdds).minus(1).times(100).toNumber();
}

/* ===========================================================================
 *  PILLAR 2 — Parlay math
 * ========================================================================= */

/** Product of decimal odds. */
export function parlayDecimalOdds(decimals: DecimalOdds[]): number {
  return decimals.reduce((acc, d) => new Decimal(acc).times(d).toNumber(), 1);
}

/** Product of independent probabilities. */
export function parlayJointProbabilityIndependent(probs: Probability[]): number {
  return probs.reduce((acc, p) => new Decimal(acc).times(p).toNumber(), 1);
}

/* ===========================================================================
 *  PILLAR 3 — Correlation logic via Monte Carlo (Gaussian copula)
 * ===========================================================================
 *
 *  The trick: we want to simulate dependent Bernoullis with prescribed
 *  marginals (p_i) and pairwise correlations. The cleanest way is the
 *  Gaussian copula:
 *
 *    1. Pick a correlation matrix Σ on the *latent normals* (this is roughly
 *       — but not exactly — the Bernoulli correlation; for our purposes the
 *       difference is small and the user supplies Σ directly).
 *    2. Cholesky-decompose Σ = L Lᵀ.
 *    3. Per trial: draw z ~ N(0, I), set y = Lz, then u_i = Φ(y_i).
 *    4. Leg i hits iff u_i < p_i.
 *
 *  Σ = I (no off-diagonals) recovers the fully independent case.
 *
 *  We hand-roll the math so the engine has zero runtime dependencies
 *  beyond decimal.js and a fast PRNG.
 * ========================================================================= */

/** Mulberry32 — small, fast, seedable PRNG. */
export function makePrng(seed: number = Date.now()): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller transform: returns 2 standard normals from 2 uniforms. */
export function boxMullerPair(u1: number, u2: number): [number, number] {
  // Guard log(0).
  const safe = Math.max(u1, 1e-12);
  const r = Math.sqrt(-2 * Math.log(safe));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/** Standard normal CDF Φ(z) via Abramowitz & Stegun 26.2.17 (max err ~7.5e-8). */
export function standardNormalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  // erf approximation
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Cholesky decomposition of a symmetric positive-semi-definite matrix.
 * Returns lower triangular L such that A = L Lᵀ. Throws on non-PSD input.
 */
export function choleskyDecomposition(a: number[][]): number[][] {
  const n = a.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) {
          // Tiny ridge — keeps near-PSD user matrices usable.
          if (sum > -1e-9) sum = 1e-12;
          else throw new Error(`choleskyDecomposition: matrix not PSD at (${i},${j}) sum=${sum}`);
        }
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Validate a correlation matrix: square, symmetric, 1s on diagonal, in [-1,1]. */
export function validateCorrelationMatrix(m: number[][], n: number): void {
  if (m.length !== n) throw new Error(`correlation matrix must be ${n}x${n}, got ${m.length}`);
  for (let i = 0; i < n; i++) {
    if (m[i].length !== n) throw new Error(`correlation matrix row ${i} wrong size`);
    if (Math.abs(m[i][i] - 1) > 1e-9) {
      throw new Error(`correlation matrix diagonal must be 1 (got ${m[i][i]} at ${i})`);
    }
    for (let j = 0; j < n; j++) {
      if (m[i][j] < -1 || m[i][j] > 1) {
        throw new Error(`correlation out of [-1,1] at (${i},${j}): ${m[i][j]}`);
      }
      if (Math.abs(m[i][j] - m[j][i]) > 1e-9) {
        throw new Error(`correlation matrix not symmetric at (${i},${j})`);
      }
    }
  }
}

/**
 * Monte Carlo joint probability that *all* legs hit, with optional pairwise
 * correlations specified on the latent normal scale.
 *
 * Returns the empirical hit rate over `trials` simulations.
 */
export function monteCarloJointProbability(
  trueProbabilities: Probability[],
  options: {
    correlationMatrix?: number[][];
    trials?: number;
    randomSeed?: number;
  } = {},
): number {
  const n = trueProbabilities.length;
  const trials = Math.max(100, Math.floor(options.trials ?? 10_000));
  const rng = makePrng(options.randomSeed);

  // Pre-compute thresholds in normal space: leg hits iff y_i < Φ⁻¹(p_i).
  // We compare via u = Φ(y) < p instead, which avoids inverse CDF altogether.

  // Either identity (no correlation) or Cholesky of supplied matrix.
  let L: number[][] | null = null;
  if (options.correlationMatrix) {
    validateCorrelationMatrix(options.correlationMatrix, n);
    L = choleskyDecomposition(options.correlationMatrix);
  }

  let hits = 0;

  // Buffers re-used per trial.
  const z = new Array<number>(n);
  const y = new Array<number>(n);

  for (let t = 0; t < trials; t++) {
    // Draw n independent standard normals via Box-Muller pairs.
    for (let i = 0; i < n; i += 2) {
      const [n1, n2] = boxMullerPair(rng(), rng());
      z[i] = n1;
      if (i + 1 < n) z[i + 1] = n2;
    }

    if (L === null) {
      // Independent case — y = z.
      let allHit = true;
      for (let i = 0; i < n; i++) {
        const u = standardNormalCdf(z[i]);
        if (u >= trueProbabilities[i]) {
          allHit = false;
          break;
        }
      }
      if (allHit) hits++;
    } else {
      // Correlated: y = L * z.
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k <= i; k++) s += L[i][k] * z[k];
        y[i] = s;
      }
      let allHit = true;
      for (let i = 0; i < n; i++) {
        const u = standardNormalCdf(y[i]);
        if (u >= trueProbabilities[i]) {
          allHit = false;
          break;
        }
      }
      if (allHit) hits++;
    }
  }

  return hits / trials;
}

/**
 * Estimate the *empirical pairwise correlation* between two legs by running
 * a paired MC and counting (A∧B, A∧¬B, ¬A∧B, ¬A∧¬B). Useful for "did the
 * book mis-price this SGP?" diagnostics — compare empirical correlation to
 * what is implied by the offered SGP price.
 */
export function pairwiseEmpiricalCorrelation(
  pA: Probability,
  pB: Probability,
  rho: number,
  trials = 10_000,
  seed?: number,
): number {
  const samples = monteCarloPairs(pA, pB, rho, trials, seed);
  const meanA = samples.aCount / trials;
  const meanB = samples.bCount / trials;
  const meanAB = samples.bothCount / trials;
  // φ-coefficient = (P(AB) - P(A)P(B)) / sqrt(P(A)P(¬A)P(B)P(¬B))
  const denom = Math.sqrt(meanA * (1 - meanA) * meanB * (1 - meanB));
  if (denom < 1e-12) return 0;
  return (meanAB - meanA * meanB) / denom;
}

function monteCarloPairs(
  pA: number,
  pB: number,
  rho: number,
  trials: number,
  seed?: number,
): { aCount: number; bCount: number; bothCount: number } {
  const rng = makePrng(seed);
  let aCount = 0;
  let bCount = 0;
  let bothCount = 0;
  const a = Math.sqrt(1 - rho * rho);
  for (let i = 0; i < trials; i += 2) {
    const [z1, z2raw] = boxMullerPair(rng(), rng());
    const [z3, z4] = boxMullerPair(rng(), rng());
    // First sample
    const yA1 = z1;
    const yB1 = rho * z1 + a * z2raw;
    const hitA1 = standardNormalCdf(yA1) < pA;
    const hitB1 = standardNormalCdf(yB1) < pB;
    if (hitA1) aCount++;
    if (hitB1) bCount++;
    if (hitA1 && hitB1) bothCount++;
    // Second sample (re-use the second normal pair)
    if (i + 1 < trials) {
      const yA2 = z3;
      const yB2 = rho * z3 + a * z4;
      const hitA2 = standardNormalCdf(yA2) < pA;
      const hitB2 = standardNormalCdf(yB2) < pB;
      if (hitA2) aCount++;
      if (hitB2) bCount++;
      if (hitA2 && hitB2) bothCount++;
    }
  }
  return { aCount, bCount, bothCount };
}

/* ===========================================================================
 *  PILLAR 4 — Kelly Criterion
 * ========================================================================= */

/**
 * Full Kelly fraction:  f* = (b * p − q) / b
 *   b = decimal_odds − 1   (net payout per 1 unit risked)
 *   p = true probability of winning
 *   q = 1 − p
 *
 * If the bet has negative expectation we return 0 (never bet against yourself).
 */
export function kellyFraction(
  trueProbability: Probability,
  decimalOdds: DecimalOdds,
): number {
  const p = new Decimal(trueProbability);
  const q = new Decimal(1).minus(p);
  const b = new Decimal(decimalOdds).minus(1);
  if (b.lte(0)) return 0;
  const f = b.times(p).minus(q).div(b).toNumber();
  return f > 0 ? f : 0;
}

/**
 * Apply a fractional Kelly multiplier and an absolute cap (default 5% of
 * bankroll). Quarter Kelly (multiplier = 0.25) is what every sharp bettor
 * I've ever met actually uses — it sacrifices ~6% of theoretical long-run
 * growth for a ~75% reduction in volatility.
 */
export function fractionalKelly(
  trueProbability: Probability,
  decimalOdds: DecimalOdds,
  multiplier: number = 0.25,
  hardCapFraction: number = 0.05,
): number {
  const full = kellyFraction(trueProbability, decimalOdds);
  const scaled = full * multiplier;
  return Math.min(scaled, hardCapFraction);
}

/* ===========================================================================
 *  Main orchestrator
 * ========================================================================= */

/**
 * The headline function. Given a parlay (list of legs), the *offered* parlay
 * price (American odds), an optional bankroll for Kelly sizing, and an
 * optional correlation matrix, produce a complete quant analysis:
 *
 *   • per-leg de-vigging and EV
 *   • combined parlay decimal/American odds
 *   • independent vs. Monte-Carlo joint probability
 *   • alpha %, EV %, fair-price comparison
 *   • Kelly + fractional Kelly stake recommendation
 *   • a list of plain-English warnings (no leg has a sharp price, MC says the
 *     legs are super correlated, etc.)
 */
export function calculateParlayAlpha(
  legs: Leg[],
  offeredParlayOdds: AmericanOdds,
  bankroll: number = 1,
  correlationMatrix?: number[][],
  options: Omit<CalculateParlayAlphaOptions, "bankroll" | "correlationMatrix"> = {},
): ParlayResult {
  if (legs.length < 2) {
    throw new Error("calculateParlayAlpha: a parlay needs at least 2 legs");
  }
  const warnings: string[] = [];
  const devigMethod: DevigMethod = options.devigMethod ?? "auto";

  /* -------- Step 1: derive trueProbability for every leg ------------- */
  const legAnalyses: LegAnalysis[] = legs.map((leg) => {
    const decimalOdds = leg.decimalOdds ?? americanToDecimal(leg.americanOdds);
    const americanOdds = leg.americanOdds;
    const impliedProbability = americanToImpliedProbability(americanOdds);

    let trueProbability: number;
    let source: LegAnalysis["trueProbabilitySource"];

    if (typeof leg.trueProbability === "number") {
      trueProbability = leg.trueProbability;
      source = "explicit";
    } else if (typeof leg.sharpAmericanOdds === "number") {
      // Prefer sharp-book de-vig as gold standard.
      if (typeof leg.sharpOppositeAmericanOdds === "number") {
        const impliedSharp = americanToImpliedProbability(leg.sharpAmericanOdds);
        const impliedSharpOpp = americanToImpliedProbability(leg.sharpOppositeAmericanOdds);
        trueProbability = devig([impliedSharp, impliedSharpOpp], devigMethod).trueProbabilities[0];
      } else {
        // No opposite price — assume the sharp price is already close to fair.
        trueProbability = americanToImpliedProbability(leg.sharpAmericanOdds);
        warnings.push(
          `Leg "${leg.description ?? leg.id ?? "?"}" used raw sharp implied prob (no opposite side supplied)`,
        );
      }
      source = "sharp-devig";
    } else if (
      leg.marketProbabilities &&
      leg.marketProbabilities.length >= 2
    ) {
      trueProbability = devig(leg.marketProbabilities, devigMethod).trueProbabilities[0];
      source = "market-devig";
    } else if (typeof leg.oppositeAmericanOdds === "number") {
      const oppImplied = americanToImpliedProbability(leg.oppositeAmericanOdds);
      trueProbability = devig([impliedProbability, oppImplied], devigMethod).trueProbabilities[0];
      source = "market-devig";
    } else {
      trueProbability = impliedProbability;
      source = "implied";
      warnings.push(
        `Leg "${leg.description ?? leg.id ?? "?"}" has no de-vig source; using raw implied prob (will undercount edge)`,
      );
    }

    const ev = expectedValue(trueProbability, decimalOdds);
    const edge = trueProbability - impliedProbability;
    const edgePct =
      impliedProbability > 0 ? (trueProbability / impliedProbability - 1) * 100 : 0;
    const fairDecimalOdds = probabilityToDecimal(trueProbability);
    const fairAmericanOdds = probabilityToAmerican(trueProbability);

    return {
      leg,
      decimalOdds,
      americanOdds,
      impliedProbability,
      trueProbability,
      trueProbabilitySource: source,
      edge,
      edgePct,
      expectedValue: ev,
      fairAmericanOdds,
      fairDecimalOdds,
    };
  });

  /* -------- Step 2: combined odds & vig diagnostics ------------------- */
  const combinedDecimalOdds = parlayDecimalOdds(legAnalyses.map((l) => l.decimalOdds));
  const combinedAmericanOdds = decimalToAmerican(combinedDecimalOdds);
  const offeredDecimalOdds = americanToDecimal(offeredParlayOdds);

  // Vig compounding = product of (1/implied) i.e. the parlay's "naive" decimal odds
  // is already that. We surface ratio of (offered fair-implied) vs. true-fair price.
  const vigCompoundingFactor = legAnalyses.reduce(
    (acc, l) => acc * (1 / l.impliedProbability),
    1,
  );
  const edgeCompoundingFactor = legAnalyses.reduce(
    (acc, l) => acc * (l.trueProbability / l.impliedProbability),
    1,
  );

  /* -------- Step 3: joint probability — independent vs. Monte Carlo --- */
  const independentJointProbability = parlayJointProbabilityIndependent(
    legAnalyses.map((l) => l.trueProbability),
  );
  const independentFairDecimalOdds = probabilityToDecimal(independentJointProbability);
  const independentFairAmericanOdds = probabilityToAmerican(independentJointProbability);

  const trials = Math.max(100, options.monteCarloTrials ?? 10_000);
  const correlationUsed = !!correlationMatrix;
  let mcJointProbability: number;
  try {
    mcJointProbability = monteCarloJointProbability(
      legAnalyses.map((l) => l.trueProbability),
      {
        correlationMatrix,
        trials,
        randomSeed: options.randomSeed,
      },
    );
  } catch (err) {
    warnings.push(`Monte Carlo failed: ${(err as Error).message}. Falling back to independent assumption.`);
    mcJointProbability = independentJointProbability;
  }

  // Sometimes with high correlation and few trials we get exactly 0 — clamp
  // to a tiny floor so downstream odds math doesn't divide by zero.
  if (mcJointProbability <= 0) mcJointProbability = 1 / (trials * 10);

  const mcFairDecimalOdds = probabilityToDecimal(mcJointProbability);
  const mcFairAmericanOdds = probabilityToAmerican(mcJointProbability);

  /* -------- Step 4: EV / Alpha on the offered parlay price ----------- */
  const evIndependent = expectedValue(independentJointProbability, offeredDecimalOdds);
  const ev = expectedValue(mcJointProbability, offeredDecimalOdds);
  const alpha = alphaPercent(mcJointProbability, offeredDecimalOdds);
  const expectedRoiPercent = ev * 100;

  /* -------- Step 5: Kelly sizing on the offered parlay --------------- */
  const fullKelly = kellyFraction(mcJointProbability, offeredDecimalOdds);
  const kellyMultiplier = options.kellyFraction ?? 0.25;
  const recommendedStakeFraction = Math.min(fullKelly * kellyMultiplier, 0.05);
  const recommendedStake = bankroll * recommendedStakeFraction;

  /* -------- Step 6: meta flags --------------------------------------- */
  const isProfitable = ev > 0;
  const independentVsMc = independentJointProbability > 0
    ? mcJointProbability / independentJointProbability
    : 1;
  const isHighlyCorrelated = correlationUsed && Math.abs(independentVsMc - 1) > 0.15;

  if (!isProfitable) {
    warnings.push("Parlay has negative expected value — DO NOT BET");
  }
  if (correlationUsed && independentVsMc > 1.5) {
    warnings.push("Legs are strongly POSITIVELY correlated — book may be under-pricing this SGP (alpha source)");
  }
  if (correlationUsed && independentVsMc < 0.5) {
    warnings.push("Legs are strongly NEGATIVELY correlated — joint hit rate is much lower than naive parlay math suggests");
  }
  if (fullKelly === 0) {
    warnings.push("Kelly fraction is 0 — no stake is mathematically justified at the offered price");
  }
  if (recommendedStakeFraction >= 0.049) {
    warnings.push("Hit the 5% hard-cap on recommended stake — Kelly says more, but volatility dictates the cap");
  }

  return {
    legs: legAnalyses,
    combinedDecimalOdds,
    combinedAmericanOdds,
    offeredDecimalOdds,
    offeredAmericanOdds: offeredParlayOdds,

    independentJointProbability,
    independentFairDecimalOdds,
    independentFairAmericanOdds,

    monteCarloJointProbability: mcJointProbability,
    monteCarloFairDecimalOdds: mcFairDecimalOdds,
    monteCarloFairAmericanOdds: mcFairAmericanOdds,
    monteCarloTrials: trials,

    expectedValue: ev,
    expectedValueIndependent: evIndependent,
    alphaPercent: alpha,
    expectedRoiPercent,

    vigCompoundingFactor,
    edgeCompoundingFactor,

    fullKellyFraction: fullKelly,
    fractionalKellyMultiplier: kellyMultiplier,
    recommendedStakeFraction,
    recommendedStake,
    bankroll,

    isProfitable,
    isHighlyCorrelated,
    correlationUsed,
    warnings,
  };
}

/* ===========================================================================
 *  Convenience aliases
 * ========================================================================= */

export const odds = {
  americanToDecimal,
  decimalToAmerican,
  americanToImplied: americanToImpliedProbability,
  decimalToImplied: decimalToImpliedProbability,
  probabilityToDecimal,
  probabilityToAmerican,
};
