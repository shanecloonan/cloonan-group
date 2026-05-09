/* ================================================================== *
 *  MoneyFund Network — Cryptographic Primitives                       *
 *                                                                      *
 *  Foundation layer for the v6.1 architecture. All primitives are      *
 *  implemented over the ed25519 prime-order subgroup using audited     *
 *  @noble/curves and @noble/hashes, mirroring the design choices of    *
 *  Monero's CryptoNote / RingCT family.                                *
 *                                                                      *
 *  WHAT'S HERE                                                         *
 *  ───────────                                                         *
 *  • Field & scalar helpers     — bytes ↔ scalars ↔ points             *
 *  • hashToScalar               — H_s : bytes → Z_L                    *
 *  • hashToPoint                — H_p : bytes → curve point            *
 *  • Schnorr signatures         — basic discrete-log signature         *
 *  • Pedersen commitments       — confidential amounts (RingCT core)   *
 *  • Stealth addresses          — CryptoNote one-time output keys      *
 *  • LSAG ring signatures       — linkable spontaneous anonymous group *
 *                                                                      *
 *  These are real implementations that should round-trip                *
 *  sign↔verify correctly. They are NOT yet audited for production —    *
 *  treat them as a faithful reference implementation of the            *
 *  whitepaper's Tier-1 privacy primitives.                             *
 * ================================================================== */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";

const Point = ed25519.Point;
type CurvePoint = InstanceType<typeof Point>;

/** Subgroup order L = 2^252 + 27742317777372353535851937790883648493 */
export const L: bigint = Point.Fn.ORDER;

/** Generator G (the canonical base point of ed25519). */
export const G: CurvePoint = Point.BASE;

/* ------------------------------------------------------------------ *
 *  ENCODING HELPERS                                                   *
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

/** 32-byte little-endian → bigint, reduced mod L. */
export function bytesToScalar(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return mod(n, L);
}

/** bigint → 32-byte little-endian. */
export function scalarToBytes(scalar: bigint): Uint8Array {
  const b = new Uint8Array(32);
  let n = mod(scalar, L);
  for (let i = 0; i < 32; i++) {
    b[i] = Number(n & 0xffn);
    n = n >> 8n;
  }
  return b;
}

export function scalarToHex(scalar: bigint): string {
  return bytesToHex(scalarToBytes(scalar));
}

export function pointToHex(p: CurvePoint): string {
  return bytesToHex(p.toBytes());
}

export function hexToPoint(h: string): CurvePoint {
  return Point.fromBytes(hexToBytes(h));
}

/** Concatenate any number of byte arrays. */
function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Modular reduction that always returns a non-negative result. */
function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

/** Modular inverse via extended Euclidean. */
function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error("modular inverse does not exist");
  return mod(old_s, m);
}

/* ------------------------------------------------------------------ *
 *  RANDOMNESS                                                         *
 * ------------------------------------------------------------------ */

/** Cryptographically secure random scalar in [1, L−1]. */
export function randomScalar(): bigint {
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  // reduce 512-bit → 256-bit scalar mod L (uniform within statistical bounds)
  const wide = sha512(buf);
  let n = 0n;
  for (let i = wide.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(wide[i]);
  }
  const reduced = mod(n, L);
  return reduced === 0n ? 1n : reduced;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/* ------------------------------------------------------------------ *
 *  HASH-TO-SCALAR  (H_s)                                              *
 *                                                                     *
 *  H_s : bytes* → Z_L                                                 *
 *  Concatenates inputs and hashes via SHA-512, then reduces mod L.    *
 *  This matches the Monero "hash_to_scalar" pattern.                  *
 * ------------------------------------------------------------------ */

export function hashToScalar(...parts: Uint8Array[]): bigint {
  const digest = sha512(concat(...parts));
  let n = 0n;
  for (let i = digest.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(digest[i]);
  }
  return mod(n, L);
}

/* ------------------------------------------------------------------ *
 *  HASH-TO-POINT  (H_p)                                               *
 *                                                                     *
 *  H_p : bytes → ed25519 point                                        *
 *  Try-and-increment over SHA-512 with a 32-bit counter. The fraction *
 *  of 32-byte strings that decode to a valid ed25519 point is ~50%,   *
 *  so we expect to succeed within a handful of attempts.              *
 *  After decoding we multiply by 8 to land in the prime-order         *
 *  subgroup, the same convention Monero uses.                         *
 * ------------------------------------------------------------------ */

export function hashToPoint(input: Uint8Array): CurvePoint {
  for (let counter = 0; counter < 1000; counter++) {
    const buf = new Uint8Array(input.length + 4);
    buf.set(input);
    new DataView(buf.buffer).setUint32(input.length, counter, false);
    const h = sha512(buf);
    try {
      // Try decoding the first 32 bytes as a compressed Edwards point.
      const candidate = Point.fromBytes(h.slice(0, 32));
      // Multiply by 8 (cofactor) to clear small-order components.
      return candidate.multiply(8n);
    } catch {
      // Invalid encoding — bump the counter and retry.
    }
  }
  throw new Error("hashToPoint: failed within 1000 attempts (statistically impossible)");
}

/** Independent generator H = H_p(G).  Used for Pedersen commitments. */
export const H: CurvePoint = hashToPoint(G.toBytes());

/* ================================================================== *
 *  PRIMITIVE 1 · SCHNORR SIGNATURE                                    *
 * ================================================================== *
 *                                                                      *
 *  Keygen: x ← Z_L random ;  P = x·G                                   *
 *                                                                      *
 *  Sign(m, x):                                                         *
 *      r ← Z_L random                                                  *
 *      R = r·G                                                         *
 *      e = H_s(R || P || m)                                            *
 *      s = r + e·x  (mod L)                                            *
 *      σ = (R, s)                                                      *
 *                                                                      *
 *  Verify(m, σ, P):                                                    *
 *      e = H_s(R || P || m)                                            *
 *      check  s·G  ==  R + e·P                                         *
 * ================================================================== */

export interface SchnorrKeypair {
  privKey: bigint;
  pubKey: CurvePoint;
}

export interface SchnorrSignature {
  R: CurvePoint;
  s: bigint;
}

export function schnorrKeygen(): SchnorrKeypair {
  const privKey = randomScalar();
  return { privKey, pubKey: G.multiply(privKey) };
}

export function schnorrSign(
  msg: Uint8Array,
  keypair: SchnorrKeypair
): SchnorrSignature {
  const r = randomScalar();
  const R = G.multiply(r);
  const e = hashToScalar(R.toBytes(), keypair.pubKey.toBytes(), msg);
  const s = mod(r + e * keypair.privKey, L);
  return { R, s };
}

export function schnorrVerify(
  msg: Uint8Array,
  sig: SchnorrSignature,
  pubKey: CurvePoint
): boolean {
  try {
    const e = hashToScalar(sig.R.toBytes(), pubKey.toBytes(), msg);
    const left = G.multiply(sig.s);
    const right = sig.R.add(pubKey.multiply(e));
    return left.equals(right);
  } catch {
    return false;
  }
}

/* ================================================================== *
 *  PRIMITIVE 2 · PEDERSEN COMMITMENT                                  *
 * ================================================================== *
 *                                                                      *
 *  C(v, r) = r·G + v·H                                                 *
 *                                                                      *
 *  • Hiding   — perfectly hides v if r is uniform random               *
 *  • Binding  — computationally binds (cannot open to a different v)   *
 *  • Additively homomorphic:                                           *
 *        C(v₁, r₁) + C(v₂, r₂) = C(v₁+v₂, r₁+r₂)                      *
 *                                                                      *
 *  This is the foundation of RingCT confidential amounts.              *
 * ================================================================== */

export interface PedersenCommitment {
  C: CurvePoint;       // the commitment point
  value: bigint;       // the committed value (the secret)
  blinding: bigint;    // the blinding factor (the secret)
}

export function pedersenCommit(value: bigint, blinding?: bigint): PedersenCommitment {
  const r = blinding ?? randomScalar();
  const C = G.multiply(mod(r, L)).add(H.multiply(mod(value, L)));
  return { C, value, blinding: r };
}

/** Verify the commitment opens to (value, blinding). */
export function pedersenVerify(c: PedersenCommitment): boolean {
  const expected = G.multiply(mod(c.blinding, L)).add(
    H.multiply(mod(c.value, L))
  );
  return expected.equals(c.C);
}

/** Add commitments: C(v₁,r₁) + C(v₂,r₂) = C(v₁+v₂, r₁+r₂). */
export function pedersenSum(commits: PedersenCommitment[]): PedersenCommitment {
  let totalC = Point.ZERO;
  let totalV = 0n;
  let totalR = 0n;
  for (const c of commits) {
    totalC = totalC.add(c.C);
    totalV = mod(totalV + c.value, L);
    totalR = mod(totalR + c.blinding, L);
  }
  return { C: totalC, value: totalV, blinding: totalR };
}

/** Verify that a set of input commitments balances against output commitments
 *  (∑ inputs = ∑ outputs). Used in RingCT to prove no value was created or
 *  destroyed without revealing any individual amount.                      */
export function pedersenBalance(
  inputs: PedersenCommitment[],
  outputs: PedersenCommitment[]
): boolean {
  const sumIn = pedersenSum(inputs);
  const sumOut = pedersenSum(outputs);
  return sumIn.C.equals(sumOut.C);
}

/* ================================================================== *
 *  PRIMITIVE 3 · STEALTH ADDRESS  (CryptoNote dual-key)               *
 * ================================================================== *
 *                                                                      *
 *  Recipient publishes a wallet address (A, B):                        *
 *     a ← Z_L private view key  ;  A = a·G                             *
 *     b ← Z_L private spend key ;  B = b·G                             *
 *                                                                      *
 *  Sender (sending to recipient (A, B)):                               *
 *     r ← Z_L random                                                   *
 *     R  = r·G                          (transaction public key)       *
 *     P  = H_s(r·A)·G + B               (one-time output address)      *
 *     publishes (R, P)                                                 *
 *                                                                      *
 *  Recipient detects an output is theirs by recomputing P:             *
 *     P' = H_s(a·R)·G + B                                              *
 *     output is mine iff P' == P                                       *
 *                                                                      *
 *  Recipient spends with private key:                                  *
 *     x = H_s(a·R) + b   (mod L)                                       *
 *     verify: x·G == P                                                 *
 *                                                                      *
 *  External observers cannot link multiple payments to the same        *
 *  wallet because each output P is a fresh, unlinkable address.        *
 * ================================================================== */

export interface StealthWallet {
  viewPriv: bigint;
  viewPub: CurvePoint;
  spendPriv: bigint;
  spendPub: CurvePoint;
}

export function stealthGen(): StealthWallet {
  const viewPriv = randomScalar();
  const spendPriv = randomScalar();
  return {
    viewPriv,
    viewPub: G.multiply(viewPriv),
    spendPriv,
    spendPub: G.multiply(spendPriv),
  };
}

export interface StealthOutput {
  R: CurvePoint;        // tx public key
  oneTimeAddr: CurvePoint; // P
}

/** Sender constructs a one-time address for the recipient (A, B). */
export function stealthSendTo(recipient: {
  viewPub: CurvePoint;
  spendPub: CurvePoint;
}): StealthOutput {
  const r = randomScalar();
  const R = G.multiply(r);
  const sharedSecret = recipient.viewPub.multiply(r); // r·A
  const Hs = hashToScalar(sharedSecret.toBytes());
  const P = G.multiply(Hs).add(recipient.spendPub);
  return { R, oneTimeAddr: P };
}

/** Recipient checks whether output P with tx-pubkey R is theirs. */
export function stealthDetect(
  output: StealthOutput,
  wallet: { viewPriv: bigint; spendPub: CurvePoint }
): boolean {
  const sharedSecret = output.R.multiply(wallet.viewPriv); // a·R
  const Hs = hashToScalar(sharedSecret.toBytes());
  const expected = G.multiply(Hs).add(wallet.spendPub);
  return expected.equals(output.oneTimeAddr);
}

/** Recipient derives the one-time private key for spending P. */
export function stealthSpendKey(
  output: StealthOutput,
  wallet: { viewPriv: bigint; spendPriv: bigint }
): bigint {
  const sharedSecret = output.R.multiply(wallet.viewPriv);
  const Hs = hashToScalar(sharedSecret.toBytes());
  return mod(Hs + wallet.spendPriv, L);
}

/* ================================================================== *
 *  PRIMITIVE 4 · LSAG RING SIGNATURE                                  *
 * ================================================================== *
 *                                                                      *
 *  Linkable Spontaneous Anonymous Group signature (Liu, Wei, Wong      *
 *  2004) — sign on behalf of a ring of N pubkeys without revealing    *
 *  which member signed. Linkable: same signer always produces the      *
 *  same key image I, allowing double-spend detection without          *
 *  identifying the signer.                                             *
 *                                                                      *
 *  Setup:    ring = (P_0, P_1, …, P_{n−1}) where P_π is the signer.   *
 *            Signer knows x such that P_π = x·G.                       *
 *            Key image  I = x · H_p(P_π)                              *
 *                                                                      *
 *  Sign(m, ring, π, x):                                                *
 *     α ← Z_L random                                                  *
 *     L_π = α·G                                                       *
 *     R_π = α·H_p(P_π)                                                *
 *     c_{π+1} = H_s(m || L_π || R_π)                                  *
 *     for i = π+1, π+2, …, π−1:                                       *
 *         s_i ← Z_L random                                            *
 *         L_i = s_i·G + c_i·P_i                                        *
 *         R_i = s_i·H_p(P_i) + c_i·I                                  *
 *         c_{i+1} = H_s(m || L_i || R_i)                              *
 *     s_π = α − c_π · x   (mod L)                                     *
 *     σ = (c_0, s_0, …, s_{n−1}, I)                                   *
 *                                                                      *
 *  Verify(m, ring, σ):                                                 *
 *     c = c_0                                                          *
 *     for i = 0, 1, …, n−1:                                            *
 *         L_i = s_i·G + c·P_i                                          *
 *         R_i = s_i·H_p(P_i) + c·I                                    *
 *         c   = H_s(m || L_i || R_i)                                  *
 *     accept iff c == c_0                                              *
 * ================================================================== */

export interface LsagSignature {
  c0: bigint;
  s: bigint[];
  I: CurvePoint; // key image — same signer ⇒ same I
}

export function lsagSign(
  msg: Uint8Array,
  ring: CurvePoint[],
  signerIdx: number,
  signerPriv: bigint
): LsagSignature {
  const n = ring.length;
  if (n < 2) throw new Error("ring must have ≥ 2 members");
  if (signerIdx < 0 || signerIdx >= n) throw new Error("signerIdx out of range");

  // Sanity check — the signer's private key must produce the claimed pubkey.
  if (!G.multiply(signerPriv).equals(ring[signerIdx])) {
    throw new Error("signerPriv does not match ring[signerIdx]");
  }

  const HP_self = hashToPoint(ring[signerIdx].toBytes());
  const I = HP_self.multiply(signerPriv); // key image

  const c: bigint[] = new Array(n).fill(0n);
  const s: bigint[] = new Array(n).fill(0n);

  // Step 1: signer's commitment α·G, α·H_p(P_π).
  const alpha = randomScalar();
  let Lcur = G.multiply(alpha);
  let Rcur = HP_self.multiply(alpha);

  // Step 2: c[π+1] = H_s(m, L_π, R_π).
  let i = (signerIdx + 1) % n;
  c[i] = hashToScalar(msg, Lcur.toBytes(), Rcur.toBytes());

  // Step 3: walk the ring forward until we wrap back to the signer.
  while (i !== signerIdx) {
    s[i] = randomScalar();
    const HPi = hashToPoint(ring[i].toBytes());
    Lcur = G.multiply(s[i]).add(ring[i].multiply(c[i]));
    Rcur = HPi.multiply(s[i]).add(I.multiply(c[i]));
    const next = (i + 1) % n;
    c[next] = hashToScalar(msg, Lcur.toBytes(), Rcur.toBytes());
    i = next;
  }

  // Step 4: close the ring at the signer's index.
  s[signerIdx] = mod(alpha - c[signerIdx] * signerPriv, L);

  return { c0: c[0], s, I };
}

export function lsagVerify(
  msg: Uint8Array,
  ring: CurvePoint[],
  sig: LsagSignature
): boolean {
  try {
    const n = ring.length;
    if (sig.s.length !== n) return false;

    let c = sig.c0;
    for (let i = 0; i < n; i++) {
      const HPi = hashToPoint(ring[i].toBytes());
      const Li = G.multiply(sig.s[i]).add(ring[i].multiply(c));
      const Ri = HPi.multiply(sig.s[i]).add(sig.I.multiply(c));
      c = hashToScalar(msg, Li.toBytes(), Ri.toBytes());
    }
    return c === sig.c0;
  } catch {
    return false;
  }
}

/** Two LSAG signatures from the same signer share the same key image. */
export function lsagLinked(a: LsagSignature, b: LsagSignature): boolean {
  return a.I.equals(b.I);
}

/* ------------------------------------------------------------------ *
 *  EXPORTS                                                            *
 * ------------------------------------------------------------------ */

export { Point };
export type { CurvePoint };

/* ------------------------------------------------------------------ *
 *  INTERNAL UTILITIES (exposed for the lab UI)                        *
 * ------------------------------------------------------------------ */

export const _internal = { mod, modInverse, concat };
