//! MoneyFund Network — BLS12-381 signatures and (future) KZG commitments.
//!
//! ## What this unlocks
//!
//! BLS signatures over BLS12-381 aggregate. `N` signatures by `N` keys on
//! `N` (or 1) message(s) compress into a single 96-byte aggregate that
//! verifies in (essentially) constant-time pairings instead of `N`
//! verifications. This is what makes proof-of-stake committee finality
//! scale: every validator signs the same block header, the leader
//! aggregates the votes, and the resulting proof is one BLS sig + a
//! bitmap of who voted.
//!
//! ## Uses in this network
//!
//! - **Committee finality.** ≥2/3 stake-weighted votes aggregate into one
//!   signature, bound to the block header.
//! - **Slashing proofs.** An aggregate of two conflicting BLS votes by the
//!   same validator at the same height is a valid slashing witness anyone
//!   can submit.
//! - **Bridge attestations** (future). Light clients on other chains can
//!   verify our finality with a single pairing check.
//!
//! ## Curve / variant
//!
//! IETF "long signatures" variant (sig in G2, pk in G1):
//!
//! - `sk` : 32-byte scalar mod `r` (BLS12-381 group order)
//! - `pk` : G1 point (48 bytes compressed)
//! - `sig`: G2 point (96 bytes compressed)
//! - hash : `msg → G2` via the IETF SSWU hash-to-curve with DST
//!   `"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_"`
//!
//! Matches Ethereum 2.0 / Filecoin / many staking systems, so bridges and
//! external verifiers can re-use existing libraries.
//!
//! Backed by the audited pure-Rust [`bls12_381`] crate (Zcash). No FFI, no
//! `unsafe`, no trusted setup.

#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![warn(clippy::all)]

pub mod sig;

pub use sig::{
    aggregate_committee_votes, aggregate_public_keys, aggregate_signatures, bitmap_indices,
    bls_keygen, bls_keygen_from_seed, bls_sign, bls_verify, decode_public_key, decode_signature,
    encode_public_key, encode_signature, hash_msg_to_g2, verify_aggregate_batch,
    verify_aggregate_same_message, verify_committee_aggregate, BlsAggregate, BlsError,
    BlsKeypair, BlsPublicKey, BlsResult, BlsSecretKey, BlsSignature, CommitteeAggregate,
    CommitteeVote, BLS_PUBLIC_KEY_BYTES, BLS_SIGNATURE_BYTES,
};
