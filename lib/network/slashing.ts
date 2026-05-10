/* ================================================================== *
 *  MoneyFund Network — Slashing                                        *
 *                                                                      *
 *  THE FAULT-ATTRIBUTION LAYER                                         *
 *  ──────────────────────────                                          *
 *  A validator who signs TWO conflicting messages at the same slot    *
 *  (e.g. votes for two different proposals at the same height) is     *
 *  provably Byzantine and must lose their stake. This module defines  *
 *  the on-chain evidence object and verifier.                          *
 *                                                                      *
 *  Evidence is a self-contained pair                                   *
 *                                                                      *
 *      (slot, height, voterIndex,                                     *
 *         headerHashA, sigA,                                          *
 *         headerHashB, sigB)                                          *
 *                                                                      *
 *  with the constraints                                                *
 *      headerHashA != headerHashB                                      *
 *      BlsVerify(sigA, headerHashA, V[voterIndex].blsPk)              *
 *      BlsVerify(sigB, headerHashB, V[voterIndex].blsPk)              *
 *                                                                      *
 *  Anyone who observes both signatures (e.g. the gossip layer always   *
 *  delivers both proposals to honest nodes) can construct evidence    *
 *  and have a producer include it in the next block. applyBlock then  *
 *  zeroes the offender's stake.                                        *
 *                                                                      *
 *  PRODUCER EQUIVOCATION                                               *
 *  ────────────────────                                                *
 *  The same evidence shape covers a producer who signs two competing  *
 *  unsealed headers — their producer BLS signature is just a BLS-     *
 *  signature over the header hash, same as a vote.                    *
 * ================================================================== */

import { Writer, Reader } from "./codec";
import { blsVerify, encodeSignature, decodeSignature, type BlsSignature } from "./bls";
import { type Validator } from "./consensus";

export interface SlashEvidence {
  height: number;
  slot: number;
  voterIndex: number;
  headerHashA: Uint8Array;
  sigA: BlsSignature;
  headerHashB: Uint8Array;
  sigB: BlsSignature;
}

/* ------------------------------------------------------------------ */
/*  ENCODING                                                           */
/* ------------------------------------------------------------------ */

export function encodeEvidence(e: SlashEvidence): Uint8Array {
  const w = new Writer();
  w.u32(e.height);
  w.u32(e.slot);
  w.u32(e.voterIndex);
  w.push(e.headerHashA);
  w.push(encodeSignature(e.sigA));
  w.push(e.headerHashB);
  w.push(encodeSignature(e.sigB));
  return w.bytes();
}

export function decodeEvidence(bytes: Uint8Array): SlashEvidence {
  const r = new Reader(bytes);
  const height = r.u32();
  const slot = r.u32();
  const voterIndex = r.u32();
  const headerHashA = r.bytes(32);
  const sigA = decodeSignature(r.bytes(96));
  const headerHashB = r.bytes(32);
  const sigB = decodeSignature(r.bytes(96));
  return { height, slot, voterIndex, headerHashA, sigA, headerHashB, sigB };
}

/* ------------------------------------------------------------------ */
/*  VERIFICATION                                                       */
/* ------------------------------------------------------------------ */

/** Lexicographic order so two reorderings of the same evidence hash to *
 *  the same thing (and we can dedupe). */
export function canonicalize(e: SlashEvidence): SlashEvidence {
  const aFirst = compareBytes(e.headerHashA, e.headerHashB) < 0;
  if (aFirst) return e;
  return {
    height: e.height,
    slot: e.slot,
    voterIndex: e.voterIndex,
    headerHashA: e.headerHashB,
    sigA: e.sigB,
    headerHashB: e.headerHashA,
    sigB: e.sigA,
  };
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function verifyEvidence(
  evidence: SlashEvidence,
  validators: Validator[]
): { ok: boolean; reason?: string } {
  if (evidence.voterIndex < 0 || evidence.voterIndex >= validators.length) {
    return { ok: false, reason: `voterIndex ${evidence.voterIndex} out of range` };
  }
  if (eqBytes(evidence.headerHashA, evidence.headerHashB)) {
    return { ok: false, reason: "both header hashes identical — not equivocation" };
  }
  const v = validators[evidence.voterIndex];
  if (v.stake === 0n) {
    return { ok: false, reason: "validator already slashed (stake = 0)" };
  }
  if (!blsVerify(evidence.sigA, evidence.headerHashA, v.blsPk)) {
    return { ok: false, reason: "sigA does not verify against voter's BLS pk" };
  }
  if (!blsVerify(evidence.sigB, evidence.headerHashB, v.blsPk)) {
    return { ok: false, reason: "sigB does not verify against voter's BLS pk" };
  }
  return { ok: true };
}
