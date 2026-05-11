//! Domain-separation tags (MFBN-1).
//!
//! Every hash in the protocol is prefixed with one of these tags so that an
//! attacker cannot cause a hash computed for purpose A to collide with one
//! computed for purpose B. Adding a new domain is backwards-incompatible by
//! design — once a chain is running, this set is frozen.
//!
//! Mirrors the `DOMAIN` constant in `lib/network/codec.ts`.

/// A domain tag is a static byte string. We model it as a `&'static [u8]` so
/// callers can pass it directly into the [`crate::codec::Writer::blob`] API.
pub type Domain = &'static [u8];

/// Canonical transaction identifier.
pub const TX_ID: Domain = b"MFBN-1/tx-id";

/// Transaction preimage hashed for ring-signature messages.
pub const TX_PREIMAGE: Domain = b"MFBN-1/tx-preimage";

/// Block identifier.
pub const BLOCK_ID: Domain = b"MFBN-1/block-id";

/// Block header preimage.
pub const BLOCK_HEADER: Domain = b"MFBN-1/block-header";

/// Storage commitment.
pub const STORAGE_COMMIT: Domain = b"MFBN-1/storage-commit";

/// Per-chunk content hash.
pub const CHUNK_HASH: Domain = b"MFBN-1/chunk-hash";

/// Merkle tree leaf hash (data side).
pub const MERKLE_LEAF: Domain = b"MFBN-1/merkle-leaf";

/// Merkle tree internal node hash.
pub const MERKLE_NODE: Domain = b"MFBN-1/merkle-node";

/// VRF input transcript.
pub const VRF_INPUT: Domain = b"MFBN-1/vrf-input";

/// VRF Fiat-Shamir challenge.
pub const VRF_CHALLENGE: Domain = b"MFBN-1/vrf-challenge";

/// VRF output expansion.
pub const VRF_OUTPUT: Domain = b"MFBN-1/vrf-output";

/// BLS aggregate signature transcript.
pub const BLS_SIG: Domain = b"MFBN-1/bls-sig";

/// KZG setup transcript.
pub const KZG_SETUP: Domain = b"MFBN-1/kzg-setup";

/// KZG Fiat-Shamir transcript.
pub const KZG_TRANSCRIPT: Domain = b"MFBN-1/kzg-transcript";

/// Bulletproof inner-product transcript.
pub const BP_INNER_PROD: Domain = b"MFBN-1/bp-inner-product";

/// Bulletproof range-proof transcript.
pub const BP_RANGE: Domain = b"MFBN-1/bp-range";

/// Consensus slot transcript.
pub const CONSENSUS_SLOT: Domain = b"MFBN-1/consensus-slot";

/// Consensus vote transcript.
pub const CONSENSUS_VOTE: Domain = b"MFBN-1/consensus-vote";

/// CLSAG aggregated-P challenge.
pub const CLSAG_AGG_P: Domain = b"MFBN-1/clsag-agg-P";

/// CLSAG aggregated-C challenge.
pub const CLSAG_AGG_C: Domain = b"MFBN-1/clsag-agg-C";

/// CLSAG ring challenge.
pub const CLSAG_RING: Domain = b"MFBN-1/clsag-ring";

/// Range-proof per-bit transcript.
pub const RANGE_BIT: Domain = b"MFBN-1/range-bit";

/// Range-proof final challenge.
pub const RANGE_FINAL: Domain = b"MFBN-1/range-final";

/// Amount-mask for the value half of an encrypted-amount blob.
pub const AMT_MASK_V: Domain = b"MFBN-1/amount-mask-v";

/// Amount-mask for the blinding half of an encrypted-amount blob.
pub const AMT_MASK_B: Domain = b"MFBN-1/amount-mask-b";

/// Coinbase transaction key derivation.
pub const COINBASE_TX_KEY: Domain = b"MFBN-1/coinbase-tx-key";

/// Coinbase blinding-factor derivation.
pub const COINBASE_BLIND: Domain = b"MFBN-1/coinbase-blind";

/// UTXO accumulator leaf hash.
pub const UTXO_LEAF: Domain = b"MFBN-1/utxo-leaf";

/// UTXO accumulator internal node hash.
pub const UTXO_NODE: Domain = b"MFBN-1/utxo-node";

/// UTXO accumulator empty-subtree precomputation.
pub const UTXO_EMPTY: Domain = b"MFBN-1/utxo-empty";

/// One-out-of-Many Fiat-Shamir challenge.
pub const OOM_CHALLENGE: Domain = b"MFBN-1/oom-challenge";
