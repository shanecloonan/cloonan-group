//! Bulletproofs — short, transparent range proofs.
//!
//! Reference: Bünz, Bootle, Boneh, Poelstra, Wuille, Maxwell, 2017
//! [`eprint.iacr.org/2017/1066`].
//!
//! ## Why this replaces [`crate::range`]
//!
//! The Borromean range proofs in `range.rs` work but cost
//! `32·N + 32·3·N ≈ 8 KB` at `N = 64` bits per output. Bulletproofs
//! collapse the same statement into `2·log₂(N)` curve points + 5 scalars
//! — about 672 bytes at `N = 64`. ~12× compression, identical security,
//! no trusted setup.
//!
//! All modern privacy chains using confidential amounts (Monero post-2018,
//! Mimblewimble, Grin, Tari, …) ship Bulletproofs for exactly this reason.
//!
//! ## Construction
//!
//! Range proof for `V = γ·G + v·H,  v ∈ [0, 2^N)`:
//!
//! ```text
//!   1. Bit decompose a_L ∈ {0,1}^N,  a_R = a_L − 1^N
//!   2. A = α·G + ⟨a_L, G_vec⟩ + ⟨a_R, H_vec⟩
//!   3. S = ρ·G + ⟨s_L, G_vec⟩ + ⟨s_R, H_vec⟩    (random s_L, s_R)
//!   4. (y, z) = FS(V, A, S)
//!   5. l(X) = (a_L − z·1^N) + s_L·X
//!      r(X) = y^N ⊙ (a_R + z·1^N + s_R·X) + z²·2^N
//!      t(X) = ⟨l(X), r(X)⟩ = t₀ + t₁·X + t₂·X²
//!   6. T₁ = t₁·H + τ₁·G,  T₂ = t₂·H + τ₂·G   (random τ₁, τ₂)
//!   7. x = FS(T₁, T₂)
//!   8. l = l(x), r = r(x), t̂ = ⟨l, r⟩
//!      τ_x = τ₁·x + τ₂·x² + z²·γ
//!      μ   = α + ρ·x
//!   9. Replace the O(N) communication of (l, r) with the
//!      Inner Product Argument (IPA) → O(log N).
//! ```
//!
//! Mirrors `lib/network/bulletproofs.ts` byte-for-byte.

#![allow(clippy::needless_range_loop)]

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;

use crate::codec::{Reader, Writer};
use crate::domain::{BP_INNER_PROD, BP_RANGE};
use crate::hash::{dhash64, hash_to_point};
use crate::point::{generator_g, generator_h};
use crate::scalar::random_scalar;
use crate::{CryptoError, Result};

/* ----------------------------------------------------------------------- *
 *  SCALAR / VECTOR OPS                                                    *
 * ----------------------------------------------------------------------- */

fn inner_product(a: &[Scalar], b: &[Scalar]) -> Scalar {
    debug_assert_eq!(a.len(), b.len());
    let mut acc = Scalar::ZERO;
    for (ai, bi) in a.iter().zip(b.iter()) {
        acc += ai * bi;
    }
    acc
}

fn vec_scalar_mul(v: &[Scalar], k: &Scalar) -> Vec<Scalar> {
    v.iter().map(|x| x * k).collect()
}

fn vec_add(a: &[Scalar], b: &[Scalar]) -> Vec<Scalar> {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b.iter()).map(|(x, y)| x + y).collect()
}

fn vec_sub(a: &[Scalar], b: &[Scalar]) -> Vec<Scalar> {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b.iter()).map(|(x, y)| x - y).collect()
}

fn hadamard(a: &[Scalar], b: &[Scalar]) -> Vec<Scalar> {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b.iter()).map(|(x, y)| x * y).collect()
}

/// Vector Pedersen-style commitment `⟨v, P⟩ = Σ v_i·P_i`.
fn vec_commit(v: &[Scalar], pts: &[EdwardsPoint]) -> EdwardsPoint {
    debug_assert_eq!(v.len(), pts.len());
    let mut acc = EdwardsPoint::identity();
    for (vi, pi) in v.iter().zip(pts.iter()) {
        if *vi == Scalar::ZERO {
            continue;
        }
        acc += pi * vi;
    }
    acc
}

/// Domain-separated hash-to-scalar over BP_RANGE.
fn hs(parts: &[&[u8]]) -> Scalar {
    let wide = dhash64(BP_RANGE, parts);
    Scalar::from_bytes_mod_order_wide(&wide)
}

/* ----------------------------------------------------------------------- *
 *  GENERATORS                                                             *
 *                                                                         *
 *  G_vec[i] / H_vec[i] / U derived deterministically from N + index. No   *
 *  trusted setup needed: prover and verifier independently recompute.     *
 * ----------------------------------------------------------------------- */

fn gen_g(i: u32, n: u32) -> EdwardsPoint {
    let mut w = Writer::new();
    w.varint(u64::from(n)).u8(0).u32(i);
    hash_to_point(w.bytes()).expect("hash_to_point: bulletproofs generator")
}

fn gen_h(i: u32, n: u32) -> EdwardsPoint {
    let mut w = Writer::new();
    w.varint(u64::from(n)).u8(1).u32(i);
    hash_to_point(w.bytes()).expect("hash_to_point: bulletproofs generator")
}

fn gen_u(n: u32) -> EdwardsPoint {
    let mut w = Writer::new();
    w.varint(u64::from(n)).u8(2);
    hash_to_point(w.bytes()).expect("hash_to_point: bulletproofs generator")
}

/* ----------------------------------------------------------------------- *
 *  INNER PRODUCT ARGUMENT                                                 *
 *                                                                         *
 *  Proves ⟨l, r⟩ = c given                                                *
 *    P = ⟨l, G_vec⟩ + ⟨r, H_vec⟩ + c·U                                    *
 *  in O(log N) communication.                                             *
 * ----------------------------------------------------------------------- */

/// Inner Product Argument proof.
#[derive(Debug, Clone)]
pub struct IpaProof {
    /// `L_j` points from each fold round (length `log₂(N)`).
    pub l_vec: Vec<EdwardsPoint>,
    /// `R_j` points from each fold round (length `log₂(N)`).
    pub r_vec: Vec<EdwardsPoint>,
    /// Final folded `l`.
    pub a: Scalar,
    /// Final folded `r`.
    pub b: Scalar,
}

fn ipa_prove(
    g_v: &[EdwardsPoint],
    h_v: &[EdwardsPoint],
    u: &EdwardsPoint,
    l: &[Scalar],
    r: &[Scalar],
    transcript_seed: &[u8; 64],
) -> IpaProof {
    let mut l_vec = Vec::new();
    let mut r_vec = Vec::new();
    let mut a: Vec<Scalar> = l.to_vec();
    let mut b: Vec<Scalar> = r.to_vec();
    let mut g_cur: Vec<EdwardsPoint> = g_v.to_vec();
    let mut h_cur: Vec<EdwardsPoint> = h_v.to_vec();
    let mut prev: Vec<u8> = transcript_seed.to_vec();

    while a.len() > 1 {
        let half = a.len() / 2;
        let (a_l, a_r) = a.split_at(half);
        let (b_l, b_r) = b.split_at(half);
        let (g_l, g_r) = g_cur.split_at(half);
        let (h_l, h_r) = h_cur.split_at(half);

        let c_l = inner_product(a_l, b_r);
        let c_r = inner_product(a_r, b_l);

        // L = ⟨aL, GR⟩ + ⟨bR, HL⟩ + cL·U
        // R = ⟨aR, GL⟩ + ⟨bL, HR⟩ + cR·U
        let l_com = vec_commit(a_l, g_r) + vec_commit(b_r, h_l) + (u * c_l);
        let r_com = vec_commit(a_r, g_l) + vec_commit(b_l, h_r) + (u * c_r);

        l_vec.push(l_com);
        r_vec.push(r_com);

        let l_bytes = l_com.compress().to_bytes();
        let r_bytes = r_com.compress().to_bytes();

        let u_chal = hs(&[&prev, &l_bytes, &r_bytes]);
        prev = dhash64(BP_INNER_PROD, &[&prev, &l_bytes, &r_bytes]).to_vec();
        let u_inv = u_chal.invert();

        let mut a_new = Vec::with_capacity(half);
        let mut b_new = Vec::with_capacity(half);
        let mut g_new = Vec::with_capacity(half);
        let mut h_new = Vec::with_capacity(half);
        for i in 0..half {
            a_new.push((u_chal * a_l[i]) + (u_inv * a_r[i]));
            b_new.push((u_inv * b_l[i]) + (u_chal * b_r[i]));
            g_new.push((g_l[i] * u_inv) + (g_r[i] * u_chal));
            h_new.push((h_l[i] * u_chal) + (h_r[i] * u_inv));
        }
        a = a_new;
        b = b_new;
        g_cur = g_new;
        h_cur = h_new;
    }

    IpaProof {
        l_vec,
        r_vec,
        a: a[0],
        b: b[0],
    }
}

/// Reconstruct `s_i` for `i ∈ [0, N)` from the folded challenges. Saves
/// the verifier from recomputing folded generator vectors iteratively.
fn ipa_s_vector(challenges: &[Scalar], invs: &[Scalar], big_n: usize) -> Vec<Scalar> {
    let k = challenges.len();
    let mut s = vec![Scalar::ONE; big_n];
    for i in 0..big_n {
        let mut acc = Scalar::ONE;
        for j in 0..k {
            let bit = (i >> (k - 1 - j)) & 1;
            acc *= if bit == 1 { challenges[j] } else { invs[j] };
        }
        s[i] = acc;
    }
    s
}

fn ipa_verify(
    g_v: &[EdwardsPoint],
    h_v: &[EdwardsPoint],
    u: &EdwardsPoint,
    p: &EdwardsPoint,
    proof: &IpaProof,
    transcript_seed: &[u8; 64],
) -> bool {
    let mut challenges: Vec<Scalar> = Vec::with_capacity(proof.l_vec.len());
    let mut prev: Vec<u8> = transcript_seed.to_vec();
    for j in 0..proof.l_vec.len() {
        let l_bytes = proof.l_vec[j].compress().to_bytes();
        let r_bytes = proof.r_vec[j].compress().to_bytes();
        let u_chal = hs(&[&prev, &l_bytes, &r_bytes]);
        challenges.push(u_chal);
        prev = dhash64(BP_INNER_PROD, &[&prev, &l_bytes, &r_bytes]).to_vec();
    }
    let invs: Vec<Scalar> = challenges.iter().map(Scalar::invert).collect();

    // P' = P + Σ u_j² · L_j + Σ u_j^{-2} · R_j
    let mut p_folded = *p;
    for j in 0..challenges.len() {
        let u2 = challenges[j] * challenges[j];
        let u_inv2 = invs[j] * invs[j];
        p_folded += proof.l_vec[j] * u2;
        p_folded += proof.r_vec[j] * u_inv2;
    }

    let big_n = g_v.len();
    let s = ipa_s_vector(&challenges, &invs, big_n);
    let s_inv: Vec<Scalar> = s.iter().map(Scalar::invert).collect();

    let mut g_sum = EdwardsPoint::identity();
    let mut h_sum = EdwardsPoint::identity();
    for i in 0..big_n {
        g_sum += g_v[i] * s[i];
        h_sum += h_v[i] * s_inv[i];
    }

    let expected = (g_sum * proof.a) + (h_sum * proof.b) + (u * (proof.a * proof.b));
    p_folded == expected
}

/* ----------------------------------------------------------------------- *
 *  RANGE PROOF                                                            *
 * ----------------------------------------------------------------------- */

/// A Bulletproofs range proof for a single Pedersen commitment.
#[derive(Debug, Clone)]
pub struct BulletproofRange {
    /// Bit width of the proven range.
    pub n: u32,
    /// Public commitment `V = γ·G + v·H`.
    pub v: EdwardsPoint,
    /// Setup point `A`.
    pub a: EdwardsPoint,
    /// Setup point `S`.
    pub s: EdwardsPoint,
    /// `T₁`.
    pub t1: EdwardsPoint,
    /// `T₂`.
    pub t2: EdwardsPoint,
    /// `t̂ = ⟨l, r⟩`.
    pub t_hat: Scalar,
    /// `τ_x`.
    pub tau_x: Scalar,
    /// `μ`.
    pub mu: Scalar,
    /// Inner-product proof.
    pub ipa: IpaProof,
}

fn is_pow2_in_range(n: u32) -> bool {
    n > 0 && n <= 64 && (n & (n - 1)) == 0
}

fn pow_vec(base: &Scalar, n: usize) -> Vec<Scalar> {
    let mut out = Vec::with_capacity(n);
    let mut acc = Scalar::ONE;
    for _ in 0..n {
        out.push(acc);
        acc *= base;
    }
    out
}

fn bigint_to_bytes_le(s: &Scalar) -> [u8; 32] {
    s.to_bytes()
}

/// Output of [`bp_prove`] — commitment plus proof.
#[derive(Debug, Clone)]
pub struct BpProveOutput {
    /// The public commitment.
    pub v: EdwardsPoint,
    /// The range proof.
    pub proof: BulletproofRange,
}

/// Build a Bulletproofs range proof for `v ∈ [0, 2^N)` against blinding `γ`.
///
/// # Errors
///
/// - `ValueOutOfRange` if `n` is not a power of 2 in `(0, 64]`, or if
///   `value >= 2^n`.
pub fn bp_prove(value: u64, blinding: &Scalar, n: u32) -> Result<BpProveOutput> {
    if !is_pow2_in_range(n) {
        return Err(CryptoError::ValueOutOfRange);
    }
    if n < 64 && value >= (1u64 << n) {
        return Err(CryptoError::ValueOutOfRange);
    }
    let big_n = n as usize;

    // Generators.
    let mut g_v = Vec::with_capacity(big_n);
    let mut h_v = Vec::with_capacity(big_n);
    for i in 0..n {
        g_v.push(gen_g(i, n));
        h_v.push(gen_h(i, n));
    }
    let u = gen_u(n);
    let g = generator_g();
    let h_pt = generator_h();

    // Public commitment.
    let v_pt = (g * blinding) + (h_pt * Scalar::from(value));

    // Bit decomposition.
    let mut a_l: Vec<Scalar> = Vec::with_capacity(big_n);
    let mut a_r: Vec<Scalar> = Vec::with_capacity(big_n);
    for i in 0..n {
        let bit = (value >> i) & 1;
        let s_bit = Scalar::from(bit);
        a_l.push(s_bit);
        a_r.push(s_bit - Scalar::ONE);
    }

    // A = α·G + ⟨a_L, G_v⟩ + ⟨a_R, H_v⟩
    let alpha = random_scalar();
    let a_setup = (g * alpha) + vec_commit(&a_l, &g_v) + vec_commit(&a_r, &h_v);

    // S = ρ·G + ⟨s_L, G_v⟩ + ⟨s_R, H_v⟩
    let s_l: Vec<Scalar> = (0..big_n).map(|_| random_scalar()).collect();
    let s_r: Vec<Scalar> = (0..big_n).map(|_| random_scalar()).collect();
    let rho = random_scalar();
    let s_setup = (g * rho) + vec_commit(&s_l, &g_v) + vec_commit(&s_r, &h_v);

    // y, z challenges.
    let v_bytes = v_pt.compress().to_bytes();
    let a_bytes = a_setup.compress().to_bytes();
    let s_bytes = s_setup.compress().to_bytes();
    let y = hs(&[&v_bytes, &a_bytes, &s_bytes, &[0u8]]);
    let z = hs(&[&v_bytes, &a_bytes, &s_bytes, &[1u8]]);

    // y^N, 2^N, 1^N.
    let y_n = pow_vec(&y, big_n);
    let two_n = pow_vec(&Scalar::from(2u64), big_n);
    let ones_n = vec![Scalar::ONE; big_n];

    // l₀ = a_L − z·1^N, l₁ = s_L
    let l0 = vec_sub(&a_l, &vec_scalar_mul(&ones_n, &z));
    let l1 = s_l.clone();

    // r₀ = y^N ⊙ (a_R + z·1^N) + z²·2^N
    // r₁ = y^N ⊙ s_R
    let z2 = z * z;
    let r0 = vec_add(
        &hadamard(&y_n, &vec_add(&a_r, &vec_scalar_mul(&ones_n, &z))),
        &vec_scalar_mul(&two_n, &z2),
    );
    let r1 = hadamard(&y_n, &s_r);

    let t1 = inner_product(&l0, &r1) + inner_product(&l1, &r0);
    let t2 = inner_product(&l1, &r1);

    let tau1 = random_scalar();
    let tau2 = random_scalar();
    let big_t1 = (h_pt * t1) + (g * tau1);
    let big_t2 = (h_pt * t2) + (g * tau2);

    // x challenge.
    let x = hs(&[
        &big_t1.compress().to_bytes(),
        &big_t2.compress().to_bytes(),
    ]);

    let l = vec_add(&l0, &vec_scalar_mul(&l1, &x));
    let r = vec_add(&r0, &vec_scalar_mul(&r1, &x));

    let t_hat = inner_product(&l, &r);
    let tau_x = (tau1 * x) + (tau2 * x * x) + (z2 * blinding);
    let mu = alpha + (rho * x);

    // Rescale H_v by y^{-i}.
    let y_inv = y.invert();
    let y_inv_pow = pow_vec(&y_inv, big_n);
    let h_vy: Vec<EdwardsPoint> = h_v
        .iter()
        .zip(y_inv_pow.iter())
        .map(|(p, k)| p * k)
        .collect();

    let transcript_seed = dhash64(
        BP_RANGE,
        &[
            &v_bytes,
            &a_bytes,
            &s_bytes,
            &big_t1.compress().to_bytes(),
            &big_t2.compress().to_bytes(),
            &bigint_to_bytes_le(&t_hat),
            &bigint_to_bytes_le(&tau_x),
            &bigint_to_bytes_le(&mu),
        ],
    );

    let ipa = ipa_prove(&g_v, &h_vy, &u, &l, &r, &transcript_seed);

    Ok(BpProveOutput {
        v: v_pt,
        proof: BulletproofRange {
            n,
            v: v_pt,
            a: a_setup,
            s: s_setup,
            t1: big_t1,
            t2: big_t2,
            t_hat,
            tau_x,
            mu,
            ipa,
        },
    })
}

/// Verify a Bulletproofs range proof.
#[must_use]
pub fn bp_verify(p: &BulletproofRange) -> bool {
    if !is_pow2_in_range(p.n) {
        return false;
    }
    let big_n = p.n as usize;

    let mut g_v = Vec::with_capacity(big_n);
    let mut h_v = Vec::with_capacity(big_n);
    for i in 0..p.n {
        g_v.push(gen_g(i, p.n));
        h_v.push(gen_h(i, p.n));
    }
    let u = gen_u(p.n);
    let g = generator_g();
    let h_pt = generator_h();

    let v_bytes = p.v.compress().to_bytes();
    let a_bytes = p.a.compress().to_bytes();
    let s_bytes = p.s.compress().to_bytes();
    let y = hs(&[&v_bytes, &a_bytes, &s_bytes, &[0u8]]);
    let z = hs(&[&v_bytes, &a_bytes, &s_bytes, &[1u8]]);
    let x = hs(&[
        &p.t1.compress().to_bytes(),
        &p.t2.compress().to_bytes(),
    ]);

    let y_n = pow_vec(&y, big_n);
    let two_n = pow_vec(&Scalar::from(2u64), big_n);
    let ones_n = vec![Scalar::ONE; big_n];
    let z2 = z * z;
    let z3 = z2 * z;

    let sum_one_y = inner_product(&ones_n, &y_n);
    let sum_one_two = inner_product(&ones_n, &two_n);
    let delta = ((z - z2) * sum_one_y) - (z3 * sum_one_two);

    // First check: t̂·H + τ_x·G = z²·V + δ·H + x·T1 + x²·T2
    let lhs1 = (h_pt * p.t_hat) + (g * p.tau_x);
    let rhs1 = (p.v * z2) + (h_pt * delta) + (p.t1 * x) + (p.t2 * (x * x));
    if lhs1 != rhs1 {
        return false;
    }

    let y_inv = y.invert();
    let y_inv_pow = pow_vec(&y_inv, big_n);
    let h_vy: Vec<EdwardsPoint> = h_v
        .iter()
        .zip(y_inv_pow.iter())
        .map(|(pt, k)| pt * k)
        .collect();

    // P = A + x·S − z·Σ G_v[i] + Σ (z·y^N + z²·2^N) ⊙ H_vy − μ·G + t̂·U
    let mut big_p = p.a + (p.s * x);
    for i in 0..big_n {
        big_p -= g_v[i] * z;
    }
    for i in 0..big_n {
        let coef = (z * y_n[i]) + (z2 * two_n[i]);
        big_p += h_vy[i] * coef;
    }
    big_p -= g * p.mu;
    big_p += u * p.t_hat;

    let transcript_seed = dhash64(
        BP_RANGE,
        &[
            &v_bytes,
            &a_bytes,
            &s_bytes,
            &p.t1.compress().to_bytes(),
            &p.t2.compress().to_bytes(),
            &bigint_to_bytes_le(&p.t_hat),
            &bigint_to_bytes_le(&p.tau_x),
            &bigint_to_bytes_le(&p.mu),
        ],
    );

    ipa_verify(&g_v, &h_vy, &u, &big_p, &p.ipa, &transcript_seed)
}

/* ----------------------------------------------------------------------- *
 *  ENCODE / DECODE                                                        *
 * ----------------------------------------------------------------------- */

/// Approximate proof size (bytes) for a given `N`.
#[must_use]
pub fn bp_proof_size(n: u32) -> usize {
    if !is_pow2_in_range(n) {
        return 0;
    }
    let log_n = n.trailing_zeros() as usize;
    32 * (4 + 2 * log_n) + 32 * (3 + 2)
}

/// Encode a Bulletproof to canonical bytes.
///
/// Note: the public commitment `V` is NOT included — the caller carries
/// it separately (it's already in the transaction's output list).
#[must_use]
pub fn encode_bulletproof(p: &BulletproofRange) -> Vec<u8> {
    let mut w = Writer::new();
    w.varint(u64::from(p.n));
    w.point(&p.a);
    w.point(&p.s);
    w.point(&p.t1);
    w.point(&p.t2);
    w.scalar(&p.t_hat);
    w.scalar(&p.tau_x);
    w.scalar(&p.mu);
    w.points(&p.ipa.l_vec);
    w.points(&p.ipa.r_vec);
    w.scalar(&p.ipa.a);
    w.scalar(&p.ipa.b);
    w.into_bytes()
}

/// Decode a Bulletproof from canonical bytes, attached to the supplied `V`.
///
/// # Errors
///
/// Forwards any [`CryptoError`] from the codec layer.
pub fn decode_bulletproof(v: EdwardsPoint, bytes: &[u8]) -> Result<BulletproofRange> {
    let mut r = Reader::new(bytes);
    let n = r.varint()? as u32;
    let a = r.point()?;
    let s = r.point()?;
    let t1 = r.point()?;
    let t2 = r.point()?;
    let t_hat = r.scalar()?;
    let tau_x = r.scalar()?;
    let mu = r.scalar()?;
    let l_vec = r.points()?;
    let r_vec = r.points()?;
    let a_final = r.scalar()?;
    let b_final = r.scalar()?;
    Ok(BulletproofRange {
        n,
        v,
        a,
        s,
        t1,
        t2,
        t_hat,
        tau_x,
        mu,
        ipa: IpaProof {
            l_vec,
            r_vec,
            a: a_final,
            b: b_final,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prove_verify_small() {
        for &(v, n) in &[(0u64, 8u32), (1, 8), (7, 8), (42, 16), (255, 8)] {
            let r = random_scalar();
            let out = bp_prove(v, &r, n).expect("prove");
            // Public commitment must match canonical form.
            let expected = (generator_g() * r) + (generator_h() * Scalar::from(v));
            assert_eq!(out.v, expected);
            assert!(bp_verify(&out.proof), "verify v={v} n={n}");
        }
    }

    #[test]
    fn prove_verify_64bit() {
        for &v in &[0u64, 1, u64::MAX] {
            let r = random_scalar();
            let out = bp_prove(v, &r, 64).expect("prove");
            assert!(bp_verify(&out.proof), "verify v={v}");
        }
    }

    #[test]
    fn out_of_range_rejected() {
        let r = random_scalar();
        assert!(matches!(
            bp_prove(256, &r, 8),
            Err(CryptoError::ValueOutOfRange)
        ));
    }

    #[test]
    fn invalid_n_rejected() {
        let r = random_scalar();
        assert!(matches!(
            bp_prove(0, &r, 7),
            Err(CryptoError::ValueOutOfRange)
        )); // not pow2
        assert!(matches!(
            bp_prove(0, &r, 128),
            Err(CryptoError::ValueOutOfRange)
        ));
    }

    #[test]
    fn tampered_proof_fails() {
        let r = random_scalar();
        let out = bp_prove(123u64, &r, 32).unwrap();
        let mut bad = out.proof.clone();
        bad.t_hat += Scalar::ONE;
        assert!(!bp_verify(&bad));
    }

    #[test]
    fn tampered_v_fails() {
        let r = random_scalar();
        let out = bp_prove(123u64, &r, 32).unwrap();
        let mut bad = out.proof.clone();
        bad.v += generator_h();
        assert!(!bp_verify(&bad));
    }

    #[test]
    fn wire_round_trip() {
        let r = random_scalar();
        let out = bp_prove(0x4242_4242u64, &r, 32).unwrap();
        let bytes = encode_bulletproof(&out.proof);
        let decoded = decode_bulletproof(out.v, &bytes).expect("decode");
        assert_eq!(decoded.t_hat, out.proof.t_hat);
        assert_eq!(decoded.ipa.l_vec.len(), out.proof.ipa.l_vec.len());
        assert!(bp_verify(&decoded));
    }

    #[test]
    fn proof_size_logarithmic_in_n() {
        // Doubling N adds 2 points (L, R) of 32 bytes each = 64 bytes.
        let s_16 = bp_proof_size(16);
        let s_32 = bp_proof_size(32);
        assert_eq!(s_32 - s_16, 64);
        let s_64 = bp_proof_size(64);
        assert_eq!(s_64 - s_32, 64);
    }
}
