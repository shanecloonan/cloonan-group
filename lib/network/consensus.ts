/* ================================================================== *
 *  MoneyFund Network — Slot-Based PoS Consensus                        *
 *                                                                      *
 *  THE ACTUAL CONSENSUS LAYER                                          *
 *  ──────────────────────────                                          *
 *  Until now `Block.header.producerProof` was a placeholder. This       *
 *  module turns it into a real producer-election + finality protocol   *
 *  that combines the privacy-friendly primitives we already have:      *
 *                                                                      *
 *    • VRF (ed25519)            — per-slot randomness from each        *
 *                                  validator's secret key. Determines  *
 *                                  who's "lucky" enough to propose.    *
 *    • BLS (BLS12-381) committee — N-of-K aggregate signatures over    *
 *                                  the proposed block header.          *
 *    • Stake-weighted thresholds — your VRF output must be below       *
 *                                  THRESHOLD · stake_v / Σstake.       *
 *                                  More stake → more lucky-slot mass.  *
 *                                  Sybil-resistant by economics.       *
 *    • Slashable equivocation   — if a validator BLS-signs two         *
 *                                  conflicting headers at the same     *
 *                                  height, anyone can submit both      *
 *                                  sigs as a slashing witness.         *
 *                                                                      *
 *  PROTOCOL (per slot s)                                               *
 *  ─────────────────────                                               *
 *    1. Slot seed   = dhash("consensus-slot", prevHash || slot_no)     *
 *    2. Each validator v with stake w_v computes                        *
 *           y_v   = VRF.output(sk_v^vrf, slot_seed)                    *
 *           y_v_norm = y_v / 2^256          ∈ [0, 1)                   *
 *       v is "eligible" iff y_v_norm < threshold · w_v / W              *
 *       where W = Σ w_v over all active validators.                    *
 *    3. The producer is the eligible validator with the smallest y_v   *
 *       (deterministic tiebreak; proof carries y_v + VRF π).           *
 *    4. Producer assembles block, signs it with their BLS key.         *
 *    5. Each committee member verifies the block + the producer's      *
 *       VRF eligibility, BLS-signs the block header.                   *
 *    6. Producer aggregates the BLS votes with a bitmap; if ≥ 2/3 by   *
 *       stake-weight signed, the block is FINAL and the aggregate      *
 *       sig becomes part of producerProof.                             *
 *                                                                      *
 *  This is a faithful slot-based PoS pattern — close in spirit to      *
 *  Ouroboros Praos / Algorand BA — but stripped to the minimum         *
 *  set of primitives that actually need to exist for it to work.       *
 *                                                                      *
 *  WHAT'S DELIBERATELY OUT OF SCOPE (FOR NOW)                          *
 *  ──────────────────────────────────────────                          *
 *    • Network layer (gossip, view-change protocol)                     *
 *    • Long-range fork choice (we use last-finalized + longest chain)  *
 *    • Slashing mempool / reward distribution mechanics                *
 *    • Reconfiguration of the validator set across epochs              *
 *  These are well-understood and orthogonal; this module is the        *
 *  cryptographic core that the network/economic layers wrap.           *
 * ================================================================== */

import {
  vrfProve,
  vrfVerify,
  vrfOutputAsU64,
  type VrfKeypair,
  type VrfProof,
} from "./vrf";
import {
  blsSign,
  blsVerify,
  aggregateCommitteeVotes,
  verifyCommitteeAggregate,
  decodeSignature,
  encodeSignature,
  type BlsKeypair,
  type BlsPublicKey,
  type BlsSignature,
  type CommitteeAggregate,
  type CommitteeVote,
} from "./bls";
import { encodeVrfProof, decodeVrfProof } from "./vrf";
import { Writer, Reader, dhash, DOMAIN, bytesToHex } from "./codec";
import { Point, type CurvePoint } from "./primitives";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

export interface Validator {
  /** Index into the canonical validator list. */
  index: number;
  /** ed25519 VRF public key. */
  vrfPk: CurvePoint;
  /** BLS12-381 voting public key. */
  blsPk: BlsPublicKey;
  /** Effective stake weight. Integer for determinism. */
  stake: bigint;
}

export interface ValidatorSecrets {
  index: number;
  vrf: VrfKeypair;
  bls: BlsKeypair;
}

export interface SlotContext {
  /** Block height being produced (genesis = 0; this is height ≥ 1). */
  height: number;
  /** Slot number within an epoch (or globally — caller's choice). */
  slot: number;
  /** Hash of the previous finalized block header. */
  prevHash: Uint8Array;
}

/* ------------------------------------------------------------------ */
/*  SLOT SEED                                                          */
/* ------------------------------------------------------------------ */

/** Deterministic slot seed.
 *  Includes prevHash so seeds are unique per fork; slot # so distinct
 *  attempts within a fork don't collide. */
export function slotSeed(ctx: SlotContext): Uint8Array {
  const w = new Writer();
  w.push(ctx.prevHash);
  w.u32(ctx.height);
  w.u32(ctx.slot);
  return dhash(DOMAIN.CONSENSUS_SLOT, w.bytes());
}

/* ------------------------------------------------------------------ */
/*  ELIGIBILITY                                                        */
/* ------------------------------------------------------------------ */

/** Largest 64-bit value, used as the VRF output's [0, 2^64) range. */
const TWO64 = 1n << 64n;

/** Compute the producer eligibility threshold for a single validator
 *  with stake w out of total stake W. The threshold is
 *      f(stake, W, F) = floor(2^64 · F · w / W)
 *  where F is a global "expected proposers per slot" parameter.
 *  Setting F = 1 makes the expected number of eligible validators per
 *  slot exactly one (Algorand-style). */
export function eligibilityThreshold(
  stake: bigint,
  totalStake: bigint,
  expectedProposersPerSlot: number
): bigint {
  if (totalStake === 0n) return 0n;
  // Multiply expectedProposersPerSlot by 2^32 for fixed-point precision,
  // then divide back.
  const factor = BigInt(Math.round(expectedProposersPerSlot * (1 << 30))); // 2^30 fixed pt
  return (TWO64 * factor * stake) / (totalStake * (1n << 30n));
}

/** Check eligibility from a VRF output (32 bytes). */
export function isEligible(
  vrfBeta: Uint8Array,
  threshold: bigint
): boolean {
  return vrfOutputAsU64(vrfBeta) < threshold;
}

/* ------------------------------------------------------------------ */
/*  PRODUCER PROOF                                                     */
/* ------------------------------------------------------------------ */

/** What a candidate producer broadcasts. The protocol picks the
 *  smallest y_v among all eligible candidates as the legitimate
 *  proposer. */
export interface ProducerProof {
  validatorIndex: number;
  /** VRF output β (raw 32 bytes). */
  beta: Uint8Array;
  /** VRF proof π over the slot seed. */
  vrfProof: VrfProof;
  /** Producer's BLS signature over the block header (proves they
   *  authored it; later included in the slashing graph). */
  producerSig: BlsSignature;
}

/** Run a single validator's eligibility check and (if eligible) build
 *  their candidate ProducerProof for the slot. */
export function tryProduceSlot(
  ctx: SlotContext,
  secrets: ValidatorSecrets,
  validator: Validator,
  totalStake: bigint,
  expectedProposersPerSlot: number,
  blockHeaderHash: Uint8Array
): ProducerProof | null {
  if (secrets.index !== validator.index) {
    throw new Error("validator/secrets index mismatch");
  }
  const seed = slotSeed(ctx);
  const { proof: vrfProof, output: beta } = vrfProve(secrets.vrf, seed);
  const threshold = eligibilityThreshold(
    validator.stake,
    totalStake,
    expectedProposersPerSlot
  );
  if (!isEligible(beta, threshold)) return null;

  const producerSig = blsSign(blockHeaderHash, secrets.bls.sk);
  return { validatorIndex: validator.index, beta, vrfProof, producerSig };
}

/** Verify a candidate ProducerProof. This is what every other validator
 *  runs before they BLS-sign the producer's block. */
export function verifyProducerProof(
  ctx: SlotContext,
  proof: ProducerProof,
  validator: Validator,
  totalStake: bigint,
  expectedProposersPerSlot: number,
  blockHeaderHash: Uint8Array
): { ok: boolean; reason?: string } {
  if (proof.validatorIndex !== validator.index) {
    return { ok: false, reason: "validator index mismatch" };
  }

  const seed = slotSeed(ctx);
  const v = vrfVerify(validator.vrfPk, seed, proof.vrfProof);
  if (!v.ok || !v.output) return { ok: false, reason: "VRF invalid" };

  if (!byteEq(v.output, proof.beta)) {
    return { ok: false, reason: "VRF output mismatch" };
  }

  const threshold = eligibilityThreshold(
    validator.stake,
    totalStake,
    expectedProposersPerSlot
  );
  if (!isEligible(proof.beta, threshold)) {
    return { ok: false, reason: "VRF output above eligibility threshold" };
  }

  if (!blsVerify(proof.producerSig, blockHeaderHash, validator.blsPk)) {
    return { ok: false, reason: "producer BLS signature invalid" };
  }

  return { ok: true };
}

/** Tie-breaker: among multiple eligible candidates, pick the smallest β. */
export function pickWinner(candidates: ProducerProof[]): ProducerProof | null {
  if (candidates.length === 0) return null;
  let winner = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (lt(candidates[i].beta, winner.beta)) winner = candidates[i];
  }
  return winner;
}

/* ------------------------------------------------------------------ */
/*  COMMITTEE FINALITY                                                 */
/* ------------------------------------------------------------------ */

/** Each committee member checks the producer + signs the block. */
export function castVote(
  blockHeaderHash: Uint8Array,
  voter: ValidatorSecrets,
  ctx: SlotContext,
  producer: ProducerProof,
  producerValidator: Validator,
  totalStake: bigint,
  expectedProposersPerSlot: number
): CommitteeVote {
  const r = verifyProducerProof(
    ctx,
    producer,
    producerValidator,
    totalStake,
    expectedProposersPerSlot,
    blockHeaderHash
  );
  if (!r.ok) throw new Error(`refusing to vote: ${r.reason}`);
  return { index: voter.index, sig: blsSign(blockHeaderHash, voter.bls.sk) };
}

/** Aggregate the committee's BLS votes into a single proof.
 *  Pass through the existing helper from bls.ts. */
export function finalize(
  blockHeaderHash: Uint8Array,
  votes: CommitteeVote[],
  totalValidators: number
): CommitteeAggregate {
  return aggregateCommitteeVotes(blockHeaderHash, votes, totalValidators);
}

/** A finality bundle ⇒ what we put into the block header's
 *  producerProof field. */
export interface FinalityProof {
  producer: ProducerProof;
  finality: CommitteeAggregate;
  /** Total stake-weight that signed (cached for fast verification). */
  signingStake: bigint;
}

/** Verify a complete FinalityProof against the validator set. */
export function verifyFinalityProof(
  ctx: SlotContext,
  proof: FinalityProof,
  validators: Validator[],
  expectedProposersPerSlot: number,
  quorumStakeBps: number,
  blockHeaderHash: Uint8Array
): { ok: boolean; reason?: string } {
  const totalStake = validators.reduce((acc, v) => acc + v.stake, 0n);

  // 1. Producer eligibility.
  const producerValidator = validators.find(
    (v) => v.index === proof.producer.validatorIndex
  );
  if (!producerValidator) {
    return { ok: false, reason: "producer not in validator set" };
  }
  const pr = verifyProducerProof(
    ctx,
    proof.producer,
    producerValidator,
    totalStake,
    expectedProposersPerSlot,
    blockHeaderHash
  );
  if (!pr.ok) return { ok: false, reason: `producer: ${pr.reason}` };

  // 2. Aggregate signature is well-formed AND signed only by validators
  //    in the canonical validator set.
  if (!byteEq(proof.finality.msg, blockHeaderHash)) {
    return { ok: false, reason: "finality msg ≠ block header hash" };
  }
  const validatorPks = validators.map((v) => v.blsPk);
  if (!verifyCommitteeAggregate(proof.finality, validatorPks)) {
    return { ok: false, reason: "committee aggregate invalid" };
  }

  // 3. Sum the stake of bitmap-marked validators; require quorum.
  let signed = 0n;
  for (let i = 0; i < validators.length; i++) {
    if ((proof.finality.bitmap[i >> 3] & (1 << (i & 7))) !== 0) {
      signed += validators[i].stake;
    }
  }
  if (signed !== proof.signingStake) {
    return { ok: false, reason: "claimed signingStake ≠ bitmap sum" };
  }
  // quorumStakeBps is in basis points (10000 = 100%).
  // Default committee finality threshold: 6667 (= 2/3 + 1 bp).
  const required = (totalStake * BigInt(quorumStakeBps) + 9999n) / 10000n;
  if (signed < required) {
    return {
      ok: false,
      reason: `quorum not met: signed=${signed}, required=${required}`,
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  SLASHING                                                           */
/*                                                                     *
 *  An EQUIVOCATION proof is two valid producer-or-finality signatures *
 *  on conflicting headers at the same height. Anyone who collects     *
 *  both can submit them and burn the offender's stake.                */
/* ------------------------------------------------------------------ */

export interface EquivocationProof {
  validatorIndex: number;
  height: number;
  headerHashA: Uint8Array;
  sigA: BlsSignature;
  headerHashB: Uint8Array;
  sigB: BlsSignature;
}

/** A valid equivocation proof: same validator signed two distinct
 *  headers at the same height. The validator's stake is slashable. */
export function verifyEquivocation(
  proof: EquivocationProof,
  validators: Validator[]
): { ok: boolean; reason?: string } {
  const v = validators.find((x) => x.index === proof.validatorIndex);
  if (!v) return { ok: false, reason: "validator not in set" };
  if (byteEq(proof.headerHashA, proof.headerHashB)) {
    return { ok: false, reason: "headers are identical (not equivocation)" };
  }
  if (!blsVerify(proof.sigA, proof.headerHashA, v.blsPk)) {
    return { ok: false, reason: "sigA invalid" };
  }
  if (!blsVerify(proof.sigB, proof.headerHashB, v.blsPk)) {
    return { ok: false, reason: "sigB invalid" };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function byteEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Lexicographic less-than for byte arrays. */
function lt(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return a.length < b.length;
}

/** Pretty-printer for VRF betas — cheap shortcut for the lab UI. */
export function shortBeta(b: Uint8Array, n = 8): string {
  const h = bytesToHex(b);
  return `${h.slice(0, n)}…${h.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/*  CONSENSUS-CRITICAL ENCODING                                        *
 *                                                                     *
 *  This is the byte form that lives inside BlockHeader.producerProof. *
 *  Any change here is a hard fork.                                    */
/* ------------------------------------------------------------------ */

export function encodeProducerProof(p: ProducerProof): Uint8Array {
  const w = new Writer();
  w.u32(p.validatorIndex);
  w.push(p.beta);
  w.push(encodeVrfProof(p.vrfProof));
  w.push(encodeSignature(p.producerSig));
  return w.bytes();
}

export function decodeProducerProof(bytes: Uint8Array): ProducerProof {
  const r = new Reader(bytes);
  const validatorIndex = r.u32();
  const beta = r.bytes(32);
  const vrfProof = decodeVrfProof(r.bytes(80));
  const producerSig = decodeSignature(r.bytes(96));
  return { validatorIndex, beta, vrfProof, producerSig };
}

export function encodeCommitteeAggregate(c: CommitteeAggregate): Uint8Array {
  const w = new Writer();
  w.blob(c.msg);
  w.blob(c.bitmap);
  w.push(encodeSignature(c.aggSig));
  return w.bytes();
}

export function decodeCommitteeAggregate(bytes: Uint8Array): CommitteeAggregate {
  const r = new Reader(bytes);
  const msg = r.blob();
  const bitmap = r.blob();
  const aggSig = decodeSignature(r.bytes(96));
  return { msg, bitmap, aggSig };
}

/** Encode a full FinalityProof. This is what goes into header.producerProof. */
export function encodeFinalityProof(p: FinalityProof): Uint8Array {
  const w = new Writer();
  w.blob(encodeProducerProof(p.producer));
  w.blob(encodeCommitteeAggregate(p.finality));
  w.u64(p.signingStake);
  return w.bytes();
}

export function decodeFinalityProof(bytes: Uint8Array): FinalityProof {
  const r = new Reader(bytes);
  const producer = decodeProducerProof(r.blob());
  const finality = decodeCommitteeAggregate(r.blob());
  const signingStake = r.u64();
  return { producer, finality, signingStake };
}

void Point;
