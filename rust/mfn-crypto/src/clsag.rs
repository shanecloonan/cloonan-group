//! CLSAG — Concise Linkable Spontaneous Anonymous Group signatures.
//!
//! Reference: Goodell, Noether, RandomRun, *Concise Linkable Ring Signatures
//! and Forgery Against Adversarial Keys*, [`eprint.iacr.org/2019/654`].
//!
//! CLSAG is the production ring-signature primitive used by Monero since
//! 2020 (RingCT v3). Compared to LSAG/MLSAG it is ≈25–30% smaller and ≈2×
//! faster to verify, while preserving:
//!
//! - **anonymity** — verifier can't tell which of the `n` ring members signed
//! - **unforgeability** — only a signer who knows *both* the one-time spend
//!   key `x` and the blinding-difference `z` can produce a valid signature
//! - **linkability** — two signatures by the same ring member produce the
//!   same key image `I`, enabling double-spend detection without
//!   identifying the signer
//!
//! ## What it signs
//!
//! The ring is a list of `(P_i, C_i)` pairs, where `P_i` is a stealth output
//! pubkey and `C_i` is its Pedersen amount commitment. `c_pseudo` is a
//! public "pseudo-output" commitment to the same hidden value `v_π` as
//! `C_π` but with a fresh blinding factor `r_pseudo`.
//!
//! The signer at index `π` provides:
//!
//! - `x` — the one-time spend key (`P_π = x·G`)
//! - `z` — the blinding difference (`C_π − c_pseudo = z·G`)
//!
//! In a real transaction, `Σ c_pseudo` across all inputs cancels with
//! `Σ C_out + fee·H`, proving amounts balance without revealing any value.
//!
//! Mirrors `lib/network/clsag.ts` byte-for-byte.

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;

use crate::codec::{Reader, Writer};
use crate::domain::{CLSAG_AGG_C, CLSAG_AGG_P, CLSAG_RING};
use crate::hash::{dhash64, hash_to_point};
use crate::point::generator_g;
use crate::scalar::random_scalar;
use crate::{CryptoError, Result};

/* ----------------------------------------------------------------------- *
 *  TYPES                                                                  *
 * ----------------------------------------------------------------------- */

/// A CLSAG ring: parallel arrays of spend pubkeys and amount commitments.
///
/// Both vectors must have the same length.
#[derive(Debug, Clone, Default)]
pub struct ClsagRing {
    /// Spend public keys, one per ring member.
    pub p: Vec<EdwardsPoint>,
    /// Amount commitments, one per ring member (parallel to [`Self::p`]).
    pub c: Vec<EdwardsPoint>,
}

impl ClsagRing {
    /// Number of ring members.
    #[inline]
    pub fn len(&self) -> usize {
        self.p.len()
    }

    /// `true` when the ring has no members.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.p.is_empty()
    }

    /// Internal: validate the parallel-array invariant.
    fn check_consistent(&self) -> Result<()> {
        if self.c.len() != self.p.len() {
            return Err(CryptoError::InvalidLength {
                expected: self.p.len(),
                got: self.c.len(),
            });
        }
        Ok(())
    }
}

/// A CLSAG signature: `(c₀, s, I, D)`.
#[derive(Debug, Clone)]
pub struct ClsagSignature {
    /// Initial challenge `c₀`.
    pub c0: Scalar,
    /// Response scalars, one per ring member.
    pub s: Vec<Scalar>,
    /// Linkable key image `I = x · H_p(P_π)`.
    pub key_image: EdwardsPoint,
    /// Auxiliary key image `D = z · H_p(P_π)` (public; not used for linking).
    pub d: EdwardsPoint,
}

/* ----------------------------------------------------------------------- *
 *  INTERNAL HELPERS                                                       *
 * ----------------------------------------------------------------------- */

/// Encode the ring + pseudo-output + key images into a deterministic byte
/// string used as the basis for the aggregation hashes and per-step
/// challenges. Mirrors `encodeRing` in `clsag.ts`.
fn encode_ring(
    ring: &ClsagRing,
    c_pseudo: &EdwardsPoint,
    key_image: &EdwardsPoint,
    d: &EdwardsPoint,
) -> Vec<u8> {
    let mut w = Writer::new();
    w.varint(ring.p.len() as u64);
    for (p_i, c_i) in ring.p.iter().zip(ring.c.iter()) {
        w.point(p_i).point(c_i);
    }
    w.point(c_pseudo).point(key_image).point(d);
    w.into_bytes()
}

/// Domain-separated hash-to-scalar via SHA-512.
fn hs(domain: crate::domain::Domain, parts: &[&[u8]]) -> Scalar {
    let wide = dhash64(domain, parts);
    Scalar::from_bytes_mod_order_wide(&wide)
}

/* ----------------------------------------------------------------------- *
 *  SIGN                                                                   *
 * ----------------------------------------------------------------------- */

/// Sign a message under the CLSAG protocol.
///
/// # Parameters
///
/// - `msg` — the message bytes to sign (already hashed/framed by the caller).
/// - `ring` — the ring of `(P_i, C_i)` pairs.
/// - `c_pseudo` — the pseudo-output Pedersen commitment.
/// - `signer_idx` — the index of the true signer in the ring.
/// - `spend_priv` — `x` such that `x·G = ring.p[signer_idx]`.
/// - `blinding_diff` — `z` such that `z·G = ring.c[signer_idx] − c_pseudo`.
///
/// # Errors
///
/// - `InvalidLength` — ring is empty, or `|P| ≠ |C|`.
/// - `ValueOutOfRange` — `signer_idx` out of bounds.
/// - `ZeroScalar` — `spend_priv` is zero.
/// - `InvalidPoint` — witnesses don't match the claimed ring entry.
pub fn clsag_sign(
    msg: &[u8],
    ring: &ClsagRing,
    c_pseudo: &EdwardsPoint,
    signer_idx: usize,
    spend_priv: &Scalar,
    blinding_diff: &Scalar,
) -> Result<ClsagSignature> {
    ring.check_consistent()?;
    let n = ring.len();
    if n == 0 {
        return Err(CryptoError::InvalidLength {
            expected: 1,
            got: 0,
        });
    }
    if signer_idx >= n {
        return Err(CryptoError::ValueOutOfRange);
    }
    if *spend_priv == Scalar::ZERO {
        return Err(CryptoError::ZeroScalar);
    }
    if generator_g() * spend_priv != ring.p[signer_idx] {
        return Err(CryptoError::InvalidPoint);
    }
    if generator_g() * blinding_diff != (ring.c[signer_idx] - c_pseudo) {
        return Err(CryptoError::InvalidPoint);
    }

    let hp_self = hash_to_point(&ring.p[signer_idx].compress().to_bytes())?;
    let key_image = hp_self * spend_priv;
    let d = hp_self * blinding_diff;

    let ring_enc = encode_ring(ring, c_pseudo, &key_image, &d);
    let mu_p = hs(CLSAG_AGG_P, &[&ring_enc, msg]);
    let mu_c = hs(CLSAG_AGG_C, &[&ring_enc, msg]);

    // Aggregate signing witness.
    let w_signer = (mu_p * spend_priv) + (mu_c * blinding_diff);

    // Per-ring-member state.
    let mut c: Vec<Scalar> = vec![Scalar::ZERO; n];
    let mut s: Vec<Scalar> = vec![Scalar::ZERO; n];

    // Signer commitment.
    let alpha = random_scalar();
    let mut l_cur = generator_g() * alpha;
    let mut r_cur = hp_self * alpha;

    // Aggregated key image (constant across the loop).
    let agg_image = (key_image * mu_p) + (d * mu_c);

    // Walk forward starting at signer_idx + 1.
    let mut i = (signer_idx + 1) % n;
    c[i] = hs(
        CLSAG_RING,
        &[
            &ring_enc,
            msg,
            &l_cur.compress().to_bytes(),
            &r_cur.compress().to_bytes(),
        ],
    );

    while i != signer_idx {
        s[i] = random_scalar();
        let p_i = ring.p[i];
        let c_i = ring.c[i];
        let hp_i = hash_to_point(&p_i.compress().to_bytes())?;

        // Aggregated public key for index i.
        let w_i = (p_i * mu_p) + ((c_i - c_pseudo) * mu_c);

        l_cur = (generator_g() * s[i]) + (w_i * c[i]);
        r_cur = (hp_i * s[i]) + (agg_image * c[i]);

        let next = (i + 1) % n;
        c[next] = hs(
            CLSAG_RING,
            &[
                &ring_enc,
                msg,
                &l_cur.compress().to_bytes(),
                &r_cur.compress().to_bytes(),
            ],
        );
        i = next;
    }

    // Close the ring at the signer's index.
    s[signer_idx] = alpha - (c[signer_idx] * w_signer);

    Ok(ClsagSignature {
        c0: c[0],
        s,
        key_image,
        d,
    })
}

/* ----------------------------------------------------------------------- *
 *  VERIFY                                                                 *
 * ----------------------------------------------------------------------- */

/// Verify a CLSAG signature.
///
/// Returns `true` iff `sig` is valid for `(msg, ring, c_pseudo)`. Any
/// internal error (mismatched lengths, hash-to-point failure on a malformed
/// ring entry) yields `false` so the function is total.
#[must_use]
pub fn clsag_verify(
    msg: &[u8],
    ring: &ClsagRing,
    c_pseudo: &EdwardsPoint,
    sig: &ClsagSignature,
) -> bool {
    if ring.c.len() != ring.p.len() {
        return false;
    }
    let n = ring.len();
    if sig.s.len() != n || n == 0 {
        return false;
    }

    let ring_enc = encode_ring(ring, c_pseudo, &sig.key_image, &sig.d);
    let mu_p = hs(CLSAG_AGG_P, &[&ring_enc, msg]);
    let mu_c = hs(CLSAG_AGG_C, &[&ring_enc, msg]);
    let agg_image = (sig.key_image * mu_p) + (sig.d * mu_c);

    let mut c = sig.c0;
    for ((p_i, c_i), s_i) in ring.p.iter().zip(ring.c.iter()).zip(sig.s.iter()) {
        let hp_i = match hash_to_point(&p_i.compress().to_bytes()) {
            Ok(p) => p,
            Err(_) => return false,
        };

        let w_i = (p_i * mu_p) + ((c_i - c_pseudo) * mu_c);
        let l_i = (generator_g() * s_i) + (w_i * c);
        let r_i = (hp_i * s_i) + (agg_image * c);
        c = hs(
            CLSAG_RING,
            &[
                &ring_enc,
                msg,
                &l_i.compress().to_bytes(),
                &r_i.compress().to_bytes(),
            ],
        );
    }
    c == sig.c0
}

/// Two CLSAG signatures from the same input share the same key image `I`.
#[inline]
pub fn clsag_linked(a: &ClsagSignature, b: &ClsagSignature) -> bool {
    a.key_image == b.key_image
}

/* ----------------------------------------------------------------------- *
 *  ENCODE / DECODE                                                        *
 * ----------------------------------------------------------------------- */

/// Serialize a CLSAG signature to wire format.
///
/// Layout: `c0 (32) || varint(|s|) || s[i] (32 each) || I (32) || D (32)`.
#[must_use]
pub fn encode_clsag(sig: &ClsagSignature) -> Vec<u8> {
    let mut w = Writer::new();
    w.scalar(&sig.c0);
    w.scalars(&sig.s);
    w.point(&sig.key_image);
    w.point(&sig.d);
    w.into_bytes()
}

/// Deserialize a CLSAG signature from its wire format.
pub fn decode_clsag(bytes: &[u8]) -> Result<ClsagSignature> {
    let mut r = Reader::new(bytes);
    let c0 = r.scalar()?;
    let s = r.scalars()?;
    let key_image = r.point()?;
    let d = r.point()?;
    Ok(ClsagSignature {
        c0,
        s,
        key_image,
        d,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pedersen::pedersen_commit;
    use crate::schnorr::schnorr_keygen;

    /// Build a ring of `n` random (P, C) pairs and return the secrets for
    /// every member so each can act as the signer in tests.
    fn make_ring(n: usize) -> (ClsagRing, Vec<Scalar>, Vec<Scalar>) {
        let mut p = Vec::with_capacity(n);
        let mut c = Vec::with_capacity(n);
        let mut privs = Vec::with_capacity(n);
        let mut blindings = Vec::with_capacity(n);
        for _ in 0..n {
            let kp = schnorr_keygen();
            p.push(kp.pub_key);
            privs.push(kp.priv_key);

            let commit = pedersen_commit(Scalar::from(123u64), None);
            c.push(commit.c);
            blindings.push(commit.blinding);
        }
        (ClsagRing { p, c }, privs, blindings)
    }

    /// Construct a pseudo-output for `ring[idx]` with a fresh blinding so
    /// `z = r_in − r_pseudo` is known. Returns `(c_pseudo, z)`.
    fn make_pseudo(ring: &ClsagRing, idx: usize, r_in: Scalar) -> (EdwardsPoint, Scalar) {
        // Same value, fresh blinding.
        let r_pseudo = random_scalar();
        let commit = pedersen_commit(Scalar::from(123u64), Some(r_pseudo));
        let z = r_in - r_pseudo;
        // Sanity: z·G == C_π − c_pseudo
        assert_eq!(generator_g() * z, ring.c[idx] - commit.c);
        (commit.c, z)
    }

    #[test]
    fn round_trip_all_indices() {
        let (ring, privs, blindings) = make_ring(6);
        for (idx, (priv_x, r_in)) in privs.iter().zip(blindings.iter()).enumerate() {
            let (c_pseudo, z) = make_pseudo(&ring, idx, *r_in);
            let sig = clsag_sign(b"clsag-msg", &ring, &c_pseudo, idx, priv_x, &z).expect("sign");
            assert!(
                clsag_verify(b"clsag-msg", &ring, &c_pseudo, &sig),
                "valid signature at index {idx}"
            );
        }
    }

    #[test]
    fn tampered_message_fails() {
        let (ring, privs, blindings) = make_ring(4);
        let (c_pseudo, z) = make_pseudo(&ring, 2, blindings[2]);
        let sig = clsag_sign(b"original", &ring, &c_pseudo, 2, &privs[2], &z).unwrap();
        assert!(!clsag_verify(b"tampered", &ring, &c_pseudo, &sig));
    }

    #[test]
    fn tampered_pseudo_fails() {
        let (ring, privs, blindings) = make_ring(4);
        let (c_pseudo, z) = make_pseudo(&ring, 1, blindings[1]);
        let sig = clsag_sign(b"msg", &ring, &c_pseudo, 1, &privs[1], &z).unwrap();
        // Replace the pseudo commitment with an unrelated one.
        let other = pedersen_commit(Scalar::from(9u64), None);
        assert!(!clsag_verify(b"msg", &ring, &other.c, &sig));
    }

    #[test]
    fn tampered_ring_entry_fails() {
        let (mut ring, privs, blindings) = make_ring(4);
        let (c_pseudo, z) = make_pseudo(&ring, 0, blindings[0]);
        let sig = clsag_sign(b"msg", &ring, &c_pseudo, 0, &privs[0], &z).unwrap();
        // Swap out a non-signer entry.
        let outsider = schnorr_keygen();
        ring.p[2] = outsider.pub_key;
        assert!(!clsag_verify(b"msg", &ring, &c_pseudo, &sig));
    }

    #[test]
    fn linkability_same_signer() {
        let (ring, privs, blindings) = make_ring(4);
        let (c_pseudo, z) = make_pseudo(&ring, 1, blindings[1]);
        let s1 = clsag_sign(b"msg-1", &ring, &c_pseudo, 1, &privs[1], &z).unwrap();
        let s2 = clsag_sign(b"msg-2", &ring, &c_pseudo, 1, &privs[1], &z).unwrap();
        assert!(clsag_linked(&s1, &s2));
    }

    #[test]
    fn distinct_signers_unlinked() {
        let (ring, privs, blindings) = make_ring(4);
        let (p1, z1) = make_pseudo(&ring, 0, blindings[0]);
        let (p2, z2) = make_pseudo(&ring, 2, blindings[2]);
        let s1 = clsag_sign(b"msg", &ring, &p1, 0, &privs[0], &z1).unwrap();
        let s2 = clsag_sign(b"msg", &ring, &p2, 2, &privs[2], &z2).unwrap();
        assert!(!clsag_linked(&s1, &s2));
    }

    #[test]
    fn wire_round_trip() {
        let (ring, privs, blindings) = make_ring(8);
        let (c_pseudo, z) = make_pseudo(&ring, 3, blindings[3]);
        let sig = clsag_sign(b"wire-test", &ring, &c_pseudo, 3, &privs[3], &z).unwrap();
        let bytes = encode_clsag(&sig);
        let decoded = decode_clsag(&bytes).expect("decode");
        assert_eq!(sig.c0, decoded.c0);
        assert_eq!(sig.s, decoded.s);
        assert_eq!(sig.key_image, decoded.key_image);
        assert_eq!(sig.d, decoded.d);
        // And the decoded form still verifies.
        assert!(clsag_verify(b"wire-test", &ring, &c_pseudo, &decoded));
    }

    #[test]
    fn empty_ring_rejected() {
        let ring = ClsagRing::default();
        let c_pseudo = generator_g();
        let result = clsag_sign(b"msg", &ring, &c_pseudo, 0, &Scalar::ONE, &Scalar::ONE);
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }

    #[test]
    fn wrong_witness_x_rejected() {
        let (ring, privs, blindings) = make_ring(3);
        let (c_pseudo, z) = make_pseudo(&ring, 0, blindings[0]);
        // Use privs[1] but claim ring.p[0].
        let result = clsag_sign(b"msg", &ring, &c_pseudo, 0, &privs[1], &z);
        assert!(matches!(result, Err(CryptoError::InvalidPoint)));
    }

    #[test]
    fn wrong_witness_z_rejected() {
        let (ring, privs, blindings) = make_ring(3);
        let (c_pseudo, _z) = make_pseudo(&ring, 0, blindings[0]);
        // Use a bogus z.
        let result = clsag_sign(b"msg", &ring, &c_pseudo, 0, &privs[0], &Scalar::from(7u64));
        assert!(matches!(result, Err(CryptoError::InvalidPoint)));
    }

    #[test]
    fn forgery_without_witness_fails() {
        let (ring, _privs, _blindings) = make_ring(4);
        let bogus_pseudo = pedersen_commit(Scalar::from(9u64), None).c;
        let bogus = ClsagSignature {
            c0: random_scalar(),
            s: (0..ring.len()).map(|_| random_scalar()).collect(),
            key_image: generator_g() * random_scalar(),
            d: generator_g() * random_scalar(),
        };
        assert!(!clsag_verify(b"msg", &ring, &bogus_pseudo, &bogus));
    }
}
