//! O(N) range proof for Pedersen commitments.
//!
//! Proves that a Pedersen commitment `C = r·G + v·H` hides a value
//! `v ∈ [0, 2^N)` without revealing `v` or `r`. This prevents an attacker
//! from inflating the supply by committing to a "negative" value, since in
//! ℤ_ℓ there is no order — without an explicit range proof, a malicious
//! sender could commit to `v = ℓ − 1` (a giant number that wraps to look
//! small) and steal value.
//!
//! ## Construction
//!
//! Decompose `v` into bits: `v = Σ b_i · 2^i, b_i ∈ {0,1}, i ∈ [0, N)`.
//!
//! For each bit `i`, publish a sub-commitment
//! `C_i = r_i · G + b_i · 2^i · H`. Blindings are chosen so that
//! `Σ r_i = r`, giving `Σ C_i = C`.
//!
//! For each bit prove
//! `C_i ∈ { r_i·G ,  r_i·G + 2^i·H }`
//! — a 1-of-2 Σ-OR-proof (Cramer–Damgård–Schoenmakers) compiled to a
//! non-interactive proof via Fiat–Shamir.
//!
//! Range follows from the bit constraint plus bit-decomposition.
//!
//! This is the "AOS" / Maxwell variant used by Monero before Bulletproofs;
//! they are provably equivalent. Proof size is `O(N)`. The future
//! [`bulletproofs`](crate) module will provide an `O(log N)` drop-in
//! replacement with identical semantics.
//!
//! Mirrors `lib/network/range.ts` byte-for-byte.

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;

use crate::codec::{Reader, Writer};
use crate::domain::RANGE_FINAL;
use crate::hash::dhash64;
use crate::point::{generator_g, generator_h};
use crate::scalar::random_scalar;
use crate::{CryptoError, Result};

/// Default range width: 64 bits (matches the protocol's u64 amounts).
pub const RANGE_N_BITS_DEFAULT: u32 = 64;

/// A range proof for one Pedersen commitment.
#[derive(Debug, Clone)]
pub struct RangeProof {
    /// Number of bits being proven (`v ∈ [0, 2^N)`).
    pub n: u32,
    /// Per-bit sub-commitments `C_i = r_i·G + b_i·2^i·H`.
    pub bit_commits: Vec<EdwardsPoint>,
    /// Aggregated Fiat-Shamir challenge.
    pub e: Scalar,
    /// Per-bit "branch 0" challenge. Branch 1 challenge is `e − c0[i]`.
    pub c0: Vec<Scalar>,
    /// Per-bit branch-0 response.
    pub s0: Vec<Scalar>,
    /// Per-bit branch-1 response.
    pub s1: Vec<Scalar>,
}

/* ----------------------------------------------------------------------- *
 *  HELPERS                                                                *
 * ----------------------------------------------------------------------- */

/// `2^i · H` as an Edwards point. Caller guarantees `i < 64`.
fn weight_h(i: u32) -> EdwardsPoint {
    generator_h() * Scalar::from(1u64 << i)
}

/// Return `(pk0, pk1)` for the bit's OR proof. The signer's witness w.r.t.
/// `G` is `r_i` for *whichever branch is true*.
fn bit_pubkeys(c_i: &EdwardsPoint, i: u32) -> (EdwardsPoint, EdwardsPoint) {
    (*c_i, c_i - weight_h(i))
}

/// Transcript bytes: `C || C_i… || R0_i… || R1_i…`.
fn transcript(
    c: &EdwardsPoint,
    bit_commits: &[EdwardsPoint],
    r0: &[EdwardsPoint],
    r1: &[EdwardsPoint],
) -> Vec<u8> {
    let mut w = Writer::new();
    w.point(c);
    w.points(bit_commits);
    w.points(r0);
    w.points(r1);
    w.into_bytes()
}

/// Domain-separated SHA-512 → mod-ℓ scalar.
fn hs(parts: &[&[u8]]) -> Scalar {
    let wide = dhash64(RANGE_FINAL, parts);
    Scalar::from_bytes_mod_order_wide(&wide)
}

/* ----------------------------------------------------------------------- *
 *  PROVE                                                                  *
 * ----------------------------------------------------------------------- */

/// The aggregated commitment plus its proof.
#[derive(Debug, Clone)]
pub struct RangeProveOutput {
    /// The aggregated commitment `C = r·G + v·H`.
    pub c: EdwardsPoint,
    /// The proof.
    pub proof: RangeProof,
}

/// Build a range proof for `C = r·G + v·H`.
///
/// # Errors
///
/// - `ValueOutOfRange` if `value >= 2^N` or `N` is out of `(0, 64]`.
pub fn range_prove(value: u64, blinding: &Scalar, n: u32) -> Result<RangeProveOutput> {
    if n == 0 || n > 64 {
        return Err(CryptoError::ValueOutOfRange);
    }
    if n < 64 && value >= (1u64 << n) {
        return Err(CryptoError::ValueOutOfRange);
    }

    let n_usize = n as usize;

    // Bit-decompose v.
    let mut bits = Vec::with_capacity(n_usize);
    for i in 0..n {
        bits.push(((value >> i) & 1) as u8);
    }

    // Pick blindings r_0..r_{N-2} freely; force r_{N-1} so Σ r_i = r.
    let mut r = Vec::with_capacity(n_usize);
    let mut sum = Scalar::ZERO;
    for _ in 0..(n_usize - 1) {
        let r_i = random_scalar();
        sum += r_i;
        r.push(r_i);
    }
    r.push(blinding - sum);

    // Per-bit commitments.
    let mut c_i: Vec<EdwardsPoint> = Vec::with_capacity(n_usize);
    for (i, (b, r_i)) in bits.iter().zip(r.iter()).enumerate() {
        let i_u32 = i as u32;
        let term = generator_g() * r_i;
        c_i.push(if *b == 1 {
            term + weight_h(i_u32)
        } else {
            term
        });
    }

    // Aggregate: Σ C_i = (Σ r_i)·G + (Σ b_i·2^i)·H = r·G + v·H = C.
    let mut c = EdwardsPoint::identity();
    for ci in &c_i {
        c += ci;
    }

    // Build the per-bit R_0, R_1 commitments.
    let mut alpha = Vec::with_capacity(n_usize);
    let mut c_fake = Vec::with_capacity(n_usize);
    let mut s_fake = Vec::with_capacity(n_usize);
    let mut r0 = Vec::with_capacity(n_usize);
    let mut r1 = Vec::with_capacity(n_usize);

    for (i, (b, ci_ref)) in bits.iter().zip(c_i.iter()).enumerate() {
        let i_u32 = i as u32;
        let (pk0, pk1) = bit_pubkeys(ci_ref, i_u32);
        let a = random_scalar();
        let cf = random_scalar();
        let sf = random_scalar();
        alpha.push(a);
        c_fake.push(cf);
        s_fake.push(sf);

        if *b == 0 {
            r0.push(generator_g() * a);
            r1.push((generator_g() * sf) + (pk1 * cf));
        } else {
            r0.push((generator_g() * sf) + (pk0 * cf));
            r1.push(generator_g() * a);
        }
    }

    // Fiat–Shamir global challenge e.
    let e = hs(&[&transcript(&c, &c_i, &r0, &r1)]);

    // Close each OR-proof.
    let mut c0 = Vec::with_capacity(n_usize);
    let mut s0 = Vec::with_capacity(n_usize);
    let mut s1 = Vec::with_capacity(n_usize);

    for (i, b) in bits.iter().enumerate() {
        if *b == 0 {
            let c1_val = c_fake[i];
            let c_real = e - c1_val;
            c0.push(c_real);
            s0.push(alpha[i] - (c_real * r[i]));
            s1.push(s_fake[i]);
        } else {
            let c0_sim = c_fake[i];
            let c_real = e - c0_sim;
            c0.push(c0_sim);
            s0.push(s_fake[i]);
            s1.push(alpha[i] - (c_real * r[i]));
        }
    }

    Ok(RangeProveOutput {
        c,
        proof: RangeProof {
            n,
            bit_commits: c_i,
            e,
            c0,
            s0,
            s1,
        },
    })
}

/* ----------------------------------------------------------------------- *
 *  VERIFY                                                                 *
 * ----------------------------------------------------------------------- */

/// Verify a range proof for the commitment `c`.
#[must_use]
pub fn range_verify(c: &EdwardsPoint, proof: &RangeProof) -> bool {
    let n = proof.n as usize;
    if proof.bit_commits.len() != n
        || proof.c0.len() != n
        || proof.s0.len() != n
        || proof.s1.len() != n
    {
        return false;
    }

    // Aggregate check: Σ C_i must equal C.
    let mut agg = EdwardsPoint::identity();
    for ci in &proof.bit_commits {
        agg += ci;
    }
    if agg != *c {
        return false;
    }

    let mut r0 = Vec::with_capacity(n);
    let mut r1 = Vec::with_capacity(n);
    for (i, ci) in proof.bit_commits.iter().enumerate() {
        let i_u32 = i as u32;
        let (pk0, pk1) = bit_pubkeys(ci, i_u32);
        let c0 = proof.c0[i];
        let c1 = proof.e - c0;
        r0.push((generator_g() * proof.s0[i]) + (pk0 * c0));
        r1.push((generator_g() * proof.s1[i]) + (pk1 * c1));
    }

    let e_check = hs(&[&transcript(c, &proof.bit_commits, &r0, &r1)]);
    e_check == proof.e
}

/* ----------------------------------------------------------------------- *
 *  WIRE ENCODING                                                          *
 * ----------------------------------------------------------------------- */

/// Encode a range proof to canonical bytes. Mirrors `encodeRangeProof` in
/// `range.ts`.
#[must_use]
pub fn encode_range_proof(p: &RangeProof) -> Vec<u8> {
    let mut w = Writer::new();
    w.varint(u64::from(p.n));
    w.points(&p.bit_commits);
    w.scalar(&p.e);
    w.scalars(&p.c0);
    w.scalars(&p.s0);
    w.scalars(&p.s1);
    w.into_bytes()
}

/// Decode a range proof from canonical bytes.
///
/// # Errors
///
/// Returns `CryptoError` if the input is malformed (short, bad point, or
/// length-mismatched arrays).
pub fn decode_range_proof(bytes: &[u8]) -> Result<RangeProof> {
    let mut r = Reader::new(bytes);
    let n = r.varint()? as u32;
    if n == 0 || n > 64 {
        return Err(CryptoError::ValueOutOfRange);
    }
    let bit_commits = r.points()?;
    let e = r.scalar()?;
    let c0 = r.scalars()?;
    let s0 = r.scalars()?;
    let s1 = r.scalars()?;
    Ok(RangeProof {
        n,
        bit_commits,
        e,
        c0,
        s0,
        s1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_small_values() {
        for v in [0u64, 1, 2, 7, 42, 100, (1 << 16) - 1] {
            let r = random_scalar();
            let out = range_prove(v, &r, 32).expect("prove");
            // The aggregated commitment must equal the canonical r·G + v·H.
            let expected = (generator_g() * r) + (generator_h() * Scalar::from(v));
            assert_eq!(out.c, expected, "commitment mismatch for v={v}");
            assert!(range_verify(&out.c, &out.proof), "verify v={v}");
        }
    }

    #[test]
    fn round_trip_full_64_bits() {
        for v in [0u64, 1, u64::MAX] {
            let r = random_scalar();
            let out = range_prove(v, &r, 64).expect("prove");
            let expected = (generator_g() * r) + (generator_h() * Scalar::from(v));
            assert_eq!(out.c, expected);
            assert!(range_verify(&out.c, &out.proof));
        }
    }

    #[test]
    fn out_of_range_rejected() {
        let r = random_scalar();
        // v = 2^8 with N=8 is invalid.
        assert!(matches!(
            range_prove(256, &r, 8),
            Err(CryptoError::ValueOutOfRange)
        ));
    }

    #[test]
    fn invalid_n_rejected() {
        let r = random_scalar();
        assert!(matches!(
            range_prove(0, &r, 0),
            Err(CryptoError::ValueOutOfRange)
        ));
        assert!(matches!(
            range_prove(0, &r, 65),
            Err(CryptoError::ValueOutOfRange)
        ));
    }

    #[test]
    fn tampered_commitment_fails_verify() {
        let r = random_scalar();
        let out = range_prove(123, &r, 32).unwrap();
        let tampered = out.c + generator_h();
        assert!(!range_verify(&tampered, &out.proof));
    }

    #[test]
    fn tampered_proof_fails_verify() {
        let r = random_scalar();
        let out = range_prove(123, &r, 32).unwrap();
        let mut bad_proof = out.proof.clone();
        // Flip a single response scalar.
        bad_proof.s0[5] += Scalar::ONE;
        assert!(!range_verify(&out.c, &bad_proof));
    }

    #[test]
    fn wire_round_trip() {
        let r = random_scalar();
        let out = range_prove(0x1234_5678, &r, 32).unwrap();
        let bytes = encode_range_proof(&out.proof);
        let decoded = decode_range_proof(&bytes).expect("decode");
        assert!(range_verify(&out.c, &decoded));
    }

    #[test]
    fn forged_value_fails() {
        // Try to commit to a "small" value but secretly stuff a giant
        // wrap-around scalar. The range proof should fail to construct,
        // OR if we hand-construct a fake proof it should fail verify.
        let r = random_scalar();
        let huge = u64::MAX;
        let out = range_prove(huge, &r, 64).unwrap();
        // Now tamper the commitment to one OUTSIDE [0, 2^64) (we add an H
        // weight > 2^64). Verify must reject.
        let beyond = out.c + (generator_h() * Scalar::from(1u128 << 64));
        assert!(!range_verify(&beyond, &out.proof));
    }
}
