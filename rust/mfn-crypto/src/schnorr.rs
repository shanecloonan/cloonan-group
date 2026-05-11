//! Schnorr signatures over ed25519.
//!
//! Mirrors the `schnorrKeygen`/`schnorrSign`/`schnorrVerify` API in
//! `lib/network/primitives.ts`.
//!
//! ## Protocol
//!
//! - Keygen: `x ←$ ℤ_ℓ` ;  `P = x·G`.
//! - Sign(m, x):
//!   1. `r ←$ ℤ_ℓ`
//!   2. `R = r·G`
//!   3. `e = H_s(R || P || m)`
//!   4. `s = r + e·x  (mod ℓ)`
//!   5. `σ = (R, s)`
//! - Verify(m, σ, P):
//!   1. `e = H_s(R || P || m)`
//!   2. accept iff `s·G == R + e·P`
//!
//! ## Security note
//!
//! This is the "raw" Schnorr scheme used throughout the protocol's interactive
//! transcripts. For *standalone* signatures over arbitrary application
//! messages, EdDSA (RFC 8032) is preferred and the appropriate Rust crate is
//! [`ed25519-dalek`](https://crates.io/crates/ed25519-dalek). The scheme in
//! this module is here because it interoperates with the protocol's internal
//! ring signatures and zero-knowledge proofs, which are all built on the same
//! Schnorr identification.

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;
use rand_core::CryptoRngCore;
use zeroize::Zeroize;

use crate::hash::hash_to_scalar;
use crate::point::generator_g;
use crate::scalar::{random_scalar, random_scalar_with};

/// A Schnorr keypair.
///
/// The private key is zeroized on drop.
#[derive(Debug, Clone)]
pub struct SchnorrKeypair {
    /// Private signing key `x`.
    pub priv_key: Scalar,
    /// Public verification key `P = x·G`.
    pub pub_key: EdwardsPoint,
}

impl Drop for SchnorrKeypair {
    fn drop(&mut self) {
        self.priv_key.zeroize();
    }
}

/// A Schnorr signature `σ = (R, s)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchnorrSignature {
    /// Commitment `R = r·G`.
    pub r: EdwardsPoint,
    /// Response `s = r + e·x mod ℓ`.
    pub s: Scalar,
}

/// Generate a fresh Schnorr keypair using the OS CSPRNG.
pub fn schnorr_keygen() -> SchnorrKeypair {
    let priv_key = random_scalar();
    let pub_key = generator_g() * priv_key;
    SchnorrKeypair { priv_key, pub_key }
}

/// Generate a Schnorr keypair from a caller-supplied RNG (used in tests).
pub fn schnorr_keygen_with<R: CryptoRngCore + ?Sized>(rng: &mut R) -> SchnorrKeypair {
    let priv_key = random_scalar_with(rng);
    let pub_key = generator_g() * priv_key;
    SchnorrKeypair { priv_key, pub_key }
}

/// Sign a message under the given keypair.
pub fn schnorr_sign(msg: &[u8], kp: &SchnorrKeypair) -> SchnorrSignature {
    schnorr_sign_with(msg, kp, &mut rand_core::OsRng)
}

/// Sign with a caller-supplied RNG (for deterministic tests).
pub fn schnorr_sign_with<R: CryptoRngCore + ?Sized>(
    msg: &[u8],
    kp: &SchnorrKeypair,
    rng: &mut R,
) -> SchnorrSignature {
    let r_scalar = random_scalar_with(rng);
    let r = generator_g() * r_scalar;
    let r_bytes = r.compress().to_bytes();
    let p_bytes = kp.pub_key.compress().to_bytes();
    let e = hash_to_scalar(&[&r_bytes, &p_bytes, msg]);
    let s = r_scalar + e * kp.priv_key;
    SchnorrSignature { r, s }
}

/// Verify a Schnorr signature.
///
/// Returns `true` iff the signature is valid for the given message and
/// public key.
pub fn schnorr_verify(msg: &[u8], sig: &SchnorrSignature, pub_key: &EdwardsPoint) -> bool {
    let r_bytes = sig.r.compress().to_bytes();
    let p_bytes = pub_key.compress().to_bytes();
    let e = hash_to_scalar(&[&r_bytes, &p_bytes, msg]);
    let left = generator_g() * sig.s;
    let right = sig.r + (pub_key * e);
    left == right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_verify_round_trip() {
        let kp = schnorr_keygen();
        let msg = b"hello, MoneyFund";
        let sig = schnorr_sign(msg, &kp);
        assert!(schnorr_verify(msg, &sig, &kp.pub_key));
    }

    #[test]
    fn wrong_message_fails() {
        let kp = schnorr_keygen();
        let sig = schnorr_sign(b"original", &kp);
        assert!(!schnorr_verify(b"tampered", &sig, &kp.pub_key));
    }

    #[test]
    fn wrong_pubkey_fails() {
        let kp = schnorr_keygen();
        let other = schnorr_keygen();
        let sig = schnorr_sign(b"msg", &kp);
        assert!(!schnorr_verify(b"msg", &sig, &other.pub_key));
    }

    #[test]
    fn tampered_s_fails() {
        let kp = schnorr_keygen();
        let mut sig = schnorr_sign(b"msg", &kp);
        sig.s += Scalar::ONE;
        assert!(!schnorr_verify(b"msg", &sig, &kp.pub_key));
    }

    #[test]
    fn tampered_r_fails() {
        let kp = schnorr_keygen();
        let mut sig = schnorr_sign(b"msg", &kp);
        sig.r += generator_g();
        assert!(!schnorr_verify(b"msg", &sig, &kp.pub_key));
    }

    #[test]
    fn forgery_resistance_random_signature() {
        let kp = schnorr_keygen();
        let bogus = SchnorrSignature {
            r: generator_g() * random_scalar(),
            s: random_scalar(),
        };
        assert!(!schnorr_verify(b"msg", &bogus, &kp.pub_key));
    }

    #[test]
    fn signatures_differ_across_calls() {
        // Two signatures over the same message under the same key should
        // differ (because r is freshly random).
        let kp = schnorr_keygen();
        let s1 = schnorr_sign(b"msg", &kp);
        let s2 = schnorr_sign(b"msg", &kp);
        assert_ne!(s1.r, s2.r);
        // Both must still verify.
        assert!(schnorr_verify(b"msg", &s1, &kp.pub_key));
        assert!(schnorr_verify(b"msg", &s2, &kp.pub_key));
    }
}
