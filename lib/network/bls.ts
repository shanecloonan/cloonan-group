/* ================================================================== *
 *  MoneyFund Network — BLS12-381 Aggregate Signatures                  *
 *                                                                      *
 *  WHAT THIS UNLOCKS                                                   *
 *  ─────────────────                                                   *
 *  BLS signatures over BLS12-381 aggregate. N signatures by N keys on  *
 *  N (or 1) message(s) compress into a single 96-byte aggregate that   *
 *  verifies in (essentially) constant-time pairings instead of N       *
 *  verifications. This is what makes proof-of-stake committee finality *
 *  scale: every validator signs the same block header, the leader      *
 *  aggregates the votes, and the resulting proof is one BLS sig + a    *
 *  bitmap of who voted.                                                *
 *                                                                      *
 *  USES IN THIS NETWORK                                                *
 *  ───────────────────                                                 *
 *    • Committee finality: ≥2/3 stake-weighted votes aggregate into    *
 *      one signature, bound to the block header.                       *
 *    • Slashing proofs: an aggregate of two conflicting BLS votes by   *
 *      the same validator at the same height is a valid slashing       *
 *      witness that anyone can submit.                                 *
 *    • Bridge attestations (future): light clients on other chains     *
 *      can verify our finality with a single pairing check.            *
 *                                                                      *
 *  CURVE / VARIANT                                                     *
 *  ──────────────                                                      *
 *  We use the IETF "long signatures" variant (sig in G2, pk in G1):    *
 *      sk    : 32-byte scalar mod r (BLS12-381 group order)            *
 *      pk    : G1 point (48 bytes compressed)                          *
 *      sig   : G2 point (96 bytes compressed)                          *
 *      hash  : msg → G2 via hash_to_curve_g2                           *
 *  This matches Ethereum 2.0 / Filecoin / many staking systems, so     *
 *  bridges and external verifiers can re-use existing libraries.       *
 *                                                                      *
 *  Backed by the audited @noble/curves implementation; we add the      *
 *  network-specific logic on top.                                      *
 * ================================================================== */

import { bls12_381 } from "@noble/curves/bls12-381.js";

const BLS = bls12_381.longSignatures;

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

/** A BLS signature lives in the G2 group. */
export type BlsSignature = ReturnType<typeof BLS.sign>;
/** A BLS public key lives in the G1 group. */
export type BlsPublicKey = ReturnType<typeof BLS.getPublicKey>;
/** A BLS secret key is just 32 bytes of scalar material. */
export type BlsSecretKey = Uint8Array;

export interface BlsKeypair {
  sk: BlsSecretKey;
  pk: BlsPublicKey;
}

/* ------------------------------------------------------------------ */
/*  KEYGEN                                                             */
/* ------------------------------------------------------------------ */

export function blsKeygen(seed?: Uint8Array): BlsKeypair {
  const kp = seed ? BLS.keygen(seed) : BLS.keygen();
  return { sk: kp.secretKey, pk: kp.publicKey };
}

/* ------------------------------------------------------------------ */
/*  SIGN / VERIFY                                                      */
/* ------------------------------------------------------------------ */

/** Hash a network message to the G2 curve. We do NOT pre-domain-tag here
 *  because the @noble hashToCurve already applies the IETF-standard DST
 *  ("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_") under the hood, which is
 *  exactly what bridges and external verifiers expect. */
export function hashMsgToG2(msg: Uint8Array): ReturnType<typeof bls12_381.G2.hashToCurve> {
  return bls12_381.G2.hashToCurve(msg);
}

export function blsSign(msg: Uint8Array, sk: BlsSecretKey): BlsSignature {
  return BLS.sign(hashMsgToG2(msg), sk);
}

export function blsVerify(
  sig: BlsSignature,
  msg: Uint8Array,
  pk: BlsPublicKey
): boolean {
  try {
    return BLS.verify(sig, hashMsgToG2(msg), pk);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  AGGREGATION                                                        */
/* ------------------------------------------------------------------ */

/**
 *  Aggregate multiple signatures into one. There are two flavors:
 *
 *    1. SAME-MESSAGE aggregation. All N validators sign the same block
 *       header; aggregating yields a single sig that verifies against
 *       the aggregate public key. Used for committee finality.
 *
 *    2. DIFFERENT-MESSAGE aggregation. N validators sign N different
 *       attestations. The aggregated sig verifies pairwise (each pk
 *       against its own message). Used for batched cross-shard votes.
 *
 *  Both reduce on-wire size from N · 96 bytes to 96 bytes; the win for
 *  same-message aggregation is bigger because public keys aggregate too.
 */
export function blsAggregateSignatures(sigs: BlsSignature[]): BlsSignature {
  if (sigs.length === 0) throw new Error("BLS: cannot aggregate zero sigs");
  return BLS.aggregateSignatures(sigs);
}

export function blsAggregatePublicKeys(pks: BlsPublicKey[]): BlsPublicKey {
  if (pks.length === 0) throw new Error("BLS: cannot aggregate zero pks");
  return BLS.aggregatePublicKeys(pks);
}

/** Same-message aggregate verify: aggregate all pks first, check sig    *
 *  against (aggPk, msg). One pairing computation regardless of N.       */
export function blsVerifyAggregateSameMessage(
  aggSig: BlsSignature,
  msg: Uint8Array,
  pks: BlsPublicKey[]
): boolean {
  if (pks.length === 0) return false;
  try {
    const aggPk = blsAggregatePublicKeys(pks);
    return BLS.verify(aggSig, hashMsgToG2(msg), aggPk);
  } catch {
    return false;
  }
}

/** Different-message aggregate verify (batch). Slower than same-msg     *
 *  but still much faster than N independent verifications.              */
export function blsVerifyAggregateBatch(
  aggSig: BlsSignature,
  msgs: Uint8Array[],
  pks: BlsPublicKey[]
): boolean {
  if (pks.length === 0 || msgs.length !== pks.length) return false;
  try {
    const items = msgs.map((m, i) => ({
      message: hashMsgToG2(m),
      publicKey: pks[i],
    }));
    return BLS.verifyBatch(aggSig, items);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  ENCODING                                                           */
/* ------------------------------------------------------------------ */

export function encodePublicKey(pk: BlsPublicKey): Uint8Array {
  return pk.toBytes();
}
export function decodePublicKey(b: Uint8Array): BlsPublicKey {
  return bls12_381.G1.Point.fromBytes(b);
}

export function encodeSignature(sig: BlsSignature): Uint8Array {
  return sig.toBytes();
}
export function decodeSignature(b: Uint8Array): BlsSignature {
  return bls12_381.G2.Point.fromBytes(b);
}

/* ------------------------------------------------------------------ */
/*  COMMITTEE HELPERS                                                  */
/* ------------------------------------------------------------------ */

/** A committee vote: validator i votes by producing sigs[i] over msg.   *
 *  We track which validators voted via a bitmap so that absent votes    *
 *  don't ruin the aggregate.                                            */
export interface CommitteeVote {
  /** Index into the canonical validator list. */
  index: number;
  /** This validator's sig over the agreed message. */
  sig: BlsSignature;
}

export interface CommitteeAggregate {
  msg: Uint8Array;
  /** Bitmap (1 bit per validator). bit i set ⇔ validator i voted. */
  bitmap: Uint8Array;
  /** Aggregate of sigs from validators where bitmap[i] = 1. */
  aggSig: BlsSignature;
}

/** Build a CommitteeAggregate from a set of votes + the canonical
 *  validator list size. Bitmap layout: byte i bit (j%8) = validator (i*8+j). */
export function aggregateCommitteeVotes(
  msg: Uint8Array,
  votes: CommitteeVote[],
  totalValidators: number
): CommitteeAggregate {
  if (votes.length === 0) throw new Error("aggregateCommitteeVotes: no votes");
  const bitmap = new Uint8Array(Math.ceil(totalValidators / 8));
  const sigs: BlsSignature[] = [];
  const seen = new Set<number>();
  for (const v of votes) {
    if (v.index < 0 || v.index >= totalValidators) {
      throw new Error(`vote index ${v.index} out of range`);
    }
    if (seen.has(v.index)) throw new Error(`duplicate vote for ${v.index}`);
    seen.add(v.index);
    bitmap[v.index >> 3] |= 1 << (v.index & 7);
    sigs.push(v.sig);
  }
  return { msg, bitmap, aggSig: blsAggregateSignatures(sigs) };
}

/** Decode a bitmap back into the indices that voted. */
export function bitmapIndices(bitmap: Uint8Array, totalValidators: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < totalValidators; i++) {
    if ((bitmap[i >> 3] & (1 << (i & 7))) !== 0) out.push(i);
  }
  return out;
}

/** Verify a CommitteeAggregate against the canonical validator pks. */
export function verifyCommitteeAggregate(
  agg: CommitteeAggregate,
  validatorPks: BlsPublicKey[]
): boolean {
  const indices = bitmapIndices(agg.bitmap, validatorPks.length);
  if (indices.length === 0) return false;
  const votingPks = indices.map((i) => validatorPks[i]);
  return blsVerifyAggregateSameMessage(agg.aggSig, agg.msg, votingPks);
}
