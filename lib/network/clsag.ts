/* ================================================================== *
 *  MoneyFund Network — CLSAG (Concise Linkable Spontaneous Anonymous   *
 *                            Group signature)                          *
 *                                                                      *
 *  Reference: Goodell, Noether, RandomRun                              *
 *             "Concise Linkable Ring Signatures and Forgery Against    *
 *              Adversarial Keys" (https://eprint.iacr.org/2019/654)    *
 *                                                                      *
 *  CLSAG is the production ring-signature primitive used by Monero     *
 *  since 2020. Compared to LSAG / MLSAG, CLSAG signatures are ~25-30%  *
 *  smaller and verify ~2× faster, while preserving the same security  *
 *  guarantees:                                                         *
 *                                                                      *
 *      anonymity        — verifier cannot tell which ring member       *
 *                          signed (out of n);                          *
 *      unforgeability   — only someone who knows BOTH the spend key x  *
 *                          AND the amount-blinding-difference z can    *
 *                          produce a valid signature;                  *
 *      linkability      — two signatures by the same ring member       *
 *                          produce the same key image I, so verifiers  *
 *                          can detect double-spends without learning   *
 *                          the signer.                                 *
 *                                                                      *
 *  WHAT IT SIGNS                                                       *
 *  ─────────────                                                       *
 *  The ring is a list of (P_i, C_i) pairs, where P_i is a stealth      *
 *  output pubkey and C_i is its Pedersen amount commitment.            *
 *  C_pseudo is a public "pseudo-output" commitment to the same hidden  *
 *  value v_π as C_π but with a fresh blinding factor.                  *
 *                                                                      *
 *  The signer at index π provides:                                     *
 *     x  : the one-time spend key (P_π = x·G)                          *
 *     z  : the blinding difference (C_π − C_pseudo = z·G)              *
 *                                                                      *
 *  In a real transaction, the ∑ C_pseudo (across all inputs) cancels   *
 *  with ∑ C_out + fee·H, proving the amounts balance — without any    *
 *  amount being revealed.                                              *
 * ================================================================== */

import {
  G,
  L,
  hashToPoint,
  randomScalar,
  Point,
  scalarToBytes,
  bytesToScalar,
  type CurvePoint,
} from "./primitives";
import { DOMAIN, Writer, Reader, dhash64 } from "./codec";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

export interface ClsagRing {
  /** spend pubkeys */
  P: CurvePoint[];
  /** matching amount commitments */
  C: CurvePoint[];
}

export interface ClsagSignature {
  /** ring entry challenge */
  c0: bigint;
  /** response scalars, one per ring member */
  s: bigint[];
  /** key image I = x · H_p(P_π) — used for double-spend detection */
  I: CurvePoint;
  /** auxiliary key image D = z · H_p(P_π) — public, but NOT used for linking */
  D: CurvePoint;
}

/* ------------------------------------------------------------------ */
/*  INTERNAL HELPERS                                                   */
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

function hashToScalar(domain: keyof typeof DOMAIN, ...parts: Uint8Array[]): bigint {
  const wide = dhash64(DOMAIN[domain], ...parts);
  return mod(bytesToBigIntLE(wide), L);
}

/** Encode a ring (P_i, C_i, C_pseudo, I, D) into a deterministic byte string
 *  that's used as the basis for both aggregation hashes and the per-step
 *  challenge hash. */
function encodeRing(
  ring: ClsagRing,
  cPseudo: CurvePoint,
  I: CurvePoint,
  D: CurvePoint
): Uint8Array {
  const w = new Writer();
  w.varint(ring.P.length);
  for (let i = 0; i < ring.P.length; i++) {
    w.point(ring.P[i]).point(ring.C[i]);
  }
  w.point(cPseudo).point(I).point(D);
  return w.bytes();
}

/* ================================================================== */
/*  SIGN                                                                */
/* ================================================================== */

export function clsagSign(
  msg: Uint8Array,
  ring: ClsagRing,
  cPseudo: CurvePoint,
  signerIdx: number,
  spendPriv: bigint, // x
  blindingDiff: bigint // z = r_input − r_pseudo
): ClsagSignature {
  const n = ring.P.length;
  if (n < 1) throw new Error("CLSAG: ring must have ≥ 1 member");
  if (ring.C.length !== n) throw new Error("CLSAG: |P| ≠ |C|");
  if (signerIdx < 0 || signerIdx >= n) throw new Error("CLSAG: signerIdx out of range");

  // Sanity-check the witnesses.
  if (!G.multiply(spendPriv).equals(ring.P[signerIdx])) {
    throw new Error("CLSAG: spendPriv does not match ring.P[signerIdx]");
  }
  const expectedDelta = ring.C[signerIdx].subtract(cPseudo);
  if (!G.multiply(blindingDiff).equals(expectedDelta)) {
    throw new Error("CLSAG: blindingDiff does not match C_π − C_pseudo");
  }

  // Hash-to-point of the signer's spend key — used in both key images.
  const HP_self = hashToPoint(ring.P[signerIdx].toBytes());

  // Two key images.
  const I = HP_self.multiply(spendPriv); // linkable
  const D = HP_self.multiply(blindingDiff); // auxiliary (published)

  // Aggregation hashes bind everything together.
  const ringEnc = encodeRing(ring, cPseudo, I, D);
  const muP = hashToScalar("CLSAG_AGG_P", ringEnc, msg);
  const muC = hashToScalar("CLSAG_AGG_C", ringEnc, msg);

  // Aggregate signing key.
  const w_signer = mod(muP * spendPriv + muC * blindingDiff, L);

  // Random nonce α (the "dummy signing scalar" for the signer's commitment).
  const alpha = randomScalar();

  const c: bigint[] = new Array(n).fill(0n);
  const s: bigint[] = new Array(n).fill(0n);

  // Signer commitment.
  let Lcur = G.multiply(alpha); //  α·G
  let Rcur = HP_self.multiply(alpha); //  α·H_p(P_π)

  // Walk the ring forward starting at (signerIdx + 1).
  let i = (signerIdx + 1) % n;
  c[i] = hashToScalar(
    "CLSAG_RING",
    ringEnc,
    msg,
    Lcur.toBytes(),
    Rcur.toBytes()
  );

  while (i !== signerIdx) {
    s[i] = randomScalar();

    const Pi = ring[`P`][i];
    const Ci = ring[`C`][i];
    const HPi = hashToPoint(Pi.toBytes());

    // Aggregated public key for index i.
    const Wi = Pi.multiply(muP).add(Ci.subtract(cPseudo).multiply(muC));
    // Aggregated key image.
    const Ki = I.multiply(muP).add(D.multiply(muC));

    Lcur = G.multiply(s[i]).add(Wi.multiply(c[i]));
    Rcur = HPi.multiply(s[i]).add(Ki.multiply(c[i]));

    const next = (i + 1) % n;
    c[next] = hashToScalar(
      "CLSAG_RING",
      ringEnc,
      msg,
      Lcur.toBytes(),
      Rcur.toBytes()
    );
    i = next;
  }

  // Close the ring at the signer's index.
  s[signerIdx] = mod(alpha - c[signerIdx] * w_signer, L);

  return { c0: c[0], s, I, D };
}

/* ================================================================== */
/*  VERIFY                                                              */
/* ================================================================== */

export function clsagVerify(
  msg: Uint8Array,
  ring: ClsagRing,
  cPseudo: CurvePoint,
  sig: ClsagSignature
): boolean {
  try {
    const n = ring.P.length;
    if (ring.C.length !== n) return false;
    if (sig.s.length !== n) return false;

    const ringEnc = encodeRing(ring, cPseudo, sig.I, sig.D);
    const muP = hashToScalar("CLSAG_AGG_P", ringEnc, msg);
    const muC = hashToScalar("CLSAG_AGG_C", ringEnc, msg);

    let c = sig.c0;
    for (let i = 0; i < n; i++) {
      const Pi = ring.P[i];
      const Ci = ring.C[i];
      const HPi = hashToPoint(Pi.toBytes());

      const Wi = Pi.multiply(muP).add(Ci.subtract(cPseudo).multiply(muC));
      const Ki = sig.I.multiply(muP).add(sig.D.multiply(muC));

      const Li = G.multiply(sig.s[i]).add(Wi.multiply(c));
      const Ri = HPi.multiply(sig.s[i]).add(Ki.multiply(c));

      c = hashToScalar(
        "CLSAG_RING",
        ringEnc,
        msg,
        Li.toBytes(),
        Ri.toBytes()
      );
    }

    return c === sig.c0;
  } catch {
    return false;
  }
}

/** Two CLSAG signatures from the same input share the same key image I. */
export function clsagLinked(a: ClsagSignature, b: ClsagSignature): boolean {
  return a.I.equals(b.I);
}

/* ------------------------------------------------------------------ */
/*  ENCODING                                                           */
/* ------------------------------------------------------------------ */

export function encodeClsag(sig: ClsagSignature): Uint8Array {
  const w = new Writer();
  w.scalar(sig.c0);
  w.scalars(sig.s);
  w.point(sig.I);
  w.point(sig.D);
  return w.bytes();
}

export function decodeClsag(bytes: Uint8Array): ClsagSignature {
  const r = new Reader(bytes);
  const c0 = r.scalar();
  const s = r.scalars();
  const I = r.point();
  const D = r.point();
  return { c0, s, I, D };
}

/* unused-import suppression for linter (Point/L/scalar helpers are
   referenced through other modules, not here directly) */
void Point;
void scalarToBytes;
void bytesToScalar;
