/* ================================================================== *
 *  MoneyFund Network — Consensus Wire Format                           *
 *                                                                      *
 *  Deterministic byte forms for every consensus-critical object.       *
 *  Anything that's persisted, gossiped, or signed over flows through   *
 *  these encoders. Identical input → identical bytes on every machine. *
 *                                                                      *
 *  Each object's encode/decode is the inverse of the other; identity   *
 *  is asserted in scripts/smoke-wire.ts.                               *
 * ================================================================== */

import { Writer, Reader } from "./codec";
import { type CurvePoint, ENC_AMOUNT_BYTES } from "./primitives";
import {
  encodeStorageProof,
  decodeStorageProof,
  type StorageProof,
} from "./storage";
import {
  encodeClsag,
  decodeClsag,
  type ClsagRing,
} from "./clsag";
import {
  encodeBulletproof,
  decodeBulletproof,
  type BulletproofRange,
} from "./bulletproofs";
import {
  type StorageCommitment,
} from "./storage";
import {
  type TransactionWire,
  type TxInputWire,
  type TxOutputWire,
} from "./transaction";
import {
  type BlockHeader,
  type Block,
  type ConsensusParams,
} from "./block";
import {
  encodePublicKey,
  decodePublicKey,
} from "./bls";
import {
  type Validator,
} from "./consensus";

/* ------------------------------------------------------------------ */
/*  STORAGE COMMITMENT                                                 */
/* ------------------------------------------------------------------ */

export function encodeStorageCommitment(c: StorageCommitment): Uint8Array {
  const w = new Writer();
  w.push(c.dataRoot);
  w.u64(c.sizeBytes);
  w.u32(c.chunkSize);
  w.u32(c.numChunks);
  w.u8(c.replication);
  w.point(c.endowment);
  return w.bytes();
}

export function decodeStorageCommitment(bytes: Uint8Array): StorageCommitment {
  const r = new Reader(bytes);
  const dataRoot = r.bytes(32);
  const sizeBytes = r.u64();
  const chunkSize = r.u32();
  const numChunks = r.u32();
  const replication = r.u8();
  const endowment = r.point();
  return { dataRoot, sizeBytes, chunkSize, numChunks, replication, endowment };
}

function writeStorageCommitment(w: Writer, c: StorageCommitment): void {
  w.push(c.dataRoot);
  w.u64(c.sizeBytes);
  w.u32(c.chunkSize);
  w.u32(c.numChunks);
  w.u8(c.replication);
  w.point(c.endowment);
}

function readStorageCommitment(r: Reader): StorageCommitment {
  const dataRoot = r.bytes(32);
  const sizeBytes = r.u64();
  const chunkSize = r.u32();
  const numChunks = r.u32();
  const replication = r.u8();
  const endowment = r.point();
  return { dataRoot, sizeBytes, chunkSize, numChunks, replication, endowment };
}

/* ------------------------------------------------------------------ */
/*  TX INPUT / OUTPUT                                                  */
/* ------------------------------------------------------------------ */

function writeRing(w: Writer, ring: ClsagRing): void {
  w.points(ring.P);
  w.points(ring.C);
}

function readRing(r: Reader): ClsagRing {
  const P = r.points();
  const C = r.points();
  return { P, C };
}

function writeTxInput(w: Writer, inp: TxInputWire): void {
  writeRing(w, inp.ring);
  w.point(inp.cPseudo);
  w.blob(encodeClsag(inp.sig));
}

function readTxInput(r: Reader): TxInputWire {
  const ring = readRing(r);
  const cPseudo = r.point();
  const sigBytes = r.blob();
  const sig = decodeClsag(sigBytes);
  return { ring, cPseudo, sig };
}

function writeTxOutput(w: Writer, out: TxOutputWire): void {
  w.point(out.oneTimeAddr);
  w.point(out.amount);
  w.blob(encodeBulletproof(out.rangeProof));
  w.push(out.encAmount);
  if (out.storage) {
    w.u8(1);
    writeStorageCommitment(w, out.storage);
  } else {
    w.u8(0);
  }
}

function readTxOutput(r: Reader): TxOutputWire {
  const oneTimeAddr = r.point();
  const amount = r.point();
  const rpBytes = r.blob();
  const rangeProof = decodeBulletproof(amount, rpBytes);
  const encAmount = r.bytes(ENC_AMOUNT_BYTES);
  const hasStorage = r.u8();
  const storage = hasStorage === 1 ? readStorageCommitment(r) : null;
  return { oneTimeAddr, amount, rangeProof, encAmount, storage };
}

/* ------------------------------------------------------------------ */
/*  TRANSACTION                                                        */
/* ------------------------------------------------------------------ */

export function encodeTransaction(tx: TransactionWire): Uint8Array {
  const w = new Writer();
  w.varint(tx.version);
  w.point(tx.R);
  w.u64(tx.fee);
  w.blob(tx.extra);
  w.varint(tx.inputs.length);
  for (const inp of tx.inputs) writeTxInput(w, inp);
  w.varint(tx.outputs.length);
  for (const out of tx.outputs) writeTxOutput(w, out);
  return w.bytes();
}

export function decodeTransaction(bytes: Uint8Array): TransactionWire {
  const r = new Reader(bytes);
  const version = Number(r.varint());
  const R = r.point();
  const fee = r.u64();
  const extra = r.blob();
  const nIn = Number(r.varint());
  const inputs: TxInputWire[] = new Array(nIn);
  for (let i = 0; i < nIn; i++) inputs[i] = readTxInput(r);
  const nOut = Number(r.varint());
  const outputs: TxOutputWire[] = new Array(nOut);
  for (let i = 0; i < nOut; i++) outputs[i] = readTxOutput(r);
  return { version, R, inputs, outputs, fee, extra };
}

/* ------------------------------------------------------------------ */
/*  BLOCK HEADER                                                       */
/* ------------------------------------------------------------------ */

export function encodeBlockHeader(h: BlockHeader): Uint8Array {
  const w = new Writer();
  w.varint(h.version);
  w.push(h.prevHash);
  w.u32(h.height);
  w.u32(h.slot);
  w.u64(BigInt(h.timestamp));
  w.push(h.txRoot);
  w.push(h.storageRoot);
  w.blob(h.producerProof);
  return w.bytes();
}

export function decodeBlockHeader(bytes: Uint8Array): BlockHeader {
  const r = new Reader(bytes);
  const version = Number(r.varint());
  const prevHash = r.bytes(32);
  const height = r.u32();
  const slot = r.u32();
  const timestamp = Number(r.u64());
  const txRoot = r.bytes(32);
  const storageRoot = r.bytes(32);
  const producerProof = r.blob();
  return { version, prevHash, height, slot, timestamp, txRoot, storageRoot, producerProof };
}

/* ------------------------------------------------------------------ */
/*  BLOCK                                                              */
/* ------------------------------------------------------------------ */

export function encodeBlock(b: Block): Uint8Array {
  const w = new Writer();
  w.blob(encodeBlockHeader(b.header));
  w.varint(b.txs.length);
  for (const tx of b.txs) w.blob(encodeTransaction(tx));
  w.varint(b.storageProofs.length);
  for (const p of b.storageProofs) w.blob(encodeStorageProof(p));
  return w.bytes();
}

export function decodeBlock(bytes: Uint8Array): Block {
  const r = new Reader(bytes);
  const header = decodeBlockHeader(r.blob());
  const nTx = Number(r.varint());
  const txs: TransactionWire[] = new Array(nTx);
  for (let i = 0; i < nTx; i++) txs[i] = decodeTransaction(r.blob());
  // storageProofs were added after the initial release; tolerate decoders
  // that ran out of bytes (i.e. legacy blocks have no proofs).
  let storageProofs: StorageProof[] = [];
  if (!r.end()) {
    const nP = Number(r.varint());
    storageProofs = new Array(nP);
    for (let i = 0; i < nP; i++) storageProofs[i] = decodeStorageProof(r.blob());
  }
  return { header, txs, storageProofs };
}

/* ------------------------------------------------------------------ */
/*  VALIDATOR                                                          */
/* ------------------------------------------------------------------ */

export function encodeValidator(v: Validator): Uint8Array {
  const w = new Writer();
  w.u32(v.index);
  w.point(v.vrfPk);
  w.push(encodePublicKey(v.blsPk));
  w.u64(v.stake);
  return w.bytes();
}

export function decodeValidator(bytes: Uint8Array): Validator {
  const r = new Reader(bytes);
  const index = r.u32();
  const vrfPk = r.point();
  const blsPk = decodePublicKey(r.bytes(48));
  const stake = r.u64();
  return { index, vrfPk, blsPk, stake };
}

export function encodeValidatorSet(vs: Validator[]): Uint8Array {
  const w = new Writer();
  w.varint(vs.length);
  for (const v of vs) w.blob(encodeValidator(v));
  return w.bytes();
}

export function decodeValidatorSet(bytes: Uint8Array): Validator[] {
  const r = new Reader(bytes);
  const n = Number(r.varint());
  const out: Validator[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = decodeValidator(r.blob());
  return out;
}

/* ------------------------------------------------------------------ */
/*  CONSENSUS PARAMS                                                   */
/* ------------------------------------------------------------------ */

export function encodeConsensusParams(p: ConsensusParams): Uint8Array {
  const w = new Writer();
  // Encode floats by multiplying by 2^16 and storing as u32. Plenty of
  // precision for proposer-density values like 0.1..16.0.
  w.u32(Math.round(p.expectedProposersPerSlot * 65536));
  w.u32(p.quorumStakeBps);
  return w.bytes();
}

export function decodeConsensusParams(bytes: Uint8Array): ConsensusParams {
  const r = new Reader(bytes);
  const expectedProposersPerSlot = r.u32() / 65536;
  const quorumStakeBps = r.u32();
  return { expectedProposersPerSlot, quorumStakeBps };
}

/* ------------------------------------------------------------------ */
/*  GENESIS OUTPUTS                                                    */
/* ------------------------------------------------------------------ */

export interface InitialOutputWire {
  oneTimeAddr: CurvePoint;
  amount: CurvePoint;
}

export function encodeInitialOutputs(os: InitialOutputWire[]): Uint8Array {
  const w = new Writer();
  w.varint(os.length);
  for (const o of os) {
    w.point(o.oneTimeAddr);
    w.point(o.amount);
  }
  return w.bytes();
}

export function decodeInitialOutputs(bytes: Uint8Array): InitialOutputWire[] {
  const r = new Reader(bytes);
  const n = Number(r.varint());
  const out: InitialOutputWire[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const oneTimeAddr = r.point();
    const amount = r.point();
    out[i] = { oneTimeAddr, amount };
  }
  return out;
}

export function encodeStorageList(ss: StorageCommitment[]): Uint8Array {
  const w = new Writer();
  w.varint(ss.length);
  for (const s of ss) writeStorageCommitment(w, s);
  return w.bytes();
}

export function decodeStorageList(bytes: Uint8Array): StorageCommitment[] {
  const r = new Reader(bytes);
  const n = Number(r.varint());
  const out: StorageCommitment[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = readStorageCommitment(r);
  return out;
}
