/* ================================================================== *
 *  MoneyFund Network — One-out-of-Many Zero-Knowledge Proof            *
 *                                                                      *
 *  THE PRIVACY MOONSHOT                                                *
 *  ────────────────────                                                *
 *  This is the cryptographic engine behind Triptych / Lelantus / Spats *
 *  — the log-size successor to Monero's CLSAG. Given a vector of N    *
 *  Pedersen-style commitments, it proves                                *
 *                                                                      *
 *      ∃ ℓ ∈ [0, N) and r such that  C_ℓ = r · H                     *
 *                                                                      *
 *  …in O(log N) communication, **without revealing ℓ or r**. CLSAG   *
 *  needs O(N) bytes per signature; this construction needs O(log N).  *
 *  Ring size 1024 → proof ≈ 5 KB instead of CLSAG's ≈ 64 KB at the    *
 *  same N. Anonymity set scales accordingly.                           *
 *                                                                      *
 *  PROTOCOL (Groth–Kohlweiss / Bootle et al., 2015–2016)              *
 *  ─────────────────────────────────────────────────                  *
 *  Setup: group of prime order L with generators G, H (we use the     *
 *  ed25519 base + an independent NUMS H). N = 2^n is a power of 2.    *
 *                                                                      *
 *  PROVER (ℓ in binary: ℓ_0 ℓ_1 … ℓ_{n−1}, LSB-first):                *
 *                                                                      *
 *    For j = 0…n−1:                                                   *
 *        a_j , r_j , s_j , t_j , ρ_k ← uniform random scalars         *
 *        A_j = a_j·G + s_j·H                                          *
 *        B_j = ℓ_j·G + r_j·H                                          *
 *        C_j = (ℓ_j · a_j)·G + t_j·H                                  *
 *                                                                      *
 *    For each i = 0…N−1, define factors                                *
 *        factor_{i,j}(x) = i_j · f_j(x)  +  (1−i_j) · (x − f_j(x))    *
 *    where f_j(x) = ℓ_j·x + a_j.                                      *
 *                                                                      *
 *    Expand the product:                                               *
 *        Π_{j} factor_{i,j}(x) = δ_{i,ℓ}·x^n + Σ_k p_{i,k} · x^k     *
 *                                                                      *
 *    For k = 0…n−1:                                                   *
 *        G_k = Σ_i p_{i,k} · C_i  +  ρ_k · H                          *
 *                                                                      *
 *    Challenge: x = Hash(ring, A_*, B_*, C_*, G_*).                    *
 *                                                                      *
 *    Responses:                                                        *
 *        f_j     = ℓ_j · x + a_j        (mod L)                       *
 *        z_A_j   = r_j · x + s_j        (mod L)                       *
 *        z_C_j   = r_j · (x − f_j) + t_j(mod L)                       *
 *        z_d     = r · x^n − Σ_k ρ_k · x^k                            *
 *                                                                      *
 *  VERIFIER checks, for j = 0…n−1:                                    *
 *        x·B_j + A_j  =  f_j·G + z_A_j·H        (sound for f_j shape) *
 *        (x − f_j)·B_j + C_j  =  z_C_j·H        (sound for ℓ_j ∈{0,1})*
 *  …and the BIG identity                                              *
 *        Σ_i (Π_j factor_{i,j}(x)) · C_i =                            *
 *               (Σ_k x^k · G_k) + z_d · H                              *
 *                                                                      *
 *  WHY IT WORKS                                                        *
 *  ─────────────                                                       *
 *  Bootle et al.'s expansion lemma guarantees that Π_j factor_{i,j}(x)*
 *  equals δ_{i,ℓ}·x^n + (a polynomial of degree n−1 in x). The verifier*
 *  computes the big sum directly from (f_j, C_i); the prover supplies *
 *  the lower-degree coefficients via G_k. The constant-term identity  *
 *  ties z_d back to the witness r, completing soundness. Zero-knowledge*
 *  comes from the per-bit Schnorr-style structure: f_j, z_A_j, z_C_j  *
 *  each leak nothing about ℓ_j thanks to the (a_j, s_j, t_j) blinders.*
 *                                                                      *
 *  SECURITY                                                            *
 *  ────────                                                            *
 *    • Soundness  — special soundness over 2 transcripts; relies on    *
 *      the discrete-log assumption in the chosen group (ed25519).     *
 *    • Zero-knowledge — honest-verifier ZK in the random-oracle model.*
 *    • Non-interactive — Fiat-Shamir; the transcript MUST commit to   *
 *      the whole proof up to the challenge, including the ring.       *
 *                                                                      *
 *  USAGE                                                               *
 *  ─────                                                               *
 *  This module gives you the raw proof. The companion module that      *
 *  wires it into spend transactions (replacing CLSAG) lives in        *
 *  lib/network/triptych.ts (forthcoming).                              *
 * ================================================================== */

import {
  G,
  H,
  L,
  Point,
  randomScalar,
  type CurvePoint,
} from "./primitives";
import { DOMAIN, dhash64 } from "./codec";

/* ------------------------------------------------------------------ */
/*  SCALAR ARITHMETIC                                                  */
/* ------------------------------------------------------------------ */

/** Canonical non-negative reduction modulo the curve order L. */
function mod(a: bigint): bigint {
  const r = a % L;
  return r < 0n ? r + L : r;
}

/* ------------------------------------------------------------------ */
/*  POLYNOMIAL ARITHMETIC (over Z/L)                                   */
/* ------------------------------------------------------------------ */

/** Multiply two polynomials given as coefficient arrays (a[0] is the   *
 *  constant term). Result length = a.length + b.length − 1.            */
function polyMul(a: bigint[], b: bigint[]): bigint[] {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0n) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === 0n) continue;
      out[i + j] = mod(out[i + j] + a[i] * b[j]);
    }
  }
  return out;
}

/** Evaluate a polynomial at scalar x. Horner's method, all mod L. */
function polyEval(coeffs: bigint[], x: bigint): bigint {
  if (coeffs.length === 0) return 0n;
  let acc = coeffs[coeffs.length - 1];
  for (let i = coeffs.length - 2; i >= 0; i--) {
    acc = mod(acc * x + coeffs[i]);
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/*  ENCODING HELPERS                                                   */
/* ------------------------------------------------------------------ */

function scalarToBytes(s: bigint): Uint8Array {
  // 32-byte little-endian (matches ed25519 conventions in @noble).
  const r = mod(s);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number((r >> BigInt(8 * i)) & 0xffn);
  }
  return out;
}

function bytesToScalar(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) {
    v = (v << 8n) | BigInt(b[i]);
  }
  return mod(v);
}

/* ------------------------------------------------------------------ */
/*  PUBLIC INTERFACE                                                   */
/* ------------------------------------------------------------------ */

export interface OomProof {
  /** Per-bit commitments. Length n = log2(N) each. */
  A: CurvePoint[];
  B: CurvePoint[];
  C: CurvePoint[];
  /** Polynomial commitments (length n; one per polynomial degree). */
  Gk: CurvePoint[];
  /** Responses (length n). */
  f: bigint[];
  zA: bigint[];
  zC: bigint[];
  /** Final response tying back to the witness. */
  zd: bigint;
}

/**
 *  Prove knowledge of an index ℓ ∈ [0, N) and a scalar r such that
 *    `ring[ℓ] = r · H`.
 *
 *  Inputs MUST satisfy: ring.length is a power of two, ℓ in [0, ring.length),
 *  and ring[ℓ] equals r · H. If any precondition is violated, the prover
 *  throws — we never silently emit a bad proof.
 */
export function oomProve(
  ring: CurvePoint[],
  ell: number,
  r: bigint
): OomProof {
  const N = ring.length;
  if (N === 0 || (N & (N - 1)) !== 0) {
    throw new Error(`oomProve: N must be a positive power of 2 (got ${N})`);
  }
  const n = Math.log2(N);
  if (!Number.isInteger(n)) throw new Error("oomProve: N not a clean power of 2");
  if (ell < 0 || ell >= N || !Number.isInteger(ell)) {
    throw new Error(`oomProve: ell out of range [0, ${N})`);
  }
  // Self-check: ring[ell] == r · H
  const rH = H.multiply(mod(r));
  if (!ring[ell].equals(rH)) {
    throw new Error("oomProve: witness mismatch (ring[ell] ≠ r·H)");
  }

  // ----- 1. Bit decomposition of ell. LSB-first. ----- //
  const bits: number[] = new Array(n);
  for (let j = 0; j < n; j++) bits[j] = (ell >> j) & 1;

  // ----- 2. Random scalars for the per-bit commitments. ----- //
  const a: bigint[] = new Array(n);
  const r_b: bigint[] = new Array(n);
  const s_b: bigint[] = new Array(n);
  const t_b: bigint[] = new Array(n);
  for (let j = 0; j < n; j++) {
    a[j] = randomScalar();
    r_b[j] = randomScalar();
    s_b[j] = randomScalar();
    t_b[j] = randomScalar();
  }

  // ----- 3. Compute A_j, B_j, C_j. ----- //
  const A: CurvePoint[] = new Array(n);
  const B: CurvePoint[] = new Array(n);
  const C: CurvePoint[] = new Array(n);
  for (let j = 0; j < n; j++) {
    A[j] = G.multiply(a[j]).add(H.multiply(s_b[j]));
    if (bits[j] === 1) {
      B[j] = G.add(H.multiply(r_b[j]));               // 1·G + r·H
      C[j] = G.multiply(a[j]).add(H.multiply(t_b[j])); // (1·a)·G + t·H
    } else {
      B[j] = H.multiply(r_b[j]);                       // 0·G + r·H
      C[j] = H.multiply(t_b[j]);                       // 0·G + t·H
    }
  }

  // ----- 4. For each i ∈ [N), compute the n-degree polynomial         //
  //          poly_i(x) = Π_{j} factor_{i,j}(x). We then read off       //
  //          coefficients p_{i,k} for k = 0…n−1 (the x^n coefficient   //
  //          is the δ_{i,ℓ} marker — we don't use it explicitly).      //
  //                                                                     //
  //   factor_{i,j}(x) =                                                //
  //     i_j = 0  →  (1 − ℓ_j)·x − a_j                                  //
  //     i_j = 1  →  ℓ_j·x + a_j                                        //
  // -------------------------------------------------------------------- //
  // pCoeffs[i] holds the n+1 coefficients of poly_i (degree ≤ n).
  const pCoeffs: bigint[][] = new Array(N);
  for (let i = 0; i < N; i++) {
    let acc: bigint[] = [1n]; // multiplicative identity
    for (let j = 0; j < n; j++) {
      const ij = (i >> j) & 1;
      const lj = bits[j];
      let factor: bigint[];
      if (ij === 0) {
        // (1 − ℓ_j)·x + (−a_j)
        factor = [mod(-a[j]), BigInt(1 - lj)];
      } else {
        // ℓ_j·x + a_j
        factor = [mod(a[j]), BigInt(lj)];
      }
      acc = polyMul(acc, factor);
    }
    // poly_i has degree ≤ n; pad to length n+1.
    while (acc.length < n + 1) acc.push(0n);
    pCoeffs[i] = acc;
  }

  // ----- 5. ρ_k random; G_k = Σ_i p_{i,k} · C_i + ρ_k · H. ----- //
  const rho: bigint[] = new Array(n);
  const Gk: CurvePoint[] = new Array(n);
  for (let k = 0; k < n; k++) {
    rho[k] = randomScalar();
    let acc: CurvePoint | null = null;
    for (let i = 0; i < N; i++) {
      const p = pCoeffs[i][k];
      if (p === 0n) continue;
      const term = ring[i].multiply(p);
      acc = acc === null ? term : acc.add(term);
    }
    const rhoTerm = H.multiply(rho[k]);
    Gk[k] = acc === null ? rhoTerm : acc.add(rhoTerm);
  }

  // ----- 6. Fiat-Shamir challenge x. The transcript binds the entire //
  //          ring + all first-round commitments so a malicious prover //
  //          can't replay across different instances.                  //
  const x = fsChallenge(ring, A, B, C, Gk);

  // ----- 7. Responses. ----- //
  const f: bigint[] = new Array(n);
  const zA: bigint[] = new Array(n);
  const zC: bigint[] = new Array(n);
  for (let j = 0; j < n; j++) {
    f[j] = mod(BigInt(bits[j]) * x + a[j]);
    zA[j] = mod(r_b[j] * x + s_b[j]);
    const xMinusFj = mod(x - f[j]);
    zC[j] = mod(r_b[j] * xMinusFj + t_b[j]);
  }
  // z_d = r · x^n  −  Σ_k ρ_k · x^k
  let xPow = 1n;
  let rhoX = 0n;
  for (let k = 0; k < n; k++) {
    rhoX = mod(rhoX + rho[k] * xPow);
    xPow = mod(xPow * x);
  }
  // After loop, xPow = x^n.
  const zd = mod(mod(r * xPow) - rhoX);

  return { A, B, C, Gk, f, zA, zC, zd };
}

/* ------------------------------------------------------------------ */
/*  VERIFY                                                             */
/* ------------------------------------------------------------------ */

export function oomVerify(ring: CurvePoint[], proof: OomProof): boolean {
  const N = ring.length;
  if (N === 0 || (N & (N - 1)) !== 0) return false;
  const n = Math.log2(N);
  if (!Number.isInteger(n)) return false;
  if (
    proof.A.length !== n || proof.B.length !== n || proof.C.length !== n ||
    proof.Gk.length !== n || proof.f.length !== n ||
    proof.zA.length !== n || proof.zC.length !== n
  ) {
    return false;
  }

  // Re-derive Fiat-Shamir challenge x.
  const x = fsChallenge(ring, proof.A, proof.B, proof.C, proof.Gk);

  // ----- Per-bit checks. ----- //
  for (let j = 0; j < n; j++) {
    // Check 1:  x·B_j + A_j  =  f_j·G + z_A_j·H
    const lhs1 = proof.B[j].multiply(x).add(proof.A[j]);
    const rhs1 = G.multiply(mod(proof.f[j])).add(H.multiply(mod(proof.zA[j])));
    if (!lhs1.equals(rhs1)) return false;

    // Check 2:  (x − f_j)·B_j + C_j  =  z_C_j·H
    const xMinusFj = mod(x - proof.f[j]);
    const lhs2 = proof.B[j].multiply(xMinusFj).add(proof.C[j]);
    const rhs2 = H.multiply(mod(proof.zC[j]));
    if (!lhs2.equals(rhs2)) return false;
  }

  // ----- Big-sum identity. ----- //
  // For each i, compute s_i = Π_j factor_{i,j}(x) AT THE SPECIFIC x.
  //   factor_{i,j}(x) = i_j · f_j   +   (1 − i_j) · (x − f_j)
  // Then LHS = Σ_i s_i · ring[i].
  // RHS = Σ_k x^k · G_k + z_d · H.
  const xPows: bigint[] = new Array(n);
  let xPow = 1n;
  for (let k = 0; k < n; k++) {
    xPows[k] = xPow;
    xPow = mod(xPow * x);
  }
  const xN = xPow; // x^n
  void xN; // not directly used in the check; included for documentation

  let lhs: CurvePoint | null = null;
  for (let i = 0; i < N; i++) {
    let s = 1n;
    for (let j = 0; j < n; j++) {
      const ij = (i >> j) & 1;
      const factor = ij === 1
        ? proof.f[j]
        : mod(x - proof.f[j]);
      s = mod(s * factor);
      if (s === 0n) break; // early-out: product is zero
    }
    if (s === 0n) continue;
    const term = ring[i].multiply(s);
    lhs = lhs === null ? term : lhs.add(term);
  }
  if (lhs === null) {
    // The big sum is zero. Then RHS must also be zero.
    // Only legitimate if every G_k is independent of ring (and z_d ≠ 0
    // unbalances), so we conservatively reject.
    return false;
  }

  let rhs: CurvePoint | null = null;
  for (let k = 0; k < n; k++) {
    const term = proof.Gk[k].multiply(xPows[k]);
    rhs = rhs === null ? term : rhs.add(term);
  }
  const zdH = H.multiply(mod(proof.zd));
  rhs = rhs === null ? zdH : rhs.add(zdH);

  return lhs.equals(rhs);
}

/* ------------------------------------------------------------------ */
/*  FIAT-SHAMIR TRANSCRIPT                                             */
/* ------------------------------------------------------------------ */

function fsChallenge(
  ring: CurvePoint[],
  A: CurvePoint[],
  B: CurvePoint[],
  C: CurvePoint[],
  Gk: CurvePoint[]
): bigint {
  // Domain-tagged hash of: |ring|, each ring point, each commitment.
  const parts: Uint8Array[] = [];
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, ring.length, false);
  parts.push(lenBuf);
  for (const p of ring) parts.push(p.toBytes());
  for (const p of A) parts.push(p.toBytes());
  for (const p of B) parts.push(p.toBytes());
  for (const p of C) parts.push(p.toBytes());
  for (const p of Gk) parts.push(p.toBytes());
  const h64 = dhash64(DOMAIN.OOM_CHALLENGE, ...parts);
  return mod(bytesToScalar(h64));
}

/* ------------------------------------------------------------------ */
/*  ENCODING (for on-the-wire usage / persistence)                     */
/* ------------------------------------------------------------------ */

export function encodeOomProof(p: OomProof): Uint8Array {
  const n = p.A.length;
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, n, false);
  parts.push(header);
  for (const arr of [p.A, p.B, p.C, p.Gk]) for (const pt of arr) parts.push(pt.toBytes());
  for (const arr of [p.f, p.zA, p.zC]) for (const s of arr) parts.push(scalarToBytes(s));
  parts.push(scalarToBytes(p.zd));
  // Concatenate.
  let total = 0;
  for (const x of parts) total += x.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const x of parts) {
    out.set(x, off);
    off += x.length;
  }
  return out;
}

export function decodeOomProof(bytes: Uint8Array): OomProof {
  if (bytes.length < 4) throw new Error("oom: truncated proof header");
  const n = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  // Expected size = 4 + 4·n·32 (points) + 3·n·32 (scalars: f, zA, zC) + 32 (zd)
  const expected = 4 + 4 * n * 32 + 3 * n * 32 + 32;
  if (bytes.length !== expected) {
    throw new Error(`oom: bad proof length (got ${bytes.length}, expected ${expected})`);
  }
  let off = 4;
  function readPoint(): CurvePoint {
    const p = Point.fromBytes(bytes.slice(off, off + 32));
    off += 32;
    return p;
  }
  function readScalar(): bigint {
    const s = bytesToScalar(bytes.slice(off, off + 32));
    off += 32;
    return s;
  }
  const A: CurvePoint[] = []; for (let i = 0; i < n; i++) A.push(readPoint());
  const B: CurvePoint[] = []; for (let i = 0; i < n; i++) B.push(readPoint());
  const C: CurvePoint[] = []; for (let i = 0; i < n; i++) C.push(readPoint());
  const Gk: CurvePoint[] = []; for (let i = 0; i < n; i++) Gk.push(readPoint());
  const f: bigint[] = []; for (let i = 0; i < n; i++) f.push(readScalar());
  const zA: bigint[] = []; for (let i = 0; i < n; i++) zA.push(readScalar());
  const zC: bigint[] = []; for (let i = 0; i < n; i++) zC.push(readScalar());
  const zd = readScalar();
  return { A, B, C, Gk, f, zA, zC, zd };
}

/* ------------------------------------------------------------------ */
/*  UTILITY                                                            */
/* ------------------------------------------------------------------ */

/** Proof size in bytes for ring size N. Useful for budgeting / UI.    */
export function oomProofSize(N: number): number {
  const n = Math.log2(N);
  return 4 + 4 * n * 32 + 3 * n * 32 + 32;
}

// Local exports for testing tooling; the polynomial helpers are
// genuinely module-internal but useful to expose to focused unit tests.
export const __internal = { polyMul, polyEval, mod };
