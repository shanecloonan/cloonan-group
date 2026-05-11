/* ================================================================== *
 *  smoke-endowment-rewards — validate the sub-base-unit PPB accumulator*
 *  that powers endowment-proportional storage rewards.                 *
 *                                                                      *
 *  This is the test that proves the "no holes" property of the         *
 *  permanence incentive: a 100 GB upload's prover ALWAYS earns more   *
 *  per proof than a 1 KB upload's prover, even though both submit     *
 *  proofs at the same cadence. Without this, every prover would farm  *
 *  trivial commitments and ignore the heavy ones the network needs.   *
 *                                                                      *
 *  We test the accrueProofReward helper directly (deterministic math) *
 *  rather than the full chain (which is exercised separately by       *
 *  smoke-treasury / smoke-upload-tx / smoke-storage-spora).            *
 * ================================================================== */

import {
  accrueProofReward,
  requiredEndowment,
  payoutPerSlot,
  cumulativePayout,
  DEFAULT_ENDOWMENT_PARAMS,
  PPB,
  type EndowmentParams,
} from "../lib/network/endowment";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`, extra ?? "");
  }
}

console.log("\n== Smoke: endowment-proportional storage rewards ==\n");

const P = DEFAULT_ENDOWMENT_PARAMS;

/* ------------------------------------------------------------------ *
 *  1. SMALL COMMIT — accumulator builds in PPB across many proofs    *
 *                    before paying out 1 base unit.                  *
 * ------------------------------------------------------------------ */
console.log("• small commit: PPB accumulator carries fractional yield");
{
  const size = 64n * 1024n; // 64 KiB
  const repl = 3;
  const endow = requiredEndowment(size, repl);
  const perSlot = payoutPerSlot(endow, P.slotsPerYear);
  console.log(`    endowment=${endow}  payoutPerSlot=${perSlot} (rounded)`);

  // Per slot, contribution in PPB:
  // ppbPerSlot = endow · realYieldPpb / slotsPerYear
  const ppbPerSlot = (endow * P.realYieldPpb) / P.slotsPerYear;
  ok(`per-slot yield in PPB > 0 (got ${ppbPerSlot})`, ppbPerSlot > 0n);
  ok(
    `per-slot yield in base units rounds to 0 (got ${perSlot})`,
    perSlot === 0n,
    "expected because endowment is small"
  );

  let pendingPpb = 0n;
  let lastProvenSlot = 0n;
  let payoutTotal = 0n;
  // Drive proofs one slot at a time. At some point the PPB accumulator
  // crosses 1 base unit and pays out. Slow but deterministic.
  let slot = 0n;
  let proofCount = 0;
  const MAX = 100_000;
  while (payoutTotal === 0n && proofCount < MAX) {
    slot += 1n;
    const r = accrueProofReward({
      sizeBytes: size,
      replication: repl,
      pendingPpb,
      lastProvenSlot,
      currentSlot: slot,
      params: P,
    });
    pendingPpb = r.newPendingPpb;
    payoutTotal += r.payout;
    lastProvenSlot = slot;
    proofCount++;
  }
  ok(
    `tiny commit eventually pays out base units (after ${proofCount} per-slot proofs)`,
    payoutTotal > 0n,
    `payout=${payoutTotal} pendingPpb=${pendingPpb}`
  );
  // Expected ≈ PPB / ppbPerSlot (slots needed to accumulate 1 base unit).
  const expectedSlots = PPB / ppbPerSlot;
  ok(
    `slots-to-first-payout within expected range (${proofCount} ≈ ${expectedSlots})`,
    BigInt(proofCount) <= expectedSlots + 2n
  );
}

/* ------------------------------------------------------------------ *
 *  2. LARGE COMMIT — non-zero payout EVERY proof at standard cadence *
 * ------------------------------------------------------------------ */
console.log("\n• large commit: pays out base units every proof");
{
  const size = 100n * 1_000_000_000n; // 100 GB
  const repl = 3;
  const endow = requiredEndowment(size, repl);
  const perSlot = payoutPerSlot(endow, P.slotsPerYear);
  console.log(`    endowment=${endow} (~${endow / 100_000_000n} MFN) perSlot=${perSlot} base`);
  ok(`100 GB: payoutPerSlot > 0 (got ${perSlot})`, perSlot > 0n);

  // One slot has elapsed since the anchor. Should pay perSlot (≈) base units.
  const r1 = accrueProofReward({
    sizeBytes: size,
    replication: repl,
    pendingPpb: 0n,
    lastProvenSlot: 0n,
    currentSlot: 1n,
    params: P,
  });
  ok(
    `100 GB, 1-slot elapsed: payout > 0 (got ${r1.payout})`,
    r1.payout > 0n
  );

  // Sanity: payout ≈ perSlot (within 1 due to flooring)
  ok(
    `payout matches perSlot within 1 (got ${r1.payout} vs ${perSlot})`,
    r1.payout === perSlot || r1.payout === perSlot - 1n
  );

  // 10 slots elapsed → ≥ 10 × perSlot (accumulator preserves sub-base
  // fractions so it pays slightly MORE than naive `10 × floor(perSlot)`).
  const r10 = accrueProofReward({
    sizeBytes: size,
    replication: repl,
    pendingPpb: 0n,
    lastProvenSlot: 0n,
    currentSlot: 10n,
    params: P,
  });
  ok(
    `10-slot elapsed: payout ≥ 10 × naive-perSlot, ≤ 10 × (perSlot+1)`,
    r10.payout >= 10n * perSlot && r10.payout <= 10n * (perSlot + 1n),
    `got=${r10.payout} naive=${10n * perSlot}`
  );
}

/* ------------------------------------------------------------------ *
 *  3. ENDOWMENT-PROPORTIONALITY  — 100 GB pays much more per proof   *
 *                                  than 64 KB at the same cadence.  *
 * ------------------------------------------------------------------ */
console.log("\n• large commit out-earns small commit per proof");
{
  const smallSize = 64n * 1024n;
  const largeSize = 100n * 1_000_000_000n;
  const repl = 3;
  const CADENCE_SLOTS = 60n; // one proof per minute

  let smallPay = 0n;
  let smallPending = 0n;
  let smallLast = 0n;

  let largePay = 0n;
  let largePending = 0n;
  let largeLast = 0n;

  for (let i = 1n; i <= 100n; i++) {
    const slot = i * CADENCE_SLOTS;
    const rs = accrueProofReward({
      sizeBytes: smallSize,
      replication: repl,
      pendingPpb: smallPending,
      lastProvenSlot: smallLast,
      currentSlot: slot,
      params: P,
    });
    smallPay += rs.payout;
    smallPending = rs.newPendingPpb;
    smallLast = slot;

    const rl = accrueProofReward({
      sizeBytes: largeSize,
      replication: repl,
      pendingPpb: largePending,
      lastProvenSlot: largeLast,
      currentSlot: slot,
      params: P,
    });
    largePay += rl.payout;
    largePending = rl.newPendingPpb;
    largeLast = slot;
  }
  console.log(`    after 100 proofs @ 60-slot cadence:`);
  console.log(`      64 KB total payout    = ${smallPay} base`);
  console.log(`      100 GB total payout   = ${largePay} base`);
  ok(`large commit out-earns small commit`, largePay > smallPay);
  // Realistic ratio: large endowment / small endowment ≈ size ratio.
  const sizeRatio = largeSize / smallSize;
  console.log(`      size ratio (large / small) = ${sizeRatio}`);
}

/* ------------------------------------------------------------------ *
 *  4. ANTI-HOARDING CAP — elapsed > window credits only window slots*
 * ------------------------------------------------------------------ */
console.log("\n• anti-hoarding cap caps credited slots at the window");
{
  const size = 100n * 1_000_000_000n;
  const repl = 3;
  const cap = P.proofRewardWindowSlots; // 7200 slots
  // Proof 7200 slots after last → fully credited (cap exactly).
  const rAt = accrueProofReward({
    sizeBytes: size,
    replication: repl,
    pendingPpb: 0n,
    lastProvenSlot: 0n,
    currentSlot: cap,
    params: P,
  });
  ok(`elapsed = cap: creditedSlots = cap (got ${rAt.creditedSlots})`, rAt.creditedSlots === cap);

  // Proof 100 × cap slots after last → STILL credited only `cap` slots.
  const rOver = accrueProofReward({
    sizeBytes: size,
    replication: repl,
    pendingPpb: 0n,
    lastProvenSlot: 0n,
    currentSlot: cap * 100n,
    params: P,
  });
  ok(
    `elapsed = 100 × cap: creditedSlots = cap (got ${rOver.creditedSlots})`,
    rOver.creditedSlots === cap
  );
  ok(
    `100 × elapsed: payout same as cap-elapsed (no hoarding bonus)`,
    rOver.payout === rAt.payout,
    `got=${rOver.payout} cap=${rAt.payout}`
  );
}

/* ------------------------------------------------------------------ *
 *  5. ZERO-SLOT EDGE CASE — proof at the same slot earns 0           *
 * ------------------------------------------------------------------ */
console.log("\n• zero-elapsed-slot proof earns 0 (no spamming for free)");
{
  const r = accrueProofReward({
    sizeBytes: 1n * 1024n * 1024n,
    replication: 3,
    pendingPpb: 0n,
    lastProvenSlot: 100n,
    currentSlot: 100n,
    params: P,
  });
  ok(`payout = 0 when elapsed = 0`, r.payout === 0n);
  ok(`pendingPpb unchanged (0 → 0)`, r.newPendingPpb === 0n);
  ok(`creditedSlots = 0`, r.creditedSlots === 0n);
}

/* ------------------------------------------------------------------ *
 *  6. ECONOMIC INVARIANT — over a year of continuous proving,        *
 *     total payout ≈ endowment × realYieldRate (within a few base   *
 *     units due to flooring/cap effects).                            *
 * ------------------------------------------------------------------ */
console.log("\n• one-year-of-proofs total ≈ endowment × yield");
{
  const size = 1n * 1_000_000_000_000n; // 1 TB so per-slot yield is non-trivial
  const repl = 3;
  const endow = requiredEndowment(size, repl);
  const expectedAnnual = (endow * P.realYieldPpb) / PPB;
  // Prove every WINDOW slots for an entire year. (Window ≈ 1 day → ~365 proofs.)
  const cadence = P.proofRewardWindowSlots;
  let total = 0n;
  let pending = 0n;
  let last = 0n;
  const proofs = P.slotsPerYear / cadence;
  for (let i = 1n; i <= proofs; i++) {
    const slot = i * cadence;
    const r = accrueProofReward({
      sizeBytes: size,
      replication: repl,
      pendingPpb: pending,
      lastProvenSlot: last,
      currentSlot: slot,
      params: P,
    });
    total += r.payout;
    pending = r.newPendingPpb;
    last = slot;
  }
  const remainderBaseUnits = pending / PPB;
  total += remainderBaseUnits;
  console.log(`    endowment            = ${endow}`);
  console.log(`    expected annual yield = ${expectedAnnual}`);
  console.log(`    accrued (sum payouts) = ${total}`);
  // Should match within 1% (flooring losses across many proofs).
  const tolerance = expectedAnnual / 100n;
  const diff = total > expectedAnnual ? total - expectedAnnual : expectedAnnual - total;
  ok(
    `accrued ≈ expected annual yield (diff = ${diff}, tolerance = ${tolerance})`,
    diff <= tolerance
  );
}

/* ------------------------------------------------------------------ *
 *  7. PARAMETER VALIDATION — bad params throw at validate time       *
 * ------------------------------------------------------------------ */
console.log("\n• params validation");
{
  let threwSlots = false;
  try {
    accrueProofReward({
      sizeBytes: 1024n,
      replication: 3,
      pendingPpb: 0n,
      lastProvenSlot: 0n,
      currentSlot: 1n,
      params: { ...P, slotsPerYear: 0n } as EndowmentParams,
    });
  } catch {
    threwSlots = true;
  }
  ok(`rejects slotsPerYear = 0`, threwSlots);

  let threwWindow = false;
  try {
    accrueProofReward({
      sizeBytes: 1024n,
      replication: 3,
      pendingPpb: 0n,
      lastProvenSlot: 0n,
      currentSlot: 1n,
      params: { ...P, proofRewardWindowSlots: 0n } as EndowmentParams,
    });
  } catch {
    threwWindow = true;
  }
  ok(`rejects proofRewardWindowSlots = 0`, threwWindow);

  let threwNeg = false;
  try {
    accrueProofReward({
      sizeBytes: 1024n,
      replication: 3,
      pendingPpb: -1n,
      lastProvenSlot: 0n,
      currentSlot: 1n,
      params: P,
    });
  } catch {
    threwNeg = true;
  }
  ok(`rejects negative pendingPpb`, threwNeg);
}

/* ------------------------------------------------------------------ *
 *  8. CROSS-CHECK with cumulativePayout helper                        *
 * ------------------------------------------------------------------ */
console.log("\n• cross-check with cumulativePayout helper");
{
  const size = 1n * 1_000_000_000n;
  const repl = 3;
  const endow = requiredEndowment(size, repl);
  const elapsed = 5000n; // < window cap
  const r = accrueProofReward({
    sizeBytes: size,
    replication: repl,
    pendingPpb: 0n,
    lastProvenSlot: 0n,
    currentSlot: elapsed,
    params: P,
  });
  const cumExpect = cumulativePayout(endow, elapsed, P.slotsPerYear, P);
  // accrueProofReward.payout = floor(elapsed · endow · yield / slotsPerYear / PPB)
  // cumulativePayout       = floor(elapsed · endow · yield / (PPB · slotsPerYear))
  // Same closed-form expression; should match exactly when within-window.
  ok(
    `accrual payout = cumulativePayout(elapsed, endow) (got ${r.payout} vs ${cumExpect})`,
    r.payout === cumExpect
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("FAIL");
  process.exit(1);
}
console.log("ALL CHECKS PASSED.");
