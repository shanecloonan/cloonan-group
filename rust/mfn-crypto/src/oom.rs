//! Groth–Kohlweiss One-out-of-Many zero-knowledge proof.
//!
//! ## The privacy moonshot
//!
//! This is the cryptographic engine behind Triptych / Lelantus / Spats —
//! the **log-size successor to Monero's CLSAG**. Given a vector of `N`
//! Pedersen-style commitments, it proves
//!
//! ```text
//!   ∃ ℓ ∈ [0, N) and r such that  ring[ℓ] = r · H
//! ```
//!
//! in `O(log N)` communication, **without revealing `ℓ` or `r`**.
//!
//! CLSAG needs `O(N)` bytes per signature; this construction needs
//! `O(log N)`. Ring size 1024 → proof ≈ 5 KB vs CLSAG's ≈ 64 KB at the
//! same `N`. Anonymity set scales accordingly.
//!
//! ## Protocol (Groth–Kohlweiss / Bootle et al., 2015–2016)
//!
//! Setup: prime-order group with generators `G`, `H` (ed25519 base + an
//! independent NUMS H). `N = 2^n` is a power of 2.
//!
//! PROVER (decompose `ℓ` LSB-first into bits `ℓ₀ ℓ₁ … ℓ_{n−1}`):
//!
//! ```text
//!   for j ∈ [0, n):
//!     a_j , r_j , s_j , t_j , ρ_k ←$ ℤ_ℓ
//!     A_j = a_j·G + s_j·H
//!     B_j = ℓ_j·G + r_j·H
//!     C_j = (ℓ_j · a_j)·G + t_j·H
//!
//!   factor_{i,j}(x) = i_j · f_j(x)  +  (1−i_j) · (x − f_j(x))
//!     where f_j(x) = ℓ_j·x + a_j
//!
//!   ∏_j factor_{i,j}(x) = δ_{i,ℓ}·x^n + Σ_k p_{i,k}·x^k
//!
//!   G_k = Σ_i p_{i,k} · ring[i]  +  ρ_k·H        for k ∈ [0, n)
//!
//!   x = H_FS(ring, A_*, B_*, C_*, G_*)
//!
//!   f_j   = ℓ_j · x + a_j           (mod ℓ)
//!   z_A_j = r_j · x + s_j           (mod ℓ)
//!   z_C_j = r_j · (x − f_j) + t_j   (mod ℓ)
//!   z_d   = r · x^n − Σ_k ρ_k · x^k (mod ℓ)
//! ```
//!
//! VERIFIER checks, for each `j`:
//!
//! - `x·B_j + A_j  =  f_j·G + z_A_j·H`   (forces `f_j` shape)
//! - `(x − f_j)·B_j + C_j  =  z_C_j·H`   (forces `ℓ_j ∈ {0, 1}`)
//!
//! …and the big identity:
//!
//! ```text
//!   Σ_i (∏_j factor_{i,j}(x))·ring[i]  =  Σ_k x^k·G_k + z_d·H
//! ```
//!
//! Mirrors `lib/network/oom.ts` byte-for-byte.

// Bit-decomposition + polynomial-coefficient indexing is fundamental to
// this protocol; indexed loops are *clearer* than iterator chains here.
#![allow(clippy::needless_range_loop)]

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;

use crate::domain::OOM_CHALLENGE;
use crate::hash::dhash64;
use crate::point::{generator_g, generator_h};
use crate::scalar::random_scalar;
use crate::{CryptoError, Result};

/* ----------------------------------------------------------------------- *
 *  POLYNOMIAL ARITHMETIC                                                  *
 * ----------------------------------------------------------------------- */

/// Multiply two polynomials given as coefficient slices (constant term first).
///
/// Result length is `a.len() + b.len() − 1` when both are non-empty, else 0.
fn poly_mul(a: &[Scalar], b: &[Scalar]) -> Vec<Scalar> {
    if a.is_empty() || b.is_empty() {
        return Vec::new();
    }
    let mut out = vec![Scalar::ZERO; a.len() + b.len() - 1];
    for (i, ai) in a.iter().enumerate() {
        if *ai == Scalar::ZERO {
            continue;
        }
        for (j, bj) in b.iter().enumerate() {
            if *bj == Scalar::ZERO {
                continue;
            }
            out[i + j] += ai * bj;
        }
    }
    out
}

#[cfg(test)]
fn poly_eval(coeffs: &[Scalar], x: &Scalar) -> Scalar {
    if coeffs.is_empty() {
        return Scalar::ZERO;
    }
    let mut acc = coeffs[coeffs.len() - 1];
    for c in coeffs.iter().rev().skip(1) {
        acc = (acc * x) + c;
    }
    acc
}

/* ----------------------------------------------------------------------- *
 *  PROOF STRUCTURE                                                        *
 * ----------------------------------------------------------------------- */

/// A one-out-of-many proof.
///
/// All array lengths equal `n = log₂(N)` where `N` is the ring size.
#[derive(Debug, Clone)]
pub struct OomProof {
    /// Per-bit commitment `A_j = a_j·G + s_j·H`.
    pub a: Vec<EdwardsPoint>,
    /// Per-bit commitment `B_j = ℓ_j·G + r_j·H`.
    pub b: Vec<EdwardsPoint>,
    /// Per-bit commitment `C_j = (ℓ_j·a_j)·G + t_j·H`.
    pub c: Vec<EdwardsPoint>,
    /// Polynomial-coefficient commitment `G_k`.
    pub g_k: Vec<EdwardsPoint>,
    /// Response `f_j = ℓ_j·x + a_j mod ℓ`.
    pub f: Vec<Scalar>,
    /// Response `z_A_j = r_j·x + s_j mod ℓ`.
    pub z_a: Vec<Scalar>,
    /// Response `z_C_j = r_j·(x − f_j) + t_j mod ℓ`.
    pub z_c: Vec<Scalar>,
    /// Final witness-binding response `z_d`.
    pub z_d: Scalar,
}

/* ----------------------------------------------------------------------- *
 *  FIAT-SHAMIR                                                            *
 * ----------------------------------------------------------------------- */

fn fs_challenge(
    ring: &[EdwardsPoint],
    a: &[EdwardsPoint],
    b: &[EdwardsPoint],
    c: &[EdwardsPoint],
    g_k: &[EdwardsPoint],
) -> Scalar {
    // Transcript framing — must match `oom.ts` byte-for-byte.
    let mut parts: Vec<Vec<u8>> = Vec::new();
    // 4-byte big-endian ring length.
    parts.push((ring.len() as u32).to_be_bytes().to_vec());
    for p in ring.iter().chain(a.iter()).chain(b.iter()).chain(c.iter()).chain(g_k.iter()) {
        parts.push(p.compress().to_bytes().to_vec());
    }
    let refs: Vec<&[u8]> = parts.iter().map(Vec::as_slice).collect();
    let wide = dhash64(OOM_CHALLENGE, &refs);
    Scalar::from_bytes_mod_order_wide(&wide)
}

/* ----------------------------------------------------------------------- *
 *  PROVE                                                                  *
 * ----------------------------------------------------------------------- */

fn is_pow2_nonzero(n: usize) -> bool {
    n != 0 && (n & (n - 1)) == 0
}

fn log2_pow2(n: usize) -> u32 {
    // Caller must have verified `is_pow2_nonzero(n)`.
    n.trailing_zeros()
}

/// Prove knowledge of `(ℓ, r)` such that `ring[ℓ] = r·H`.
///
/// # Errors
///
/// - `InvalidLength` if `ring.len()` is zero or not a power of 2.
/// - `ValueOutOfRange` if `ell >= ring.len()`.
/// - `InvalidPoint` if `ring[ell] != r·H` (witness mismatch).
pub fn oom_prove(ring: &[EdwardsPoint], ell: usize, r: &Scalar) -> Result<OomProof> {
    let big_n = ring.len();
    if !is_pow2_nonzero(big_n) {
        return Err(CryptoError::InvalidLength {
            expected: big_n.next_power_of_two().max(1),
            got: big_n,
        });
    }
    let n = log2_pow2(big_n) as usize;
    if ell >= big_n {
        return Err(CryptoError::ValueOutOfRange);
    }
    if ring[ell] != generator_h() * r {
        return Err(CryptoError::InvalidPoint);
    }

    // ── 1. Bit decomposition of `ell` (LSB first) ──
    let bits: Vec<u8> = (0..n).map(|j| ((ell >> j) & 1) as u8).collect();

    // ── 2. Random blinders ──
    let a_blind: Vec<Scalar> = (0..n).map(|_| random_scalar()).collect();
    let r_blind: Vec<Scalar> = (0..n).map(|_| random_scalar()).collect();
    let s_blind: Vec<Scalar> = (0..n).map(|_| random_scalar()).collect();
    let t_blind: Vec<Scalar> = (0..n).map(|_| random_scalar()).collect();

    // ── 3. A_j, B_j, C_j ──
    let g = generator_g();
    let h_point = generator_h();
    let mut a_pts = Vec::with_capacity(n);
    let mut b_pts = Vec::with_capacity(n);
    let mut c_pts = Vec::with_capacity(n);
    for j in 0..n {
        a_pts.push((g * a_blind[j]) + (h_point * s_blind[j]));
        if bits[j] == 1 {
            b_pts.push(g + (h_point * r_blind[j]));
            c_pts.push((g * a_blind[j]) + (h_point * t_blind[j]));
        } else {
            b_pts.push(h_point * r_blind[j]);
            c_pts.push(h_point * t_blind[j]);
        }
    }

    // ── 4. Per-i polynomial poly_i(x) = ∏_j factor_{i,j}(x). ──
    //   factor_{i,j}(x) =
    //     i_j = 0 → (1 − ℓ_j)·x − a_j        ([−a_j,  1−ℓ_j])
    //     i_j = 1 → ℓ_j·x + a_j              ([ a_j,   ℓ_j ])
    let mut p_coeffs: Vec<Vec<Scalar>> = Vec::with_capacity(big_n);
    for i in 0..big_n {
        let mut acc: Vec<Scalar> = vec![Scalar::ONE];
        for (j, &lj) in bits.iter().enumerate() {
            let ij = ((i >> j) & 1) as u8;
            let factor: [Scalar; 2] = if ij == 0 {
                [-a_blind[j], Scalar::from(u64::from(1 - lj))]
            } else {
                [a_blind[j], Scalar::from(u64::from(lj))]
            };
            acc = poly_mul(&acc, &factor);
        }
        // Pad to length n+1 so all polys are stored uniformly.
        acc.resize(n + 1, Scalar::ZERO);
        p_coeffs.push(acc);
    }

    // ── 5. ρ_k random; G_k = Σ_i p_{i,k}·ring[i] + ρ_k·H ──
    let rho: Vec<Scalar> = (0..n).map(|_| random_scalar()).collect();
    let mut g_k = Vec::with_capacity(n);
    for k in 0..n {
        let mut acc = EdwardsPoint::identity();
        for i in 0..big_n {
            let p = p_coeffs[i][k];
            if p == Scalar::ZERO {
                continue;
            }
            acc += ring[i] * p;
        }
        g_k.push(acc + (h_point * rho[k]));
    }

    // ── 6. Fiat-Shamir challenge x ──
    let x = fs_challenge(ring, &a_pts, &b_pts, &c_pts, &g_k);

    // ── 7. Responses ──
    let mut f = Vec::with_capacity(n);
    let mut z_a = Vec::with_capacity(n);
    let mut z_c = Vec::with_capacity(n);
    for j in 0..n {
        let lj = Scalar::from(u64::from(bits[j]));
        f.push((lj * x) + a_blind[j]);
        z_a.push((r_blind[j] * x) + s_blind[j]);
        let x_minus_fj = x - f[j];
        z_c.push((r_blind[j] * x_minus_fj) + t_blind[j]);
    }

    // z_d = r·x^n − Σ_k ρ_k·x^k
    let mut x_pow = Scalar::ONE;
    let mut rho_x = Scalar::ZERO;
    for rho_k in &rho {
        rho_x += rho_k * x_pow;
        x_pow *= x;
    }
    // After the loop, x_pow == x^n.
    let z_d = (r * x_pow) - rho_x;

    Ok(OomProof {
        a: a_pts,
        b: b_pts,
        c: c_pts,
        g_k,
        f,
        z_a,
        z_c,
        z_d,
    })
}

/* ----------------------------------------------------------------------- *
 *  VERIFY                                                                 *
 * ----------------------------------------------------------------------- */

/// Verify a one-out-of-many proof. Returns `true` iff valid.
#[must_use]
pub fn oom_verify(ring: &[EdwardsPoint], proof: &OomProof) -> bool {
    let big_n = ring.len();
    if !is_pow2_nonzero(big_n) {
        return false;
    }
    let n = log2_pow2(big_n) as usize;
    if proof.a.len() != n
        || proof.b.len() != n
        || proof.c.len() != n
        || proof.g_k.len() != n
        || proof.f.len() != n
        || proof.z_a.len() != n
        || proof.z_c.len() != n
    {
        return false;
    }

    let g = generator_g();
    let h_point = generator_h();
    let x = fs_challenge(ring, &proof.a, &proof.b, &proof.c, &proof.g_k);

    // Per-bit checks.
    for j in 0..n {
        let lhs1 = (proof.b[j] * x) + proof.a[j];
        let rhs1 = (g * proof.f[j]) + (h_point * proof.z_a[j]);
        if lhs1 != rhs1 {
            return false;
        }
        let x_minus_fj = x - proof.f[j];
        let lhs2 = (proof.b[j] * x_minus_fj) + proof.c[j];
        let rhs2 = h_point * proof.z_c[j];
        if lhs2 != rhs2 {
            return false;
        }
    }

    // Big-sum identity.
    let mut x_pows: Vec<Scalar> = Vec::with_capacity(n);
    let mut x_pow = Scalar::ONE;
    for _ in 0..n {
        x_pows.push(x_pow);
        x_pow *= x;
    }

    let mut lhs = EdwardsPoint::identity();
    let mut lhs_nonzero = false;
    for i in 0..big_n {
        let mut s = Scalar::ONE;
        let mut hit_zero = false;
        for j in 0..n {
            let ij = (i >> j) & 1;
            let factor = if ij == 1 {
                proof.f[j]
            } else {
                x - proof.f[j]
            };
            s *= factor;
            if s == Scalar::ZERO {
                hit_zero = true;
                break;
            }
        }
        if hit_zero {
            continue;
        }
        lhs += ring[i] * s;
        lhs_nonzero = true;
    }
    if !lhs_nonzero {
        // The big sum is zero. We conservatively reject: a legitimate
        // proof would not produce an all-zero LHS unless the prover were
        // also constructing the RHS adversarially.
        return false;
    }

    let mut rhs = EdwardsPoint::identity();
    for k in 0..n {
        rhs += proof.g_k[k] * x_pows[k];
    }
    rhs += h_point * proof.z_d;

    lhs == rhs
}

/* ----------------------------------------------------------------------- *
 *  ENCODE / DECODE                                                        *
 * ----------------------------------------------------------------------- */

/// Encode an OoM proof to canonical bytes.
///
/// Layout: `u32_be(n) || A_j…(32B each) || B_j… || C_j… || G_k…
///         || f_j…(32B LE each) || z_A_j… || z_C_j… || z_d (32B LE)`.
#[must_use]
pub fn encode_oom_proof(p: &OomProof) -> Vec<u8> {
    let n = p.a.len();
    let total = 4 + 4 * n * 32 + 3 * n * 32 + 32;
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&(n as u32).to_be_bytes());
    for arr in [&p.a, &p.b, &p.c, &p.g_k] {
        for pt in arr.iter() {
            out.extend_from_slice(pt.compress().as_bytes());
        }
    }
    for arr in [&p.f, &p.z_a, &p.z_c] {
        for s in arr.iter() {
            out.extend_from_slice(s.as_bytes());
        }
    }
    out.extend_from_slice(p.z_d.as_bytes());
    out
}

/// Decode an OoM proof from canonical bytes.
///
/// # Errors
///
/// Returns `CryptoError` for short buffers, bad lengths, or invalid points.
pub fn decode_oom_proof(bytes: &[u8]) -> Result<OomProof> {
    if bytes.len() < 4 {
        return Err(CryptoError::ShortBuffer { needed: 4 });
    }
    let n_bytes: [u8; 4] = bytes[..4].try_into().unwrap();
    let n = u32::from_be_bytes(n_bytes) as usize;
    let expected = 4 + 4 * n * 32 + 3 * n * 32 + 32;
    if bytes.len() != expected {
        return Err(CryptoError::InvalidLength {
            expected,
            got: bytes.len(),
        });
    }
    let mut off = 4usize;
    let read_point = |off: &mut usize| -> Result<EdwardsPoint> {
        let arr: [u8; 32] = bytes[*off..*off + 32].try_into().unwrap();
        *off += 32;
        curve25519_dalek::edwards::CompressedEdwardsY(arr)
            .decompress()
            .ok_or(CryptoError::InvalidPoint)
    };
    let read_scalar = |off: &mut usize| -> Scalar {
        let arr: [u8; 32] = bytes[*off..*off + 32].try_into().unwrap();
        *off += 32;
        Scalar::from_bytes_mod_order(arr)
    };

    let mut a = Vec::with_capacity(n);
    let mut b = Vec::with_capacity(n);
    let mut c = Vec::with_capacity(n);
    let mut g_k = Vec::with_capacity(n);
    for _ in 0..n {
        a.push(read_point(&mut off)?);
    }
    for _ in 0..n {
        b.push(read_point(&mut off)?);
    }
    for _ in 0..n {
        c.push(read_point(&mut off)?);
    }
    for _ in 0..n {
        g_k.push(read_point(&mut off)?);
    }
    let mut f = Vec::with_capacity(n);
    let mut z_a = Vec::with_capacity(n);
    let mut z_c = Vec::with_capacity(n);
    for _ in 0..n {
        f.push(read_scalar(&mut off));
    }
    for _ in 0..n {
        z_a.push(read_scalar(&mut off));
    }
    for _ in 0..n {
        z_c.push(read_scalar(&mut off));
    }
    let z_d = read_scalar(&mut off);

    Ok(OomProof {
        a,
        b,
        c,
        g_k,
        f,
        z_a,
        z_c,
        z_d,
    })
}

/// Return the wire-encoded size in bytes for ring size `big_n`.
#[must_use]
pub fn oom_proof_size(big_n: usize) -> usize {
    if !is_pow2_nonzero(big_n) {
        return 0;
    }
    let n = log2_pow2(big_n) as usize;
    4 + 4 * n * 32 + 3 * n * 32 + 32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_ring(big_n: usize, ell: usize) -> (Vec<EdwardsPoint>, Scalar) {
        let r = random_scalar();
        let mut ring: Vec<EdwardsPoint> = (0..big_n)
            .map(|_| generator_h() * random_scalar())
            .collect();
        ring[ell] = generator_h() * r;
        (ring, r)
    }

    #[test]
    fn poly_mul_basic() {
        // (1 + x) · (1 − x) = 1 − x²
        let a = vec![Scalar::ONE, Scalar::ONE];
        let b = vec![Scalar::ONE, -Scalar::ONE];
        let c = poly_mul(&a, &b);
        assert_eq!(c.len(), 3);
        assert_eq!(c[0], Scalar::ONE);
        assert_eq!(c[1], Scalar::ZERO);
        assert_eq!(c[2], -Scalar::ONE);
    }

    #[test]
    fn poly_eval_basic() {
        // p(x) = 2 + 3x + 5x². p(2) = 2 + 6 + 20 = 28.
        let p = vec![Scalar::from(2u64), Scalar::from(3u64), Scalar::from(5u64)];
        let val = poly_eval(&p, &Scalar::from(2u64));
        assert_eq!(val, Scalar::from(28u64));
    }

    #[test]
    fn prove_verify_n4() {
        for ell in 0..4 {
            let (ring, r) = random_ring(4, ell);
            let proof = oom_prove(&ring, ell, &r).expect("prove");
            assert!(oom_verify(&ring, &proof), "verify ell={ell}");
        }
    }

    #[test]
    fn prove_verify_n16() {
        let ell = 11;
        let (ring, r) = random_ring(16, ell);
        let proof = oom_prove(&ring, ell, &r).expect("prove");
        assert!(oom_verify(&ring, &proof));
    }

    #[test]
    fn prove_verify_n64() {
        let ell = 37;
        let (ring, r) = random_ring(64, ell);
        let proof = oom_prove(&ring, ell, &r).expect("prove");
        assert!(oom_verify(&ring, &proof));
    }

    #[test]
    fn prove_verify_n256() {
        let ell = 199;
        let (ring, r) = random_ring(256, ell);
        let proof = oom_prove(&ring, ell, &r).expect("prove");
        assert!(oom_verify(&ring, &proof));
    }

    #[test]
    fn non_power_of_two_rejected() {
        let ring: Vec<_> = (0..5).map(|_| generator_h()).collect();
        let r = Scalar::ONE;
        assert!(matches!(
            oom_prove(&ring, 0, &r),
            Err(CryptoError::InvalidLength { .. })
        ));
    }

    #[test]
    fn ell_out_of_range_rejected() {
        let (ring, r) = random_ring(8, 0);
        assert!(matches!(
            oom_prove(&ring, 8, &r),
            Err(CryptoError::ValueOutOfRange)
        ));
    }

    #[test]
    fn witness_mismatch_rejected() {
        let (mut ring, _r) = random_ring(8, 3);
        // Overwrite ring[3] so it no longer equals r·H.
        ring[3] = generator_h() * (random_scalar() + Scalar::ONE);
        let r = random_scalar();
        assert!(matches!(
            oom_prove(&ring, 3, &r),
            Err(CryptoError::InvalidPoint)
        ));
    }

    #[test]
    fn tampered_a_rejected() {
        let (ring, r) = random_ring(8, 3);
        let mut proof = oom_prove(&ring, 3, &r).unwrap();
        proof.a[0] += generator_g();
        assert!(!oom_verify(&ring, &proof));
    }

    #[test]
    fn tampered_f_rejected() {
        let (ring, r) = random_ring(8, 3);
        let mut proof = oom_prove(&ring, 3, &r).unwrap();
        proof.f[0] += Scalar::ONE;
        assert!(!oom_verify(&ring, &proof));
    }

    #[test]
    fn tampered_ring_rejected() {
        let (mut ring, r) = random_ring(8, 3);
        let proof = oom_prove(&ring, 3, &r).unwrap();
        ring[5] = generator_h() * random_scalar();
        assert!(!oom_verify(&ring, &proof));
    }

    #[test]
    fn wire_round_trip() {
        let (ring, r) = random_ring(32, 17);
        let proof = oom_prove(&ring, 17, &r).unwrap();
        let bytes = encode_oom_proof(&proof);
        assert_eq!(bytes.len(), oom_proof_size(32));
        let decoded = decode_oom_proof(&bytes).expect("decode");
        assert!(oom_verify(&ring, &decoded));
    }

    #[test]
    fn proof_size_logarithmic() {
        // Confirm log-size scaling: doubling N adds one "rung" worth of
        // points + scalars = 4·32 + 3·32 = 224 bytes.
        let s_64 = oom_proof_size(64);
        let s_128 = oom_proof_size(128);
        assert_eq!(s_128 - s_64, 224);
    }
}
