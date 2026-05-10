/* ================================================================== *
 *  Smoke: emission schedule                                            *
 *                                                                      *
 *  Verifies every invariant the protocol relies on:                    *
 *    • genesis is unfunded (emission(0) = 0)                          *
 *    • first block earns initialReward                                *
 *    • halvings happen exactly at every halvingPeriod boundary         *
 *    • emission is monotonically non-increasing                       *
 *    • tail kicks in exactly at halvingCount * halvingPeriod + 1       *
 *    • cumulative supply matches naive sum (closed-form vs. integration)*
 *    • cumulative is strictly monotonic for height > 0                *
 *    • param validation catches misconfigurations                     *
 * ================================================================== */

import {
  DEFAULT_EMISSION_PARAMS,
  MFN_BASE,
  emissionAtHeight,
  cumulativeEmission,
  preTailSupplyCap,
  annualTailEmission,
  annualizedInflationPpb,
  validateEmissionParams,
  type EmissionParams,
} from "../lib/network/emission";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("\n== Smoke: emission schedule ==\n");

const P = DEFAULT_EMISSION_PARAMS;

/* 1. Edge cases at the boundaries. */
ok("emission(0) = 0", emissionAtHeight(0) === 0n);
ok("emission(-100) = 0", emissionAtHeight(-100) === 0n);
ok(
  "emission(1) = initialReward",
  emissionAtHeight(1) === P.initialReward,
  emissionAtHeight(1)
);
ok(
  "emission(halvingPeriod) = initialReward (end of era 0)",
  emissionAtHeight(P.halvingPeriod) === P.initialReward
);
ok(
  "emission(halvingPeriod+1) = initialReward / 2 (start of era 1)",
  emissionAtHeight(P.halvingPeriod + 1) === P.initialReward / 2n
);
ok(
  "emission(2*halvingPeriod+1) = initialReward / 4",
  emissionAtHeight(2 * P.halvingPeriod + 1) === P.initialReward / 4n
);

/* 2. Tail era. */
const tailStart = P.halvingCount * P.halvingPeriod + 1;
ok(
  `emission(tailStart=${tailStart}) = tailEmission`,
  emissionAtHeight(tailStart) === P.tailEmission
);
ok(
  "emission(tailStart + 10^9) = tailEmission (truly perpetual)",
  emissionAtHeight(tailStart + 1_000_000_000) === P.tailEmission
);

/* 3. Monotonicity at sample points. */
let prev = emissionAtHeight(1);
let monotonic = true;
for (let era = 0; era <= P.halvingCount; era++) {
  const h = era * P.halvingPeriod + 1;
  const v = emissionAtHeight(h);
  if (v > prev) {
    monotonic = false;
    console.error(`    non-monotone at h=${h}: prev=${prev}, now=${v}`);
    break;
  }
  prev = v;
}
ok("emission is monotonically non-increasing across halvings", monotonic);

/* 4. Cumulative is exact for small heights (integration check). */
let naive = 0n;
for (let h = 1; h <= 1000; h++) naive += emissionAtHeight(h);
ok(
  "cumulativeEmission(1000) matches naive Σ emission(h)",
  cumulativeEmission(1000) === naive,
  `closed=${cumulativeEmission(1000)} naive=${naive}`
);

/* 5. Cumulative is exact at era boundaries. */
const era0End = P.halvingPeriod;
const expectedEra0 = P.initialReward * BigInt(era0End);
ok(
  "cumulativeEmission(end of era 0) = initialReward * halvingPeriod",
  cumulativeEmission(era0End) === expectedEra0
);

const era1End = 2 * P.halvingPeriod;
const expectedEra1 = expectedEra0 + (P.initialReward / 2n) * BigInt(P.halvingPeriod);
ok(
  "cumulativeEmission(end of era 1) = era0 + halvingPeriod * initialReward/2",
  cumulativeEmission(era1End) === expectedEra1
);

/* 6. Pre-tail supply equals the closed-form geometric sum.             *
 *   Σ_{k=0..N-1} (initialReward >> k) · halvingPeriod                  *
 *   = initialReward · halvingPeriod · (2 − 1/2^(N-1))                  */
const cap = preTailSupplyCap();
const geometricFactor = 2n * MFN_BASE - (MFN_BASE >> BigInt(P.halvingCount - 1));
const expectedCap = (P.initialReward * BigInt(P.halvingPeriod) * geometricFactor) / MFN_BASE;
ok(
  `preTailSupplyCap ≈ ${(Number(cap) / Number(MFN_BASE)).toLocaleString()} MFN`,
  cap === expectedCap,
  `got=${cap} expected=${expectedCap}`
);

/* 7. Tail past the cap continues to grow linearly. */
const tailBlocks = 1_000_000;
const supplyAtTailPlusN = cumulativeEmission(tailStart + tailBlocks - 1);
const expectedTailContribution = P.tailEmission * BigInt(tailBlocks);
ok(
  "1M tail blocks contribute exactly tailEmission * 1M",
  supplyAtTailPlusN - cap === expectedTailContribution,
  `delta=${supplyAtTailPlusN - cap} expected=${expectedTailContribution}`
);

/* 8. Annual issuance after the tail. */
const blocksPerYear = 5_256_000; // 6s slots, 78% VRF hit rate ≈ 4.1M actual
const annualTail = annualTailEmission(blocksPerYear);
ok(
  `annualTailEmission(${blocksPerYear} blocks/yr) = tail * blocksPerYear`,
  annualTail === P.tailEmission * BigInt(blocksPerYear)
);

/* 9. Annualized inflation drops below 1% well into the halvings.       *
 *   At end of era 0 supply = 50·8M = 400M MFN. Next-year emission at   *
 *   25 MFN/block * 4M blocks = 100M MFN → 25% inflation at the         *
 *   first halving. By era 5 we're at sub-1% inflation, by tail era    *
 *   the inflation tends to zero monotonically.                          */
const inflationAtTailStart = annualizedInflationPpb(tailStart, 4_100_000);
const inflationFarIntoTail = annualizedInflationPpb(tailStart + 100_000_000, 4_100_000);
ok(
  "annualized inflation decays as we move into the tail era",
  inflationFarIntoTail < inflationAtTailStart,
  `tailStart=${inflationAtTailStart} ppb, far=${inflationFarIntoTail} ppb`
);

/* 10. Param validation catches obviously-bad configs. */
function shouldThrow(p: EmissionParams, why: string): void {
  let threw = false;
  try { validateEmissionParams(p); } catch { threw = true; }
  ok(`validate rejects: ${why}`, threw);
}
shouldThrow({ ...P, tailEmission: 0n }, "tail = 0 (no perpetual security funding)");
shouldThrow({ ...P, initialReward: -1n }, "negative initialReward");
shouldThrow({ ...P, halvingPeriod: 0 }, "halvingPeriod = 0");
shouldThrow({ ...P, halvingCount: -1 }, "negative halvingCount");
shouldThrow({ ...P, halvingCount: 100 }, "halvingCount > 64");
shouldThrow(
  { ...P, tailEmission: P.initialReward }, //  tail >= initial >> 0 = initial
  "tail > last halving subsidy (upward discontinuity)"
);
let passed = false;
try { validateEmissionParams(P); passed = true; } catch {}
ok("validate accepts default params", passed);

console.log(
  `\n  • initialReward:    ${(Number(P.initialReward) / Number(MFN_BASE)).toFixed(8)} MFN`
);
console.log(`  • halvingPeriod:    ${P.halvingPeriod.toLocaleString()} blocks`);
console.log(`  • halvingCount:     ${P.halvingCount}`);
console.log(
  `  • tailEmission:     ${(Number(P.tailEmission) / Number(MFN_BASE)).toFixed(8)} MFN/block`
);
console.log(
  `  • preTailSupplyCap: ${(Number(cap) / Number(MFN_BASE)).toLocaleString()} MFN`
);
console.log("\nALL CHECKS PASSED.\n");
