/* ===========================================================================
 *  Live smoke test: hit The Odds API via the built-in key, run the scanner
 *  end-to-end, print top picks. Confirms the hardcoded key is healthy.
 *
 *  Run:  npx tsx scripts/smoke-parlay-live.ts
 * ========================================================================= */

import { scanDailyParlays } from "../lib/parlay-scanner";

async function main() {
  console.log("Running live scan against The Odds API (built-in key)…");
  const report = await scanDailyParlays({
    bankroll: 1000,
    minLegs: 2,
    maxLegs: 3,
    minLegEvPct: 0.5,
    minParlayEvPct: 1,
    monteCarloTrials: 5_000,
    maxResults: 8,
  });
  console.log(`\nsource: ${report.source}`);
  console.log(`events scanned: ${report.eventsConsidered}`);
  console.log(`lagging lines:  ${report.laggingLines.length}`);
  console.log(`candidates:     ${report.candidates.length}`);
  console.log(`top picks:      ${report.topPicks.length}`);
  if (report.warnings.length) {
    console.log("\nwarnings:");
    for (const w of report.warnings) console.log(`  • ${w}`);
  }
  console.log("\nTop 5 +EV singles:");
  for (const l of report.laggingLines.slice(0, 5)) {
    console.log(
      `  ${l.sport} · ${l.game} · ${l.outcomeName}${l.point !== undefined ? " " + l.point : ""} (${l.market.toUpperCase()}) ` +
        `@ ${l.bookTitle} ${l.bookAmericanOdds >= 0 ? "+" + l.bookAmericanOdds : l.bookAmericanOdds} ` +
        `→ EV ${l.expectedValuePct.toFixed(2)}%`,
    );
  }
  console.log("\nTop 5 parlays:");
  for (const c of report.topPicks.slice(0, 5)) {
    console.log(
      `  ${c.legs.length}-leg ${c.legs.map((l) => l.outcomeName).join(" + ")} → ` +
        `ROI ${c.result.expectedRoiPercent.toFixed(2)}% (stake $${c.result.recommendedStake.toFixed(2)})`,
    );
  }
}

main().catch((err) => {
  console.error("live scan failed:", err);
  process.exit(1);
});
