//! Gamma-distributed decoy selection.
//!
//! ## Why this matters
//!
//! CLSAG ring signatures hide the real spender among `N` decoy outputs.
//! The cryptography is sound — an adversary with no out-of-band info cannot
//! distinguish the real spender from any individual decoy. But the
//! **selection process** leaks information if done naïvely.
//!
//! Real spends cluster on RECENT outputs (users receive coins and spend
//! within days). If you sample decoys uniformly across the entire UTXO
//! history, the real spender stands out as "the recent one." Monero
//! learned this the hard way: by 2017 empirical analyses correctly
//! identified the real spender in ≈ 60–90% of ring signatures using only
//! the age-clustering heuristic.
//!
//! The fix (Monero v0.13, 2018) is to sample decoys from a distribution
//! that matches the empirical age distribution of real spends. With
//! gamma-distributed ages, the real spender's age is statistically
//! indistinguishable from any decoy's, collapsing the heuristic attack to
//! baseline (`1/ring_size`, e.g. ~6% for a 16-member ring).
//!
//! Mirrors `lib/network/decoy.ts` byte-for-byte for deterministic seeded
//! tests.

use crate::CryptoError;
use crate::Result;

/* ----------------------------------------------------------------------- *
 *  RNG ABSTRACTION                                                        *
 * ----------------------------------------------------------------------- */

/// Source of uniform `[0, 1)` doubles.
///
/// In production wallets use [`crypto_random`] (OS CSPRNG backed). For
/// deterministic tests use [`seeded_rng`] which implements Mulberry32 with
/// the same bit pattern as the TypeScript reference.
pub trait Random: FnMut() -> f64 {}
impl<T> Random for T where T: FnMut() -> f64 {}

/// OS CSPRNG → uniform `[0, 1)` double using the standard 53-bit trick.
pub fn crypto_random() -> f64 {
    use rand_core::RngCore;
    let mut buf = [0u8; 8];
    rand_core::OsRng.fill_bytes(&mut buf);
    let a = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
    let b = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
    // 53-bit double: ((a * 2^21) + (b >> 11)) / 2^53.
    let hi = u64::from(a) * (1u64 << 21);
    let lo = u64::from(b >> 11);
    (hi + lo) as f64 / (1u64 << 53) as f64
}

/// Seeded Mulberry32 PRNG.
///
/// Returns a closure suitable for deterministic tests. The byte sequence
/// matches the TS reference implementation exactly when seeded with the
/// same `u32`.
pub fn seeded_rng(seed: u32) -> impl FnMut() -> f64 {
    let mut s: u32 = seed;
    move || {
        s = s.wrapping_add(0x6d2b_79f5);
        let mut t: u32 = s;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / (1u64 << 32) as f64
    }
}

/* ----------------------------------------------------------------------- *
 *  STANDARD NORMAL (polar Box–Muller)                                     *
 * ----------------------------------------------------------------------- */

/// Sample a value from `N(0, 1)` using the polar Box–Muller method.
pub fn sample_normal<R: FnMut() -> f64>(rand: &mut R) -> f64 {
    loop {
        let u = 2.0 * rand() - 1.0;
        let v = 2.0 * rand() - 1.0;
        let s = u * u + v * v;
        if s < 1.0 && s != 0.0 {
            return u * ((-2.0 * s.ln()) / s).sqrt();
        }
    }
}

/* ----------------------------------------------------------------------- *
 *  GAMMA SAMPLER (Marsaglia–Tsang 2000)                                   *
 * ----------------------------------------------------------------------- */

/// Sample from `Gamma(shape k, scale θ)`.
///
/// For `k ≥ 1` we use Marsaglia–Tsang's exact squeeze rejection (≥ 95%
/// acceptance). For `k < 1` we boost into `k+1` using
/// `X · U^(1/k) ~ Gamma(k, θ)`.
///
/// # Errors
///
/// Returns `ValueOutOfRange` if `shape <= 0` or `scale <= 0`.
pub fn sample_gamma<R: FnMut() -> f64>(shape: f64, scale: f64, rand: &mut R) -> Result<f64> {
    if shape <= 0.0 || scale <= 0.0 {
        return Err(CryptoError::ValueOutOfRange);
    }
    if shape < 1.0 {
        // Boost: X ~ Gamma(k+1, θ), then Y = X · U^(1/k) ~ Gamma(k, θ).
        let u = rand();
        let x = sample_gamma(shape + 1.0, scale, rand)?;
        return Ok(x * u.powf(1.0 / shape));
    }
    let d = shape - 1.0 / 3.0;
    let c = 1.0 / (9.0 * d).sqrt();
    loop {
        let mut z;
        let mut v;
        loop {
            z = sample_normal(rand);
            v = 1.0 + c * z;
            if v > 0.0 {
                break;
            }
        }
        v = v * v * v;
        let u = rand();
        let z2 = z * z;
        if u < 1.0 - 0.0331 * z2 * z2 {
            return Ok(d * v * scale);
        }
        if u.ln() < 0.5 * z2 + d - d * v + d * v.ln() {
            return Ok(d * v * scale);
        }
    }
}

/* ----------------------------------------------------------------------- *
 *  TYPES                                                                  *
 * ----------------------------------------------------------------------- */

/// One candidate decoy. The protocol needs `P` and `C` for the ring but
/// the SELECTION algorithm only needs `height` to age-weight; the `data`
/// payload is whatever the caller wants to preserve.
#[derive(Debug, Clone)]
pub struct DecoyCandidate<T: Clone> {
    /// Block height at which this output was anchored.
    pub height: u64,
    /// Caller payload (e.g. `(P, C)` for ring construction).
    pub data: T,
}

/// Tuning parameters for gamma-based decoy selection.
#[derive(Debug, Clone, Copy)]
pub struct GammaDecoyParams {
    /// Gamma shape `k`. Monero default ≈ 19.28.
    pub shape: f64,
    /// Gamma scale `θ`. Monero default ≈ 1/1.61 ≈ 0.62.
    pub scale: f64,
    /// Minimum age (blocks) below which outputs are never selected.
    /// Prevents picking outputs from the very latest blocks, which the
    /// network may not have finalized at every peer yet.
    pub min_age: u64,
    /// Number of resampling attempts before falling back to uniform.
    pub max_resamples: usize,
}

/// Empirically-tuned defaults from Monero on-chain spend analysis.
pub const DEFAULT_GAMMA_PARAMS: GammaDecoyParams = GammaDecoyParams {
    shape: 19.28,
    scale: 1.0 / 1.61,
    min_age: 10,
    max_resamples: 1000,
};

/* ----------------------------------------------------------------------- *
 *  SELECTION                                                              *
 * ----------------------------------------------------------------------- */

/// Pick `count` decoys from `pool` using Monero-style gamma age weighting.
///
/// `pool` MUST be sorted by `height` ascending.
///
/// Returns a deduplicated `Vec` of up to `count` candidates. If the pool
/// is too small to satisfy the request after `max_resamples × count`
/// attempts, falls back to uniform sampling of remaining candidates — a
/// partial-gamma ring is better than no transaction.
///
/// # Errors
///
/// - `ValueOutOfRange` if `pool` is not sorted ascending by height.
pub fn select_gamma_decoys<T, R>(
    pool: &[DecoyCandidate<T>],
    count: usize,
    current_height: u64,
    rand: &mut R,
    params: &GammaDecoyParams,
) -> Result<Vec<DecoyCandidate<T>>>
where
    T: Clone,
    R: FnMut() -> f64,
{
    if count == 0 {
        return Ok(Vec::new());
    }
    // Validate sort.
    for w in pool.windows(2) {
        if w[1].height < w[0].height {
            return Err(CryptoError::ValueOutOfRange);
        }
    }

    let mut chosen = vec![false; pool.len()];
    let mut out: Vec<DecoyCandidate<T>> = Vec::with_capacity(count);
    let mut resamples = 0usize;
    let resample_cap = params.max_resamples.saturating_mul(count);

    while out.len() < count && resamples < resample_cap {
        resamples += 1;
        // 1) Sample log-age from gamma.
        let log_age = match sample_gamma(params.shape, params.scale, rand) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // 2) Convert to blocks.
        let age = log_age.exp();
        if !age.is_finite() {
            continue;
        }
        let age_u = age as i128;
        if age_u < i128::from(params.min_age) {
            continue;
        }
        if pool.is_empty() {
            break;
        }
        let target = i128::from(current_height) - age_u;
        let lo_h = i128::from(pool[0].height);
        let hi_h = i128::from(pool[pool.len() - 1].height);
        if target < lo_h || target > hi_h {
            continue;
        }
        // 3) Binary search for largest index with height ≤ target.
        let target_u = target as u64;
        let mut lo = 0usize;
        let mut hi = pool.len() - 1;
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            if pool[mid].height <= target_u {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        if chosen[lo] {
            continue;
        }
        chosen[lo] = true;
        out.push(pool[lo].clone());
    }

    // 4) Uniform-fallback top-up.
    if out.len() < count {
        let mut remaining: Vec<usize> =
            (0..pool.len()).filter(|i| !chosen[*i]).collect();
        while out.len() < count && !remaining.is_empty() {
            let i = (rand() * remaining.len() as f64) as usize;
            let i = i.min(remaining.len() - 1);
            out.push(pool[remaining[i]].clone());
            remaining.swap_remove(i);
        }
    }

    Ok(out)
}

/* ----------------------------------------------------------------------- *
 *  INTROSPECTION                                                          *
 * ----------------------------------------------------------------------- */

/// Diagnostic statistics over the gamma-age distribution.
#[derive(Debug, Clone, Copy)]
pub struct GammaAgeStats {
    /// Mean age (blocks).
    pub mean: f64,
    /// Median age.
    pub median: f64,
    /// 95th percentile.
    pub p95: f64,
    /// Maximum.
    pub max: f64,
}

/// Sample `samples` ages and report basic distribution statistics.
///
/// # Errors
///
/// Propagates `sample_gamma`'s parameter-validation error.
pub fn gamma_age_stats<R: FnMut() -> f64>(
    samples: usize,
    rand: &mut R,
    params: &GammaDecoyParams,
) -> Result<GammaAgeStats> {
    let mut ages = Vec::with_capacity(samples);
    for _ in 0..samples {
        let a = sample_gamma(params.shape, params.scale, rand)?.exp();
        if a.is_finite() {
            ages.push(a);
        }
    }
    if ages.is_empty() {
        return Ok(GammaAgeStats {
            mean: 0.0,
            median: 0.0,
            p95: 0.0,
            max: 0.0,
        });
    }
    ages.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mean = ages.iter().sum::<f64>() / ages.len() as f64;
    let median = ages[ages.len() / 2];
    let p95 = ages[(ages.len() as f64 * 0.95) as usize];
    let max = ages[ages.len() - 1];
    Ok(GammaAgeStats {
        mean,
        median,
        p95,
        max,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_rng_is_deterministic() {
        let mut a = seeded_rng(42);
        let mut b = seeded_rng(42);
        for _ in 0..32 {
            assert_eq!(a(), b());
        }
    }

    #[test]
    fn seeded_rng_in_unit_interval() {
        let mut r = seeded_rng(0xdead);
        for _ in 0..1024 {
            let x = r();
            assert!((0.0..1.0).contains(&x), "rng escaped [0,1): {x}");
        }
    }

    #[test]
    fn normal_has_correct_moments() {
        let mut r = seeded_rng(7);
        let mut samples = Vec::new();
        for _ in 0..10_000 {
            samples.push(sample_normal(&mut r));
        }
        let mean: f64 = samples.iter().sum::<f64>() / samples.len() as f64;
        let var: f64 = samples.iter().map(|x| (x - mean).powi(2)).sum::<f64>()
            / samples.len() as f64;
        assert!(mean.abs() < 0.05, "mean ≈ 0, got {mean}");
        assert!(
            (var - 1.0).abs() < 0.05,
            "variance ≈ 1, got {var}"
        );
    }

    #[test]
    fn gamma_has_correct_mean() {
        // E[Gamma(k, θ)] = k·θ.
        let mut r = seeded_rng(123);
        let shape = 19.28_f64;
        let scale = 1.0 / 1.61_f64;
        let mut samples = Vec::new();
        for _ in 0..10_000 {
            samples.push(sample_gamma(shape, scale, &mut r).unwrap());
        }
        let mean = samples.iter().sum::<f64>() / samples.len() as f64;
        let expected = shape * scale;
        assert!(
            (mean - expected).abs() / expected < 0.05,
            "mean {mean} should be near {expected}"
        );
    }

    #[test]
    fn gamma_validates_params() {
        let mut r = seeded_rng(0);
        assert!(matches!(
            sample_gamma(0.0, 1.0, &mut r),
            Err(CryptoError::ValueOutOfRange)
        ));
        assert!(matches!(
            sample_gamma(1.0, -1.0, &mut r),
            Err(CryptoError::ValueOutOfRange)
        ));
    }

    fn synthetic_pool(n: usize) -> Vec<DecoyCandidate<usize>> {
        (0..n)
            .map(|i| DecoyCandidate {
                height: i as u64,
                data: i,
            })
            .collect()
    }

    #[test]
    fn select_returns_requested_count() {
        let pool = synthetic_pool(10_000);
        let mut r = seeded_rng(0xc0ffee);
        let picks =
            select_gamma_decoys(&pool, 16, 10_000, &mut r, &DEFAULT_GAMMA_PARAMS).unwrap();
        assert_eq!(picks.len(), 16);
        // No duplicates.
        let mut heights: Vec<u64> = picks.iter().map(|p| p.height).collect();
        heights.sort_unstable();
        heights.dedup();
        assert_eq!(heights.len(), 16);
    }

    #[test]
    fn select_skews_recent() {
        // Sanity: median of picked heights should be >> 0 and < current_height,
        // and lean toward recent.
        let pool = synthetic_pool(100_000);
        let current = 100_000u64;
        let mut r = seeded_rng(42);
        let mut all_heights = Vec::new();
        for _ in 0..100 {
            let picks =
                select_gamma_decoys(&pool, 16, current, &mut r, &DEFAULT_GAMMA_PARAMS).unwrap();
            for p in picks {
                all_heights.push(p.height);
            }
        }
        all_heights.sort_unstable();
        let median = all_heights[all_heights.len() / 2];
        // For gamma with mean ≈ exp(12) ≈ 1.6e5 blocks, on a 100k-block chain
        // the median lands in the recent half, not the ancient half.
        assert!(
            median > current / 2,
            "median {median} should be > current/2 = {}",
            current / 2
        );
    }

    #[test]
    fn select_rejects_unsorted_pool() {
        let pool = vec![
            DecoyCandidate {
                height: 10,
                data: 0,
            },
            DecoyCandidate {
                height: 5,
                data: 1,
            },
        ];
        let mut r = seeded_rng(0);
        assert!(matches!(
            select_gamma_decoys(&pool, 1, 100, &mut r, &DEFAULT_GAMMA_PARAMS),
            Err(CryptoError::ValueOutOfRange)
        ));
    }

    #[test]
    fn select_count_zero_returns_empty() {
        let pool = synthetic_pool(10);
        let mut r = seeded_rng(0);
        let v = select_gamma_decoys(&pool, 0, 100, &mut r, &DEFAULT_GAMMA_PARAMS).unwrap();
        assert!(v.is_empty());
    }
}
