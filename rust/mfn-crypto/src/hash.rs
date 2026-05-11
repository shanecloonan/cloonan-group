//! Hash primitives.
//!
//! - [`hash_to_scalar`] — variable-arity SHA-512 → mod-ℓ.
//! - [`hash_to_point`] — try-and-increment over SHA-512, multiply by 8 to
//!   clear the cofactor (Monero convention).
//! - [`dhash`] / [`dhash64`] — domain-separated SHA-512 with MFBN-1 framing.
//!
//! Mirrors the `hashToScalar`, `hashToPoint`, `dhash`, `dhash64` functions in
//! `lib/network/primitives.ts` and `lib/network/codec.ts`.

use curve25519_dalek::edwards::{CompressedEdwardsY, EdwardsPoint};
use curve25519_dalek::scalar::Scalar;
use sha2::{Digest, Sha512};

use crate::codec::Writer;
use crate::domain::Domain;
use crate::{CryptoError, Result};

/// SHA-512 over the concatenation of `parts`, reduced mod ℓ.
///
/// This is the protocol's standard hash-to-scalar (`H_s`). Use it for
/// Fiat-Shamir challenges and any time you need a uniformly-distributed
/// scalar from arbitrary byte inputs.
pub fn hash_to_scalar(parts: &[&[u8]]) -> Scalar {
    let mut h = Sha512::new();
    for p in parts {
        h.update(p);
    }
    let digest = h.finalize();
    let mut arr = [0u8; 64];
    arr.copy_from_slice(&digest);
    Scalar::from_bytes_mod_order_wide(&arr)
}

/// Hash bytes to an ed25519 curve point.
///
/// Algorithm: try-and-increment over SHA-512 with a big-endian 32-bit
/// counter. Decode the first 32 bytes as a compressed Edwards point; on
/// success, multiply by 8 (the cofactor) to land in the prime-order
/// subgroup.
///
/// ≈ 50% of random 32-byte strings decode to a valid Edwards point, so the
/// expected number of trials is 2. We cap at 1000 trials and bail with
/// [`CryptoError::HashToPointFailed`] otherwise (statistically impossible
/// outside of adversarial inputs we won't tolerate anyway).
pub fn hash_to_point(input: &[u8]) -> Result<EdwardsPoint> {
    const MAX_ATTEMPTS: u32 = 1000;
    for counter in 0..MAX_ATTEMPTS {
        let mut h = Sha512::new();
        h.update(input);
        h.update(counter.to_be_bytes());
        let digest = h.finalize();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&digest[..32]);
        if let Some(point) = CompressedEdwardsY(arr).decompress() {
            return Ok(point.mul_by_cofactor());
        }
    }
    Err(CryptoError::HashToPointFailed(MAX_ATTEMPTS))
}

/// Domain-separated SHA-512 truncated to 32 bytes.
///
/// Framing: each input (the domain tag included) is encoded as a varint-
/// prefixed blob in MFBN-1, then SHA-512 is applied to the concatenation.
/// This matches `dhash` in `codec.ts` byte-for-byte.
pub fn dhash(domain: Domain, inputs: &[&[u8]]) -> [u8; 32] {
    let mut w = Writer::new();
    w.blob(domain);
    for i in inputs {
        w.blob(i);
    }
    let digest = Sha512::digest(w.bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest[..32]);
    out
}

/// Domain-separated SHA-512 returning the full 64 bytes.
///
/// Use this when you need the full SHA-512 output (e.g. to reduce mod ℓ
/// without re-hashing).
pub fn dhash64(domain: Domain, inputs: &[&[u8]]) -> [u8; 64] {
    let mut w = Writer::new();
    w.blob(domain);
    for i in inputs {
        w.blob(i);
    }
    let digest = Sha512::digest(w.bytes());
    let mut out = [0u8; 64];
    out.copy_from_slice(&digest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_to_scalar_is_deterministic() {
        let msg = b"some message";
        let a = hash_to_scalar(&[msg]);
        let b = hash_to_scalar(&[msg]);
        assert_eq!(a, b);
    }

    #[test]
    fn hash_to_scalar_distinguishes_inputs() {
        let a = hash_to_scalar(&[b"a"]);
        let b = hash_to_scalar(&[b"b"]);
        assert_ne!(a, b);
    }

    #[test]
    fn hash_to_scalar_concat_safe() {
        // Without proper framing, ["ab", ""] and ["a", "b"] would collide.
        // Our hash_to_scalar concatenates without varint framing on purpose
        // (matching primitives.ts), which means callers must use dhash for
        // domain-separated inputs. Document and test that this is by-design.
        let a = hash_to_scalar(&[b"ab", b""]);
        let b = hash_to_scalar(&[b"a", b"b"]);
        assert_eq!(a, b, "raw hash_to_scalar concatenates");

        // With dhash framing, the two are distinct (the lengths differ).
        let da = dhash(crate::domain::TX_ID, &[b"ab", b""]);
        let db = dhash(crate::domain::TX_ID, &[b"a", b"b"]);
        assert_ne!(da, db, "dhash must distinguish framing");
    }

    #[test]
    fn hash_to_point_returns_valid_subgroup_member() {
        for msg in [b"abc".as_slice(), b"the quick brown fox", b""] {
            let p = hash_to_point(msg).expect("hash_to_point");
            assert!(p.is_torsion_free(), "hash_to_point output must be torsion-free");
        }
    }

    #[test]
    fn hash_to_point_is_deterministic() {
        let p1 = hash_to_point(b"foo").unwrap();
        let p2 = hash_to_point(b"foo").unwrap();
        assert_eq!(p1, p2);
    }

    #[test]
    fn hash_to_point_distinguishes_inputs() {
        let a = hash_to_point(b"foo").unwrap();
        let b = hash_to_point(b"bar").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn dhash_domain_separated() {
        let a = dhash(crate::domain::TX_ID, &[b"x"]);
        let b = dhash(crate::domain::BLOCK_ID, &[b"x"]);
        assert_ne!(a, b);
    }
}
