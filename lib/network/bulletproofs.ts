/* ================================================================== *
 *  MoneyFund Network — Bulletproofs (BP)                               *
 *                                                                      *
 *  REFERENCE                                                           *
 *  ─────────                                                           *
 *  Bünz, Bootle, Boneh, Poelstra, Wuille, Maxwell, 2017                *
 *  "Bulletproofs: Short Proofs for Confidential Transactions and       *
 *   More". https://eprint.iacr.org/2017/1066                           *
 *                                                                      *
 *  WHY THIS REPLACES range.ts                                          *
 *  ──────────────────────────                                          *
 *  Our Borromean range proofs (lib/network/range.ts) work but cost     *
 *  ~32·N + 32·3·N ≈ 8 KB at N = 64 bits per output. Bulletproofs       *
 *  collapse the same statement into 2·log₂(N) curve points + 5         *
 *  scalars — about 672 bytes at N = 64. ~12× compression with          *
 *  identical security and no trusted setup.                            *
 *                                                                      *
 *  All modern privacy chains that use confidential amounts             *
 *  (Monero post-2018, Mimblewimble, Grin, Tari, …) ship Bulletproofs   *
 *  for exactly this reason.                                            *
 *                                                                      *
 *  CONSTRUCTION                                                        *
 *  ────────────                                                        *
 *  Range proof for V = γ·G + v·H, v ∈ [0, 2^N):                       *
 *                                                                      *
 *    1. Bit decomposition  a_L ∈ {0,1}^N,  a_R = a_L − 1^N             *
 *    2. A = α·G + ⟨a_L, G_vec⟩ + ⟨a_R, H_vec⟩                          *
 *    3. S = ρ·G + ⟨s_L, G_vec⟩ + ⟨s_R, H_vec⟩    (random s_L, s_R)     *
 *    4. (y, z) = FS(V, A, S)                                           *
 *    5. l(X) = (a_L − z·1^N) + s_L·X                                   *
 *       r(X) = y^N ⊙ (a_R + z·1^N + s_R·X) + z²·2^N                    *
 *       t(X) = ⟨l(X), r(X)⟩  =  t₀ + t₁·X + t₂·X²                      *
 *    6. T₁ = t₁·H + τ₁·G,    T₂ = t₂·H + τ₂·G   (random τ₁, τ₂)        *
 *    7. x = FS(T₁, T₂)                                                 *
 *    8. l = l(x), r = r(x), t̂ = ⟨l, r⟩                                *
 *       τ_x = τ₁·x + τ₂·x² + z²·γ                                     *
 *       μ   = α + ρ·x                                                  *
 *    9. Replace the O(N) communication of (l, r) with the              *
 *       Inner Product Argument (IPA) → O(log N).                       *
 *                                                                      *
 *  Verifier checks                                                     *
 *      t̂·H + τ_x·G  =?  z²·V + δ(y,z)·H + x·T₁ + x²·T₂                *
 *      δ(y,z) = (z − z²)·⟨1^N, y^N⟩ − z³·⟨1^N, 2^N⟩                   *
 *  and runs the IPA verifier on the residual P − μ·G.                  *
 *                                                                      *
 *  This module exposes `bpProve` / `bpVerify` over the same ed25519    *
 *  group used by the rest of the network — no extra curve, no extra   *
 *  trust, no extra setup.                                              *
 * ================================================================== */

import {
  G,
  H,
  L,
  Point,
  randomScalar,
  hashToPoint,
  type CurvePoint,
} from "./primitives";
import { Writer, dhash64, DOMAIN } from "./codec";

/* ------------------------------------------------------------------ */
/*  FIELD HELPERS                                                      */
/* ------------------------------------------------------------------ */

function mod(a: bigint): bigint {
  const r = a % L;
  return r < 0n ? r + L : r;
}

function modInv(a: bigint): bigint {
  let [oldR, r] = [mod(a), L];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("BP: scalar not invertible");
  return mod(oldS);
}

function bytesToBigIntLE(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
}

function hashToScalar(...parts: Uint8Array[]): bigint {
  const wide = dhash64(DOMAIN.BP_RANGE, ...parts);
  return mod(bytesToBigIntLE(wide));
}

/** @noble's multiply rejects 0 — route to the curve identity. */
function mul(P: CurvePoint, k: bigint): CurvePoint {
  const km = mod(k);
  return km === 0n ? Point.ZERO : P.multiply(km);
}

/* ------------------------------------------------------------------ */
/*  VECTOR OPS  (over Z_L)                                             */
/* ------------------------------------------------------------------ */

function innerProduct(a: bigint[], b: bigint[]): bigint {
  if (a.length !== b.length) throw new Error("ip: length mismatch");
  let acc = 0n;
  for (let i = 0; i < a.length; i++) acc = mod(acc + a[i] * b[i]);
  return acc;
}

function vecScalarMul(v: bigint[], k: bigint): bigint[] {
  return v.map((x) => mod(x * k));
}

function vecAdd(a: bigint[], b: bigint[]): bigint[] {
  if (a.length !== b.length) throw new Error("vecAdd: length mismatch");
  return a.map((x, i) => mod(x + b[i]));
}

function vecSub(a: bigint[], b: bigint[]): bigint[] {
  if (a.length !== b.length) throw new Error("vecSub: length mismatch");
  return a.map((x, i) => mod(x - b[i]));
}

function hadamard(a: bigint[], b: bigint[]): bigint[] {
  if (a.length !== b.length) throw new Error("hadamard: length mismatch");
  return a.map((x, i) => mod(x * b[i]));
}

/** Vector pedersen-style commitment: ⟨v, P⟩ = Σ v_i · P_i */
function vecCommit(v: bigint[], P: CurvePoint[]): CurvePoint {
  if (v.length !== P.length) throw new Error("vecCommit: length mismatch");
  let acc = Point.ZERO;
  for (let i = 0; i < v.length; i++) {
    if (mod(v[i]) === 0n) continue;
    acc = acc.add(P[i].multiply(mod(v[i])));
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/*  GENERATOR VECTORS                                                  */
/*                                                                     *
 *  G_vec[i] and H_vec[i] are independent generators in the group;     *
 *  derived deterministically from N + index so prover and verifier    *
 *  agree without any setup.                                            */
/* ------------------------------------------------------------------ */

function genG(i: number, N: number): CurvePoint {
  const w = new Writer();
  w.varint(N).u8(0).u32(i);
  return hashToPoint(w.bytes());
}
function genH(i: number, N: number): CurvePoint {
  const w = new Writer();
  w.varint(N).u8(1).u32(i);
  return hashToPoint(w.bytes());
}
function genU(N: number): CurvePoint {
  const w = new Writer();
  w.varint(N).u8(2);
  return hashToPoint(w.bytes());
}

/* ------------------------------------------------------------------ */
/*  INNER PRODUCT ARGUMENT (IPA)                                       */
/*                                                                     *
 *  Proves ⟨l, r⟩ = c given                                            *
 *      P = ⟨l, G_vec⟩ + ⟨r, H_vec⟩ + c·U                              *
 *  in O(log N) communication.                                         *
 *                                                                     *
 *  Each round halves the vector lengths and emits one (L, R) pair.    */
/* ------------------------------------------------------------------ */

interface IPAProof {
  Lvec: CurvePoint[]; // log₂(N) entries
  Rvec: CurvePoint[]; // log₂(N) entries
  a: bigint;          // final l[0]
  b: bigint;          // final r[0]
}

function ipaProve(
  Gv: CurvePoint[],
  Hv: CurvePoint[],
  U: CurvePoint,
  l: bigint[],
  r: bigint[],
  transcriptSeed: Uint8Array
): IPAProof {
  const Lvec: CurvePoint[] = [];
  const Rvec: CurvePoint[] = [];
  let a = [...l];
  let b = [...r];
  let G_ = [...Gv];
  let H_ = [...Hv];
  let prevTranscript = transcriptSeed;

  while (a.length > 1) {
    const half = a.length >> 1;
    const aL = a.slice(0, half), aR = a.slice(half);
    const bL = b.slice(0, half), bR = b.slice(half);
    const GL = G_.slice(0, half), GR = G_.slice(half);
    const HL = H_.slice(0, half), HR = H_.slice(half);

    const cL = innerProduct(aL, bR);
    const cR = innerProduct(aR, bL);

    // L = ⟨aL, GR⟩ + ⟨bR, HL⟩ + cL·U
    // R = ⟨aR, GL⟩ + ⟨bL, HR⟩ + cR·U
    const Lcom = vecCommit(aL, GR).add(vecCommit(bR, HL)).add(mul(U, cL));
    const Rcom = vecCommit(aR, GL).add(vecCommit(bL, HR)).add(mul(U, cR));

    Lvec.push(Lcom);
    Rvec.push(Rcom);

    const u = hashToScalar(prevTranscript, Lcom.toBytes(), Rcom.toBytes());
    prevTranscript = dhash64(
      DOMAIN.BP_INNER_PROD,
      prevTranscript,
      Lcom.toBytes(),
      Rcom.toBytes()
    );
    const uInv = modInv(u);

    // Fold vectors.
    const aNew = new Array<bigint>(half);
    const bNew = new Array<bigint>(half);
    const GNew = new Array<CurvePoint>(half);
    const HNew = new Array<CurvePoint>(half);
    for (let i = 0; i < half; i++) {
      aNew[i] = mod(u * aL[i] + uInv * aR[i]);
      bNew[i] = mod(uInv * bL[i] + u * bR[i]);
      GNew[i] = mul(GL[i], uInv).add(mul(GR[i], u));
      HNew[i] = mul(HL[i], u).add(mul(HR[i], uInv));
    }
    a = aNew;
    b = bNew;
    G_ = GNew;
    H_ = HNew;
  }

  return { Lvec, Rvec, a: a[0], b: b[0] };
}

/** Recompute the verifier-side generator scaling factor s[i] for each
 *  base index i. Saves us from recomputing G_vec/H_vec iteratively. */
function ipaSVector(challenges: bigint[], invs: bigint[], N: number): bigint[] {
  // s[i] = product_{j=0..k-1} (bit_j(i) ? u_j : u_j^{-1})
  // where k = log₂(N) and bit_j(i) is the j-th bit of i with j=0 being MSB
  // (matches the recursion order: outermost split first).
  const k = challenges.length;
  const s = new Array<bigint>(N).fill(1n);
  for (let i = 0; i < N; i++) {
    let acc = 1n;
    for (let j = 0; j < k; j++) {
      const bit = (i >> (k - 1 - j)) & 1;
      acc = mod(acc * (bit === 1 ? challenges[j] : invs[j]));
    }
    s[i] = acc;
  }
  return s;
}

function ipaVerify(
  Gv: CurvePoint[],
  Hv: CurvePoint[],
  U: CurvePoint,
  P: CurvePoint,
  proof: IPAProof,
  transcriptSeed: Uint8Array
): boolean {
  // Re-derive the per-round challenges from the transcript.
  const challenges: bigint[] = [];
  let prev = transcriptSeed;
  for (let j = 0; j < proof.Lvec.length; j++) {
    const Lj = proof.Lvec[j];
    const Rj = proof.Rvec[j];
    const u = hashToScalar(prev, Lj.toBytes(), Rj.toBytes());
    challenges.push(u);
    prev = dhash64(
      DOMAIN.BP_INNER_PROD,
      prev,
      Lj.toBytes(),
      Rj.toBytes()
    );
  }
  const invs = challenges.map((u) => modInv(u));

  // Compute the folded P:
  //   P' = P + Σ u²_j · L_j + Σ u^{-2}_j · R_j
  let Pfolded = P;
  for (let j = 0; j < challenges.length; j++) {
    const u2 = mod(challenges[j] * challenges[j]);
    const uInv2 = mod(invs[j] * invs[j]);
    Pfolded = Pfolded.add(mul(proof.Lvec[j], u2)).add(mul(proof.Rvec[j], uInv2));
  }

  // Compute the s vector and its inverse.
  const N = Gv.length;
  const s = ipaSVector(challenges, invs, N);
  const sInv = s.map((x) => modInv(x));

  // Check P' =? a·(Σ s_i G_i) + b·(Σ s_i^{-1} H_i) + (a·b)·U
  let GsumScaled = Point.ZERO;
  let HsumScaled = Point.ZERO;
  for (let i = 0; i < N; i++) {
    GsumScaled = GsumScaled.add(mul(Gv[i], s[i]));
    HsumScaled = HsumScaled.add(mul(Hv[i], sInv[i]));
  }

  const expected = mul(GsumScaled, proof.a)
    .add(mul(HsumScaled, proof.b))
    .add(mul(U, mod(proof.a * proof.b)));

  return Pfolded.equals(expected);
}

/* ------------------------------------------------------------------ */
/*  RANGE PROOF                                                        */
/* ------------------------------------------------------------------ */

export interface BulletproofRange {
  N: number;
  V: CurvePoint;          // public commitment
  A: CurvePoint;
  S: CurvePoint;
  T1: CurvePoint;
  T2: CurvePoint;
  tHat: bigint;
  taux: bigint;
  mu: bigint;
  ipa: IPAProof;
}

/** Build a Bulletproofs range proof for v ∈ [0, 2^N). */
export function bpProve(
  value: bigint,
  blinding: bigint,
  N = 64
): { V: CurvePoint; proof: BulletproofRange } {
  if ((N & (N - 1)) !== 0 || N <= 0 || N > 64) {
    throw new Error("BP: N must be a power of two in (0, 64]");
  }
  if (value < 0n || value >= 1n << BigInt(N)) {
    throw new Error(`BP: value out of [0, 2^${N})`);
  }

  // Generators.
  const Gv: CurvePoint[] = new Array(N);
  const Hv: CurvePoint[] = new Array(N);
  for (let i = 0; i < N; i++) {
    Gv[i] = genG(i, N);
    Hv[i] = genH(i, N);
  }
  const U = genU(N);

  // Public commitment.
  const V = mul(G, blinding).add(mul(H, value));

  // Bit decomposition.
  const aL = new Array<bigint>(N);
  const aR = new Array<bigint>(N);
  for (let i = 0; i < N; i++) {
    const b = Number((value >> BigInt(i)) & 1n);
    aL[i] = BigInt(b);
    aR[i] = mod(BigInt(b) - 1n);
  }

  // A = α·G + ⟨a_L, G_vec⟩ + ⟨a_R, H_vec⟩
  const alpha = randomScalar();
  const A = mul(G, alpha).add(vecCommit(aL, Gv)).add(vecCommit(aR, Hv));

  // S = ρ·G + ⟨s_L, G_vec⟩ + ⟨s_R, H_vec⟩
  const sL = new Array<bigint>(N);
  const sR = new Array<bigint>(N);
  for (let i = 0; i < N; i++) {
    sL[i] = randomScalar();
    sR[i] = randomScalar();
  }
  const rho = randomScalar();
  const S = mul(G, rho).add(vecCommit(sL, Gv)).add(vecCommit(sR, Hv));

  // y, z challenges.
  const y = hashToScalar(V.toBytes(), A.toBytes(), S.toBytes(), new Uint8Array([0]));
  const z = hashToScalar(V.toBytes(), A.toBytes(), S.toBytes(), new Uint8Array([1]));

  // Powers of y.
  const yN = new Array<bigint>(N);
  yN[0] = 1n;
  for (let i = 1; i < N; i++) yN[i] = mod(yN[i - 1] * y);
  const twoN = new Array<bigint>(N);
  twoN[0] = 1n;
  for (let i = 1; i < N; i++) twoN[i] = mod(twoN[i - 1] * 2n);
  const onesN = new Array<bigint>(N).fill(1n);

  // l(X) = (a_L − z·1^N) + s_L·X
  // r(X) = y^N ⊙ (a_R + z·1^N + s_R·X) + z²·2^N
  // We need l(x) and r(x) for the chosen x; t₁ and t₂ for T1, T2.

  // l₀ = a_L − z·1^N, l₁ = s_L
  const l0 = vecSub(aL, vecScalarMul(onesN, z));
  const l1 = sL;

  // r₀ = y^N ⊙ (a_R + z·1^N) + z²·2^N
  // r₁ = y^N ⊙ s_R
  const z2 = mod(z * z);
  const r0 = vecAdd(
    hadamard(yN, vecAdd(aR, vecScalarMul(onesN, z))),
    vecScalarMul(twoN, z2)
  );
  const r1 = hadamard(yN, sR);

  // t₀ = ⟨l₀, r₀⟩, t₁ = ⟨l₀, r₁⟩ + ⟨l₁, r₀⟩, t₂ = ⟨l₁, r₁⟩
  const t1 = mod(innerProduct(l0, r1) + innerProduct(l1, r0));
  const t2 = innerProduct(l1, r1);

  const tau1 = randomScalar();
  const tau2 = randomScalar();
  const T1 = mul(H, t1).add(mul(G, tau1));
  const T2 = mul(H, t2).add(mul(G, tau2));

  // x challenge.
  const x = hashToScalar(T1.toBytes(), T2.toBytes());

  // l = l₀ + l₁·x;  r = r₀ + r₁·x
  const l = vecAdd(l0, vecScalarMul(l1, x));
  const r = vecAdd(r0, vecScalarMul(r1, x));

  const tHat = innerProduct(l, r);
  const taux = mod(tau1 * x + tau2 * mod(x * x) + z2 * blinding);
  const mu = mod(alpha + rho * x);

  // Prepare for IPA: scale H_vec by y^{-i} so the IPA "sees" an inner product
  // ⟨l, r⟩ = tHat against the rescaled bases.
  const yInv = modInv(y);
  const yInvPow = new Array<bigint>(N);
  yInvPow[0] = 1n;
  for (let i = 1; i < N; i++) yInvPow[i] = mod(yInvPow[i - 1] * yInv);
  const Hvy: CurvePoint[] = Hv.map((P, i) => mul(P, yInvPow[i]));

  // IPA transcript seed binds in the high-level proof.
  const transcriptSeed = dhash64(
    DOMAIN.BP_RANGE,
    V.toBytes(),
    A.toBytes(),
    S.toBytes(),
    T1.toBytes(),
    T2.toBytes(),
    bigintToBytes(tHat, 32),
    bigintToBytes(taux, 32),
    bigintToBytes(mu, 32)
  );

  // P' such that P' = ⟨l, G_vec⟩ + ⟨r, H_vec_y⟩ + tHat·U.
  const ipa = ipaProve(Gv, Hvy, U, l, r, transcriptSeed);

  return {
    V,
    proof: {
      N,
      V,
      A,
      S,
      T1,
      T2,
      tHat,
      taux,
      mu,
      ipa,
    },
  };
}

export function bpVerify(p: BulletproofRange): boolean {
  try {
    const N = p.N;
    if ((N & (N - 1)) !== 0 || N <= 0 || N > 64) return false;

    // Reconstruct generators.
    const Gv = new Array<CurvePoint>(N);
    const Hv = new Array<CurvePoint>(N);
    for (let i = 0; i < N; i++) {
      Gv[i] = genG(i, N);
      Hv[i] = genH(i, N);
    }
    const U = genU(N);

    // Re-derive challenges.
    const y = hashToScalar(p.V.toBytes(), p.A.toBytes(), p.S.toBytes(), new Uint8Array([0]));
    const z = hashToScalar(p.V.toBytes(), p.A.toBytes(), p.S.toBytes(), new Uint8Array([1]));
    const x = hashToScalar(p.T1.toBytes(), p.T2.toBytes());

    // Powers.
    const yN = new Array<bigint>(N);
    yN[0] = 1n;
    for (let i = 1; i < N; i++) yN[i] = mod(yN[i - 1] * y);
    const twoN = new Array<bigint>(N);
    twoN[0] = 1n;
    for (let i = 1; i < N; i++) twoN[i] = mod(twoN[i - 1] * 2n);
    const onesN = new Array<bigint>(N).fill(1n);
    const z2 = mod(z * z);
    const z3 = mod(z2 * z);

    // δ(y,z)
    const sumOneY = innerProduct(onesN, yN);
    const sumOneTwo = innerProduct(onesN, twoN);
    const delta = mod(mod(z - z2) * sumOneY - z3 * sumOneTwo);

    // First check: t̂·H + τ_x·G  =?  z²·V + δ·H + x·T1 + x²·T2
    const lhs1 = mul(H, p.tHat).add(mul(G, p.taux));
    const rhs1 = mul(p.V, z2)
      .add(mul(H, delta))
      .add(mul(p.T1, x))
      .add(mul(p.T2, mod(x * x)));
    if (!lhs1.equals(rhs1)) return false;

    // Build the vector P that the IPA will verify against.
    const yInv = modInv(y);
    const yInvPow = new Array<bigint>(N);
    yInvPow[0] = 1n;
    for (let i = 1; i < N; i++) yInvPow[i] = mod(yInvPow[i - 1] * yInv);
    const Hvy: CurvePoint[] = Hv.map((P, i) => mul(P, yInvPow[i]));

    // P = A + x·S − z·⟨1^N, G_vec⟩ + ⟨z·y^N + z²·2^N, Hvy⟩ − μ·G + tHat·U
    let P = p.A.add(mul(p.S, x));
    // − z·Σ G_vec[i]
    for (let i = 0; i < N; i++) P = P.subtract(mul(Gv[i], z));
    // + (z·y^N + z²·2^N) ⊙ scaled Hvy
    for (let i = 0; i < N; i++) {
      const coef = mod(z * yN[i] + z2 * twoN[i]);
      P = P.add(mul(Hvy[i], coef));
    }
    P = P.subtract(mul(G, p.mu)).add(mul(U, p.tHat));

    // Recompute IPA transcript seed.
    const transcriptSeed = dhash64(
      DOMAIN.BP_RANGE,
      p.V.toBytes(),
      p.A.toBytes(),
      p.S.toBytes(),
      p.T1.toBytes(),
      p.T2.toBytes(),
      bigintToBytes(p.tHat, 32),
      bigintToBytes(p.taux, 32),
      bigintToBytes(p.mu, 32)
    );

    return ipaVerify(Gv, Hvy, U, P, p.ipa, transcriptSeed);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  HELPERS / ENCODING                                                 */
/* ------------------------------------------------------------------ */

function bigintToBytes(n: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let v = mod(n);
  for (let i = 0; i < len; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Approximate proof size (bytes) for a given N. */
export function bpProofSize(N: number): number {
  const logN = Math.log2(N);
  // 4 setup points (A, S, T1, T2)
  // V is the public commitment, not counted as proof
  // 3 scalars (tHat, taux, mu)
  // 2·logN points (Lvec, Rvec)
  // 2 scalars (a, b)
  return 32 * (4 + 2 * logN) + 32 * (3 + 2);
}
