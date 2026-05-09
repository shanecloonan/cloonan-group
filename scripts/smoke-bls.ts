/* BLS smoke test. */
import {
  blsKeygen,
  blsSign,
  blsVerify,
  blsAggregateSignatures,
  blsAggregatePublicKeys,
  blsVerifyAggregateSameMessage,
  blsVerifyAggregateBatch,
  encodeSignature,
  decodeSignature,
  encodePublicKey,
  decodePublicKey,
  aggregateCommitteeVotes,
  verifyCommitteeAggregate,
  bitmapIndices,
} from "../lib/network/bls";

function ok(label: string, cond: boolean): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`);
    process.exit(1);
  }
}

console.log("• single-sig round trip");
{
  const kp = blsKeygen();
  const msg = new TextEncoder().encode("hello bls");
  const sig = blsSign(msg, kp.sk);
  ok("verify ok", blsVerify(sig, msg, kp.pk));
  ok("rejects wrong msg", !blsVerify(sig, new TextEncoder().encode("bye"), kp.pk));

  const enc = encodeSignature(sig);
  ok("sig is 96 bytes", enc.length === 96);
  ok("decoded sig still verifies", blsVerify(decodeSignature(enc), msg, kp.pk));

  const pkEnc = encodePublicKey(kp.pk);
  ok("pk is 48 bytes", pkEnc.length === 48);
  ok("decoded pk verifies", blsVerify(sig, msg, decodePublicKey(pkEnc)));
}

console.log("• same-message aggregation");
{
  const N = 8;
  const kps = Array.from({ length: N }, () => blsKeygen());
  const msg = new TextEncoder().encode("block#42");
  const sigs = kps.map((kp) => blsSign(msg, kp.sk));
  const agg = blsAggregateSignatures(sigs);
  ok("aggregate verifies", blsVerifyAggregateSameMessage(agg, msg, kps.map((k) => k.pk)));

  // Tamper: replace one sig with another from a different msg
  const bad = blsSign(new TextEncoder().encode("evil"), kps[0].sk);
  const tamperedAgg = blsAggregateSignatures([bad, ...sigs.slice(1)]);
  ok("rejects tampered aggregate", !blsVerifyAggregateSameMessage(tamperedAgg, msg, kps.map((k) => k.pk)));

  // Aggregate pk also valid alone
  const aggPk = blsAggregatePublicKeys(kps.map((k) => k.pk));
  ok("aggPk + agg sig verifies", blsVerify(agg, msg, aggPk));
}

console.log("• different-message aggregation");
{
  const N = 5;
  const kps = Array.from({ length: N }, () => blsKeygen());
  const msgs = Array.from({ length: N }, (_, i) => new TextEncoder().encode(`vote-${i}`));
  const sigs = kps.map((kp, i) => blsSign(msgs[i], kp.sk));
  const agg = blsAggregateSignatures(sigs);
  ok("batch verify", blsVerifyAggregateBatch(agg, msgs, kps.map((k) => k.pk)));
}

console.log("• committee voting");
{
  const totalValidators = 16;
  const validators = Array.from({ length: totalValidators }, () => blsKeygen());
  const validatorPks = validators.map((v) => v.pk);
  const msg = new TextEncoder().encode("block-header-hash");
  // 12 of 16 voted (3/4 quorum)
  const voterIdxs = [0, 1, 3, 4, 5, 7, 8, 9, 10, 12, 13, 15];
  const votes = voterIdxs.map((i) => ({
    index: i,
    sig: blsSign(msg, validators[i].sk),
  }));
  const agg = aggregateCommitteeVotes(msg, votes, totalValidators);
  ok("aggregate verifies", verifyCommitteeAggregate(agg, validatorPks));

  const reconstructed = bitmapIndices(agg.bitmap, totalValidators);
  ok(
    "bitmap recovers the same voters",
    reconstructed.length === voterIdxs.length &&
      reconstructed.every((idx, i) => idx === voterIdxs[i])
  );

  // Tamper the bitmap (claim a non-voter voted) → must reject
  const cheated = { ...agg, bitmap: new Uint8Array(agg.bitmap) };
  cheated.bitmap[0] |= 0b00000100; // claim validator 2 voted (they didn't)
  ok("rejects fraudulent bitmap", !verifyCommitteeAggregate(cheated, validatorPks));
}

console.log("\nBLS smoke checks passed.");
