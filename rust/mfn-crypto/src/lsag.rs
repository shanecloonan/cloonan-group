//! LSAG — Linkable Spontaneous Anonymous Group signatures (Liu/Wei/Wong 2004).
//!
//! Sign on behalf of a ring of `N` public keys without revealing which
//! member signed. *Linkable*: the same signer always produces the same key
//! image `I`, which lets the protocol detect double-spends without
//! identifying the signer.
//!
//! ## Protocol
//!
//! Ring = `(P₀, P₁, …, P_{n−1})` where `P_π` is the signer.
//! Signer knows `x` such that `P_π = x·G`.
//! Key image: `I = x · H_p(P_π)`.
//!
//! Sign(m, ring, π, x):
//! 1. draw `α ←$ ℤ_ℓ`
//! 2. `L_π = α·G` ; `R_π = α·H_p(P_π)`
//! 3. `c_{π+1} = H_s(m || L_π || R_π)`
//! 4. for `i = π+1, π+2, …, π−1`:
//!    - `s_i ←$ ℤ_ℓ`
//!    - `L_i = s_i·G + c_i·P_i`
//!    - `R_i = s_i·H_p(P_i) + c_i·I`
//!    - `c_{i+1} = H_s(m || L_i || R_i)`
//! 5. `s_π = α − c_π · x  (mod ℓ)`
//! 6. `σ = (c_0, s_0, …, s_{n−1}, I)`
//!
//! Verify(m, ring, σ):
//! - `c = c_0`
//! - for `i = 0, 1, …, n−1`:
//!   - `L_i = s_i·G + c·P_i`
//!   - `R_i = s_i·H_p(P_i) + c·I`
//!   - `c = H_s(m || L_i || R_i)`
//! - accept iff `c == c_0`.
//!
//! Mirrors `lsagSign`/`lsagVerify`/`lsagLinked` in
//! `lib/network/primitives.ts`.

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;

use crate::hash::{hash_to_point, hash_to_scalar};
use crate::point::generator_g;
use crate::scalar::random_scalar;
use crate::{CryptoError, Result};

/// A linkable ring signature.
#[derive(Debug, Clone)]
pub struct LsagSignature {
    /// Initial challenge `c₀`.
    pub c0: Scalar,
    /// Responses `s_i` for each ring member.
    pub s: Vec<Scalar>,
    /// Key image — same signer ⇒ same `I`.
    pub key_image: EdwardsPoint,
}

/// Sign a message under the discrete log of `ring[signer_idx]`.
///
/// # Errors
///
/// - Returns `CryptoError::InvalidLength` if the ring has fewer than 2
///   members.
/// - Returns `CryptoError::ValueOutOfRange` if `signer_idx` is out of bounds.
/// - Returns `CryptoError::ZeroScalar` if `signer_priv` is zero.
/// - Returns `CryptoError::InvalidPoint` if `signer_priv·G != ring[signer_idx]`
///   (the signer's claimed private key does not match the ring entry).
pub fn lsag_sign(
    msg: &[u8],
    ring: &[EdwardsPoint],
    signer_idx: usize,
    signer_priv: &Scalar,
) -> Result<LsagSignature> {
    let n = ring.len();
    if n < 2 {
        return Err(CryptoError::InvalidLength {
            expected: 2,
            got: n,
        });
    }
    if signer_idx >= n {
        return Err(CryptoError::ValueOutOfRange);
    }
    if *signer_priv == Scalar::ZERO {
        return Err(CryptoError::ZeroScalar);
    }
    // Sanity check: the signer's claimed private key must produce the
    // claimed ring entry.
    if generator_g() * signer_priv != ring[signer_idx] {
        return Err(CryptoError::InvalidPoint);
    }

    let hp_self = hash_to_point(&ring[signer_idx].compress().to_bytes())?;
    let key_image = hp_self * signer_priv;

    let mut c: Vec<Scalar> = vec![Scalar::ZERO; n];
    let mut s: Vec<Scalar> = vec![Scalar::ZERO; n];

    // Step 1: signer's commitment α·G, α·H_p(P_π).
    let alpha = random_scalar();
    let mut l_cur = generator_g() * alpha;
    let mut r_cur = hp_self * alpha;

    // Step 2: c_{π+1} = H_s(m, L_π, R_π).
    let mut i = (signer_idx + 1) % n;
    c[i] = hash_to_scalar(&[
        msg,
        &l_cur.compress().to_bytes(),
        &r_cur.compress().to_bytes(),
    ]);

    // Step 3: walk forward until we wrap back to the signer.
    while i != signer_idx {
        s[i] = random_scalar();
        let hp_i = hash_to_point(&ring[i].compress().to_bytes())?;
        l_cur = (generator_g() * s[i]) + (ring[i] * c[i]);
        r_cur = (hp_i * s[i]) + (key_image * c[i]);
        let next = (i + 1) % n;
        c[next] = hash_to_scalar(&[
            msg,
            &l_cur.compress().to_bytes(),
            &r_cur.compress().to_bytes(),
        ]);
        i = next;
    }

    // Step 4: close the ring at the signer's index.
    s[signer_idx] = alpha - (c[signer_idx] * signer_priv);

    Ok(LsagSignature {
        c0: c[0],
        s,
        key_image,
    })
}

/// Verify a linkable ring signature.
///
/// Returns `true` iff the signature is valid for the given ring and
/// message. Constant-time over the ring contents.
pub fn lsag_verify(msg: &[u8], ring: &[EdwardsPoint], sig: &LsagSignature) -> bool {
    let n = ring.len();
    if sig.s.len() != n {
        return false;
    }

    let mut c = sig.c0;
    for (ring_i, s_i) in ring.iter().zip(sig.s.iter()) {
        let hp_i = match hash_to_point(&ring_i.compress().to_bytes()) {
            Ok(p) => p,
            Err(_) => return false,
        };
        let l_i = (generator_g() * s_i) + (ring_i * c);
        let r_i = (hp_i * s_i) + (sig.key_image * c);
        c = hash_to_scalar(&[
            msg,
            &l_i.compress().to_bytes(),
            &r_i.compress().to_bytes(),
        ]);
    }
    c == sig.c0
}

/// Two signatures from the same signer share the same key image.
///
/// This is the protocol's double-spend detector: if two valid LSAG
/// signatures over different transactions present the same `key_image`,
/// they were produced by the same private key.
#[inline]
pub fn lsag_linked(a: &LsagSignature, b: &LsagSignature) -> bool {
    a.key_image == b.key_image
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schnorr::schnorr_keygen;

    fn fresh_ring(size: usize) -> (Vec<EdwardsPoint>, Vec<Scalar>) {
        let mut points = Vec::with_capacity(size);
        let mut privs = Vec::with_capacity(size);
        for _ in 0..size {
            let kp = schnorr_keygen();
            points.push(kp.pub_key);
            privs.push(kp.priv_key);
        }
        (points, privs)
    }

    #[test]
    fn sign_verify_round_trip() {
        let (ring, privs) = fresh_ring(8);
        for (signer_idx, signer_priv) in privs.iter().enumerate() {
            let sig = lsag_sign(b"hello LSAG", &ring, signer_idx, signer_priv).expect("sign");
            assert!(
                lsag_verify(b"hello LSAG", &ring, &sig),
                "valid signature at index {signer_idx}"
            );
        }
    }

    #[test]
    fn tampered_message_fails() {
        let (ring, privs) = fresh_ring(5);
        let sig = lsag_sign(b"original", &ring, 2, &privs[2]).unwrap();
        assert!(!lsag_verify(b"tampered", &ring, &sig));
    }

    #[test]
    fn tampered_ring_fails() {
        let (mut ring, privs) = fresh_ring(5);
        let sig = lsag_sign(b"msg", &ring, 0, &privs[0]).unwrap();
        // Swap one ring member out for an unrelated key.
        let outsider = schnorr_keygen();
        ring[3] = outsider.pub_key;
        assert!(!lsag_verify(b"msg", &ring, &sig));
    }

    #[test]
    fn linkability() {
        // Same signer over two different messages ⇒ same key image.
        let (ring, privs) = fresh_ring(4);
        let s1 = lsag_sign(b"msg-1", &ring, 1, &privs[1]).unwrap();
        let s2 = lsag_sign(b"msg-2", &ring, 1, &privs[1]).unwrap();
        assert!(lsag_linked(&s1, &s2));
        assert!(lsag_verify(b"msg-1", &ring, &s1));
        assert!(lsag_verify(b"msg-2", &ring, &s2));
    }

    #[test]
    fn different_signers_unlinked() {
        let (ring, privs) = fresh_ring(4);
        let s_a = lsag_sign(b"msg", &ring, 0, &privs[0]).unwrap();
        let s_b = lsag_sign(b"msg", &ring, 2, &privs[2]).unwrap();
        assert!(!lsag_linked(&s_a, &s_b));
    }

    #[test]
    fn ring_too_small_rejected() {
        let (ring, privs) = fresh_ring(1);
        let result = lsag_sign(b"msg", &ring, 0, &privs[0]);
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }

    #[test]
    fn signer_idx_out_of_range_rejected() {
        let (ring, privs) = fresh_ring(4);
        let result = lsag_sign(b"msg", &ring, 4, &privs[0]);
        assert!(matches!(result, Err(CryptoError::ValueOutOfRange)));
    }

    #[test]
    fn wrong_signer_priv_rejected() {
        let (ring, privs) = fresh_ring(4);
        // Try to claim ring[1] with privs[0].
        let result = lsag_sign(b"msg", &ring, 1, &privs[0]);
        assert!(matches!(result, Err(CryptoError::InvalidPoint)));
    }

    #[test]
    fn forgery_from_no_secret_fails() {
        // Construct a bogus signature without knowing any ring member's
        // secret. The verify path should reject with overwhelming probability.
        let (ring, _) = fresh_ring(4);
        let bogus = LsagSignature {
            c0: random_scalar(),
            s: (0..ring.len()).map(|_| random_scalar()).collect(),
            key_image: generator_g() * random_scalar(),
        };
        assert!(!lsag_verify(b"msg", &ring, &bogus));
    }
}
