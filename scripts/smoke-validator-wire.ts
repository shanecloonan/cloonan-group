/* ================================================================== *
 *  Smoke: Validator wire round-trip with optional payoutAddress       *
 *                                                                      *
 *  Backward compatibility is the whole point of the encoding scheme:  *
 *  old records (no payoutAddress) and new records must coexist in the *
 *  same ValidatorSet and survive encode/decode round-trips.            *
 * ================================================================== */

import {
  encodeValidator,
  decodeValidator,
  encodeValidatorSet,
  decodeValidatorSet,
} from "../lib/network/wire";
import { type Validator } from "../lib/network/consensus";
import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen } from "../lib/network/bls";
import { stealthGen } from "../lib/network/primitives";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("\n== Smoke: Validator wire round-trip (payoutAddress) ==\n");

const vrf = vrfKeygen();
const bls = blsKeygen();
const stealth = stealthGen();

/* 1. Validator WITH payoutAddress. */
const vNew: Validator = {
  index: 7,
  vrfPk: vrf.pk,
  blsPk: bls.pk,
  stake: 12345n,
  payoutAddress: { viewPub: stealth.viewPub, spendPub: stealth.spendPub },
};
{
  const round = decodeValidator(encodeValidator(vNew));
  ok("vNew round-trip preserves index", round.index === vNew.index);
  ok("vNew round-trip preserves stake", round.stake === vNew.stake);
  ok(
    "vNew round-trip preserves viewPub",
    round.payoutAddress?.viewPub.equals(stealth.viewPub) === true
  );
  ok(
    "vNew round-trip preserves spendPub",
    round.payoutAddress?.spendPub.equals(stealth.spendPub) === true
  );
}

/* 2. Validator WITHOUT payoutAddress (legacy). */
const vOld: Validator = {
  index: 3,
  vrfPk: vrf.pk,
  blsPk: bls.pk,
  stake: 99999n,
};
{
  const round = decodeValidator(encodeValidator(vOld));
  ok("vOld round-trip preserves index", round.index === vOld.index);
  ok("vOld round-trip preserves stake", round.stake === vOld.stake);
  ok(
    "vOld round-trip has no payoutAddress",
    round.payoutAddress === undefined
  );
}

/* 3. Mixed ValidatorSet round-trip. */
{
  const set = [vNew, vOld];
  const bytes = encodeValidatorSet(set);
  const round = decodeValidatorSet(bytes);
  ok("ValidatorSet length preserved", round.length === 2);
  ok("set[0] has payoutAddress", round[0].payoutAddress !== undefined);
  ok("set[1] has no payoutAddress", round[1].payoutAddress === undefined);
}

/* 4. Determinism: same logical record → identical bytes.               */
{
  const a = encodeValidator(vNew);
  const b = encodeValidator(vNew);
  ok(
    "encodeValidator is deterministic",
    Buffer.from(a).equals(Buffer.from(b))
  );
}

/* 5. Trailing-byte tolerance: an old-format record (no trailer) should *
 *    decode cleanly. Simulate by truncating a new-format record at the *
 *    pre-trailer offset.                                                *
 *    Old format size = 4 (index u32) + 32 (vrfPk) + 48 (blsPk) + 8 (stake) = 92. */
{
  const newBytes = encodeValidator(vNew);
  const oldStyle = newBytes.slice(0, 92);
  const r = decodeValidator(oldStyle);
  ok("truncated-to-old-format decodes without payoutAddress", r.payoutAddress === undefined);
}

console.log("\nALL CHECKS PASSED.\n");
