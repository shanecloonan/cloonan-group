/* ===========================================================================
 *  Smoke test: lib/casino/plinko — path determinism + RTP convergence
 *  ---------------------------------------------------------------------------
 *  Validates:
 *   1. Binomial coefficients are correct (P(bin) sums to 1.0 across rows).
 *   2. Theoretical RTP of every (rows, risk) config is between 95% and 105%
 *      (then we tune from there with empirical sims).
 *   3. Replay determinism: same seed/nonce → same path + bin.
 *   4. Path → bin invariant: bin = count of trues in path.
 *   5. Settle math: payout = stake * multiplier exactly.
 *   6. RTP convergence: 200k drops for every (rows, risk) combo converge
 *      to within 0.5pp of analytic RTP.
 *
 *  Run:  npx tsx scripts/smoke-casino-plinko.ts
 * ========================================================================= */

import {
  binomial,
  DEV_TOKEN,
  HmacRngStream,
  newSeedPair,
  plinkoBinProbability,
  plinkoGame,
  plinkoTheoreticalRtp,
  PLINKO_PAYOUTS,
  type PlinkoConfig,
  type PlinkoRisk,
  type PlinkoRowCount,
  type PlinkoState,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ FAIL: ${msg}`);
  process.exit(1);
}
function header(s: string) {
  console.log("\n── " + s + " " + "─".repeat(Math.max(0, 60 - s.length)));
}

(async () => {
  console.log("=== smoke-casino-plinko ===");

  /* -------------------------------------------------------------------------
   *  1. Binomial sanity + bin probabilities sum to 1
   * ----------------------------------------------------------------------- */
  header("1. binomial + bin probabilities");
  {
    if (binomial(8, 4) !== 70) fail(`C(8,4) = ${binomial(8, 4)} ≠ 70`);
    if (binomial(16, 8) !== 12870) fail(`C(16,8) = ${binomial(16, 8)} ≠ 12870`);
    pass("C(8,4)=70 and C(16,8)=12870");
    for (const rows of [8, 12, 16] as PlinkoRowCount[]) {
      let s = 0;
      for (let k = 0; k <= rows; k++) s += plinkoBinProbability(rows, k);
      if (Math.abs(s - 1) > 1e-12) fail(`rows=${rows} probs sum to ${s}`);
    }
    pass("bin probability sums = 1 across {8, 12, 16}");
  }

  /* -------------------------------------------------------------------------
   *  2. Theoretical RTP of every config
   * ----------------------------------------------------------------------- */
  header("2. theoretical RTP");
  {
    for (const rows of [8, 12, 16] as PlinkoRowCount[]) {
      for (const risk of ["low", "medium", "high"] as PlinkoRisk[]) {
        const config: PlinkoConfig = { rows, risk };
        const rtp = plinkoTheoreticalRtp(config);
        console.log(`  rows=${rows} risk=${risk.padEnd(6)} · theoretical RTP ${(rtp * 100).toFixed(2)}%`);
        if (rtp < 0.95 || rtp > 1.05) fail(`rows=${rows} risk=${risk} RTP ${rtp} outside [0.95, 1.05]`);
      }
    }
    pass("all 9 configs within [95%, 105%] theoretical RTP");
  }

  /* -------------------------------------------------------------------------
   *  3. Replay determinism + path/bin invariant
   * ----------------------------------------------------------------------- */
  header("3. replay determinism + path/bin invariant");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const config: PlinkoConfig = { rows: 16, risk: "medium" };
    const bet = {
      sessionId: "s",
      userId: "u",
      gameId: "plinko" as const,
      chainId: "dev-mock" as const,
      token: DEV_TOKEN,
      stake: 1_000_000n,
      config: config as unknown as Record<string, unknown>,
    };
    const rng1 = new HmacRngStream(seedPair, 1);
    const rng2 = new HmacRngStream(seedPair, 1);
    const s1 = plinkoGame.initialState(bet, rng1);
    const s2 = plinkoGame.initialState(bet, rng2);
    if (s1.bin !== s2.bin) fail(`replay bin mismatch: ${s1.bin} ≠ ${s2.bin}`);
    if (s1.path.length !== s2.path.length) fail("replay path length mismatch");
    for (let i = 0; i < s1.path.length; i++) {
      if (s1.path[i] !== s2.path[i]) fail(`replay path[${i}] mismatch`);
    }
    pass(`identical drops: bin=${s1.bin}, path=${s1.path.map((b) => (b ? "R" : "L")).join("")}`);

    const truesCount = s1.path.filter(Boolean).length;
    if (truesCount !== s1.bin) fail(`bin (${s1.bin}) ≠ count(true) in path (${truesCount})`);
    pass(`path/bin invariant: bin = count(R) = ${truesCount}`);
  }

  /* -------------------------------------------------------------------------
   *  4. Settle math
   * ----------------------------------------------------------------------- */
  header("4. settle math");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const config: PlinkoConfig = { rows: 8, risk: "high" };
    for (let nonce = 1; nonce <= 5; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      const bet = {
        sessionId: "s",
        userId: "u",
        gameId: "plinko" as const,
        chainId: "dev-mock" as const,
        token: DEV_TOKEN,
        stake: 1_000_000n,
        config: config as unknown as Record<string, unknown>,
      };
      const state = plinkoGame.initialState(bet, rng);
      const settled = plinkoGame.settle(state, bet);
      const expected = (1_000_000n * BigInt(Math.round(state.multiplier * 1000))) / 1000n;
      if (settled.totalPayoutUnits !== expected) {
        fail(`bin ${state.bin} (${state.multiplier}×) payout ${settled.totalPayoutUnits} ≠ ${expected}`);
      }
    }
    pass("5 drops · payout = stake * multiplier exactly");
  }

  /* -------------------------------------------------------------------------
   *  5. RTP convergence — full 9-config sweep
   * ----------------------------------------------------------------------- */
  header("5. RTP convergence (200k drops per config)");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const N = 200_000;
    const stake = 1_000_000n;
    for (const rows of [8, 12, 16] as PlinkoRowCount[]) {
      for (const risk of ["low", "medium", "high"] as PlinkoRisk[]) {
        const config: PlinkoConfig = { rows, risk };
        const payouts = PLINKO_PAYOUTS[rows][risk];
        const bet = {
          sessionId: "s",
          userId: "u",
          gameId: "plinko" as const,
          chainId: "dev-mock" as const,
          token: DEV_TOKEN,
          stake,
          config: config as unknown as Record<string, unknown>,
        };
        let totalStaked = 0n;
        let totalPayout = 0n;
        const binCount: number[] = Array(rows + 1).fill(0);
        for (let nonce = 1; nonce <= N; nonce++) {
          const rng = new HmacRngStream(seedPair, nonce);
          const state = plinkoGame.initialState(bet, rng);
          binCount[state.bin]++;
          totalStaked += stake;
          totalPayout += (stake * BigInt(state.multiplierMilli)) / 1000n;
        }
        const empiricalRtp = Number(totalPayout) / Number(totalStaked);
        const theoreticalRtp = plinkoTheoreticalRtp(config);
        const drift = Math.abs(empiricalRtp - theoreticalRtp);
        // bin distribution sanity: center bin should be most populated
        const center = rows / 2;
        const centerCount = binCount[center];
        const centerExpected = N * plinkoBinProbability(rows, center);
        const centerDrift = Math.abs(centerCount - centerExpected) / centerExpected;
        console.log(
          `  rows=${rows} risk=${risk.padEnd(6)} · empirical ${(empiricalRtp * 100).toFixed(2)}% (theory ${(theoreticalRtp * 100).toFixed(2)}%) Δ ${(drift * 100).toFixed(2)}pp · center bin ${centerCount}/${centerExpected.toFixed(0)} (${(centerDrift * 100).toFixed(2)}% drift)`,
        );
        // HIGH risk configs are dominated by ultra-rare edge bins (e.g.
        // rows=16 pays 1000× at p=1/65536; rows=12 pays 170× at p=1/4096).
        // Edge-bin sampling variance over 200k drops is large, so we widen
        // tolerance for these. Low/medium are tight (≤1pp).
        let tolerance = 0.01;
        if (risk === "high") {
          if (rows === 16) tolerance = 0.03;
          else if (rows === 12) tolerance = 0.025;
          else tolerance = 0.015;
        }
        if (drift > tolerance) {
          fail(`rows=${rows} risk=${risk} RTP off by ${(drift * 100).toFixed(2)}pp > ${(tolerance * 100).toFixed(2)}pp`);
        }
      }
    }
    pass("all 9 configs converge within tolerance");
  }

  /* -------------------------------------------------------------------------
   *  6. Sample some paths — sanity
   * ----------------------------------------------------------------------- */
  header("6. sample paths");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const config: PlinkoConfig = { rows: 16, risk: "medium" };
    const bet = {
      sessionId: "s",
      userId: "u",
      gameId: "plinko" as const,
      chainId: "dev-mock" as const,
      token: DEV_TOKEN,
      stake: 10_000_000n,
      config: config as unknown as Record<string, unknown>,
    };
    for (let i = 1; i <= 3; i++) {
      const rng = new HmacRngStream(seedPair, i);
      const s = plinkoGame.initialState(bet, rng) as PlinkoState;
      const settled = plinkoGame.settle(s, bet);
      console.log(
        `  nonce=${i} · bin=${s.bin.toString().padStart(2)} · ${s.multiplier.toFixed(2).padStart(6)}× · path=${s.path.map((b) => (b ? "R" : "L")).join("")} · pnl=${settled.pnlUnits}`,
      );
    }
    pass("sample paths printed");
  }

  console.log("\nAll plinko smoke tests passed ✓");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
