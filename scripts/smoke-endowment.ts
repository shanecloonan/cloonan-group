/* ================================================================== *
 *  Smoke: endowment math                                               *
 *                                                                      *
 *  Verifies the protocol's storage-cost formula matches the whitepaper *
 *  and is robust to the obvious adversarial inputs.                    *
 *                                                                      *
 *  Closed-form sanity:                                                 *
 *    For C₀ = 100 base/byte-year, sizeBytes = 1, replication = 3,      *
 *    i = 2%, r = 4%, we should get:                                    *
 *      E₀ = 100·3·(1+0.02)/(0.04 − 0.02)                              *
 *         = 300 · 1.02 / 0.02 = 15,300 base units                      *
 *                                                                      *
 *  Plus: invariants that the protocol enforces no matter what.         *
 * ================================================================== */

import {
  DEFAULT_ENDOWMENT_PARAMS,
  PPB,
  requiredEndowment,
  payoutPerSlot,
  cumulativePayout,
  maxBytesForEndowment,
  validateEndowmentParams,
  ceilDiv,
  type EndowmentParams,
} from "../lib/network/endowment";
import { MFN_BASE } from "../lib/network/emission";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("\n== Smoke: endowment math ==\n");

const P = DEFAULT_ENDOWMENT_PARAMS;

/* 1. Closed-form sanity at minimum replication.                        *
 *   With defaults (costPerByteYearPpb=200_000, i=2%, r=4%, repl=3):    *
 *     E₀ = 200_000 · 1 · 3 · (1e9 + 2e7) / (1e9 · 2e7)                 *
 *        = 200_000 · 3 · 1.02e9 / 2e16                                 *
 *        = 6.12e14 / 2e16                                              *
 *        = 0.0306                                                       *
 *   Ceil → 1 base unit (the minimum non-zero charge per byte).         */
const e1 = requiredEndowment(1n, P.minReplication);
const expected1 = ceilDiv(
  P.costPerByteYearPpb * 1n * 3n * (PPB + P.inflationPpb),
  PPB * (P.realYieldPpb - P.inflationPpb)
);
ok(
  `requiredEndowment(1 byte, repl=3) = closed form (got ${e1})`,
  e1 === expected1
);

/* 2. Linear scaling in size (use sizes large enough that ceiling      *
 *    rounding is negligible).                                          */
const e1Mb = requiredEndowment(1_000_000n, 3);
const e2Mb = requiredEndowment(2_000_000n, 3);
ok(
  "endowment(2 MB) = 2 · endowment(1 MB) (linear in size)",
  e2Mb === e1Mb * 2n,
  `1MB:${e1Mb} 2MB:${e2Mb}`
);

/* 3. Linear scaling in replication. */
const eRepl3 = requiredEndowment(1_000_000n, 3);
const eRepl6 = requiredEndowment(1_000_000n, 6);
ok(
  "endowment scales linearly with replication",
  eRepl6 === eRepl3 * 2n,
  `r=3:${eRepl3} r=6:${eRepl6}`
);

/* 4. Zero-byte upload escrows nothing. */
ok("requiredEndowment(0 bytes, any repl) = 0", requiredEndowment(0n, 3) === 0n);

/* 5. Replication out of bounds rejects. */
function shouldThrow(fn: () => unknown, why: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(`rejects: ${why}`, threw);
}
shouldThrow(() => requiredEndowment(100n, 1), "replication < minReplication (1 < 3)");
shouldThrow(() => requiredEndowment(100n, 99), "replication > maxReplication (99 > 32)");
shouldThrow(() => requiredEndowment(-1n, 3), "negative size");
shouldThrow(
  () => validateEndowmentParams({ ...P, realYieldPpb: P.inflationPpb }),
  "r == i (geometric series diverges)"
);
shouldThrow(
  () => validateEndowmentParams({ ...P, realYieldPpb: 10_000_000n, inflationPpb: 20_000_000n }),
  "r < i (model breaks, denominator negative)"
);

/* 6. Ceiling-division correctness: never under-funds.                  *
 *   Construct numerator/denominator that don't divide evenly and ensure*
 *   the result is rounded UP.                                          */
{
  const odd = ceilDiv(7n, 3n);
  ok("ceilDiv(7, 3) = 3 (rounds up from 2.33)", odd === 3n);
  ok("ceilDiv(6, 3) = 2 (clean divide)", ceilDiv(6n, 3n) === 2n);
  ok("ceilDiv(0, 3) = 0", ceilDiv(0n, 3n) === 0n);
}

/* 7. Yield-per-slot math.                                              *
 *   At i=2%, r=4%, the treasury earns 4%/year on its balance. For an   *
 *   endowment of 1,000,000 MFN base units with 5,256,000 slots/year:   *
 *      perSlot = 1,000,000 · 40,000,000 / (10^9 · 5,256,000)           *
 *              = floor(40,000,000,000,000 / 5,256,000,000,000,000)     *
 *              = floor(0.00761) = 0                                    *
 *  Hmm — this is dust per slot. Scale up the endowment to see meaning. *
 */
const E = MFN_BASE * 1_000_000n; // 1,000,000 MFN
const slotsPerYear = 5_256_000n;
const perSlot = payoutPerSlot(E, slotsPerYear);
const annualEnd = perSlot * slotsPerYear;
const annualYieldExpected = (E * P.realYieldPpb) / PPB;
ok(
  "annual yield from per-slot accumulation matches closed form (within 1 slot)",
  annualEnd <= annualYieldExpected &&
    annualYieldExpected - annualEnd <= slotsPerYear,
  `slot=${perSlot} yearAccum=${annualEnd} closed=${annualYieldExpected}`
);

/* 8. Cumulative payout scales linearly in slots (within rounding noise).
 *    The function now floors at the END of one big multiplication rather
 *    than per-slot, so c(N·k) ≥ N·c(k) up to a small fractional residue
 *    (bounded by ~N base units when the per-slot rate is fractional).
 *    Monotonicity and approximate linearity is what matters here. */
const c10 = cumulativePayout(E, 10n, slotsPerYear);
const c1000 = cumulativePayout(E, 1000n, slotsPerYear);
ok(
  "cumulativePayout monotone in slots (1000 ≥ 10)",
  c1000 >= c10 * 100n,
  `c10=${c10} c1000=${c1000}`
);
const linDiff = c1000 - c10 * 100n;
ok(
  "cumulativePayout(1000) - 100·cumulativePayout(10) is small (≤ 100 base units)",
  linDiff <= 100n,
  `diff=${linDiff}`
);

/* 9. Inverse function: maxBytesForEndowment is the inverse of           *
 *   requiredEndowment up to ceiling/floor rounding noise. Test with a   *
 *   large value so the relative error is negligible.                    */
{
  const size = 5_000_000_000n; // 5 GB
  const e = requiredEndowment(size, 3);
  const sizeBack = maxBytesForEndowment(e, 3);
  const diff = size > sizeBack ? size - sizeBack : sizeBack - size;
  ok(
    "maxBytesForEndowment is approximately inverse (within 1 KB of 5 GB)",
    diff <= 1000n,
    `forward=${e}, sizeIn=${size}, sizeBack=${sizeBack}, diff=${diff}`
  );
}

/* 10. Parameter validation accepts defaults. */
{
  let passed = false;
  try { validateEndowmentParams(P); passed = true; } catch {}
  ok("validate accepts default params", passed);
}

/* 11. Adversarial: same-yield-and-inflation should reject.            */
shouldThrow(
  () => requiredEndowment(1000n, 3, { ...P, realYieldPpb: P.inflationPpb }),
  "requiredEndowment with r=i should throw at validation"
);

/* 12. Realistic example narrative.                                    *
 *   Storing 1 GB permanently at 3x replication should cost roughly   *
 *   tens of millions of base units (fractions of an MFN). Print so   *
 *   we can sanity-check the calibration.                             */
const oneGb = 1_000_000_000n;
const endowGb = requiredEndowment(oneGb, 3);
const endowTb = requiredEndowment(oneGb * 1000n, 3);

console.log("\n  • Storage prices at default params (r=4%, i=2%, repl=3):");
console.log(
  `      1 byte     → ${e1.toString()} base units` +
    ` (${(Number(e1) / Number(MFN_BASE)).toExponential(2)} MFN)`
);
console.log(
  `      1 GB       → ${endowGb.toLocaleString()} base units` +
    ` (${(Number(endowGb) / Number(MFN_BASE)).toLocaleString()} MFN)`
);
console.log(
  `      1 TB       → ${endowTb.toLocaleString()} base units` +
    ` (${(Number(endowTb) / Number(MFN_BASE)).toLocaleString()} MFN)`
);
const slotForTb = payoutPerSlot(endowTb, slotsPerYear);
console.log(
  `      1 TB yield → ${slotForTb} base units / slot ` +
    `(≈ ${(Number(slotForTb) * Number(slotsPerYear) / Number(MFN_BASE)).toFixed(2)} MFN / year)`
);

console.log("\nALL CHECKS PASSED.\n");

// Suppress unused-var warnings for the test scaffolding params.
void (P as EndowmentParams);
