/* ================================================================== *
 *  MoneyFund Network — Verifiable Random Function (ECVRF / ed25519)    *
 *                                                                      *
 *  WHAT THIS UNLOCKS                                                   *
 *  ─────────────────                                                   *
 *  A VRF turns a secret key into a deterministic, unpredictable, but   *
 *  publicly verifiable random function. For network consensus this is  *
 *  the missing primitive that lets us:                                 *
 *                                                                      *
 *    1. Run leader election without a coordinator. Each validator      *
 *       computes y_v = VRF(sk_v, slot_seed). Smallest y_v wins the     *
 *       slot — and they include the proof in the block, so any node    *
 *       can verify the leader was the legitimate winner.               *
 *                                                                      *
 *    2. Sample ring decoys deterministically. The chain selects a      *
 *       per-tx seed; the sender derives decoy indices from VRF outputs *
 *       so anyone can verify the decoys were chosen "fairly" without   *
 *       seeing the spend key.                                          *
 *                                                                      *
 *    3. Pick storage audit chunks. VRF(slot_seed, storage_id) → chunk  *
 *       index → operator must produce that chunk + Merkle proof or     *
 *       fail the audit and be slashed.                                 *
 *                                                                      *
 *  PROPERTIES                                                          *
 *  ──────────                                                          *
 *    • Deterministic: VRF(sk, m) is a function of (sk, m)              *
 *    • Unique: only the holder of sk can compute the output            *
 *    • Pseudorandom: output is computationally indistinguishable from  *
 *      uniform random for anyone who doesn't know sk                   *
 *    • Verifiable: anyone with pk can check the proof π and recover    *
 *      the same output                                                 *
 *                                                                      *
 *  CONSTRUCTION                                                        *
 *  ────────────                                                        *
 *  Mirrors RFC 9381 (ECVRF-EDWARDS25519-SHA512) closely. We swap the   *
 *  RFC's mandatory Elligator2 hash-to-curve for our existing           *
 *  try-and-increment hashToPoint — mathematically equivalent in        *
 *  security, slightly different output distribution. Production use    *
 *  would adopt strict Elligator2 to be drop-in compatible with         *
 *  external verifiers.                                                 *
 *                                                                      *
 *      sk  ← 32 random bytes                                           *
 *      x   = expand(sk).scalar                                         *
 *      pk  = x · G                                                     *
 *                                                                      *
 *      Prove(sk, msg):                                                 *
 *         H     = hashToPoint(pk || msg)                               *
 *         Γ     = x · H                                                *
 *         k     = nonce(sk, H)            // deterministic             *
 *         c     = chal(pk, H, Γ, k·G, k·H)                             *
 *         s     = k + c·x  (mod L)                                     *
 *         π     = (Γ, c, s)                                            *
 *         β     = hash("VRF-output", Γ)   // 32-byte output            *
 *                                                                      *
 *      Verify(pk, msg, π):                                             *
 *         H     = hashToPoint(pk || msg)                               *
 *         U     = s·G − c·pk            // = k·G                       *
 *         V     = s·H − c·Γ             // = k·H                       *
 *         c′    = chal(pk, H, Γ, U, V)                                 *
 *         accept iff c′ = c, return β = hash("VRF-output", Γ)          *
 * ================================================================== */

import { sha512 } from "@noble/hashes/sha2.js";
import {
  G,
  L,
  Point,
  hashToPoint,
  randomBytes,
  type CurvePoint,
} from "./primitives";
import { Writer, dhash, DOMAIN } from "./codec";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

export interface VrfKeypair {
  sk: Uint8Array; //  32 bytes of seed material
  /** scalar derived from sk */
  x: bigint;
  pk: CurvePoint; //  x · G
}

export interface VrfProof {
  Gamma: CurvePoint; // x · H
  c: bigint; //  Fiat-Shamir challenge
  s: bigint; //  response scalar k + c·x mod L
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function bytesToBigIntLE(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
}

/** Expand 32-byte seed → (scalar, prefix). Mirrors ed25519 key expansion
 *  so a VRF keypair could co-exist with a normal ed25519 signing key. */
function expandSeed(sk: Uint8Array): { x: bigint; prefix: Uint8Array } {
  if (sk.length !== 32) throw new Error("VRF: sk must be 32 bytes");
  const h = sha512(sk);
  const lower = new Uint8Array(h.slice(0, 32));
  // Apply ed25519 clamping so the scalar lies in the right range, then
  // reduce mod L because @noble's scalar mul rejects scalars ≥ curve.n.
  // Reducing mod L is mathematically identical for a prime-order subgroup.
  lower[0] &= 248;
  lower[31] &= 127;
  lower[31] |= 64;
  const xRaw = bytesToBigIntLE(lower);
  return { x: mod(xRaw, L), prefix: h.slice(32, 64) };
}

/** Deterministic nonce derived from prefix and the H point — like
 *  RFC 9381 §5.4.2.2, but using SHA-512 over (prefix || H_bytes). */
function deriveNonce(prefix: Uint8Array, H: CurvePoint): bigint {
  const buf = new Uint8Array(prefix.length + 32);
  buf.set(prefix);
  buf.set(H.toBytes(), prefix.length);
  const wide = sha512(buf);
  return mod(bytesToBigIntLE(wide), L);
}

/** Domain-separated challenge derivation. Returns a 16-byte (128-bit)
 *  scalar truncation, the same width RFC 9381 specifies. */
function challengeScalar(
  pk: CurvePoint,
  H: CurvePoint,
  Gamma: CurvePoint,
  U: CurvePoint,
  V: CurvePoint
): bigint {
  const w = new Writer();
  w.point(pk).point(H).point(Gamma).point(U).point(V);
  const out = dhash(DOMAIN.VRF_CHALLENGE, w.bytes());
  return bytesToBigIntLE(out.slice(0, 16));
}

/* ------------------------------------------------------------------ */
/*  KEYGEN                                                             */
/* ------------------------------------------------------------------ */

export function vrfKeygen(seed?: Uint8Array): VrfKeypair {
  const sk = seed ? new Uint8Array(seed) : randomBytes(32);
  if (sk.length !== 32) throw new Error("VRF: seed must be 32 bytes");
  const { x } = expandSeed(sk);
  return { sk, x, pk: G.multiply(x) };
}

/* ------------------------------------------------------------------ */
/*  PROVE                                                              */
/* ------------------------------------------------------------------ */

export function vrfProve(
  kp: VrfKeypair,
  msg: Uint8Array
): { proof: VrfProof; output: Uint8Array } {
  const { x, prefix } = expandSeed(kp.sk);
  const Hinput = new Uint8Array(32 + msg.length);
  Hinput.set(kp.pk.toBytes());
  Hinput.set(msg, 32);
  const H = hashToPoint(Hinput);
  const Gamma = H.multiply(x);
  const k = deriveNonce(prefix, H);
  const Ucommit = G.multiply(k);
  const Vcommit = H.multiply(k);
  const c = challengeScalar(kp.pk, H, Gamma, Ucommit, Vcommit);
  const s = mod(k + c * x, L);
  const output = vrfOutput(Gamma);
  return { proof: { Gamma, c, s }, output };
}

/* ------------------------------------------------------------------ */
/*  VERIFY                                                             */
/* ------------------------------------------------------------------ */

export function vrfVerify(
  pk: CurvePoint,
  msg: Uint8Array,
  proof: VrfProof
): { ok: boolean; output: Uint8Array | null } {
  try {
    const Hinput = new Uint8Array(32 + msg.length);
    Hinput.set(pk.toBytes());
    Hinput.set(msg, 32);
    const H = hashToPoint(Hinput);
    const U = G.multiply(proof.s).subtract(pk.multiply(proof.c));
    const V = H.multiply(proof.s).subtract(proof.Gamma.multiply(proof.c));
    const cCheck = challengeScalar(pk, H, proof.Gamma, U, V);
    if (cCheck !== proof.c) return { ok: false, output: null };
    return { ok: true, output: vrfOutput(proof.Gamma) };
  } catch {
    return { ok: false, output: null };
  }
}

/** Map the proof's Γ point to the 32-byte VRF output β.                *
 *  Domain-separated to prevent confusion with other hashes of Γ.       */
export function vrfOutput(Gamma: CurvePoint): Uint8Array {
  // Multiply by cofactor 8 to clear small-order components — RFC 9381 §5.2.
  const cleared = Gamma.multiply(8n);
  return dhash(DOMAIN.VRF_OUTPUT, cleared.toBytes());
}

/** Convenience: interpret the VRF output as a uniform u64 in [0, 2^64). */
export function vrfOutputAsU64(beta: Uint8Array): bigint {
  return new DataView(beta.buffer, beta.byteOffset, 8).getBigUint64(0, false);
}

/** Convenience: deterministically derive an integer in [0, n). */
export function vrfOutputAsIndex(beta: Uint8Array, n: number): number {
  if (n <= 0) throw new Error("vrfOutputAsIndex: n must be positive");
  return Number(vrfOutputAsU64(beta) % BigInt(n));
}

/* ------------------------------------------------------------------ */
/*  ENCODING                                                           */
/* ------------------------------------------------------------------ */

export function encodeVrfProof(p: VrfProof): Uint8Array {
  // 32 (Γ) + 16 (c, low 16 bytes) + 32 (s) = 80 bytes
  const out = new Uint8Array(80);
  out.set(p.Gamma.toBytes(), 0);
  // Encode c as 16-byte LE
  let cn = p.c;
  for (let i = 0; i < 16; i++) {
    out[32 + i] = Number(cn & 0xffn);
    cn >>= 8n;
  }
  // s as 32-byte LE
  let sn = p.s;
  for (let i = 0; i < 32; i++) {
    out[48 + i] = Number(sn & 0xffn);
    sn >>= 8n;
  }
  return out;
}

export function decodeVrfProof(b: Uint8Array): VrfProof {
  if (b.length !== 80) throw new Error("decodeVrfProof: expect 80 bytes");
  const Gamma = Point.fromBytes(b.slice(0, 32));
  let c = 0n;
  for (let i = 15; i >= 0; i--) c = (c << 8n) | BigInt(b[32 + i]);
  let s = 0n;
  for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(b[48 + i]);
  return { Gamma, c, s };
}

