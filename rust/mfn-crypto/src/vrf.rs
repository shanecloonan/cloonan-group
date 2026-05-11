//! Verifiable Random Function (ECVRF over ed25519).
//!
//! A VRF turns a secret key into a deterministic, unpredictable, but
//! publicly verifiable random function. For the MoneyFund Network this is
//! the missing primitive that lets us:
//!
//! 1. **Run leader election without a coordinator.** Each validator computes
//!    `y_v = VRF(sk_v, slot_seed)`; smallest `y_v` wins the slot, and they
//!    include the proof in the block, so any node can verify the leader was
//!    the legitimate winner.
//! 2. **Sample ring decoys deterministically.** Per-tx seed → VRF → decoy
//!    indices, so anyone can audit decoy choice without seeing the spend key.
//! 3. **Pick storage audit chunks.** `VRF(slot_seed, storage_id)` → chunk
//!    index → operator must produce that chunk + Merkle proof or be slashed.
//!
//! ## Construction
//!
//! Mirrors RFC 9381 (ECVRF-EDWARDS25519-SHA512) closely, with one deviation:
//! we use the protocol's `hash_to_point` (try-and-increment, cofactor cleared
//! via mul-by-8) in place of the RFC's mandatory Elligator2. Mathematically
//! equivalent in security; slightly different output distribution.
//! Production interop with external verifiers would require switching to
//! strict Elligator2.
//!
//! ```text
//!   sk  ← 32 random bytes
//!   x   = expand(sk).scalar
//!   pk  = x · G
//!
//!   Prove(sk, msg):
//!     H     = hash_to_point(pk || msg)
//!     Γ     = x · H
//!     k     = nonce(sk, H)            // deterministic
//!     c     = chal(pk, H, Γ, k·G, k·H)
//!     s     = k + c·x  (mod ℓ)
//!     π     = (Γ, c, s)
//!     β     = dhash(VRF_OUTPUT, 8·Γ)  // 32-byte output
//!
//!   Verify(pk, msg, π):
//!     H     = hash_to_point(pk || msg)
//!     U     = s·G − c·pk     // = k·G if honest
//!     V     = s·H − c·Γ      // = k·H if honest
//!     c′    = chal(pk, H, Γ, U, V)
//!     accept iff c′ = c, return β = dhash(VRF_OUTPUT, 8·Γ)
//! ```
//!
//! Mirrors `lib/network/vrf.ts` byte-for-byte.

use curve25519_dalek::edwards::{CompressedEdwardsY, EdwardsPoint};
use curve25519_dalek::scalar::Scalar;
use sha2::{Digest, Sha512};
use zeroize::Zeroize;

use crate::codec::Writer;
use crate::domain::{VRF_CHALLENGE, VRF_OUTPUT};
use crate::hash::{dhash, hash_to_point};
use crate::point::generator_g;
use crate::scalar::random_bytes;
use crate::{CryptoError, Result};

/* ----------------------------------------------------------------------- *
 *  TYPES                                                                  *
 * ----------------------------------------------------------------------- */

/// A VRF keypair.
///
/// The 32-byte seed `sk` and derived scalar `x` are zeroized on drop.
#[derive(Debug, Clone)]
pub struct VrfKeypair {
    /// 32-byte seed material (the user's actual secret).
    pub sk: [u8; 32],
    /// Scalar derived from `sk` via ed25519 expansion.
    pub x: Scalar,
    /// Public key `pk = x·G`.
    pub pk: EdwardsPoint,
}

impl Drop for VrfKeypair {
    fn drop(&mut self) {
        self.sk.zeroize();
        self.x.zeroize();
    }
}

/// A VRF proof `π = (Γ, c, s)`.
///
/// `c` is the 128-bit Fiat-Shamir challenge (truncated to 16 bytes per
/// RFC 9381 §5.3). On the wire it is encoded little-endian in 16 bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VrfProof {
    /// `Γ = x·H`.
    pub gamma: EdwardsPoint,
    /// Fiat-Shamir challenge (128-bit, stored as a `Scalar` ≤ 2¹²⁸).
    pub c: Scalar,
    /// Response `s = k + c·x mod ℓ`.
    pub s: Scalar,
}

/* ----------------------------------------------------------------------- *
 *  HELPERS                                                                *
 * ----------------------------------------------------------------------- */

/// Expand a 32-byte seed into `(scalar x, prefix)` using the ed25519 rules.
///
/// This is the same expansion an ordinary ed25519 signing key uses, so a
/// single seed could serve both purposes if desired.
fn expand_seed(sk: &[u8; 32]) -> (Scalar, [u8; 32]) {
    let h = Sha512::digest(sk);
    let mut lower = [0u8; 32];
    lower.copy_from_slice(&h[..32]);
    let mut prefix = [0u8; 32];
    prefix.copy_from_slice(&h[32..]);
    // ed25519 clamping.
    lower[0] &= 248;
    lower[31] &= 127;
    lower[31] |= 64;
    let x = Scalar::from_bytes_mod_order(lower);
    lower.zeroize();
    (x, prefix)
}

/// Deterministic nonce derived from the seed's prefix and the H point.
/// SHA-512(prefix || H_compressed) reduced mod ℓ.
fn derive_nonce(prefix: &[u8; 32], h_point: &EdwardsPoint) -> Scalar {
    let mut hasher = Sha512::new();
    hasher.update(prefix);
    hasher.update(h_point.compress().as_bytes());
    let wide = hasher.finalize();
    let mut wide_arr = [0u8; 64];
    wide_arr.copy_from_slice(&wide);
    let k = Scalar::from_bytes_mod_order_wide(&wide_arr);
    wide_arr.zeroize();
    k
}

/// Domain-separated challenge. RFC 9381 specifies a 128-bit (16-byte)
/// challenge for security parameter 128.
fn challenge_scalar(
    pk: &EdwardsPoint,
    h_point: &EdwardsPoint,
    gamma: &EdwardsPoint,
    u: &EdwardsPoint,
    v: &EdwardsPoint,
) -> Scalar {
    let mut w = Writer::new();
    w.point(pk).point(h_point).point(gamma).point(u).point(v);
    let h = dhash(VRF_CHALLENGE, &[w.bytes()]);
    // Take the low 16 bytes as a little-endian integer; pad to 32 bytes for
    // Scalar construction.
    let mut padded = [0u8; 32];
    padded[..16].copy_from_slice(&h[..16]);
    Scalar::from_bytes_mod_order(padded)
}

/// Compute `H = hash_to_point(pk || msg)`.
fn vrf_h(pk: &EdwardsPoint, msg: &[u8]) -> Result<EdwardsPoint> {
    let mut buf = Vec::with_capacity(32 + msg.len());
    buf.extend_from_slice(pk.compress().as_bytes());
    buf.extend_from_slice(msg);
    hash_to_point(&buf)
}

/* ----------------------------------------------------------------------- *
 *  KEYGEN / PROVE / VERIFY                                                *
 * ----------------------------------------------------------------------- */

/// Generate a fresh VRF keypair using the OS CSPRNG.
pub fn vrf_keygen() -> VrfKeypair {
    let raw = random_bytes(32);
    let mut sk = [0u8; 32];
    sk.copy_from_slice(&raw);
    vrf_keygen_from_seed(&sk).expect("32-byte seed is always valid")
}

/// Generate a VRF keypair from a caller-supplied 32-byte seed.
///
/// # Errors
///
/// - `InvalidLength` if `seed.len() != 32`.
pub fn vrf_keygen_from_seed(seed: &[u8]) -> Result<VrfKeypair> {
    if seed.len() != 32 {
        return Err(CryptoError::InvalidLength {
            expected: 32,
            got: seed.len(),
        });
    }
    let mut sk = [0u8; 32];
    sk.copy_from_slice(seed);
    let (x, _prefix) = expand_seed(&sk);
    let pk = generator_g() * x;
    Ok(VrfKeypair { sk, x, pk })
}

/// Compute the VRF output β from the proof's Γ point.
///
/// Multiplies by the cofactor 8 to clear small-order components (RFC 9381
/// §5.2), then applies the domain-separated VRF_OUTPUT hash.
#[must_use]
pub fn vrf_output(gamma: &EdwardsPoint) -> [u8; 32] {
    let cleared = gamma.mul_by_cofactor();
    dhash(VRF_OUTPUT, &[cleared.compress().as_bytes()])
}

/// Result of [`vrf_prove`] — the proof and the deterministic random output.
#[derive(Debug, Clone, Copy)]
pub struct VrfProveResult {
    /// Public verifiable proof.
    pub proof: VrfProof,
    /// Deterministic 32-byte VRF output `β`.
    pub output: [u8; 32],
}

/// Prove: produce `(π, β)` for `(kp, msg)`.
///
/// # Errors
///
/// - `HashToPointFailed` if `hash_to_point(pk || msg)` exhausted its trial
///   budget (statistically impossible outside an adversarial input).
pub fn vrf_prove(kp: &VrfKeypair, msg: &[u8]) -> Result<VrfProveResult> {
    let (x, prefix) = expand_seed(&kp.sk);
    let h_point = vrf_h(&kp.pk, msg)?;
    let gamma = h_point * x;
    let k = derive_nonce(&prefix, &h_point);
    let u_commit = generator_g() * k;
    let v_commit = h_point * k;
    let c = challenge_scalar(&kp.pk, &h_point, &gamma, &u_commit, &v_commit);
    let s = k + (c * x);
    let output = vrf_output(&gamma);
    Ok(VrfProveResult {
        proof: VrfProof { gamma, c, s },
        output,
    })
}

/// Result of [`vrf_verify`].
#[derive(Debug, Clone, Copy)]
pub struct VrfVerifyResult {
    /// `true` iff the proof is valid.
    pub ok: bool,
    /// Recovered VRF output (only populated when `ok == true`).
    pub output: [u8; 32],
}

/// Verify a proof and recover the deterministic output `β`.
///
/// On failure (bad proof, malformed H derivation) returns
/// `VrfVerifyResult { ok: false, output: [0; 32] }`.
#[must_use]
pub fn vrf_verify(pk: &EdwardsPoint, msg: &[u8], proof: &VrfProof) -> VrfVerifyResult {
    let h_point = match vrf_h(pk, msg) {
        Ok(p) => p,
        Err(_) => {
            return VrfVerifyResult {
                ok: false,
                output: [0u8; 32],
            }
        }
    };
    let u = (generator_g() * proof.s) - (pk * proof.c);
    let v = (h_point * proof.s) - (proof.gamma * proof.c);
    let c_check = challenge_scalar(pk, &h_point, &proof.gamma, &u, &v);
    if c_check != proof.c {
        return VrfVerifyResult {
            ok: false,
            output: [0u8; 32],
        };
    }
    VrfVerifyResult {
        ok: true,
        output: vrf_output(&proof.gamma),
    }
}

/// Interpret the first 8 bytes of `β` as a big-endian `u64`.
///
/// Useful for "lowest output wins" leader-election comparisons.
#[must_use]
pub fn vrf_output_as_u64(beta: &[u8; 32]) -> u64 {
    u64::from_be_bytes([
        beta[0], beta[1], beta[2], beta[3], beta[4], beta[5], beta[6], beta[7],
    ])
}

/// Deterministically derive an integer in `[0, n)`.
///
/// # Panics
///
/// Panics if `n == 0`.
#[must_use]
pub fn vrf_output_as_index(beta: &[u8; 32], n: u64) -> u64 {
    assert!(n > 0, "vrf_output_as_index: n must be positive");
    vrf_output_as_u64(beta) % n
}

/* ----------------------------------------------------------------------- *
 *  WIRE ENCODING (80 bytes: Γ 32 || c 16 LE || s 32 LE)                   *
 * ----------------------------------------------------------------------- */

/// Wire-encoded VRF proof length: 32 (Γ) + 16 (c) + 32 (s).
pub const VRF_PROOF_BYTES: usize = 80;

/// Encode a VRF proof to its 80-byte wire format.
#[must_use]
pub fn encode_vrf_proof(p: &VrfProof) -> [u8; VRF_PROOF_BYTES] {
    let mut out = [0u8; VRF_PROOF_BYTES];
    out[..32].copy_from_slice(p.gamma.compress().as_bytes());
    // c: 16 little-endian bytes (the low 128 bits of the scalar).
    let c_bytes = p.c.to_bytes(); // 32 LE bytes
    out[32..48].copy_from_slice(&c_bytes[..16]);
    // s: 32 little-endian bytes (the full scalar).
    out[48..].copy_from_slice(&p.s.to_bytes());
    out
}

/// Decode a VRF proof from its 80-byte wire format.
///
/// # Errors
///
/// - `InvalidLength` if `b.len() != 80`.
/// - `InvalidPoint` if Γ does not decode to a valid Edwards point.
pub fn decode_vrf_proof(b: &[u8]) -> Result<VrfProof> {
    if b.len() != VRF_PROOF_BYTES {
        return Err(CryptoError::InvalidLength {
            expected: VRF_PROOF_BYTES,
            got: b.len(),
        });
    }
    let mut g_bytes = [0u8; 32];
    g_bytes.copy_from_slice(&b[..32]);
    let gamma = CompressedEdwardsY(g_bytes)
        .decompress()
        .ok_or(CryptoError::InvalidPoint)?;
    // c was encoded as 16 LE bytes (the low 128 bits). Pad to 32 to build a scalar.
    let mut c_arr = [0u8; 32];
    c_arr[..16].copy_from_slice(&b[32..48]);
    let c = Scalar::from_bytes_mod_order(c_arr);
    let mut s_arr = [0u8; 32];
    s_arr.copy_from_slice(&b[48..]);
    let s = Scalar::from_bytes_mod_order(s_arr);
    Ok(VrfProof { gamma, c, s })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prove_verify_round_trip() {
        let kp = vrf_keygen();
        let msg = b"election seed slot 42";
        let r = vrf_prove(&kp, msg).expect("prove");
        let v = vrf_verify(&kp.pk, msg, &r.proof);
        assert!(v.ok);
        assert_eq!(v.output, r.output);
    }

    #[test]
    fn output_is_deterministic() {
        // Same (seed, msg) ⇒ same output across two independent prove calls.
        let seed = [7u8; 32];
        let kp = vrf_keygen_from_seed(&seed).unwrap();
        let r1 = vrf_prove(&kp, b"msg").unwrap();
        let r2 = vrf_prove(&kp, b"msg").unwrap();
        assert_eq!(r1.output, r2.output);
        assert_eq!(r1.proof.gamma, r2.proof.gamma);
        // c and s are also deterministic because the nonce is derived from
        // (prefix, H).
        assert_eq!(r1.proof.c, r2.proof.c);
        assert_eq!(r1.proof.s, r2.proof.s);
    }

    #[test]
    fn different_msgs_produce_different_outputs() {
        let kp = vrf_keygen();
        let a = vrf_prove(&kp, b"slot-a").unwrap();
        let b = vrf_prove(&kp, b"slot-b").unwrap();
        assert_ne!(a.output, b.output);
        assert_ne!(a.proof.gamma, b.proof.gamma);
    }

    #[test]
    fn wrong_pk_fails() {
        let kp = vrf_keygen();
        let other = vrf_keygen();
        let r = vrf_prove(&kp, b"msg").unwrap();
        let v = vrf_verify(&other.pk, b"msg", &r.proof);
        assert!(!v.ok);
    }

    #[test]
    fn tampered_msg_fails() {
        let kp = vrf_keygen();
        let r = vrf_prove(&kp, b"original").unwrap();
        let v = vrf_verify(&kp.pk, b"tampered", &r.proof);
        assert!(!v.ok);
    }

    #[test]
    fn tampered_proof_fails() {
        let kp = vrf_keygen();
        let r = vrf_prove(&kp, b"msg").unwrap();
        // Bump s by one — should break the equation.
        let bad = VrfProof {
            s: r.proof.s + Scalar::ONE,
            ..r.proof
        };
        let v = vrf_verify(&kp.pk, b"msg", &bad);
        assert!(!v.ok);
    }

    #[test]
    fn wire_round_trip() {
        let kp = vrf_keygen();
        let r = vrf_prove(&kp, b"wire test").unwrap();
        let enc = encode_vrf_proof(&r.proof);
        let dec = decode_vrf_proof(&enc).unwrap();
        assert_eq!(r.proof, dec);
        // And the decoded form still verifies.
        let v = vrf_verify(&kp.pk, b"wire test", &dec);
        assert!(v.ok);
    }

    #[test]
    fn decode_wrong_length_rejected() {
        assert!(matches!(
            decode_vrf_proof(&[0u8; 50]),
            Err(CryptoError::InvalidLength { .. })
        ));
    }

    #[test]
    fn index_derivation() {
        let beta = [0xffu8; 32];
        assert!(vrf_output_as_index(&beta, 100) < 100);
        // Same seed → same index.
        let beta2 = [0xffu8; 32];
        assert_eq!(
            vrf_output_as_index(&beta, 100),
            vrf_output_as_index(&beta2, 100)
        );
    }

    #[test]
    fn keypair_from_seed_is_deterministic() {
        let seed = [0x42u8; 32];
        let a = vrf_keygen_from_seed(&seed).unwrap();
        let b = vrf_keygen_from_seed(&seed).unwrap();
        assert_eq!(a.pk, b.pk);
        assert_eq!(a.x, b.x);
    }

    #[test]
    fn leader_election_smoke() {
        // Three "validators" all run VRF on the same slot seed. The lowest
        // output wins — and any verifier can independently confirm the
        // winning proof.
        let validators: Vec<_> = (0..3).map(|_| vrf_keygen()).collect();
        let seed = b"slot-7";
        let outs: Vec<_> = validators
            .iter()
            .map(|kp| vrf_prove(kp, seed).unwrap())
            .collect();
        let scores: Vec<u64> = outs.iter().map(|r| vrf_output_as_u64(&r.output)).collect();
        let winner_idx = scores
            .iter()
            .enumerate()
            .min_by_key(|&(_, s)| s)
            .map(|(i, _)| i)
            .unwrap();
        let v = vrf_verify(&validators[winner_idx].pk, seed, &outs[winner_idx].proof);
        assert!(v.ok);
        assert_eq!(v.output, outs[winner_idx].output);
    }
}
