//! Point helpers and protocol generators.
//!
//! - `G` is the canonical ed25519 base point.
//! - `H` is an independent generator derived deterministically as
//!   `hash_to_point(G_compressed)`. We use `H` for Pedersen commitments so
//!   that no party knows a non-trivial discrete-log relationship between `G`
//!   and `H` — this is the binding security argument.
//!
//! Mirrors the `G` and `H` definitions in `lib/network/primitives.ts`.

use std::sync::OnceLock;

use curve25519_dalek::constants::ED25519_BASEPOINT_POINT;
use curve25519_dalek::edwards::{CompressedEdwardsY, EdwardsPoint};

use crate::hash::hash_to_point;
use crate::{CryptoError, Result};

/// The ed25519 base point `G`.
#[inline]
pub fn generator_g() -> EdwardsPoint {
    ED25519_BASEPOINT_POINT
}

/// The independent Pedersen generator `H = hash_to_point(G_compressed)`.
///
/// Computed lazily on first access and cached for the lifetime of the
/// process. Deterministic across runs.
pub fn generator_h() -> EdwardsPoint {
    static H: OnceLock<EdwardsPoint> = OnceLock::new();
    *H.get_or_init(|| {
        let g_bytes = ED25519_BASEPOINT_POINT.compress().to_bytes();
        hash_to_point(&g_bytes).expect("hash_to_point(G) must succeed")
    })
}

/// Encode a point as 32 compressed-Edwards bytes.
#[inline]
pub fn point_to_bytes(p: &EdwardsPoint) -> [u8; 32] {
    p.compress().to_bytes()
}

/// Decode 32 compressed-Edwards bytes into a point.
pub fn point_from_bytes(b: &[u8]) -> Result<EdwardsPoint> {
    if b.len() != 32 {
        return Err(CryptoError::InvalidLength {
            expected: 32,
            got: b.len(),
        });
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(b);
    CompressedEdwardsY(arr)
        .decompress()
        .ok_or(CryptoError::InvalidPoint)
}

#[cfg(test)]
mod tests {
    use super::*;
    use curve25519_dalek::scalar::Scalar;

    #[test]
    fn h_is_deterministic() {
        let h1 = generator_h();
        let h2 = generator_h();
        assert_eq!(h1, h2);
    }

    #[test]
    fn h_differs_from_g() {
        assert_ne!(generator_h(), generator_g());
    }

    #[test]
    fn h_is_in_prime_order_subgroup() {
        // h * ℓ should be the identity (curve25519-dalek scalars are already
        // mod ℓ, so multiplying by Scalar::ZERO is the closest check; instead
        // we verify h is torsion-free by Edwards' is_torsion_free.
        assert!(generator_h().is_torsion_free());
    }

    #[test]
    fn point_round_trip() {
        let p = generator_g() * Scalar::from(42u64);
        let bytes = point_to_bytes(&p);
        let p2 = point_from_bytes(&bytes).unwrap();
        assert_eq!(p, p2);
    }

    #[test]
    fn point_decode_rejects_invalid() {
        // About half of all 32-byte strings encode a valid Edwards y with
        // recoverable x. The other half fail decompression. Scan up to 256
        // candidates differing only in the high byte; with the ~50% rejection
        // rate the probability of all of them succeeding is ≈ 2⁻²⁵⁶.
        let mut found = false;
        let mut bad = [0u8; 32];
        for hi in 0u8..=255 {
            bad[31] = hi;
            if matches!(
                point_from_bytes(&bad),
                Err(CryptoError::InvalidPoint)
            ) {
                found = true;
                break;
            }
        }
        assert!(found, "expected at least one invalid Edwards encoding");
    }

    #[test]
    fn point_decode_rejects_wrong_length() {
        assert!(matches!(
            point_from_bytes(&[0u8; 16]),
            Err(CryptoError::InvalidLength { .. })
        ));
    }
}
