/* ================================================================== *
 *  MoneyFund Network — Coinbase                                        *
 *                                                                      *
 *  WHAT THIS IS                                                       *
 *  ────────────                                                       *
 *  The "coinbase" is the synthetic transaction that mints fresh tokens *
 *  for every block: it has NO inputs (the value is created from thin   *
 *  air by protocol rule) and one output paying the block producer.    *
 *  Its amount is exactly                                               *
 *                                                                      *
 *       coinbase.amount  =  emissionAtHeight(height)  +  Σ fees       *
 *                                                                      *
 *  where the fees are summed over every other (real) tx in the block. *
 *  applyBlock verifies this equality; any deviation rejects the block. *
 *                                                                      *
 *  DETERMINISTIC EPHEMERAL KEYPAIR                                    *
 *  ───────────────────────────────                                    *
 *  Every stealth-addressed output needs a tx-level keypair (R, r) so   *
 *  the recipient can derive their one-time address. For regular txs    *
 *  this `r` is randomly chosen and stays secret to the sender. For a   *
 *  coinbase, the sender is the *protocol* — we have no one to keep it  *
 *  secret from. We therefore derive `r` deterministically from public  *
 *  inputs so any node replaying history can reconstruct the coinbase   *
 *  byte-for-byte:                                                      *
 *                                                                      *
 *      r = H_s( "MFBN-1/coinbase-tx-key" || height || spendPub )       *
 *      R = G · r                                                       *
 *                                                                      *
 *  This is safe because the coinbase's amount is already public (every *
 *  node can compute emission + Σ fees), so leaking `r` does not reveal *
 *  anything not already public. Later spends of the coinbase output    *
 *  by the validator still go through normal CLSAG-with-decoys and      *
 *  inherit full RingCT privacy.                                        *
 *                                                                      *
 *  WHY THIS DESIGN                                                    *
 *  ───────────────                                                    *
 *  By making the coinbase an ordinary TransactionWire (with empty      *
 *  `inputs` as the only special-case marker), we get four free          *
 *  benefits:                                                            *
 *    1. The wallet's stealth scanner already detects it — no new code. *
 *    2. The UTXO insertion path is the same as any other output.       *
 *    3. The block's txRoot binds it cryptographically with no extra   *
 *       commitment scheme.                                              *
 *    4. Future txs spending the coinbase output flow through the      *
 *       existing CLSAG ring logic with no special path.                *
 *  Only applyBlock needs new logic, isolated in verifyCoinbase below. *
 * ================================================================== */

import {
  G,
  H,
  L,
  hashToScalar,
  indexedStealthAddress,
  encryptOutputAmount,
  type CurvePoint,
} from "./primitives";
import { DOMAIN, Writer, bytesToHex } from "./codec";
import { bpProve, bpVerify } from "./bulletproofs";
import {
  TX_RANGE_BITS,
  type TransactionWire,
  type TxOutputWire,
} from "./transaction";

/** Stealth address used by the protocol to pay the producer.            *
 *  Same shape as the wallet's main address; we copy it instead of      *
 *  re-exporting the wallet's type so this module stays self-contained. */
export interface PayoutAddress {
  viewPub: CurvePoint;
  spendPub: CurvePoint;
}

/* ------------------------------------------------------------------ */
/*  DETERMINISTIC EPHEMERAL KEY                                        */
/* ------------------------------------------------------------------ */

function heightLE(height: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  // BigInt-safe write: javascript Number is 53-bit, plenty for chain heights.
  dv.setUint32(0, Math.floor(height / 2 ** 32), false);
  dv.setUint32(4, height >>> 0, false);
  return b;
}

/** Compute the deterministic tx-priv scalar for a coinbase at `height`  *
 *  paying `producerSpendPub`. Public on purpose; r isn't a secret for   *
 *  coinbase, only a structural seed.                                    */
export function coinbaseTxPriv(
  height: number,
  producerSpendPub: CurvePoint
): bigint {
  const w = new Writer();
  w.push(new TextEncoder().encode(DOMAIN.COINBASE_TX_KEY));
  w.push(heightLE(height));
  w.point(producerSpendPub);
  // hashToScalar reduces sha512 mod L; the chance of a 0 scalar is 2^-256.
  const s = hashToScalar(w.bytes());
  if (s === 0n) {
    // Pathologically unlucky; just rotate by one. Deterministic per height.
    return 1n;
  }
  return s;
}

/** Compute the deterministic output blinding factor for a coinbase.     *
 *  Derived the same way the regular RingCT scheme uses the encrypted    *
 *  amount blob — but we publish the blinding so the consensus protocol  *
 *  can re-derive the commitment when validating.                         */
function coinbaseBlinding(R: CurvePoint, payout: PayoutAddress): bigint {
  // We don't use H_s(shared_secret) here because shared_secret is also
  // publicly derivable (txPriv is public). The blinding only needs to
  // be uniformly random-looking so that the resulting Pedersen
  // commitment hides nothing — but the AMOUNT is also public, so this
  // is fine.
  const w = new Writer();
  w.push(new TextEncoder().encode(DOMAIN.COINBASE_BLIND));
  w.point(R);
  w.point(payout.viewPub);
  w.point(payout.spendPub);
  const s = hashToScalar(w.bytes());
  return s === 0n ? 1n : s;
}

/* ------------------------------------------------------------------ */
/*  BUILD                                                              */
/* ------------------------------------------------------------------ */

/** Construct the coinbase TransactionWire that pays `amount` units to   *
 *  the producer's stealth payout address. Anyone can build this — the   *
 *  function is deterministic — but in practice the block producer      *
 *  is the one calling it during proposal.                                *
 *                                                                        *
 *  Throws on invalid amount (must fit u64) or replication missing.       */
export function buildCoinbase(
  height: number,
  amount: bigint,
  payout: PayoutAddress
): TransactionWire {
  if (height < 1) throw new Error("coinbase: height must be >= 1");
  if (amount < 0n || amount >= 1n << 64n) {
    throw new Error("coinbase: amount out of u64 range");
  }
  const txPriv = coinbaseTxPriv(height, payout.spendPub);
  const R = G.multiply(txPriv);
  // outputIndex = 0 by convention; only one output.
  const oneTimeAddr = indexedStealthAddress(txPriv, payout, 0);
  const blinding = coinbaseBlinding(R, payout);
  const amountCommit = G.multiply(blinding).add(H.multiply(amount));
  const { proof } = bpProve(amount, blinding, TX_RANGE_BITS);
  const encAmount = encryptOutputAmount(txPriv, payout.viewPub, 0, amount, blinding);
  const output: TxOutputWire = {
    oneTimeAddr,
    amount: amountCommit,
    rangeProof: proof,
    encAmount,
    storage: null,
  };
  return {
    version: 1,
    inputs: [],
    outputs: [output],
    fee: 0n,
    extra: new Uint8Array(0),
    R,
  };
}

/* ------------------------------------------------------------------ */
/*  VERIFY                                                             */
/* ------------------------------------------------------------------ */

export interface CoinbaseVerifyResult {
  ok: boolean;
  errors: string[];
  /** Public amount this coinbase claims to mint (or 0n if malformed). */
  amount: bigint;
}

/** Verify a TransactionWire conforms to coinbase rules for a given      *
 *  height, expected amount, and producer payout address. Does NOT check *
 *  the amount against the protocol's expected emission + fees — that's *
 *  applyBlock's job. This function checks STRUCTURAL correctness.       */
export function verifyCoinbase(
  tx: TransactionWire,
  height: number,
  expectedAmount: bigint,
  payout: PayoutAddress
): CoinbaseVerifyResult {
  const errors: string[] = [];

  if (tx.version !== 1) errors.push(`bad version ${tx.version}`);
  if (tx.inputs.length !== 0) errors.push(`coinbase has ${tx.inputs.length} inputs (must be 0)`);
  if (tx.outputs.length !== 1) errors.push(`coinbase has ${tx.outputs.length} outputs (must be 1)`);
  if (tx.fee !== 0n) errors.push(`coinbase fee must be 0, got ${tx.fee}`);

  if (errors.length > 0) return { ok: false, errors, amount: 0n };

  const out = tx.outputs[0];

  // R must be deterministic.
  const txPriv = coinbaseTxPriv(height, payout.spendPub);
  const expectedR = G.multiply(txPriv);
  if (!expectedR.equals(tx.R)) {
    errors.push("R does not match deterministic coinbase derivation");
  }

  // OneTimeAddress must match payout.
  const expectedOneTime = indexedStealthAddress(txPriv, payout, 0);
  if (!expectedOneTime.equals(out.oneTimeAddr)) {
    errors.push("oneTimeAddr does not match payout-derived stealth address");
  }

  // Amount commitment must open to (expectedAmount, deterministic blinding).
  const blinding = coinbaseBlinding(tx.R, payout);
  const expectedCommit = G.multiply(blinding).add(H.multiply(expectedAmount));
  if (!expectedCommit.equals(out.amount)) {
    errors.push("amount commitment does not match (expectedAmount, blinding)");
  }

  // Range proof must verify and bind to the right commitment.
  if (!out.amount.equals(out.rangeProof.V)) {
    errors.push("range-proof V does not match coinbase amount commitment");
  } else if (out.rangeProof.N !== TX_RANGE_BITS) {
    errors.push(`range-proof bit-width ${out.rangeProof.N} ≠ ${TX_RANGE_BITS}`);
  } else if (!bpVerify(out.rangeProof)) {
    errors.push("range proof invalid");
  }

  // Storage commitment cannot ride a coinbase (no fee-paying input flow).
  if (out.storage !== null) errors.push("coinbase output cannot anchor storage");

  return {
    ok: errors.length === 0,
    errors,
    amount: expectedAmount,
  };
}

/* ------------------------------------------------------------------ */
/*  IDENTIFICATION                                                     */
/* ------------------------------------------------------------------ */

/** Heuristic to detect "this TransactionWire looks like a coinbase" —   *
 *  used by applyBlock to route the first tx of a block to verifyCoinbase *
 *  instead of verifyTransaction. The unique structural signature is     *
 *  `inputs.length === 0`, which verifyTransaction explicitly rejects.   */
export function isCoinbaseShaped(tx: TransactionWire): boolean {
  return tx.inputs.length === 0;
}

/* ------------------------------------------------------------------ */
/*  DEBUG                                                              */
/* ------------------------------------------------------------------ */

/** Pretty-print for tests and node logs. Public info only. */
export function describeCoinbase(tx: TransactionWire, height: number): string {
  if (!isCoinbaseShaped(tx) || tx.outputs.length !== 1) {
    return "(not a coinbase)";
  }
  return (
    `coinbase{height=${height}, oneTimeAddr=${bytesToHex(tx.outputs[0].oneTimeAddr.toBytes()).slice(0, 16)}…}`
  );
}

void L;
