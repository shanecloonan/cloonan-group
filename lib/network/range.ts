/* ================================================================== *
 *  MoneyFund Network — Range Proof                                     *
 *                                                                      *
 *  Proves a Pedersen commitment C = r·G + v·H hides a value v in       *
 *  [0, 2^N) without revealing v or r. This prevents an attacker from   *
 *  inflating the supply by committing to a "negative" amount, since    *
 *  in the integers mod L there is no order — without an explicit       *
 *  range proof, a malicious sender could commit to v = L − 1 (a giant  *
 *  number that wraps to look small) and steal value.                   *
 *                                                                      *
 *  CONSTRUCTION                                                        *
 *  ────────────                                                        *
 *  Decompose v into bits:                                              *
 *      v = Σ b_i · 2^i,    b_i ∈ {0, 1},   i ∈ [0, N).                 *
 *                                                                      *
 *  For each bit i, the prover publishes a sub-commitment                *
 *      C_i = r_i · G + b_i · 2^i · H                                   *
 *  with blindings chosen so that  Σ r_i = r,  giving Σ C_i = C.        *
 *                                                                      *
 *  For each bit i the prover then proves                               *
 *      C_i ∈ { r_i·G ,  r_i·G + 2^i·H }                                *
 *  i.e. C_i is a commitment to either 0 or 2^i. This is a              *
 *  1-of-2 sigma OR-proof (Cramer–Damgård–Schoenmakers) compiled to     *
 *  a non-interactive proof via Fiat–Shamir.                            *
 *                                                                      *
 *  Range follows from the bit constraint plus the bit-decomposition:   *
 *      v = Σ b_i · 2^i  ∈  [0, 2^N − 1].                               *
 *                                                                      *
 *  This is the "AOS" / Maxwell ring-signature variant of range proofs  *
 *  used by Monero before Bulletproofs (and is provably equivalent).    *
 *  Proof size is O(N) — O(log N) Bulletproofs are a future drop-in     *
 *  replacement that doesn't change any of the above semantics.         *
 * ================================================================== */

import {
  G,
  H,
  L,
  randomScalar,
  Point,
  type CurvePoint,
} from "./primitives";
import { DOMAIN, Writer, dhash64 } from "./codec";

/* ------------------------------------------------------------------ */
/*  CONSTANTS / TYPES                                                  */
/* ------------------------------------------------------------------ */

export const RANGE_N_BITS_DEFAULT = 64;

export interface RangeProof {
  /** Number of bits used (must match prover and verifier). */
  N: number;
  /** Per-bit commitments C_i. */
  bitCommits: CurvePoint[];
  /** Combined challenge from Fiat-Shamir over all sub-commitments. */
  e: bigint;
  /** For each bit, the "branch 0" challenge. branch 1 = e − c0[i] mod L. */
  c0: bigint[];
  /** Per-bit branch-0 response (s for the "bit = 0" branch). */
  s0: bigint[];
  /** Per-bit branch-1 response (s for the "bit = 1" branch). */
  s1: bigint[];
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

function hashToScalar(...parts: Uint8Array[]): bigint {
  const wide = dhash64(DOMAIN.RANGE_FINAL, ...parts);
  return mod(bytesToBigIntLE(wide), L);
}

/** Compute the two pubkeys for a bit's OR proof:
 *    pk_0 = C_i             (commitment to 0   ⇒ sk = r_i)
 *    pk_1 = C_i − 2^i · H   (commitment to 2^i ⇒ sk = r_i)
 *  In either case the signer's witness w.r.t. G is r_i.        */
function bitPubkeys(C_i: CurvePoint, i: number): [CurvePoint, CurvePoint] {
  const weight = H.multiply(1n << BigInt(i));
  return [C_i, C_i.subtract(weight)];
}

/** Encode the public part of the proof so we can hash it for FS. */
function transcript(C: CurvePoint, bitCommits: CurvePoint[], R0: CurvePoint[], R1: CurvePoint[]): Uint8Array {
  const w = new Writer();
  w.point(C);
  w.points(bitCommits);
  w.points(R0);
  w.points(R1);
  return w.bytes();
}

/* ================================================================== */
/*  PROVE                                                              */
/* ================================================================== */

/** Build a range proof for the commitment C = r·G + v·H.
 *  Caller must hold v and r. Returns (C, proof). */
export function rangeProve(
  value: bigint,
  blinding: bigint,
  N: number = RANGE_N_BITS_DEFAULT
): { C: CurvePoint; proof: RangeProof } {
  if (N <= 0 || N > 64) throw new Error("range: N must be in (0, 64]");
  if (value < 0n) throw new Error("range: negative value");
  const max = 1n << BigInt(N);
  if (value >= max) throw new Error(`range: value ≥ 2^${N}`);

  // Decompose v into N bits.
  const bits: number[] = new Array(N);
  for (let i = 0; i < N; i++) bits[i] = Number((value >> BigInt(i)) & 1n);

  // Pick blinding factors r_0, …, r_{N-2} freely; force r_{N-1} so Σ r_i = r.
  const r: bigint[] = new Array(N);
  let sum = 0n;
  for (let i = 0; i < N - 1; i++) {
    r[i] = randomScalar();
    sum = mod(sum + r[i], L);
  }
  r[N - 1] = mod(blinding - sum, L);

  // Per-bit commitments.
  const C_i: CurvePoint[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const term = G.multiply(r[i]);
    C_i[i] = bits[i] === 1 ? term.add(H.multiply(1n << BigInt(i))) : term;
  }

  // The aggregate is Σ C_i = (Σ r_i)·G + (Σ b_i·2^i)·H = r·G + v·H = C.
  let C = Point.ZERO;
  for (const c of C_i) C = C.add(c);

  /* ---- Build the per-bit commitments R_0, R_1 ---- */
  const alpha: bigint[] = new Array(N);    // signer's nonce per bit
  const cFake: bigint[] = new Array(N);    // simulator's challenge for the wrong branch
  const sFake: bigint[] = new Array(N);    // simulator's response for the wrong branch
  const R0: CurvePoint[] = new Array(N);
  const R1: CurvePoint[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const [pk0, pk1] = bitPubkeys(C_i[i], i);
    alpha[i] = randomScalar();
    cFake[i] = randomScalar();
    sFake[i] = randomScalar();

    if (bits[i] === 0) {
      // Real branch is 0; simulate branch 1.
      R0[i] = G.multiply(alpha[i]);
      R1[i] = G.multiply(sFake[i]).add(pk1.multiply(cFake[i]));
    } else {
      // Real branch is 1; simulate branch 0.
      R0[i] = G.multiply(sFake[i]).add(pk0.multiply(cFake[i]));
      R1[i] = G.multiply(alpha[i]);
    }
  }

  /* ---- Fiat–Shamir global challenge e ---- */
  const e = hashToScalar(transcript(C, C_i, R0, R1));

  /* ---- Close each OR-proof ---- */
  const c0: bigint[] = new Array(N);
  const s0: bigint[] = new Array(N);
  const s1: bigint[] = new Array(N);

  for (let i = 0; i < N; i++) {
    if (bits[i] === 0) {
      const c1 = cFake[i];
      const cReal = mod(e - c1, L);
      c0[i] = cReal;
      s0[i] = mod(alpha[i] - cReal * r[i], L);
      s1[i] = sFake[i];
    } else {
      const c0Sim = cFake[i];
      const cReal = mod(e - c0Sim, L);
      c0[i] = c0Sim;
      s0[i] = sFake[i];
      s1[i] = mod(alpha[i] - cReal * r[i], L);
    }
  }

  return {
    C,
    proof: { N, bitCommits: C_i, e, c0, s0, s1 },
  };
}

/* ================================================================== */
/*  VERIFY                                                              */
/* ================================================================== */

export function rangeVerify(C: CurvePoint, proof: RangeProof): boolean {
  try {
    const N = proof.N;
    if (
      proof.bitCommits.length !== N ||
      proof.c0.length !== N ||
      proof.s0.length !== N ||
      proof.s1.length !== N
    )
      return false;

    // Aggregate check: Σ C_i must equal C.
    let agg = Point.ZERO;
    for (const c of proof.bitCommits) agg = agg.add(c);
    if (!agg.equals(C)) return false;

    // Reconstruct R_0, R_1 for each bit and recompute the FS challenge.
    const R0: CurvePoint[] = new Array(N);
    const R1: CurvePoint[] = new Array(N);

    for (let i = 0; i < N; i++) {
      const [pk0, pk1] = bitPubkeys(proof.bitCommits[i], i);
      const c0 = proof.c0[i];
      const c1 = mod(proof.e - c0, L);

      R0[i] = G.multiply(proof.s0[i]).add(pk0.multiply(c0));
      R1[i] = G.multiply(proof.s1[i]).add(pk1.multiply(c1));
    }

    const eCheck = hashToScalar(transcript(C, proof.bitCommits, R0, R1));
    return eCheck === proof.e;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  ENCODING                                                           */
/* ------------------------------------------------------------------ */

export function encodeRangeProof(p: RangeProof): Uint8Array {
  const w = new Writer();
  w.varint(p.N);
  w.points(p.bitCommits);
  w.scalar(p.e);
  w.scalars(p.c0);
  w.scalars(p.s0);
  w.scalars(p.s1);
  return w.bytes();
}
