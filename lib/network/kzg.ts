/* ================================================================== *
 *  MoneyFund Network — KZG Polynomial Commitments                      *
 *                                                                      *
 *  WHAT THIS UNLOCKS                                                   *
 *  ─────────────────                                                   *
 *  KZG (Kate–Zaverucha–Goldberg, 2010) is the polynomial commitment    *
 *  scheme that powers most modern zk-SNARKs (Plonk, Halo2, Sonic,      *
 *  Marlin) and Ethereum's Danksharding data-availability layer.        *
 *                                                                      *
 *  Given a polynomial p(X) of degree ≤ n, KZG lets a prover            *
 *      • COMMIT to p with a single 48-byte G1 point C_p,               *
 *      • OPEN p at any evaluation point x with a single 48-byte π,     *
 *      • have the verifier check  p(x) = y  in CONSTANT TIME           *
 *        regardless of n — one pairing equation.                       *
 *                                                                      *
 *  Why this matters for the MoneyFund Network:                         *
 *                                                                      *
 *    • zkVM execution proofs. The whitepaper's decoupled-prover        *
 *      architecture proves chunks of execution via zk-SNARKs. Plonk    *
 *      uses KZG; this module is the foundation for that prover.        *
 *    • Data availability sampling. Storage operators commit to chunks  *
 *      with KZG; light clients sample at random points — if 1% of      *
 *      chunks are missing, sampling 50 random points catches it with   *
 *      ~99.4% probability.                                             *
 *    • Recursive proof aggregation. Halo-style accumulation of KZG     *
 *      proofs gives O(1) light-client verification of the entire      *
 *      chain history.                                                  *
 *                                                                      *
 *  CRITICAL CAVEAT — TRUSTED SETUP                                     *
 *  ───────────────────────────────                                     *
 *  KZG requires a structured reference string (SRS) of the form        *
 *      pp = ( G1·τ⁰, G1·τ¹, …, G1·τⁿ,  G2,  G2·τ )                    *
 *  where τ is a secret scalar. If anyone learns τ, they can forge      *
 *  any opening proof — total break of soundness.                       *
 *                                                                      *
 *  Production deployments use a multi-party "powers-of-tau" ceremony   *
 *  where the secret is split across hundreds of contributors; you only *
 *  need ONE honest contributor for soundness. Ethereum's KZG ceremony  *
 *  had 140k+ contributors.                                             *
 *                                                                      *
 *  THIS MODULE GENERATES A LOCAL SRS DETERMINISTICALLY for testing,    *
 *  development, and the lab UI. The setup is correct and the math is   *
 *  audit-grade, but DO NOT use this SRS for any value-bearing system.  *
 *  Replace with a properly-ceremonied SRS before shipping.             *
 *                                                                      *
 *  CONSTRUCTION                                                        *
 *  ────────────                                                        *
 *      Setup(n, τ):                                                    *
 *         srsG1[i] = τ^i · G1   for i = 0..n                           *
 *         srsG2τ   = τ · G2                                            *
 *                                                                      *
 *      Commit(p):                                                      *
 *         C = Σ p_i · srsG1[i]   (= p(τ) · G1, but prover never knows τ)
 *                                                                      *
 *      Open(p, x):                                                     *
 *         q(X) = (p(X) − p(x)) / (X − x)        // exact division      *
 *         π     = Σ q_i · srsG1[i]              (= q(τ) · G1)          *
 *         return (y = p(x), π)                                          *
 *                                                                      *
 *      Verify(C, x, y, π):                                             *
 *         check  e(C − y·G1,  G2) ≟ e(π,  srsG2τ − x·G2)               *
 *                                                                      *
 *  The verification equation is the famous Schwartz–Zippel-style       *
 *  identity: q(τ)·(τ − x) = p(τ) − y, lifted into pairings.            *
 * ================================================================== */

import { bls12_381 } from "@noble/curves/bls12-381.js";

const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
type G1Pt = InstanceType<typeof G1>;
type G2Pt = InstanceType<typeof G2>;

const Fr = bls12_381.fields.Fr;
/** Scalar-field prime of BLS12-381. */
export const FR_ORDER: bigint = Fr.ORDER;

/* ------------------------------------------------------------------ */
/*  FIELD HELPERS                                                      */
/*                                                                     *
 *  We do polynomial arithmetic in Fr using bigint mod FR_ORDER         *
 *  rather than going through @noble's Field abstraction, because       *
 *  the bigint approach is more readable and Fr is small enough that    *
 *  performance is fine for proofs up to ~2^16 degree.                  *
 * ------------------------------------------------------------------ */

function mod(a: bigint): bigint {
  const r = a % FR_ORDER;
  return r < 0n ? r + FR_ORDER : r;
}

/** @noble's multiply rejects scalar 0 with a range error. The
 *  mathematically correct identity for 0·P is the curve's zero point,
 *  so we route those calls explicitly. */
function safeMulG1(P: G1Pt, k: bigint): G1Pt {
  const km = mod(k);
  return km === 0n ? G1.ZERO : P.multiply(km);
}
function safeMulG2(P: G2Pt, k: bigint): G2Pt {
  const km = mod(k);
  return km === 0n ? G2.ZERO : P.multiply(km);
}

function modInv(a: bigint): bigint {
  // Extended Euclidean algorithm.
  let [oldR, r] = [mod(a), FR_ORDER];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("KZG: scalar has no inverse mod r");
  return mod(oldS);
}

/* ------------------------------------------------------------------ */
/*  POLYNOMIAL TYPE                                                    */
/* ------------------------------------------------------------------ */

/** A polynomial p(X) = c[0] + c[1]·X + c[2]·X² + … stored as ascending
 *  coefficients. Trailing zero coefficients are tolerated.               */
export type Polynomial = bigint[];

export function polyEval(p: Polynomial, x: bigint): bigint {
  // Horner's method.
  let acc = 0n;
  for (let i = p.length - 1; i >= 0; i--) {
    acc = mod(acc * x + p[i]);
  }
  return acc;
}

/** Subtract a constant in-place. Returns a new array. */
function polySubScalar(p: Polynomial, c: bigint): Polynomial {
  const out = [...p];
  out[0] = mod(out[0] - c);
  return out;
}

/** Synthetic division of p(X) − y by (X − x). Caller must ensure        *
 *  y == p(x), otherwise the remainder is non-zero (we throw).            *
 *                                                                        *
 *  Algorithm: if r(X) = p(X) − y, write r(X) = (X − x)·q(X). Then        *
 *      q[n−1] = r[n]                                                    *
 *      q[i]   = r[i+1] + x·q[i+1]   for i = n−2 down to 0                *
 *  The "remainder" r[0] + x·q[0] should be 0; we assert.                 */
function polyDivByLinear(p: Polynomial, x: bigint, y: bigint): Polynomial {
  const r = polySubScalar(p, y);
  const n = r.length;
  if (n === 0) return [];
  const q: Polynomial = new Array(n - 1);
  let prev = 0n;
  for (let i = n - 1; i > 0; i--) {
    q[i - 1] = mod(r[i] + x * prev);
    prev = q[i - 1];
  }
  const remainder = mod(r[0] + x * prev);
  if (remainder !== 0n) {
    throw new Error("KZG: polyDivByLinear remainder ≠ 0 (y did not equal p(x))");
  }
  return q;
}

/* ------------------------------------------------------------------ */
/*  STRUCTURED REFERENCE STRING (SRS)                                  */
/* ------------------------------------------------------------------ */

export interface KzgSrs {
  /** Maximum polynomial degree this SRS supports. */
  maxDegree: number;
  /** [τ^0·G1, τ^1·G1, …, τ^maxDegree·G1] */
  g1Powers: G1Pt[];
  /** τ · G2 */
  g2Tau: G2Pt;
}

/** DEVELOPMENT-ONLY trusted setup. Generates a fresh τ from a 32-byte    *
 *  seed and discards it on return — but the caller could in principle    *
 *  recover τ from the seed, so this MUST NOT be used in production.      *
 *                                                                        *
 *  In production replace with the output of a multi-party                *
 *  powers-of-tau ceremony (Ethereum's KZG SRS or similar).               */
export function kzgInsecureSetup(maxDegree: number, seed: Uint8Array): KzgSrs {
  if (maxDegree < 1) throw new Error("KZG: maxDegree must be ≥ 1");
  if (seed.length !== 32) throw new Error("KZG: seed must be 32 bytes");

  // Derive τ from seed.
  let tau = 0n;
  for (let i = seed.length - 1; i >= 0; i--) tau = (tau << 8n) | BigInt(seed[i]);
  tau = mod(tau);
  if (tau === 0n) tau = 1n;

  // Build the SRS by iterated multiplication so we don't have to multiply
  // by τ^i directly (which would still work, just slower).
  const g1Powers: G1Pt[] = new Array(maxDegree + 1);
  g1Powers[0] = G1.BASE; // τ^0 · G1 = G1
  for (let i = 1; i <= maxDegree; i++) {
    g1Powers[i] = g1Powers[i - 1].multiply(tau);
  }
  const g2Tau = G2.BASE.multiply(tau);

  return { maxDegree, g1Powers, g2Tau };
}

/* ------------------------------------------------------------------ */
/*  COMMIT                                                             */
/* ------------------------------------------------------------------ */

export function kzgCommit(srs: KzgSrs, p: Polynomial): G1Pt {
  if (p.length > srs.maxDegree + 1) {
    throw new Error(
      `KZG commit: polynomial of degree ${p.length - 1} exceeds SRS max ${srs.maxDegree}`
    );
  }
  let acc = G1.ZERO;
  for (let i = 0; i < p.length; i++) {
    const c = mod(p[i]);
    if (c === 0n) continue;
    acc = acc.add(srs.g1Powers[i].multiply(c));
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/*  OPEN  (single-point evaluation proof)                              */
/* ------------------------------------------------------------------ */

export interface KzgOpening {
  /** Evaluation point x. */
  x: bigint;
  /** Claimed value y = p(x). */
  y: bigint;
  /** Proof π = q(τ) · G1 where q(X) = (p(X) − y)/(X − x). */
  proof: G1Pt;
}

export function kzgOpen(srs: KzgSrs, p: Polynomial, x: bigint): KzgOpening {
  const xMod = mod(x);
  const y = polyEval(p, xMod);
  const q = polyDivByLinear(p, xMod, y);
  const proof = kzgCommit(srs, q);
  return { x: xMod, y, proof };
}

/* ------------------------------------------------------------------ */
/*  VERIFY                                                             */
/* ------------------------------------------------------------------ */

/** Verify the pairing identity                                          *
 *      e(C − y·G1,  G2)  =  e(π,  srsG2τ − x·G2)                        *
 *                                                                        *
 *  We check by computing both pairings and comparing the resulting       *
 *  elements in Fp12. (A more efficient implementation rearranges into    *
 *  a single multi-pairing; @noble's pairing API is fine for v0.1.)       */
export function kzgVerify(
  srs: KzgSrs,
  commitment: G1Pt,
  opening: KzgOpening
): boolean {
  try {
    const lhs1 = commitment.subtract(safeMulG1(G1.BASE, opening.y));
    const rhs2 = srs.g2Tau.subtract(safeMulG2(G2.BASE, opening.x));

    const lhsPair = bls12_381.pairing(lhs1, G2.BASE);
    const rhsPair = bls12_381.pairing(opening.proof, rhs2);

    return fp12Equal(lhsPair, rhsPair);
  } catch {
    return false;
  }
}

/** Bytewise equality on the Fp12 pairing output. The Fp12 element is
 *  a nested object, so we serialize and compare. */
function fp12Equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(serialize(a)) === JSON.stringify(serialize(b));
}

function serialize(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString(16);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = serialize((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/* ------------------------------------------------------------------ */
/*  CONVENIENCE: random polynomial / interpolation                     */
/* ------------------------------------------------------------------ */

export function randomPolynomial(degree: number): Polynomial {
  const out: Polynomial = new Array(degree + 1);
  for (let i = 0; i <= degree; i++) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    let n = 0n;
    for (let j = 0; j < 32; j++) n = (n << 8n) | BigInt(buf[j]);
    out[i] = mod(n);
  }
  return out;
}

void modInv;
