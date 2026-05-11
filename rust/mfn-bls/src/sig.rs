//! BLS signature scheme over BLS12-381 (G1 pubkey, G2 signature).

use bls12_381_plus::{pairing, G1Affine, G1Projective, G2Affine, G2Projective, Gt, Scalar};
use elliptic_curve::hash2curve::ExpandMsgXmd;
use ff::Field;
use group::{Curve, Group};
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::Zeroize;

/// Domain separation tag used by the IETF BLS Signatures spec for the
/// "long signatures" (G2 sig, G1 pubkey) variant. Matches Ethereum 2.0 /
/// Filecoin / `@noble/curves`.
pub const SIG_DST: &[u8] = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_";

/// Wire length of a compressed BLS public key.
pub const BLS_PUBLIC_KEY_BYTES: usize = 48;

/// Wire length of a compressed BLS signature.
pub const BLS_SIGNATURE_BYTES: usize = 96;

/// Errors produced by this module.
#[derive(Debug, thiserror::Error)]
pub enum BlsError {
    /// Wrong number of bytes given to a decode function.
    #[error("expected {expected} bytes, got {got}")]
    InvalidLength {
        /// Expected length.
        expected: usize,
        /// Actual length.
        got: usize,
    },
    /// Decoded bytes did not form a valid curve point.
    #[error("invalid point encoding")]
    InvalidPoint,
    /// Caller passed empty input to a function requiring `≥ 1` entry.
    #[error("empty input")]
    Empty,
    /// Aggregate verify saw a mismatched `(msgs.len(), pks.len())`.
    #[error("len mismatch: msgs={msgs}, pks={pks}")]
    LenMismatch {
        /// `msgs.len()`.
        msgs: usize,
        /// `pks.len()`.
        pks: usize,
    },
    /// Duplicate vote at the same validator index.
    #[error("duplicate vote at index {index}")]
    DuplicateVote {
        /// Offending validator index.
        index: usize,
    },
    /// Validator index out of range for the canonical list.
    #[error("validator index {index} out of range (total = {total})")]
    IndexOutOfRange {
        /// Offending validator index.
        index: usize,
        /// Total validator count.
        total: usize,
    },
}

/// Convenience alias for results in this module.
pub type BlsResult<T> = std::result::Result<T, BlsError>;

/* ----------------------------------------------------------------------- *
 *  TYPES                                                                  *
 * ----------------------------------------------------------------------- */

/// A BLS secret key (scalar `mod r`).
///
/// Zeroized on drop.
#[derive(Clone)]
pub struct BlsSecretKey(pub Scalar);

impl Drop for BlsSecretKey {
    fn drop(&mut self) {
        // Scalar exposes a constant-time zeroize via the `zeroize` trait on
        // its byte representation; just overwrite with zero scalar to
        // ensure no residual material remains.
        self.0 = Scalar::ZERO;
    }
}

impl core::fmt::Debug for BlsSecretKey {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("BlsSecretKey(REDACTED)")
    }
}

/// A BLS public key (G1 point).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlsPublicKey(pub G1Projective);

/// A BLS signature (G2 point).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlsSignature(pub G2Projective);

/// A BLS keypair.
#[derive(Debug, Clone)]
pub struct BlsKeypair {
    /// Secret key (zeroized on drop).
    pub sk: BlsSecretKey,
    /// Public key.
    pub pk: BlsPublicKey,
}

/* ----------------------------------------------------------------------- *
 *  KEYGEN / SIGN / VERIFY                                                 *
 * ----------------------------------------------------------------------- */

/// Generate a fresh keypair from the OS CSPRNG.
pub fn bls_keygen() -> BlsKeypair {
    let mut sk = Scalar::random(&mut OsRng);
    while sk == Scalar::ZERO {
        sk = Scalar::random(&mut OsRng);
    }
    let pk = G1Projective::generator() * sk;
    BlsKeypair {
        sk: BlsSecretKey(sk),
        pk: BlsPublicKey(pk),
    }
}

/// Derive a keypair from a 32-byte seed via SHA-256 (treated as scalar).
///
/// **Note:** This is a simple seeded keygen, not EIP-2333 / HKDF. For
/// interop with Ethereum 2.0 deposit / withdrawal keys, use EIP-2333
/// (planned). Provided here for deterministic tests.
pub fn bls_keygen_from_seed(seed: &[u8]) -> BlsKeypair {
    let mut hasher = <Sha256 as sha2::Digest>::new();
    sha2::Digest::update(&mut hasher, seed);
    let digest = sha2::Digest::finalize(hasher);
    // Build a 64-byte wide field input to avoid bias by reducing mod r.
    let mut wide = [0u8; 64];
    wide[..32].copy_from_slice(&digest);
    let mut sk = Scalar::from_bytes_wide(&wide);
    if sk == Scalar::ZERO {
        sk = Scalar::ONE;
    }
    let pk = G1Projective::generator() * sk;
    wide.zeroize();
    BlsKeypair {
        sk: BlsSecretKey(sk),
        pk: BlsPublicKey(pk),
    }
}

/// Hash a network message to the G2 curve using the IETF SSWU map.
///
/// Domain-separated with the standard `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_`
/// tag for interop with Ethereum 2.0 / Filecoin / `@noble/curves`.
#[must_use]
pub fn hash_msg_to_g2(msg: &[u8]) -> G2Projective {
    G2Projective::hash::<ExpandMsgXmd<Sha256>>(msg, SIG_DST)
}

/// Sign `msg` under `sk`.
#[must_use]
pub fn bls_sign(msg: &[u8], sk: &BlsSecretKey) -> BlsSignature {
    let h = hash_msg_to_g2(msg);
    BlsSignature(h * sk.0)
}

/// Verify `sig` against `(msg, pk)`.
///
/// Returns `true` iff `e(pk, H(msg)) == e(G1_generator, sig)`.
#[must_use]
pub fn bls_verify(sig: &BlsSignature, msg: &[u8], pk: &BlsPublicKey) -> bool {
    let h = hash_msg_to_g2(msg).to_affine();
    let pk_a = pk.0.to_affine();
    let sig_a = sig.0.to_affine();
    let g1 = G1Affine::generator();
    let left = pairing(&pk_a, &h);
    let right = pairing(&g1, &sig_a);
    left == right
}

/* ----------------------------------------------------------------------- *
 *  AGGREGATION                                                            *
 * ----------------------------------------------------------------------- */

/// Aggregate multiple signatures into one (Σ sig_i).
///
/// # Errors
///
/// `Empty` if `sigs` is empty.
pub fn aggregate_signatures(sigs: &[BlsSignature]) -> BlsResult<BlsSignature> {
    if sigs.is_empty() {
        return Err(BlsError::Empty);
    }
    let mut acc = G2Projective::IDENTITY;
    for s in sigs {
        acc += s.0;
    }
    Ok(BlsSignature(acc))
}

/// Aggregate multiple public keys into one (Σ pk_i).
///
/// # Errors
///
/// `Empty` if `pks` is empty.
pub fn aggregate_public_keys(pks: &[BlsPublicKey]) -> BlsResult<BlsPublicKey> {
    if pks.is_empty() {
        return Err(BlsError::Empty);
    }
    let mut acc = G1Projective::IDENTITY;
    for p in pks {
        acc += p.0;
    }
    Ok(BlsPublicKey(acc))
}

/// Same-message aggregate verify: aggregate all pks first, check sig
/// against `(agg_pk, msg)`. One pairing computation regardless of `N`.
#[must_use]
pub fn verify_aggregate_same_message(
    agg_sig: &BlsSignature,
    msg: &[u8],
    pks: &[BlsPublicKey],
) -> bool {
    if pks.is_empty() {
        return false;
    }
    let agg_pk = match aggregate_public_keys(pks) {
        Ok(pk) => pk,
        Err(_) => return false,
    };
    bls_verify(agg_sig, msg, &agg_pk)
}

/// Different-message aggregate verify (batch).
///
/// Checks `Σ e(pk_i, H(msg_i)) == e(G1, agg_sig)`. Implemented as a single
/// final-exponentiation via a multi-Miller-loop equivalent, modulo the
/// generic-curve `pairing()` API we have here.
#[must_use]
pub fn verify_aggregate_batch(
    agg_sig: &BlsSignature,
    msgs: &[&[u8]],
    pks: &[BlsPublicKey],
) -> bool {
    if pks.is_empty() || msgs.len() != pks.len() {
        return false;
    }
    let mut acc = Gt::IDENTITY;
    for (m, pk) in msgs.iter().zip(pks.iter()) {
        let h = hash_msg_to_g2(m).to_affine();
        let pk_a = pk.0.to_affine();
        acc += pairing(&pk_a, &h);
    }
    let g1 = G1Affine::generator();
    let right = pairing(&g1, &agg_sig.0.to_affine());
    acc == right
}

/* ----------------------------------------------------------------------- *
 *  WIRE ENCODING                                                          *
 * ----------------------------------------------------------------------- */

/// Encode a public key to its 48-byte compressed form.
#[must_use]
pub fn encode_public_key(pk: &BlsPublicKey) -> [u8; BLS_PUBLIC_KEY_BYTES] {
    pk.0.to_affine().to_compressed()
}

/// Decode a 48-byte compressed public key.
///
/// # Errors
///
/// - `InvalidLength` if `b.len() != 48`.
/// - `InvalidPoint` if decompression fails.
pub fn decode_public_key(b: &[u8]) -> BlsResult<BlsPublicKey> {
    if b.len() != BLS_PUBLIC_KEY_BYTES {
        return Err(BlsError::InvalidLength {
            expected: BLS_PUBLIC_KEY_BYTES,
            got: b.len(),
        });
    }
    let mut arr = [0u8; BLS_PUBLIC_KEY_BYTES];
    arr.copy_from_slice(b);
    let opt = G1Affine::from_compressed(&arr);
    if bool::from(opt.is_some()) {
        Ok(BlsPublicKey(G1Projective::from(opt.unwrap())))
    } else {
        Err(BlsError::InvalidPoint)
    }
}

/// Encode a signature to its 96-byte compressed form.
#[must_use]
pub fn encode_signature(sig: &BlsSignature) -> [u8; BLS_SIGNATURE_BYTES] {
    sig.0.to_affine().to_compressed()
}

/// Decode a 96-byte compressed signature.
///
/// # Errors
///
/// - `InvalidLength` if `b.len() != 96`.
/// - `InvalidPoint` if decompression fails.
pub fn decode_signature(b: &[u8]) -> BlsResult<BlsSignature> {
    if b.len() != BLS_SIGNATURE_BYTES {
        return Err(BlsError::InvalidLength {
            expected: BLS_SIGNATURE_BYTES,
            got: b.len(),
        });
    }
    let mut arr = [0u8; BLS_SIGNATURE_BYTES];
    arr.copy_from_slice(b);
    let opt = G2Affine::from_compressed(&arr);
    if bool::from(opt.is_some()) {
        Ok(BlsSignature(G2Projective::from(opt.unwrap())))
    } else {
        Err(BlsError::InvalidPoint)
    }
}

/// Constant-time equality for public keys (defense against side-channel
/// attacks when a contract decides "is this the validator's pk?").
#[must_use]
pub fn pk_eq_ct(a: &BlsPublicKey, b: &BlsPublicKey) -> bool {
    encode_public_key(a).ct_eq(&encode_public_key(b)).into()
}

/* ----------------------------------------------------------------------- *
 *  COMMITTEE HELPERS                                                      *
 * ----------------------------------------------------------------------- */

/// One vote from validator `index` over the agreed message.
#[derive(Debug, Clone, Copy)]
pub struct CommitteeVote {
    /// Index into the canonical validator list.
    pub index: usize,
    /// This validator's signature.
    pub sig: BlsSignature,
}

/// An aggregated committee vote.
#[derive(Debug, Clone)]
pub struct CommitteeAggregate {
    /// The agreed message (typically the block header hash).
    pub msg: Vec<u8>,
    /// Bitmap; bit `i` set ⇔ validator `i` voted.
    pub bitmap: Vec<u8>,
    /// Σ sig_i across voting validators.
    pub agg_sig: BlsSignature,
}

/// Convenience alias for a top-level `BlsAggregate` (committee vote bundle).
pub type BlsAggregate = CommitteeAggregate;

/// Build a [`CommitteeAggregate`] from individual votes + total validator
/// count. Bitmap layout: byte `i` bit `(j % 8)` = validator `(i * 8 + j)`.
///
/// # Errors
///
/// - `Empty` if `votes` is empty.
/// - `IndexOutOfRange` if any `vote.index >= total_validators`.
/// - `DuplicateVote` if two votes share the same index.
pub fn aggregate_committee_votes(
    msg: &[u8],
    votes: &[CommitteeVote],
    total_validators: usize,
) -> BlsResult<CommitteeAggregate> {
    if votes.is_empty() {
        return Err(BlsError::Empty);
    }
    let bitmap_len = total_validators.div_ceil(8);
    let mut bitmap = vec![0u8; bitmap_len];
    let mut seen = vec![false; total_validators];
    let mut sigs = Vec::with_capacity(votes.len());
    for v in votes {
        if v.index >= total_validators {
            return Err(BlsError::IndexOutOfRange {
                index: v.index,
                total: total_validators,
            });
        }
        if seen[v.index] {
            return Err(BlsError::DuplicateVote { index: v.index });
        }
        seen[v.index] = true;
        bitmap[v.index >> 3] |= 1u8 << (v.index & 7);
        sigs.push(v.sig);
    }
    let agg_sig = aggregate_signatures(&sigs)?;
    Ok(CommitteeAggregate {
        msg: msg.to_vec(),
        bitmap,
        agg_sig,
    })
}

/// Decode a bitmap back into the indices that voted.
#[must_use]
pub fn bitmap_indices(bitmap: &[u8], total_validators: usize) -> Vec<usize> {
    let mut out = Vec::new();
    for i in 0..total_validators {
        if (bitmap[i >> 3] & (1u8 << (i & 7))) != 0 {
            out.push(i);
        }
    }
    out
}

/// Verify a [`CommitteeAggregate`] against the canonical validator pubkey list.
#[must_use]
pub fn verify_committee_aggregate(
    agg: &CommitteeAggregate,
    validator_pks: &[BlsPublicKey],
) -> bool {
    let indices = bitmap_indices(&agg.bitmap, validator_pks.len());
    if indices.is_empty() {
        return false;
    }
    let voting_pks: Vec<BlsPublicKey> = indices.iter().map(|&i| validator_pks[i]).collect();
    verify_aggregate_same_message(&agg.agg_sig, &agg.msg, &voting_pks)
}

/// Random bytes helper used in tests.
#[doc(hidden)]
pub fn _rand_bytes(n: usize) -> Vec<u8> {
    let mut v = vec![0u8; n];
    OsRng.fill_bytes(&mut v);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_verify_round_trip() {
        let kp = bls_keygen();
        let msg = b"hello bls";
        let sig = bls_sign(msg, &kp.sk);
        assert!(bls_verify(&sig, msg, &kp.pk));
    }

    #[test]
    fn wrong_msg_fails() {
        let kp = bls_keygen();
        let sig = bls_sign(b"original", &kp.sk);
        assert!(!bls_verify(&sig, b"tampered", &kp.pk));
    }

    #[test]
    fn wrong_pk_fails() {
        let a = bls_keygen();
        let b = bls_keygen();
        let sig = bls_sign(b"msg", &a.sk);
        assert!(!bls_verify(&sig, b"msg", &b.pk));
    }

    #[test]
    fn seeded_keygen_is_deterministic() {
        let seed = [42u8; 32];
        let a = bls_keygen_from_seed(&seed);
        let b = bls_keygen_from_seed(&seed);
        assert_eq!(a.pk, b.pk);
    }

    #[test]
    fn aggregate_same_message() {
        // 8 validators sign the same block header.
        let kps: Vec<_> = (0..8).map(|_| bls_keygen()).collect();
        let msg = b"block-header-hash";
        let sigs: Vec<_> = kps.iter().map(|k| bls_sign(msg, &k.sk)).collect();
        let agg = aggregate_signatures(&sigs).unwrap();
        let pks: Vec<_> = kps.iter().map(|k| k.pk).collect();
        assert!(verify_aggregate_same_message(&agg, msg, &pks));
    }

    #[test]
    fn aggregate_same_message_rejects_missing_signer() {
        // 4 sign, but verify includes 5 pks → fails.
        let kps: Vec<_> = (0..5).map(|_| bls_keygen()).collect();
        let msg = b"hdr";
        let sigs: Vec<_> = kps.iter().take(4).map(|k| bls_sign(msg, &k.sk)).collect();
        let agg = aggregate_signatures(&sigs).unwrap();
        let pks: Vec<_> = kps.iter().map(|k| k.pk).collect();
        assert!(!verify_aggregate_same_message(&agg, msg, &pks));
    }

    #[test]
    fn aggregate_batch_different_messages() {
        // 3 validators sign 3 different attestations.
        let kps: Vec<_> = (0..3).map(|_| bls_keygen()).collect();
        let msgs: Vec<&[u8]> = vec![b"a", b"b", b"c"];
        let sigs: Vec<_> = kps
            .iter()
            .zip(msgs.iter())
            .map(|(k, m)| bls_sign(m, &k.sk))
            .collect();
        let agg = aggregate_signatures(&sigs).unwrap();
        let pks: Vec<_> = kps.iter().map(|k| k.pk).collect();
        assert!(verify_aggregate_batch(&agg, &msgs, &pks));
    }

    #[test]
    fn aggregate_batch_rejects_msg_swap() {
        let kps: Vec<_> = (0..3).map(|_| bls_keygen()).collect();
        let msgs: Vec<&[u8]> = vec![b"a", b"b", b"c"];
        let sigs: Vec<_> = kps
            .iter()
            .zip(msgs.iter())
            .map(|(k, m)| bls_sign(m, &k.sk))
            .collect();
        let agg = aggregate_signatures(&sigs).unwrap();
        let pks: Vec<_> = kps.iter().map(|k| k.pk).collect();
        let swapped: Vec<&[u8]> = vec![b"a", b"c", b"b"];
        assert!(!verify_aggregate_batch(&agg, &swapped, &pks));
    }

    #[test]
    fn pk_wire_round_trip() {
        let kp = bls_keygen();
        let bytes = encode_public_key(&kp.pk);
        assert_eq!(bytes.len(), BLS_PUBLIC_KEY_BYTES);
        let decoded = decode_public_key(&bytes).expect("decode pk");
        assert_eq!(decoded, kp.pk);
    }

    #[test]
    fn sig_wire_round_trip() {
        let kp = bls_keygen();
        let sig = bls_sign(b"msg", &kp.sk);
        let bytes = encode_signature(&sig);
        assert_eq!(bytes.len(), BLS_SIGNATURE_BYTES);
        let decoded = decode_signature(&bytes).expect("decode sig");
        assert_eq!(decoded, sig);
        assert!(bls_verify(&decoded, b"msg", &kp.pk));
    }

    #[test]
    fn decode_wrong_length_rejected() {
        assert!(matches!(
            decode_public_key(&[0u8; 16]),
            Err(BlsError::InvalidLength { .. })
        ));
        assert!(matches!(
            decode_signature(&[0u8; 16]),
            Err(BlsError::InvalidLength { .. })
        ));
    }

    #[test]
    fn committee_aggregate_basic() {
        let total = 16;
        let pks: Vec<_> = (0..total).map(|_| bls_keygen()).collect();
        let msg = b"block-hash";
        // Validators 0, 3, 7, 11, 13 vote.
        let voters = [0usize, 3, 7, 11, 13];
        let votes: Vec<CommitteeVote> = voters
            .iter()
            .map(|&i| CommitteeVote {
                index: i,
                sig: bls_sign(msg, &pks[i].sk),
            })
            .collect();
        let agg = aggregate_committee_votes(msg, &votes, total).unwrap();
        let pks_pub: Vec<_> = pks.iter().map(|k| k.pk).collect();
        assert!(verify_committee_aggregate(&agg, &pks_pub));
        // Bitmap should include exactly the voters.
        let recovered = bitmap_indices(&agg.bitmap, total);
        assert_eq!(recovered, voters.to_vec());
    }

    #[test]
    fn committee_duplicate_vote_rejected() {
        let total = 4;
        let pks: Vec<_> = (0..total).map(|_| bls_keygen()).collect();
        let msg = b"msg";
        let votes = vec![
            CommitteeVote {
                index: 1,
                sig: bls_sign(msg, &pks[1].sk),
            },
            CommitteeVote {
                index: 1,
                sig: bls_sign(msg, &pks[1].sk),
            },
        ];
        assert!(matches!(
            aggregate_committee_votes(msg, &votes, total),
            Err(BlsError::DuplicateVote { index: 1 })
        ));
    }

    #[test]
    fn committee_index_out_of_range_rejected() {
        let total = 4;
        let pks: Vec<_> = (0..total).map(|_| bls_keygen()).collect();
        let msg = b"msg";
        let votes = vec![CommitteeVote {
            index: 7,
            sig: bls_sign(msg, &pks[0].sk),
        }];
        assert!(matches!(
            aggregate_committee_votes(msg, &votes, total),
            Err(BlsError::IndexOutOfRange { .. })
        ));
    }

    #[test]
    fn pk_eq_ct_works() {
        let a = bls_keygen();
        let b = a.clone();
        assert!(pk_eq_ct(&a.pk, &b.pk));
        let c = bls_keygen();
        assert!(!pk_eq_ct(&a.pk, &c.pk));
    }

    #[test]
    fn slashing_evidence_demo() {
        // Two conflicting messages signed at the "same height" by the same key.
        let validator = bls_keygen();
        let block_a = b"vote: blockA @ height 100";
        let block_b = b"vote: blockB @ height 100";
        let sig_a = bls_sign(block_a, &validator.sk);
        let sig_b = bls_sign(block_b, &validator.sk);
        // Both should verify under the same pk.
        assert!(bls_verify(&sig_a, block_a, &validator.pk));
        assert!(bls_verify(&sig_b, block_b, &validator.pk));
        // The protocol's slashing rule then says: same pk × different msgs
        // at the same height → slashable. The crypto layer just provides the
        // primitives; the consensus layer makes the decision.
    }
}
