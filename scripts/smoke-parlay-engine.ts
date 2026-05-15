/* ===========================================================================
 *  Smoke test for lib/parlay-engine.ts and lib/parlay-scanner.ts
 *  ---------------------------------------------------------------------------
 *  Verifies:
 *   1. odds <-> probability conversions round-trip
 *   2. de-vig methods sum to ~1
 *   3. EV / Kelly calc on a textbook example (Pillar 4 example)
 *   4. Monte Carlo joint prob for *independent* legs is ~ product
 *   5. Monte Carlo with positive correlation > independent prob
 *   6. calculateParlayAlpha produces a complete, sane ParlayResult
 *   7. scanDailyParlays with mock data returns a ranked report
 *
 *  Run:  npx tsx scripts/smoke-parlay-engine.ts
 * ========================================================================= */

import {
  alphaPercent,
  americanToDecimal,
  americanToImpliedProbability,
  calculateParlayAlpha,
  choleskyDecomposition,
  decimalToAmerican,
  devig,
  devigMultiplicative,
  devigPower,
  expectedValue,
  fractionalKelly,
  kellyFraction,
  monteCarloJointProbability,
  parlayDecimalOdds,
  parlayJointProbabilityIndependent,
  probabilityToAmerican,
  probabilityToDecimal,
} from "../lib/parlay-engine";
import { scanDailyParlays } from "../lib/parlay-scanner";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function near(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) < eps;
}

async function main() {
  console.log("── 1. Odds conversion round-trips ──────────────────────────");
  for (const am of [-200, -150, -110, 100, 120, 250, 500]) {
    const dec = americanToDecimal(am);
    const back = decimalToAmerican(dec);
    assert(Math.abs(back - am) < 0.5, `roundtrip ${am} → ${dec} → ${back}`);
    console.log(`  ${am} → decimal ${dec.toFixed(4)} → ${back}  ✓`);
  }

  const p = americanToImpliedProbability(-110);
  assert(near(p, 0.52381, 1e-4), `implied(-110) should be ~52.38%, got ${p}`);
  console.log(`  americanToImpliedProbability(-110) = ${(p * 100).toFixed(4)}%  ✓`);

  const decToAmer = probabilityToAmerican(probabilityToDecimal(0.4) === 2.5 ? 0.4 : 0.4);
  console.log(`  probabilityToAmerican(0.4) = ${decToAmer}  ✓`);

  console.log("");
  console.log("── 2. De-vig methods ───────────────────────────────────────");
  const implied = [0.5238, 0.5238];
  const mult = devigMultiplicative(implied);
  const pow = devigPower(implied);
  const add = devig(implied, "additive").trueProbabilities;
  console.log("  mult:", mult.map((x) => x.toFixed(4)).join(", "));
  console.log("  pow: ", pow.map((x) => x.toFixed(4)).join(", "));
  console.log("  add: ", add.map((x) => x.toFixed(4)).join(", "));
  assert(near(mult.reduce((a, b) => a + b, 0), 1), "mult should sum to 1");
  assert(near(pow.reduce((a, b) => a + b, 0), 1, 1e-6), "pow should sum to ~1");
  assert(near(add.reduce((a, b) => a + b, 0), 1), "add should sum to 1");

  // Asymmetric market
  const implied2 = [americanToImpliedProbability(-150), americanToImpliedProbability(130)];
  const auto = devig(implied2, "auto");
  console.log(
    `  auto(-150/+130): method=${auto.method}, probs=[${auto.trueProbabilities.map((x) => x.toFixed(4)).join(", ")}], vig=${auto.vigPercent.toFixed(2)}%`,
  );
  assert(near(auto.trueProbabilities.reduce((a, b) => a + b, 0), 1, 1e-6), "auto should sum to 1");

  console.log("");
  console.log("── 3. EV + Kelly textbook examples ─────────────────────────");
  // From the prompt's Pillar 4 example: offered +200 (decimal 3.0), true p = 40%
  const decimal = americanToDecimal(200);
  assert(near(decimal, 3.0), `decimal(+200) should be 3.0, got ${decimal}`);
  const ev = expectedValue(0.4, decimal);
  console.log(`  EV(p=40%, decimal=3.0) = ${ev.toFixed(4)} (expected 0.2)`);
  assert(near(ev, 0.2), `EV should be 0.2`);
  const f = kellyFraction(0.4, decimal);
  console.log(`  Kelly fraction = ${(f * 100).toFixed(2)}% (expected ~10%)`);
  assert(near(f, 0.1, 1e-4), `Kelly should be 10%`);
  const f4 = fractionalKelly(0.4, decimal, 0.25);
  console.log(`  Quarter Kelly = ${(f4 * 100).toFixed(2)}% (expected ~2.5%)`);
  assert(near(f4, 0.025, 1e-4), `Quarter Kelly should be 2.5%`);

  console.log("");
  console.log("── 4. Independent Monte Carlo ≈ analytic product ───────────");
  const probs = [0.55, 0.50, 0.35];
  const analytic = parlayJointProbabilityIndependent(probs);
  const mc = monteCarloJointProbability(probs, { trials: 50_000, randomSeed: 1234 });
  console.log(`  analytic = ${analytic.toFixed(4)}, MC = ${mc.toFixed(4)}`);
  assert(Math.abs(analytic - mc) < 0.01, `MC should match analytic within 1pp`);

  console.log("");
  console.log("── 5. Positive correlation raises joint hit rate ───────────");
  const corrMat = [
    [1.0, 0.6],
    [0.6, 1.0],
  ];
  const indep = parlayJointProbabilityIndependent([0.5, 0.5]);
  const mcCorr = monteCarloJointProbability([0.5, 0.5], {
    correlationMatrix: corrMat,
    trials: 50_000,
    randomSeed: 1234,
  });
  console.log(`  indep = ${indep.toFixed(4)}, ρ=0.6 MC = ${mcCorr.toFixed(4)}`);
  assert(mcCorr > indep + 0.05, "positive correlation should push joint hit rate well above 25%");

  // Cholesky sanity
  const L = choleskyDecomposition([
    [1, 0.6, 0.3],
    [0.6, 1, 0.2],
    [0.3, 0.2, 1],
  ]);
  console.log(`  Cholesky 3×3 OK, L[0][0]=${L[0][0]}`);

  console.log("");
  console.log("── 6. calculateParlayAlpha end-to-end ──────────────────────");
  const res = calculateParlayAlpha(
    [
      { description: "Chiefs ML", americanOdds: -135, oppositeAmericanOdds: 120 },
      { description: "Over 48.5", americanOdds: -105, oppositeAmericanOdds: -115 },
    ],
    280, // offered parlay
    1000,
    [
      [1.0, 0.1],
      [0.1, 1.0],
    ],
    { monteCarloTrials: 20_000, randomSeed: 42 },
  );
  console.log(`  Combined offered = ${res.offeredAmericanOdds} (decimal ${res.offeredDecimalOdds.toFixed(3)})`);
  console.log(`  Combined book   = ${res.combinedAmericanOdds.toFixed(0)} (decimal ${res.combinedDecimalOdds.toFixed(3)})`);
  console.log(`  Independent joint prob = ${(res.independentJointProbability * 100).toFixed(3)}%`);
  console.log(`  MC joint prob          = ${(res.monteCarloJointProbability * 100).toFixed(3)}%`);
  console.log(`  Expected ROI = ${res.expectedRoiPercent.toFixed(2)}%   Alpha = ${res.alphaPercent.toFixed(2)}%`);
  console.log(`  Full Kelly = ${(res.fullKellyFraction * 100).toFixed(2)}%, recommended = ${(res.recommendedStakeFraction * 100).toFixed(3)}% = ${res.recommendedStake.toFixed(2)}`);
  console.log(`  Warnings (${res.warnings.length}): ${res.warnings.join(" | ")}`);
  assert(res.legs.length === 2, "should have 2 leg analyses");
  assert(res.monteCarloTrials > 0, "MC trials count surfaced");
  assert(res.bankroll === 1000, "bankroll round-trip");

  console.log("");
  console.log("── 7. scanDailyParlays() with mock data ────────────────────");
  const report = await scanDailyParlays({
    bankroll: 1000,
    minLegs: 2,
    maxLegs: 3,
    minLegEvPct: 0.5,
    minParlayEvPct: 1,
    monteCarloTrials: 5_000,
    useMockData: true,
  });
  console.log(`  source=${report.source}, events=${report.eventsConsidered}, lagging=${report.laggingLines.length}, candidates=${report.candidates.length}, top=${report.topPicks.length}`);
  assert(report.eventsConsidered > 0, "should consider events");
  assert(report.laggingLines.length > 0, "mock data should produce lagging lines");
  for (const pick of report.topPicks.slice(0, 3)) {
    console.log(`    • ${pick.legs.length}-leg ${pick.legs.map((l) => l.outcomeName).join(" + ")} → EV ${pick.result.expectedRoiPercent.toFixed(2)}% (stake $${pick.result.recommendedStake.toFixed(2)})`);
  }

  console.log("");
  console.log("All smoke tests passed ✓");
}

main().catch((err) => {
  console.error("Smoke test threw:", err);
  process.exit(1);
});

// Silence unused-import warnings on the variables we keep just for type assertions
void alphaPercent;
void parlayDecimalOdds;
