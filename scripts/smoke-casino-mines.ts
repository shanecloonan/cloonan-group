/* ===========================================================================
 *  Smoke test: lib/casino/mines — provably-fair layouts + RTP convergence
 *  ---------------------------------------------------------------------------
 *  Validates:
 *   1. Binomial coefficients and survival probability sanity.
 *   2. Multiplier formula matches the analytic identity
 *         P(survive k | M) · m_k = 1 − houseEdge   (for every k, every M).
 *   3. Replay determinism: same seed/nonce → same mine layout.
 *   4. Layout uniformity: across many nonces, every tile appears as a
 *      mine ≈ M/25 fraction of the time (verifies the Fisher–Yates
 *      shuffle is unbiased).
 *   5. Pick action mechanics: safe vs. mine transitions, cashout legality,
 *      auto-cashout when all safe tiles cleared.
 *   6. Settle math: payout = stake · multiplier exactly (bigint).
 *   7. RTP convergence: "pick exactly k then cash out" RTP empirically
 *      converges to 0.99 across many strategies and mine counts.
 *
 *  Run:  npx tsx scripts/smoke-casino-mines.ts
 * ========================================================================= */

import {
  DEV_TOKEN,
  HmacRngStream,
  deriveMineLayout,
  expectedReturnAtK,
  minesBinomial,
  minesGame,
  minesMultiplier,
  minesPayoutTable,
  minesSurvivalProbability,
  newSeedPair,
  type MinesConfig,
  type MinesState,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  + ${msg}`);
}
function fail(msg: string): never {
  console.error(`  X FAIL: ${msg}`);
  process.exit(1);
}
function header(s: string) {
  console.log("\n-- " + s + " " + "-".repeat(Math.max(0, 60 - s.length)));
}

(async () => {
  console.log("=== smoke-casino-mines ===");

  /* -------------------------------------------------------------------------
   *  1. Binomial sanity
   * ----------------------------------------------------------------------- */
  header("1. binomial + survival probabilities");
  {
    if (minesBinomial(25, 0) !== 1n) fail("C(25,0) != 1");
    if (minesBinomial(25, 25) !== 1n) fail("C(25,25) != 1");
    if (minesBinomial(25, 1) !== 25n) fail("C(25,1) != 25");
    if (minesBinomial(25, 12) !== 5200300n) fail(`C(25,12) = ${minesBinomial(25, 12)} != 5200300`);
    pass("C(25,k) basics check out");

    // Survival probability is monotonic decreasing in k (more picks = riskier).
    for (let mines = 1; mines <= 24; mines++) {
      let prev = 1.0;
      for (let k = 1; k <= 25 - mines; k++) {
        const p = minesSurvivalProbability(mines, k);
        if (p <= 0 || p > 1) fail(`survival p out of [0,1]: mines=${mines} k=${k} -> ${p}`);
        if (p > prev) fail(`survival not monotonic: mines=${mines} k=${k}: ${p} > ${prev}`);
        prev = p;
      }
    }
    pass("survival probabilities are monotonic decreasing across all (mines, k)");

    // First-pick survival = (25 - M)/25.
    for (let mines = 1; mines <= 24; mines++) {
      const expected = (25 - mines) / 25;
      const actual = minesSurvivalProbability(mines, 1);
      if (Math.abs(actual - expected) > 1e-12) {
        fail(`first-pick survival mines=${mines}: ${actual} != ${expected}`);
      }
    }
    pass("first-pick survival = (25 - M)/25 exactly");
  }

  /* -------------------------------------------------------------------------
   *  2. Multiplier formula identity check
   *  P(survive k) · m_k must equal (10000 - hbp)/10000 exactly.
   * ----------------------------------------------------------------------- */
  header("2. multiplier x survival = 1 - edge");
  {
    const hbp = 100;
    const expected = (10000 - hbp) / 10000; // 0.99
    let maxErr = 0;
    for (let mines = 1; mines <= 24; mines++) {
      for (let k = 1; k <= 25 - mines; k++) {
        const m = minesMultiplier(mines, k, hbp).value;
        const p = minesSurvivalProbability(mines, k);
        const product = p * m;
        const err = Math.abs(product - expected);
        if (err > maxErr) maxErr = err;
        // Allow a few-ULPs slop because m comes from a bigint floor division.
        if (err > 1e-6) {
          fail(`identity broken at mines=${mines} k=${k}: p·m=${product} expected ${expected}`);
        }
      }
    }
    pass(`identity holds across all (mines, k); max err = ${maxErr.toExponential(2)}`);

    // Multiplier monotonically increases with k (more picks = higher payout).
    for (let mines = 1; mines <= 24; mines++) {
      let prev = 1.0;
      for (let k = 1; k <= 25 - mines; k++) {
        const m = minesMultiplier(mines, k).value;
        if (m < prev) fail(`multiplier non-monotonic: mines=${mines} k=${k}: ${m} < ${prev}`);
        prev = m;
      }
    }
    pass("multiplier is monotonic non-decreasing in k");

    // Spot-check a published Stake.com 3-mine table value:
    //   k=1 -> 25/22 · 0.99 = 1.125
    //   k=5 -> C(25,5)/C(22,5)·0.99 = 53130/26334·0.99 ≈ 1.997
    {
      const k1 = minesMultiplier(3, 1).value;
      if (Math.abs(k1 - 1.125) > 0.001) fail(`3-mine k=1 multiplier ${k1} != ~1.125`);
      const k5 = minesMultiplier(3, 5).value;
      if (Math.abs(k5 - 1.997) > 0.005) fail(`3-mine k=5 multiplier ${k5} != ~1.997`);
      pass(`spot check: 3 mines -> k=1: ${k1.toFixed(3)}x, k=5: ${k5.toFixed(3)}x`);
    }

    // The payout table length is exactly (25 - mines):
    const tbl = minesPayoutTable(3);
    if (tbl.length !== 22) fail(`payout table length ${tbl.length} != 22`);
    pass("payout table length = 25 - M");
  }

  /* -------------------------------------------------------------------------
   *  3. Replay determinism — same seed/nonce -> same layout
   * ----------------------------------------------------------------------- */
  header("3. replay determinism");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    for (let mines = 1; mines <= 24; mines++) {
      const r1 = new HmacRngStream(seedPair, 42);
      const r2 = new HmacRngStream(seedPair, 42);
      const a = deriveMineLayout(r1, mines);
      const b = deriveMineLayout(r2, mines);
      if (a.length !== mines) fail(`layout length ${a.length} != ${mines}`);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) fail(`mines=${mines} replay mismatch at ${i}: ${a[i]} != ${b[i]}`);
      }
    }
    pass("layouts replay identically across all M for the same (seed, nonce)");

    // Different nonces -> usually different layouts (sanity).
    const r1 = new HmacRngStream(seedPair, 1);
    const r2 = new HmacRngStream(seedPair, 2);
    const a = deriveMineLayout(r1, 3);
    const b = deriveMineLayout(r2, 3);
    const sameAll = a.every((x, i) => x === b[i]);
    if (sameAll) fail("expected nonce 1 vs 2 to differ for M=3");
    pass("different nonces produce different layouts");
  }

  /* -------------------------------------------------------------------------
   *  4. Layout uniformity (each tile is a mine ~M/25 of the time)
   * ----------------------------------------------------------------------- */
  header("4. layout uniformity (M=5, N=50_000)");
  {
    const seedPair = newSeedPair({ userId: "uniform" });
    const N = 50_000;
    const mines = 5;
    const count = new Array<number>(25).fill(0);
    for (let nonce = 1; nonce <= N; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      const layout = deriveMineLayout(rng, mines);
      for (const t of layout) count[t]++;
    }
    const expected = (N * mines) / 25; // = N/5
    let maxDrift = 0;
    for (let t = 0; t < 25; t++) {
      const drift = Math.abs(count[t] - expected) / expected;
      if (drift > maxDrift) maxDrift = drift;
    }
    // 50k draws, p=0.2, std dev = sqrt(50k · 0.2 · 0.8) = 89.4, so 89.4/10000 ≈
    // 0.9% expected drift; allow up to 3% (3 sigma + slack).
    if (maxDrift > 0.03) fail(`layout uniformity drift ${(maxDrift * 100).toFixed(2)}% > 3%`);
    pass(`every tile is a mine ${(100 * mines) / 25}% +/- ${(maxDrift * 100).toFixed(2)}% of the time`);
  }

  /* -------------------------------------------------------------------------
   *  5. Pick action mechanics
   * ----------------------------------------------------------------------- */
  header("5. pick action mechanics");
  {
    const seedPair = newSeedPair({ userId: "mechanics" });
    const config: MinesConfig = { gridSize: 5, mines: 3, houseEdgeBps: 100 };
    const bet = {
      sessionId: "s",
      userId: "u",
      gameId: "mines" as const,
      chainId: "dev-mock" as const,
      token: DEV_TOKEN,
      stake: 1_000_000n,
      config: config as unknown as Record<string, unknown>,
    };
    // Pick all safe tiles -> auto cash-out.
    {
      const rng = new HmacRngStream(seedPair, 1);
      let s: MinesState = minesGame.initialState(bet, rng);
      const mineSet = new Set(s.mineLayout);
      for (let i = 0; i < 25; i++) {
        if (mineSet.has(i)) continue;
        s = minesGame.step(s, { type: "pick", tile: i }, rng);
        if (s.phase === "exploded") fail("safe pick exploded");
      }
      if (s.phase !== "cashed_out") fail(`expected auto-cashout, got ${s.phase}`);
      if (s.picks !== 25 - 3) fail(`picks ${s.picks} != 22`);
      pass(`clearing all safe tiles auto-cashes out at ${s.multiplier.toFixed(2)}x`);
    }
    // Pick a mine -> exploded.
    {
      const rng = new HmacRngStream(seedPair, 2);
      let s: MinesState = minesGame.initialState(bet, rng);
      const mine = s.mineLayout[0];
      s = minesGame.step(s, { type: "pick", tile: mine }, rng);
      if (s.phase !== "exploded") fail(`expected exploded, got ${s.phase}`);
      if (s.multiplier !== 0) fail(`exploded multiplier ${s.multiplier} != 0`);
      pass("picking a mine sets phase=exploded and multiplier=0");
    }
    // Cashout with 0 picks throws.
    {
      const rng = new HmacRngStream(seedPair, 3);
      const s: MinesState = minesGame.initialState(bet, rng);
      let threw = false;
      try {
        minesGame.step(s, { type: "cashout" }, rng);
      } catch {
        threw = true;
      }
      if (!threw) fail("cashout with 0 picks should throw");
      pass("cashout requires at least one safe pick");
    }
    // Picking same tile twice throws.
    {
      const rng = new HmacRngStream(seedPair, 4);
      let s: MinesState = minesGame.initialState(bet, rng);
      const safe = [...Array(25).keys()].find((i) => !s.mineLayout.includes(i));
      if (safe === undefined) fail("no safe tile?");
      s = minesGame.step(s, { type: "pick", tile: safe }, rng);
      let threw = false;
      try {
        minesGame.step(s, { type: "pick", tile: safe }, rng);
      } catch {
        threw = true;
      }
      if (!threw) fail("picking same tile twice should throw");
      pass("re-picking a revealed tile throws");
    }
  }

  /* -------------------------------------------------------------------------
   *  6. Settle math (bigint)
   * ----------------------------------------------------------------------- */
  header("6. settle math");
  {
    const seedPair = newSeedPair({ userId: "settle" });
    const config: MinesConfig = { gridSize: 5, mines: 5, houseEdgeBps: 100 };
    const stake = 1_000_000n;
    const bet = {
      sessionId: "s",
      userId: "u",
      gameId: "mines" as const,
      chainId: "dev-mock" as const,
      token: DEV_TOKEN,
      stake,
      config: config as unknown as Record<string, unknown>,
    };
    for (let nonce = 1; nonce <= 20; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      let s: MinesState = minesGame.initialState(bet, rng);
      const mineSet = new Set(s.mineLayout);
      // Pick safe tiles until 3 picks reached, then cashout.
      const target = 3;
      let picked = 0;
      for (let i = 0; i < 25 && picked < target; i++) {
        if (mineSet.has(i)) continue;
        s = minesGame.step(s, { type: "pick", tile: i }, rng);
        picked++;
      }
      if (s.phase === "running" && picked > 0) {
        s = minesGame.step(s, { type: "cashout" }, rng);
      }
      const settled = minesGame.settle(s, bet);
      if (s.phase === "cashed_out") {
        const expected = (stake * s.multiplierMicro) / 1_000_000n;
        if (settled.totalPayoutUnits !== expected) {
          fail(
            `nonce=${nonce} payout mismatch: got ${settled.totalPayoutUnits}, expected ${expected}`,
          );
        }
      } else if (settled.totalPayoutUnits !== 0n) {
        fail(`exploded payout should be 0, got ${settled.totalPayoutUnits}`);
      }
    }
    pass("20 rounds: payout = stake * multiplier_micro / 1e6 exactly");
  }

  /* -------------------------------------------------------------------------
   *  7. RTP convergence — pick-k-then-cashout strategies
   *  Expected RTP for every (M, k) is 0.99 (1% house edge), independent of k.
   * ----------------------------------------------------------------------- */
  header("7. RTP convergence (pick-k strategies, 50k rounds each)");
  {
    const seedPair = newSeedPair({ userId: "rtp" });
    const N = 50_000;
    const stake = 1_000_000n;
    // Test a sampling of (mines, k) strategies that all should yield 0.99 RTP.
    const strategies: { mines: number; k: number }[] = [
      { mines: 1, k: 1 },
      { mines: 1, k: 5 },
      { mines: 1, k: 10 },
      { mines: 3, k: 1 },
      { mines: 3, k: 3 },
      { mines: 3, k: 10 },
      { mines: 5, k: 1 },
      { mines: 5, k: 5 },
      { mines: 10, k: 1 },
      { mines: 10, k: 5 },
      { mines: 20, k: 1 },
      { mines: 20, k: 3 },
    ];
    for (const { mines, k } of strategies) {
      const config: MinesConfig = { gridSize: 5, mines, houseEdgeBps: 100 };
      const bet = {
        sessionId: "s",
        userId: "u",
        gameId: "mines" as const,
        chainId: "dev-mock" as const,
        token: DEV_TOKEN,
        stake,
        config: config as unknown as Record<string, unknown>,
      };
      let totalStaked = 0n;
      let totalPayout = 0n;
      for (let nonce = 1; nonce <= N; nonce++) {
        const rng = new HmacRngStream(seedPair, nonce);
        let s: MinesState = minesGame.initialState(bet, rng);
        // Strategy: deterministically pick tiles 0,1,2,... in numerical order
        // until either we've made k safe picks or we hit a mine.
        for (let tile = 0; tile < 25 && s.phase === "running" && s.picks < k; tile++) {
          s = minesGame.step(s, { type: "pick", tile }, rng);
        }
        if (s.phase === "running") {
          s = minesGame.step(s, { type: "cashout" }, rng);
        }
        const settled = minesGame.settle(s, bet);
        totalStaked += stake;
        totalPayout += settled.totalPayoutUnits;
      }
      const empirical = Number(totalPayout) / Number(totalStaked);
      const expected = expectedReturnAtK(mines, k); // 0.99
      const drift = Math.abs(empirical - expected);
      console.log(
        `  mines=${String(mines).padStart(2)} k=${String(k).padStart(2)} : empirical ${(empirical * 100).toFixed(2)}% (target ${(expected * 100).toFixed(2)}%) drift ${(drift * 100).toFixed(2)}pp`,
      );
      // Variance is highest when payouts are tail-heavy (low survival, high multiplier).
      // For M=20 k=3: survival = C(5,3)/C(25,3) = 10/2300 ~= 0.43%, multiplier ~= 228x.
      // That's similar variance to a single-bin lottery; tolerate up to 5pp.
      // Tolerance scales with the strategy's theoretical std dev: payout
      // per round is a Bernoulli(p) scaled by m, so:
      //   stderr(mean RTP) = m · sqrt( p(1-p) / N )
      // Allow 4 std-dev band (~once in 16k tests of false-positive) plus
      // a 0.5pp floor for floor-division rounding artifacts.
      const survival = minesSurvivalProbability(mines, k);
      const m = minesMultiplier(mines, k).value;
      const stderr = m * Math.sqrt((survival * (1 - survival)) / N);
      const tolerance = Math.max(4 * stderr, 0.005);
      if (drift > tolerance) {
        fail(`mines=${mines} k=${k} drift ${(drift * 100).toFixed(2)}pp > ${(tolerance * 100).toFixed(2)}pp (4 sigma)`);
      }
    }
    pass("all strategies converge to within tolerance of 99% RTP");
  }

  console.log("\nAll mines smoke tests passed +");
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
