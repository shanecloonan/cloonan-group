/* ================================================================== *
 *  MoneyFund Network — Transaction                                     *
 *                                                                      *
 *  THE COMPOSITE PRIMITIVE                                             *
 *  ───────────────────────                                             *
 *  A MoneyFund transaction binds together every privacy guarantee:     *
 *                                                                      *
 *    inputs         each input references a previous output by its    *
 *                   stealth address P, hides the spender among a      *
 *                   ring of decoys, and proves authorization with a   *
 *                   CLSAG signature. The signature's key image I is   *
 *                   the on-chain identity of the input — same I       *
 *                   spent twice == double-spend == reject.            *
 *                                                                      *
 *    outputs        each output is a fresh stealth address P_out      *
 *                   plus a hidden amount commitment C_out. Optionally *
 *                   carries a storage commitment for the permanence   *
 *                   layer.                                             *
 *                                                                      *
 *    range proofs   for every output amount, proving v ∈ [0, 2^N).    *
 *                                                                      *
 *    balance proof  Σ pseudo_in − Σ C_out − fee·H == 0·G              *
 *                   (no value created, no value destroyed) — implicit *
 *                   in the choice of pseudo-output blinding factors.  *
 *                                                                      *
 *  CONSENSUS-CRITICAL ENCODING                                         *
 *  ──────────────────────────                                          *
 *  We hash a domain-tagged byte form of the tx to derive its id and    *
 *  to serve as the message that CLSAG signs. Any change to the        *
 *  encoding here is a hard fork.                                       *
 * ================================================================== */

import {
  G,
  H,
  L,
  Point,
  randomScalar,
  indexedStealthAddress,
  encryptOutputAmount,
  ENC_AMOUNT_BYTES,
  type CurvePoint,
} from "./primitives";
import {
  clsagSign,
  clsagVerify,
  encodeClsag,
  type ClsagRing,
  type ClsagSignature,
} from "./clsag";
import {
  bpProve,
  bpVerify,
  encodeBulletproof,
  type BulletproofRange,
} from "./bulletproofs";
import {
  storageCommitmentHash,
  type StorageCommitment,
} from "./storage";
import {
  DOMAIN,
  Writer,
  dhash,
} from "./codec";

/* ------------------------------------------------------------------ */
/*  WIRE TYPES                                                         */
/* ------------------------------------------------------------------ */

export interface TxInputWire {
  /** Ring of (P, C) pairs — anonymity set. */
  ring: ClsagRing;
  /** Pseudo-output commitment with the same hidden value as the real input. */
  cPseudo: CurvePoint;
  /** CLSAG signature authorizing the spend. */
  sig: ClsagSignature;
}

/** Default range-proof width: amounts are 64-bit unsigned. */
export const TX_RANGE_BITS = 64;

export interface TxOutputWire {
  /** Stealth one-time address P. */
  oneTimeAddr: CurvePoint;
  /** Pedersen commitment to the hidden output amount. */
  amount: CurvePoint;
  /** Bulletproof range proof for the amount commitment.
   *  proof.V === amount (must be enforced at verify time). */
  rangeProof: BulletproofRange;
  /** RingCT-style encrypted (value, blinding) blob.                       *
   *  Length is exactly ENC_AMOUNT_BYTES (40). For outputs whose target    *
   *  was a pre-built oneTimeAddr (decoys, tests), the sender does not     *
   *  have a recipient viewPub to encrypt under, so these bytes are        *
   *  zero — recipients of legacy outputs cannot open the commitment.     */
  encAmount: Uint8Array;
  /** Optional permanence binding — non-null if this output stores data. */
  storage: StorageCommitment | null;
}

export interface TransactionWire {
  /** Codec version. */
  version: number;
  /** Transaction-level public key R = r·G (used by recipients to scan). */
  R: CurvePoint;
  /** Inputs being spent. */
  inputs: TxInputWire[];
  /** Outputs being created. */
  outputs: TxOutputWire[];
  /** Hidden fee — published in the clear because miners need to claim it.
   *  In a more advanced version this can also be hidden behind a Pedersen
   *  commitment, but for v0.1 the fee is public. */
  fee: bigint;
  /** Optional small payload (memo, hint to the recipient, etc.). Bound by
   *  consensus encoding so it can't be manipulated post-signing. */
  extra: Uint8Array;
}

/* ------------------------------------------------------------------ */
/*  ENCODING                                                           */
/* ------------------------------------------------------------------ */

/** Encode the consensus-critical part of the tx (everything that signs
 *  on top of). This is what CLSAG signs over and what we hash for txid. */
export function txPreimage(tx: TransactionWire): Uint8Array {
  const w = new Writer();
  w.varint(tx.version);
  w.point(tx.R);
  w.u64(tx.fee);
  w.blob(tx.extra);

  // Inputs (only ring + pseudo — signatures are NOT in the preimage).
  w.varint(tx.inputs.length);
  for (const inp of tx.inputs) {
    w.points(inp.ring.P);
    w.points(inp.ring.C);
    w.point(inp.cPseudo);
  }

  // Outputs (everything is part of the preimage, including range proofs
  // and storage commitments — these are committed-to before signing).
  w.varint(tx.outputs.length);
  for (const out of tx.outputs) {
    w.point(out.oneTimeAddr);
    w.point(out.amount);
    w.blob(encodeBulletproof(out.rangeProof));
    w.push(out.encAmount);
    if (out.storage) {
      w.u8(1);
      w.push(storageCommitmentHash(out.storage));
    } else {
      w.u8(0);
    }
  }

  return dhash(DOMAIN.TX_PREIMAGE, w.bytes());
}

/** Full transaction id — hash of the entire wire-format object including
 *  signatures. This is what blocks merkleize. */
export function txId(tx: TransactionWire): Uint8Array {
  const w = new Writer();
  w.push(txPreimage(tx));

  // Append the signatures so two different proofs of the same preimage
  // hash to different ids. (Defense against malleability.)
  w.varint(tx.inputs.length);
  for (const inp of tx.inputs) {
    w.blob(encodeClsag(inp.sig));
  }

  return dhash(DOMAIN.TX_ID, w.bytes());
}

/* ------------------------------------------------------------------ */
/*  BUILDER  (signer side)                                             */
/* ------------------------------------------------------------------ */

export interface InputSpec {
  /** The ring of (P_i, C_i) — must include the real input at signerIdx. */
  ring: ClsagRing;
  signerIdx: number;
  /** Spend key: x with P_signer = x·G. */
  spendPriv: bigint;
  /** Hidden value v of the real input. */
  value: bigint;
  /** Original blinding factor of the real input's commitment C_signer. */
  blinding: bigint;
}

/** Output specification. Provide EXACTLY ONE of `recipient` or         *
 *  `oneTimeAddr`:                                                       *
 *                                                                       *
 *   - `recipient`  (preferred):  pass the recipient's stealth pubkeys.  *
 *                  signTransaction derives the on-chain stealth address *
 *                  (P_i) from the tx-level pubkey R, so the recipient   *
 *                  can scan the chain and detect the output. This is    *
 *                  what an actual wallet should always use.             *
 *                                                                       *
 *   - `oneTimeAddr` (legacy):    pass a pre-computed stealth address.   *
 *                  Useful for tests / decoy outputs / synthetic ring    *
 *                  members. The recipient (if any) will NOT be able to  *
 *                  detect the output by scanning, because the tx-level  *
 *                  R is independent of how `oneTimeAddr` was derived.   *
 */
export type OutputSpec =
  | {
      recipient: { viewPub: CurvePoint; spendPub: CurvePoint };
      value: bigint;
      storage?: StorageCommitment;
    }
  | {
      oneTimeAddr: CurvePoint;
      value: bigint;
      storage?: StorageCommitment;
    };

export interface SignedTransaction {
  tx: TransactionWire;
  /** Per-output blinding factors — these are private to the recipient.
   *  Sender hands them off via the encrypted transaction extra (out of
   *  scope here) so the recipient can later open the commitments. */
  outputBlindings: bigint[];
}

/** Build, sign, and seal a transaction. Performs the full RingCT-style
 *  ceremony: pseudo-blindings → output blindings → range proofs → CLSAGs. */
export function signTransaction(
  inputs: InputSpec[],
  outputs: OutputSpec[],
  fee: bigint,
  extra: Uint8Array = new Uint8Array(0)
): SignedTransaction {
  if (inputs.length === 0) throw new Error("tx: at least one input required");
  if (outputs.length === 0) throw new Error("tx: at least one output required");
  if (fee < 0n) throw new Error("tx: negative fee");

  /* ---- Balance check (clear-text, sender side) ---- */
  let inSum = 0n;
  for (const i of inputs) inSum += i.value;
  let outSum = 0n;
  for (const o of outputs) outSum += o.value;
  if (inSum !== outSum + fee) {
    throw new Error(
      `tx: amounts do not balance (Σin=${inSum}, Σout=${outSum}, fee=${fee})`
    );
  }

  /* ---- Pick a tx-level keypair so recipients can scan ---- */
  const txPriv = randomScalar();
  const R = G.multiply(txPriv);

  /* ---- Resolve each output's stealth address. If the caller passed a
   *      `recipient`, derive P_i from txPriv + recipient + i (Monero
   *      style); otherwise use the literal `oneTimeAddr` they provided. */
  const oneTimeAddrs: CurvePoint[] = new Array(outputs.length);
  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    if ("recipient" in o) {
      oneTimeAddrs[i] = indexedStealthAddress(txPriv, o.recipient, i);
    } else {
      oneTimeAddrs[i] = o.oneTimeAddr;
    }
  }

  /* ---- Pick output blinding factors freely; range-prove each ---- */
  const outputBlindings: bigint[] = new Array(outputs.length);
  const outputCommits: CurvePoint[] = new Array(outputs.length);
  const rangeProofs: BulletproofRange[] = new Array(outputs.length);
  let outBlindingSum = 0n;

  for (let i = 0; i < outputs.length; i++) {
    const r_out = randomScalar();
    outputBlindings[i] = r_out;
    outBlindingSum = (outBlindingSum + r_out) % L;

    const { V, proof } = bpProve(outputs[i].value, r_out, TX_RANGE_BITS);
    outputCommits[i] = V;
    rangeProofs[i] = proof;
  }

  /* ---- Pseudo-output blindings: free for inputs[0..n-2], constrained
         for inputs[n-1] so that Σ pseudo_in = Σ out_blinding. ----     */
  const n = inputs.length;
  const pseudoBlindings: bigint[] = new Array(n);
  let acc = 0n;
  for (let i = 0; i < n - 1; i++) {
    pseudoBlindings[i] = randomScalar();
    acc = (acc + pseudoBlindings[i]) % L;
  }
  // Last pseudo_blinding closes the balance. Note: amounts cancel because
  // value is stored on H and the per-input values sum to outputs+fee in v;
  // the fee is published as v·H is added on the verifier side.
  let last = (outBlindingSum - acc) % L;
  if (last < 0n) last += L;
  pseudoBlindings[n - 1] = last;

  /* ---- Build pseudo-output commitments C_pseudo[i]. We commit to the
         input value v_i (so the linkage to real C_in[signerIdx]
         is z = r_in − r_pseudo). Sum check (deferred to verifier):
            Σ C_pseudo  −  Σ C_out  −  fee · H   ==   0 · G         ---- */
  const pseudoCommits: CurvePoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    pseudoCommits[i] = G.multiply(pseudoBlindings[i]).add(
      H.multiply(inputs[i].value)
    );
  }

  /* ---- Encrypt (value, blinding) for each output where we know the
   *      recipient's viewPub. Pre-built oneTimeAddrs get zeros (no
   *      recipient to encrypt under). */
  const encAmounts: Uint8Array[] = new Array(outputs.length);
  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    if ("recipient" in o) {
      encAmounts[i] = encryptOutputAmount(
        txPriv,
        o.recipient.viewPub,
        i,
        outputs[i].value,
        outputBlindings[i]
      );
    } else {
      encAmounts[i] = new Uint8Array(ENC_AMOUNT_BYTES);
    }
  }

  /* ---- Assemble preliminary tx (to compute the signing message) ---- */
  const outputsWire: TxOutputWire[] = outputs.map((o, i) => ({
    oneTimeAddr: oneTimeAddrs[i],
    amount: outputCommits[i],
    rangeProof: rangeProofs[i],
    encAmount: encAmounts[i],
    storage: o.storage ?? null,
  }));

  /* ---- Sign each input with CLSAG over (preimage) ---- */
  const inputsWireUnsigned: { ring: ClsagRing; cPseudo: CurvePoint }[] =
    inputs.map((inp, i) => ({
      ring: inp.ring,
      cPseudo: pseudoCommits[i],
    }));

  // Build a preimage stub WITHOUT signatures (signatures depend on it).
  const stub: TransactionWire = {
    version: 1,
    R,
    inputs: inputsWireUnsigned.map((u) => ({
      ring: u.ring,
      cPseudo: u.cPseudo,
      // placeholder: actual sig assigned below
      sig: { c0: 0n, s: [], I: Point.ZERO, D: Point.ZERO },
    })),
    outputs: outputsWire,
    fee,
    extra,
  };
  const msg = txPreimage(stub);

  /* ---- Now actually sign each input ---- */
  const signedInputs: TxInputWire[] = inputs.map((inp, i) => {
    const blindingDiff = (inp.blinding - pseudoBlindings[i]) % L;
    const z = blindingDiff < 0n ? blindingDiff + L : blindingDiff;
    const sig = clsagSign(
      msg,
      inp.ring,
      pseudoCommits[i],
      inp.signerIdx,
      inp.spendPriv,
      z
    );
    return { ring: inp.ring, cPseudo: pseudoCommits[i], sig };
  });

  return {
    tx: {
      version: 1,
      R,
      inputs: signedInputs,
      outputs: outputsWire,
      fee,
      extra,
    },
    outputBlindings,
  };
}

/* ------------------------------------------------------------------ */
/*  VERIFY                                                             */
/* ------------------------------------------------------------------ */

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  /** Set of key images that this tx spends. The mempool / block        *
   *  validator uses these to detect double-spends globally.            */
  keyImages: CurvePoint[];
  txId: Uint8Array;
}

export function verifyTransaction(tx: TransactionWire): VerifyResult {
  const errors: string[] = [];

  /* ---- Structural ---- */
  if (tx.inputs.length === 0) errors.push("no inputs");
  if (tx.outputs.length === 0) errors.push("no outputs");
  if (tx.fee < 0n) errors.push("negative fee");

  /* ---- Range proofs on every output ----
   *  We bind the proof's V to the output's amount commitment. A malicious
   *  prover that supplies a different V cannot produce a valid range proof
   *  whose verifier-derived equation matches the on-chain amount.        */
  for (let i = 0; i < tx.outputs.length; i++) {
    const out = tx.outputs[i];
    if (!out.amount.equals(out.rangeProof.V)) {
      errors.push(`output ${i}: range-proof V does not match output amount`);
      continue;
    }
    if (out.rangeProof.N !== TX_RANGE_BITS) {
      errors.push(
        `output ${i}: range-proof bit-width ${out.rangeProof.N} ≠ canonical ${TX_RANGE_BITS}`
      );
      continue;
    }
    if (!bpVerify(out.rangeProof)) {
      errors.push(`output ${i}: range proof invalid`);
    }
  }

  /* ---- Balance:  Σ C_pseudo  −  Σ C_out  −  fee·H  ==  0          ----
         If this holds, the only way it can be true is if the prover    *
         knew blinding factors that make it sum to zero, which is what  *
         a correct sender produces. (Discrete log of 0·G is the only    *
         way to "open" the difference, so the prover can't have hidden  *
         value mismatch.)                                                */
  let balance = Point.ZERO;
  for (const inp of tx.inputs) balance = balance.add(inp.cPseudo);
  for (const out of tx.outputs) balance = balance.subtract(out.amount);
  balance = balance.subtract(H.multiply(tx.fee));

  if (!balance.equals(Point.ZERO)) {
    errors.push("balance proof failed (Σ pseudo ≠ Σ out + fee·H)");
  }

  /* ---- CLSAG verifications + collect key images ---- */
  const seenKi: string[] = [];
  const keyImages: CurvePoint[] = [];

  // Reconstruct the message from a stub without signatures.
  const stub: TransactionWire = {
    ...tx,
    inputs: tx.inputs.map((u) => ({
      ring: u.ring,
      cPseudo: u.cPseudo,
      sig: { c0: 0n, s: [], I: Point.ZERO, D: Point.ZERO },
    })),
  };
  const msg = txPreimage(stub);

  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const ok = clsagVerify(msg, inp.ring, inp.cPseudo, inp.sig);
    if (!ok) errors.push(`input ${i}: CLSAG signature invalid`);

    // Within-tx double-spend prevention: same key image twice is an instant
    // reject, regardless of mempool / chain state.
    const kiHex = inp.sig.I.toHex();
    if (seenKi.includes(kiHex)) {
      errors.push(`input ${i}: key image repeated within tx`);
    } else {
      seenKi.push(kiHex);
      keyImages.push(inp.sig.I);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    keyImages,
    txId: txId(tx),
  };
}
