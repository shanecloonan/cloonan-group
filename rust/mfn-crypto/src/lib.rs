//! # `mfn-crypto`
//!
//! Discrete-log cryptographic primitives for the MoneyFund Network, built on
//! the ed25519 prime-order subgroup via the audited
//! [`curve25519-dalek`](https://crates.io/crates/curve25519-dalek) crate.
//!
//! This is the **production-grade port** of `lib/network/primitives.ts` from
//! the parent repo's TypeScript reference implementation. Every operation in
//! this crate is intended to be byte-for-byte compatible with the TS version
//! so the two implementations can validate each other.
//!
//! ## Modules
//!
//! - [`domain`] — domain-separation tags (mirrors `codec.ts` `DOMAIN`).
//! - [`codec`] — `Writer`/`Reader` MFBN-1 canonical binary encoding.
//! - [`scalar`] — scalar helpers (little-endian, mod-L).
//! - [`point`] — point helpers, generators `G` and `H`.
//! - [`hash`] — `hash_to_scalar`, `hash_to_point`.
//! - [`schnorr`] — Schnorr signatures.
//! - [`pedersen`] — Pedersen commitments (RingCT-style hiding+binding).
//! - [`stealth`] — CryptoNote dual-key stealth addresses (basic + indexed).
//! - [`encrypted_amount`] — RingCT-style encrypted (value, blinding) blobs.
//!
//! ## Safety contract
//!
//! - `#![forbid(unsafe_code)]`.
//! - Secret material implements [`zeroize::Zeroize`] on drop.
//! - Curve-point and scalar equality uses constant-time comparisons.
//! - All hashing is domain-separated; reusing a domain tag for a new purpose
//!   is a hard fork.

#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![warn(clippy::all, clippy::pedantic)]

pub mod codec;
pub mod domain;
pub mod encrypted_amount;
pub mod hash;
pub mod pedersen;
pub mod point;
pub mod scalar;
pub mod schnorr;
pub mod stealth;

pub use codec::{Reader, Writer};
pub use domain::Domain;
pub use encrypted_amount::{decrypt_output_amount, encrypt_output_amount, ENC_AMOUNT_BYTES};
pub use hash::{dhash, dhash64, hash_to_point, hash_to_scalar};
pub use pedersen::{
    pedersen_balance, pedersen_commit, pedersen_sum, pedersen_verify, PedersenCommitment,
};
pub use point::{generator_g, generator_h, point_from_bytes, point_to_bytes};
pub use scalar::{bytes_to_scalar, random_scalar, scalar_to_bytes};
pub use schnorr::{schnorr_keygen, schnorr_sign, schnorr_verify, SchnorrKeypair, SchnorrSignature};
pub use stealth::{
    indexed_stealth_address, indexed_stealth_detect, indexed_stealth_spend_key, stealth_detect,
    stealth_gen, stealth_send_to, stealth_spend_key, StealthOutput, StealthWallet,
};

/// Errors returned by the cryptographic primitives in this crate.
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    /// A byte string was the wrong length for the type being decoded.
    #[error("invalid length: expected {expected}, got {got}")]
    InvalidLength {
        /// Expected number of bytes.
        expected: usize,
        /// Number of bytes actually supplied.
        got: usize,
    },
    /// A 32-byte string did not decode to a valid Edwards point.
    #[error("invalid Edwards point encoding")]
    InvalidPoint,
    /// A scalar was zero where a non-zero value is required.
    #[error("scalar is zero")]
    ZeroScalar,
    /// A value exceeded the protocol's u64 range.
    #[error("value out of u64 range")]
    ValueOutOfRange,
    /// `hash_to_point` failed to find a valid point in the bounded retry window.
    #[error("hash_to_point: failed within {0} attempts")]
    HashToPointFailed(u32),
    /// A reader ran out of bytes mid-decode.
    #[error("short buffer: needed {needed} more bytes")]
    ShortBuffer {
        /// Number of additional bytes the reader needed.
        needed: usize,
    },
    /// A varint encoding exceeded its size limit.
    #[error("varint too long")]
    VarintTooLong,
}

/// Result type used throughout this crate.
pub type Result<T> = core::result::Result<T, CryptoError>;
