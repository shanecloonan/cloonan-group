//! Scalar helpers.
//!
//! The ed25519 scalar field has prime order
//! `ℓ = 2²⁵² + 27 742 317 777 372 353 535 851 937 790 883 648 493`.
//!
//! Scalars are stored in little-endian (the curve25519-dalek native form,
//! which also matches the TS reference and the ed25519 RFC).

use curve25519_dalek::scalar::Scalar;
use rand_core::CryptoRngCore;
use rand_core::OsRng;
use sha2::{Digest, Sha512};
use zeroize::Zeroize;

/// Encode a [`Scalar`] as 32 little-endian bytes.
#[inline]
pub fn scalar_to_bytes(s: &Scalar) -> [u8; 32] {
    s.to_bytes()
}

/// Decode 32 little-endian bytes into a [`Scalar`], reducing mod ℓ.
#[inline]
pub fn bytes_to_scalar(b: &[u8; 32]) -> Scalar {
    Scalar::from_bytes_mod_order(*b)
}

/// Wide reduction: 64 bytes → uniform scalar mod ℓ.
///
/// This is what `hash_to_scalar` uses internally after the SHA-512 expansion.
#[inline]
pub fn wide_reduce(b: &[u8; 64]) -> Scalar {
    Scalar::from_bytes_mod_order_wide(b)
}

/// Cryptographically secure random scalar in `[1, ℓ−1]`.
///
/// Uses the OS CSPRNG via [`rand_core::OsRng`]. The implementation draws 64
/// random bytes, hashes them with SHA-512 (matching the TS reference for
/// stream behaviour), reduces, and rejects zero. The probability of rejection
/// is negligible (≈ 2⁻²⁵²).
pub fn random_scalar() -> Scalar {
    random_scalar_with(&mut OsRng)
}

/// Cryptographically secure random scalar from a caller-supplied RNG.
///
/// Useful for deterministic tests where the caller seeds a `ChaCha20Rng` or
/// similar. Same rejection rule as [`random_scalar`].
pub fn random_scalar_with<R: CryptoRngCore + ?Sized>(rng: &mut R) -> Scalar {
    let mut buf = [0u8; 64];
    rng.fill_bytes(&mut buf);
    let mut wide = Sha512::digest(buf);
    let mut wide_arr = [0u8; 64];
    wide_arr.copy_from_slice(&wide);
    let s = Scalar::from_bytes_mod_order_wide(&wide_arr);
    wide.zeroize();
    wide_arr.zeroize();
    buf.zeroize();
    if s == Scalar::ZERO {
        // Negligible probability; replace with Scalar::ONE to honour the
        // [1, ℓ-1] contract without panicking.
        Scalar::ONE
    } else {
        s
    }
}

/// Cryptographically secure random byte string of `len` bytes.
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut out = vec![0u8; len];
    use rand_core::RngCore;
    OsRng.fill_bytes(&mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_round_trip() {
        for _ in 0..16 {
            let s = random_scalar();
            let bytes = scalar_to_bytes(&s);
            let s2 = bytes_to_scalar(&bytes);
            assert_eq!(s, s2);
        }
    }

    #[test]
    fn random_scalar_is_nonzero() {
        for _ in 0..32 {
            let s = random_scalar();
            assert_ne!(s, Scalar::ZERO);
        }
    }

    #[test]
    fn random_scalars_differ() {
        let a = random_scalar();
        let b = random_scalar();
        assert_ne!(a, b, "two fresh random scalars should differ");
    }

    #[test]
    fn random_bytes_correct_length() {
        for n in [0usize, 1, 16, 32, 64, 4096] {
            assert_eq!(random_bytes(n).len(), n);
        }
    }
}
