/* ================================================================== *
 *  Smoke: coinbase primitive                                          *
 *                                                                      *
 *  Verifies the protocol-level coinbase tx:                            *
 *    • build → verify round-trip with a producer payout address       *
 *    • the producer's wallet can detect and decrypt the output         *
 *    • every node arrives at the same coinbase bytes from the same    *
 *      public inputs (deterministic build, no per-call randomness)    *
 *    • verifier rejects tampering on amount, R, oneTimeAddr            *
 *    • a wallet can later SPEND the coinbase output via the regular   *
 *      stealth-derived spend key (no special coinbase-spend path)     *
 * ================================================================== */

import {
  buildCoinbase,
  verifyCoinbase,
  isCoinbaseShaped,
  coinbaseTxPriv,
} from "../lib/network/coinbase";
import { encodeTransaction, decodeTransaction } from "../lib/network/wire";
import {
  stealthGen,
  indexedStealthDetect,
  indexedStealthSpendKey,
  decryptOutputAmount,
  G,
  H,
} from "../lib/network/primitives";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("\n== Smoke: coinbase ==\n");

const producer = stealthGen();
const payout = { viewPub: producer.viewPub, spendPub: producer.spendPub };
const HEIGHT = 42;
const REWARD = 1_234_567_890n; // arbitrary u64 amount

/* 1. Build + identify. */
const cb = buildCoinbase(HEIGHT, REWARD, payout);
ok("isCoinbaseShaped(cb)", isCoinbaseShaped(cb));
ok("inputs.length === 0", cb.inputs.length === 0);
ok("outputs.length === 1", cb.outputs.length === 1);
ok("fee === 0", cb.fee === 0n);

/* 2. Verify with correct args. */
{
  const r = verifyCoinbase(cb, HEIGHT, REWARD, payout);
  ok("verifyCoinbase accepts well-formed coinbase", r.ok, r.errors);
  ok("verifier returns the correct claimed amount", r.amount === REWARD);
}

/* 3. Determinism of the consensus-critical parts. Bulletproofs are by   *
 *    design randomized (zero-knowledge), so the encoded bytes differ    *
 *    across builds, but the OUTPUTS that the protocol commits to —     *
 *    R, oneTimeAddr, amount commitment — must be identical so any      *
 *    node can re-derive them from public inputs alone.                  */
{
  const cb2 = buildCoinbase(HEIGHT, REWARD, payout);
  ok("R is deterministic across builds", cb.R.equals(cb2.R));
  ok(
    "oneTimeAddr is deterministic across builds",
    cb.outputs[0].oneTimeAddr.equals(cb2.outputs[0].oneTimeAddr)
  );
  ok(
    "amount commitment is deterministic across builds",
    cb.outputs[0].amount.equals(cb2.outputs[0].amount)
  );
  // Both range proofs verify but their internal randomness differs.
  ok(
    "both independent range proofs verify against the same commitment",
    cb.outputs[0].amount.equals(cb.outputs[0].rangeProof.V) &&
      cb2.outputs[0].amount.equals(cb2.outputs[0].rangeProof.V)
  );
}

/* 4. Wire round-trip. */
{
  const bytes = encodeTransaction(cb);
  const back = decodeTransaction(bytes);
  ok("encodeTransaction → decodeTransaction round-trip", back.outputs.length === 1);
  const r = verifyCoinbase(back, HEIGHT, REWARD, payout);
  ok("decoded coinbase still verifies", r.ok, r.errors);
}

/* 5. Producer wallet detects ownership. */
{
  const out = cb.outputs[0];
  const mine = indexedStealthDetect(cb.R, out.oneTimeAddr, 0, {
    viewPriv: producer.viewPriv,
    spendPub: producer.spendPub,
  });
  ok("producer's wallet detects the coinbase output as theirs", mine);
}

/* 6. Producer can decrypt the amount + blinding. */
{
  const { value, blinding } = decryptOutputAmount(
    cb.R, 0, producer.viewPriv, cb.outputs[0].encAmount
  );
  ok("decrypted amount equals REWARD", value === REWARD);
  // commitment opens consistently
  const reCommit = G.multiply(blinding).add(H.multiply(value));
  ok(
    "decrypted (value, blinding) re-derive the on-chain commitment",
    reCommit.equals(cb.outputs[0].amount)
  );
}

/* 7. Producer derives the one-time spend key — proving spendability.   */
{
  const spendKey = indexedStealthSpendKey(cb.R, 0, {
    viewPriv: producer.viewPriv,
    spendPriv: producer.spendPriv,
  });
  const recomputed = G.multiply(spendKey);
  ok(
    "spend-key · G == oneTimeAddr (provable spendability)",
    recomputed.equals(cb.outputs[0].oneTimeAddr)
  );
}

/* 8. A different wallet cannot detect the output as theirs. */
{
  const other = stealthGen();
  const mine = indexedStealthDetect(cb.R, cb.outputs[0].oneTimeAddr, 0, {
    viewPriv: other.viewPriv,
    spendPub: other.spendPub,
  });
  ok("an unrelated wallet does NOT detect the coinbase as theirs", !mine);
}

/* 9. Tamper detection. */
{
  // 9a. Wrong amount.
  const r = verifyCoinbase(cb, HEIGHT, REWARD + 1n, payout);
  ok("rejects when expected amount disagrees with commitment", !r.ok);
}
{
  // 9b. Wrong payout (different spendPub).
  const evil = stealthGen();
  const r = verifyCoinbase(cb, HEIGHT, REWARD, {
    viewPub: producer.viewPub,
    spendPub: evil.spendPub,
  });
  ok("rejects when payoutAddress disagrees", !r.ok);
}
{
  // 9c. Wrong height.
  const r = verifyCoinbase(cb, HEIGHT + 1, REWARD, payout);
  ok("rejects when height disagrees (different deterministic R)", !r.ok);
}
{
  // 9d. Caller-supplied input list breaks coinbase shape.
  const tampered = { ...cb, fee: 1n };
  const r = verifyCoinbase(tampered, HEIGHT, REWARD, payout);
  ok("rejects coinbase with non-zero fee", !r.ok);
}

/* 10. The deterministic txPriv is non-zero and stable across calls. */
{
  const p1 = coinbaseTxPriv(HEIGHT, payout.spendPub);
  const p2 = coinbaseTxPriv(HEIGHT, payout.spendPub);
  ok("coinbaseTxPriv is deterministic", p1 === p2);
  ok("coinbaseTxPriv is non-zero", p1 !== 0n);
}

console.log("\nALL CHECKS PASSED.\n");
