/* ================================================================== *
 *  MoneyFund Network — Gamma-distributed Decoy Selection              *
 *                                                                      *
 *  WHY THIS EXISTS                                                    *
 *  ───────────────                                                    *
 *  CLSAG ring signatures hide the real spender among N decoy outputs. *
 *  The cryptography is sound: an adversary who has no out-of-band      *
 *  info cannot distinguish the real spender from any individual decoy. *
 *  But the *selection process* leaks information if not done right.    *
 *                                                                      *
 *  Concretely: real spends cluster on RECENT outputs. Users receive a  *
 *  coin and spend it within days, not years. So if you sample decoys   *
 *  UNIFORMLY across the entire UTXO history, the real spender stands   *
 *  out as "the recent one." Monero learned this the hard way: by 2017  *
 *  empirical analyses were correctly identifying the real spender in   *
 *  ≈ 60–90% of ring signatures using only the age-clustering heuristic.*
 *                                                                      *
 *  The fix (Monero v0.13, 2018) is to sample decoys from a distribution *
 *  that matches the empirical age distribution of real spends. With   *
 *  gamma-distributed ages, the real spender's age is statistically    *
 *  indistinguishable from any decoy's, and the heuristic attack       *
 *  collapses to baseline (= 1/ringSize, e.g. 1/16 ≈ 6%).               *
 *                                                                      *
 *  REFERENCE                                                          *
 *  ─────────                                                          *
 *  See Monero's `pick_random_indices` and the "Möser et al. 2018"     *
 *  analysis that motivated the change. The parameter values below      *
 *  (shape ≈ 19.28, scale ≈ 1/1.61 ≈ 0.62) are Monero's empirically    *
 *  fitted constants from on-chain spend data.                          *
 *                                                                      *
 *  Sampling produces a LOG-AGE; the actual age in blocks is exp(x).   *
 *  So a sampled value of ~7 implies age ≈ e⁷ ≈ 1100 blocks; values of  *
 *  10+ correspond to year-plus-old outputs (the long tail).            *
 * ================================================================== */

/* ------------------------------------------------------------------ */
/*  RNG ABSTRACTION                                                    */
/* ------------------------------------------------------------------ */

/** A uniform-on-[0,1) source. For production wallets use crypto.getRandomValues *
 *  via the cryptoRandom adapter below. For tests, pass a seeded PRNG so       *
 *  results are reproducible.                                                 */
export type Random = () => number;

/** crypto.getRandomValues backed uniform-on-[0,1) source. Tested only in     *
 *  Node 19+ where webcrypto is in global scope. */
export function cryptoRandom(): number {
  const buf = new Uint32Array(2);
  // Prefer global crypto (Node 19+, all modern runtimes); fall back to require.
  const c: Crypto = (globalThis as { crypto: Crypto }).crypto;
  c.getRandomValues(buf);
  // Combine to 53-bit double in [0,1). This is the standard JS trick.
  return ((buf[0] * 0x200000) + (buf[1] >>> 11)) / 0x20000000000000;
}

/** Seeded PRNG for deterministic tests. Mulberry32 — 32-bit linear *
 *  congruential variant. Cycle 2³² which is fine for our needs.    */
export function seededRng(seed: number): Random {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/* ------------------------------------------------------------------ */
/*  BOX–MULLER STANDARD NORMAL                                         */
/* ------------------------------------------------------------------ */

/** Sample a single value from N(0, 1) using polar Box–Muller. */
export function sampleNormal(rand: Random): number {
  let u: number, v: number, s: number;
  do {
    u = 2 * rand() - 1;
    v = 2 * rand() - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

/* ------------------------------------------------------------------ */
/*  GAMMA SAMPLER  (Marsaglia–Tsang, 2000)                             */
/* ------------------------------------------------------------------ */

/** Sample one value from Gamma(shape k, scale θ). For k >= 1 we use   *
 *  Marsaglia–Tsang's "squeeze" rejection method, which is exact and   *
 *  has acceptance probability > 95%. For k < 1 we boost into k+1 via  *
 *  the standard trick: X · U^(1/k).                                    */
export function sampleGamma(shape: number, scale: number, rand: Random): number {
  if (shape <= 0 || scale <= 0) {
    throw new Error(`sampleGamma: shape and scale must be > 0 (got ${shape}, ${scale})`);
  }
  if (shape < 1) {
    // Boost: X ~ Gamma(k+1, θ),  then Y = X · U^(1/k) ~ Gamma(k, θ).
    const u = rand();
    return sampleGamma(shape + 1, scale, rand) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let z: number;
    let v: number;
    do {
      z = sampleNormal(rand);
      v = 1 + c * z;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    const z2 = z * z;
    if (u < 1 - 0.0331 * z2 * z2) {
      return d * v * scale;
    }
    if (Math.log(u) < 0.5 * z2 + d - d * v + d * Math.log(v)) {
      return d * v * scale;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  DECOY POOL ABSTRACTION                                             */
/* ------------------------------------------------------------------ */

/** One candidate decoy. The protocol needs `P` and `C` for the ring  *
 *  but the SELECTION algorithm needs `height` so it can age-weight.  */
export interface DecoyCandidate<T = unknown> {
  /** Block height at which this output was anchored (i.e. created). */
  height: number;
  /** Arbitrary payload that survives selection. Caller chooses what   *
   *  this is — typically { P, C } for ring construction.              */
  data: T;
}

/* ------------------------------------------------------------------ */
/*  PARAMS                                                             */
/* ------------------------------------------------------------------ */

export interface GammaDecoyParams {
  /** Gamma shape k. Monero default ≈ 19.28.                          */
  shape: number;
  /** Gamma scale θ. Monero default = 1 / 1.61 ≈ 0.62.               */
  scale: number;
  /** Minimum age (in blocks) below which outputs are NEVER selected. *
   *  Prevents picking outputs from the very latest blocks, which     *
   *  the network may not have finalized at every peer yet.           */
  minAge: number;
  /** Number of times to resample before giving up if every draw is   *
   *  out-of-range or collides with an already-picked decoy. Set high *
   *  enough to handle small pools.                                   */
  maxResamples: number;
}

/** Empirically-tuned defaults from Monero on-chain spend analysis.   *
 *  These work directly for a network with ~2-minute blocks; if your  *
 *  block time differs significantly, RESCALE `scale` to compensate   *
 *  (smaller blocks → larger scale, since age in blocks is bigger).   */
export const DEFAULT_GAMMA_PARAMS: GammaDecoyParams = {
  shape: 19.28,
  scale: 1 / 1.61,
  minAge: 10,
  maxResamples: 1000,
};

/* ------------------------------------------------------------------ */
/*  THE SELECTION ALGORITHM                                            */
/* ------------------------------------------------------------------ */

/** Pick `count` decoys from `pool` matching Monero-style gamma age   *
 *  weighting against `currentHeight`. The `pool` must be sorted by    *
 *  height ascending (we exploit this for log-time nearest-age search).*
 *                                                                      *
 *  RETURNS a deduplicated array of `count` candidates. If the pool is *
 *  too small to satisfy the request after `maxResamples` attempts,    *
 *  the function falls back to uniform sampling of the remaining      *
 *  candidates rather than throwing — a partial gamma ring is far     *
 *  better than no transaction.                                        */
export function selectGammaDecoys<T>(
  pool: DecoyCandidate<T>[],
  count: number,
  currentHeight: number,
  rand: Random = cryptoRandom,
  params: GammaDecoyParams = DEFAULT_GAMMA_PARAMS
): DecoyCandidate<T>[] {
  if (count < 0) throw new Error("selectGammaDecoys: count must be >= 0");
  if (count === 0) return [];
  // Hard validation: pool must be sorted ascending by height so we can do
  // an efficient binary-search nearest-by-age lookup.
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].height < pool[i - 1].height) {
      throw new Error("selectGammaDecoys: pool must be sorted by height ascending");
    }
  }

  const chosen = new Set<number>();
  const out: DecoyCandidate<T>[] = [];

  let resamples = 0;
  while (out.length < count && resamples < params.maxResamples * count) {
    resamples++;
    // 1. Sample log-age from gamma.
    const logAge = sampleGamma(params.shape, params.scale, rand);
    // 2. Convert to actual age in blocks. exp(logAge) can be enormous;
    //    Monero clamps via the pool's bounds. We do the same.
    const age = Math.exp(logAge);
    if (!Number.isFinite(age)) continue;
    if (age < params.minAge) continue;
    const targetHeight = currentHeight - age;
    // 3. Out of range → skip (genesis predates the chain).
    if (pool.length === 0 || targetHeight < pool[0].height) continue;
    if (targetHeight > pool[pool.length - 1].height) continue;
    // 4. Binary search for nearest output at or below targetHeight.
    let lo = 0, hi = pool.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (pool[mid].height <= targetHeight) lo = mid; else hi = mid - 1;
    }
    if (chosen.has(lo)) continue;
    chosen.add(lo);
    out.push(pool[lo]);
  }

  // 5. If we ran out of resamples but still need decoys, top up with
  //    uniformly-random remaining candidates (privacy is worse but a   *
  //    tx is better than no tx).
  if (out.length < count) {
    const remaining: number[] = [];
    for (let i = 0; i < pool.length; i++) if (!chosen.has(i)) remaining.push(i);
    while (out.length < count && remaining.length > 0) {
      const i = Math.floor(rand() * remaining.length);
      out.push(pool[remaining[i]]);
      remaining.splice(i, 1);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  INTROSPECTION                                                      */
/* ------------------------------------------------------------------ */

/** Returns the mean and 95% quantile of the GAMMA-AGE distribution    *
 *  (in blocks). Helpful for tuning the parameters per-chain.           */
export function gammaAgeStats(
  samples: number,
  rand: Random = cryptoRandom,
  params: GammaDecoyParams = DEFAULT_GAMMA_PARAMS
): { mean: number; median: number; p95: number; max: number } {
  const ages: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = Math.exp(sampleGamma(params.shape, params.scale, rand));
    if (Number.isFinite(a)) ages.push(a);
  }
  ages.sort((a, b) => a - b);
  const mean = ages.reduce((acc, x) => acc + x, 0) / ages.length;
  const median = ages[Math.floor(ages.length / 2)];
  const p95 = ages[Math.floor(ages.length * 0.95)];
  const max = ages[ages.length - 1];
  return { mean, median, p95, max };
}
