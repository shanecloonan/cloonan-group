/* ================================================================== *
 *  MoneyFund Network — MFBN-1 Codec                                    *
 *                                                                      *
 *  Deterministic, big-endian, length-prefixed binary encoding.         *
 *                                                                      *
 *  WHY THIS EXISTS                                                     *
 *  ────────────────                                                    *
 *  Every consensus-critical object (tx, block, ring sig challenge,     *
 *  key image, storage commitment) needs ONE canonical byte             *
 *  representation, because we hash that representation to derive its   *
 *  identity. If two implementations encode the same logical value      *
 *  differently, they fork the chain. JSON, JS object iteration, and    *
 *  dict-like Maps are non-deterministic — banned here.                 *
 *                                                                      *
 *  DESIGN                                                              *
 *  ──────                                                              *
 *    • Big-endian throughout.                                          *
 *    • Fixed-width integers for known sizes; varint for sizes/lengths. *
 *    • Length-prefix every variable-length field.                      *
 *    • All hashing is domain-separated. Adding a new domain tag is     *
 *      backwards-incompatible by design.                               *
 *                                                                      *
 *  Versioning: this is MFBN-1. A future MFBN-2 must use new domain     *
 *  tags so old objects cannot be confused with new ones.               *
 * ================================================================== */

import { sha512 } from "@noble/hashes/sha2.js";
import {
  scalarToBytes,
  bytesToScalar,
  Point,
  type CurvePoint,
} from "./primitives";

/* ------------------------------------------------------------------ *
 *  WRITER                                                             *
 * ------------------------------------------------------------------ */

export class Writer {
  private parts: Uint8Array[] = [];
  private size = 0;

  /** Concatenate all queued parts into a single Uint8Array. */
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let off = 0;
    for (const p of this.parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  push(b: Uint8Array): this {
    this.parts.push(b);
    this.size += b.length;
    return this;
  }

  u8(v: number): this {
    if (v < 0 || v > 0xff) throw new Error("u8 out of range");
    return this.push(new Uint8Array([v & 0xff]));
  }

  u32(v: number): this {
    if (v < 0 || v > 0xffffffff) throw new Error("u32 out of range");
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, false);
    return this.push(b);
  }

  u64(v: bigint): this {
    if (v < 0n || v > 0xffffffffffffffffn) throw new Error("u64 out of range");
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, false);
    return this.push(b);
  }

  /** Variable-length unsigned integer. LEB128-style 7-bit groups. */
  varint(v: bigint | number): this {
    let n = typeof v === "bigint" ? v : BigInt(v);
    if (n < 0n) throw new Error("varint: negative");
    while (n >= 0x80n) {
      this.u8(Number(n & 0x7fn) | 0x80);
      n >>= 7n;
    }
    return this.u8(Number(n));
  }

  /** Length-prefixed bytes. */
  blob(b: Uint8Array): this {
    return this.varint(b.length).push(b);
  }

  scalar(s: bigint): this {
    return this.push(scalarToBytes(s));
  }

  point(p: CurvePoint): this {
    return this.push(p.toBytes());
  }

  scalars(ss: bigint[]): this {
    this.varint(ss.length);
    for (const s of ss) this.scalar(s);
    return this;
  }

  points(ps: CurvePoint[]): this {
    this.varint(ps.length);
    for (const p of ps) this.point(p);
    return this;
  }
}

/* ------------------------------------------------------------------ *
 *  READER                                                             *
 * ------------------------------------------------------------------ */

export class Reader {
  private offset = 0;
  constructor(private readonly buffer: Uint8Array) {}

  end(): boolean {
    return this.offset >= this.buffer.length;
  }
  remaining(): number {
    return this.buffer.length - this.offset;
  }

  bytes(n: number): Uint8Array {
    if (this.offset + n > this.buffer.length)
      throw new Error("Reader: short buffer");
    const out = this.buffer.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  u8(): number {
    return this.bytes(1)[0];
  }
  u32(): number {
    return new DataView(this.bytes(4).buffer).getUint32(0, false);
  }
  u64(): bigint {
    return new DataView(this.bytes(8).buffer).getBigUint64(0, false);
  }

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    while (true) {
      if (shift > 70n) throw new Error("varint: too long");
      const b = this.u8();
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  }

  blob(): Uint8Array {
    const n = Number(this.varint());
    return this.bytes(n);
  }

  scalar(): bigint {
    return bytesToScalar(this.bytes(32));
  }
  point(): CurvePoint {
    return Point.fromBytes(this.bytes(32));
  }

  scalars(): bigint[] {
    const n = Number(this.varint());
    const out: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.scalar();
    return out;
  }
  points(): CurvePoint[] {
    const n = Number(this.varint());
    const out: CurvePoint[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.point();
    return out;
  }
}

/* ------------------------------------------------------------------ *
 *  DOMAIN-SEPARATED HASHING                                           *
 *                                                                     *
 *  All hashing in the protocol is prefixed with a domain string.      *
 *  This prevents cross-protocol replay (e.g. a Schnorr challenge      *
 *  being reused as a transaction hash). Returns 32 bytes by default.  *
 * ------------------------------------------------------------------ */

export const DOMAIN = {
  TX_ID:           "MFBN-1/tx-id",
  TX_PREIMAGE:     "MFBN-1/tx-preimage",          // hashed for ring-sig msg
  BLOCK_ID:        "MFBN-1/block-id",
  BLOCK_HEADER:    "MFBN-1/block-header",
  STORAGE_COMMIT:  "MFBN-1/storage-commit",
  CHUNK_HASH:      "MFBN-1/chunk-hash",
  MERKLE_LEAF:     "MFBN-1/merkle-leaf",
  MERKLE_NODE:     "MFBN-1/merkle-node",
  VRF_INPUT:       "MFBN-1/vrf-input",
  VRF_CHALLENGE:   "MFBN-1/vrf-challenge",
  VRF_OUTPUT:      "MFBN-1/vrf-output",
  BLS_SIG:         "MFBN-1/bls-sig",
  KZG_SETUP:       "MFBN-1/kzg-setup",
  KZG_TRANSCRIPT:  "MFBN-1/kzg-transcript",
  BP_INNER_PROD:   "MFBN-1/bp-inner-product",
  BP_RANGE:        "MFBN-1/bp-range",
  CONSENSUS_SLOT:  "MFBN-1/consensus-slot",
  CONSENSUS_VOTE:  "MFBN-1/consensus-vote",
  CLSAG_AGG_P:     "MFBN-1/clsag-agg-P",
  CLSAG_AGG_C:     "MFBN-1/clsag-agg-C",
  CLSAG_RING:      "MFBN-1/clsag-ring",
  RANGE_BIT:       "MFBN-1/range-bit",
  RANGE_FINAL:     "MFBN-1/range-final",
} as const;

export type Domain = (typeof DOMAIN)[keyof typeof DOMAIN];

/** Domain-separated hash → 32 bytes. */
export function dhash(domain: Domain, ...inputs: Uint8Array[]): Uint8Array {
  const w = new Writer();
  w.blob(new TextEncoder().encode(domain));
  for (const i of inputs) w.blob(i);
  return sha512(w.bytes()).slice(0, 32);
}

/** Domain-separated 64-byte hash (for hash-to-scalar reductions). */
export function dhash64(domain: Domain, ...inputs: Uint8Array[]): Uint8Array {
  const w = new Writer();
  w.blob(new TextEncoder().encode(domain));
  for (const i of inputs) w.blob(i);
  return sha512(w.bytes());
}

/* ------------------------------------------------------------------ *
 *  HEX HELPERS (re-exported for convenience)                          *
 * ------------------------------------------------------------------ */

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  }
  return out;
}
