/* ===========================================================================
 *  Smoke test: lib/casino/hilo — independent draws + flat 1% edge + RTP
 *  ---------------------------------------------------------------------------
 *  Validates:
 *   1. Win probability formula sanity:
 *         P(higher | r) + P(lower | r) = 56/52 = 14/13 (ties shared)
 *         P(higher | 0) = 1.0, P(lower | 12) = 1.0
 *   2. Multiplier identity: per-pick `p · m_step = (1 - edge)` exactly
 *      across every rank index and direction.
 *   3. Card draw uniformity: each card 0..51 appears 1/52 of the time
 *      across many draws.
 *   4. Replay determinism: same (seed, nonce) yields the same starting
 *      card AND the same sequence of subsequent draws.
 *   5. Pick action mechanics: win advances multiplier, loss ends round,
 *      cashout requires at least one pick.
 *   6. Settle math: payout = stake · multiplier_micro / 1e6 exactly (bigint).
 *   7. RTP convergence (with-replacement model):
 *         - "always higher": EV = 0.99 (flat)
 *         - "always lower":  EV = 0.99 (flat)
 *         - "always higher × k": EV = 0.99^k (compounded edge)
 *
 *  Run:  npx tsx scripts/smoke-casino-hilo.ts
 * ========================================================================= */

import {
  DEV_TOKEN,
  HmacRngStream,
  drawHiloCard,
  expectedReturnAtPick,
  hiloGame,
  hiloMultiplierStep,
  hiloWinProbability,
  newSeedPair,
  rankIndexOf,
  type HiloDirection,
  type HiloState,
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
  console.log("=== smoke-casino-hilo ===");

  /* -------------------------------------------------------------------------
   *  1. Win probability sanity
   * ----------------------------------------------------------------------- */
  header("1. win probability sanity");
  {
    // Both buttons include ties: sum should be 56/52 = 14/13.
    for (let r = 0; r <= 12; r++) {
      const ph = hiloWinProbability("higher", r);
      const pl = hiloWinProbability("lower", r);
      const sum = ph + pl;
      const expected = 56 / 52;
      if (Math.abs(sum - expected) > 1e-12) {
        fail(`r=${r}: P(higher) + P(lower) = ${sum} != ${expected}`);
      }
    }
    pass("P(higher|r) + P(lower|r) = 56/52 for all r");

    // Extreme: r=0 (rank 2): higher-or-same wins on every card.
    if (hiloWinProbability("higher", 0) !== 1.0) {
      fail(`P(higher | r=0) = ${hiloWinProbability("higher", 0)} != 1.0`);
    }
    // Extreme: r=12 (A): lower-or-same wins on every card.
    if (hiloWinProbability("lower", 12) !== 1.0) {
      fail(`P(lower | r=12) = ${hiloWinProbability("lower", 12)} != 1.0`);
    }
    // P(higher | 12) = 4/52 (only another A wins).
    const phA = hiloWinProbability("higher", 12);
    if (Math.abs(phA - 4 / 52) > 1e-12) fail(`P(higher | A) ${phA} != 4/52`);
    pass("extreme rank probabilities check out (r=0, r=12)");
  }

  /* -------------------------------------------------------------------------
   *  2. Multiplier identity: p · m_step = (1 - edge)
   * ----------------------------------------------------------------------- */
  header("2. multiplier x probability = 1 - edge");
  {
    const hbp = 100;
    const target = (10000 - hbp) / 10000;
    let maxErr = 0;
    for (let r = 0; r <= 12; r++) {
      for (const dir of ["higher", "lower"] as HiloDirection[]) {
        const p = hiloWinProbability(dir, r);
        const m = hiloMultiplierStep(p, hbp);
        const product = p * m;
        const err = Math.abs(product - target);
        if (err > maxErr) maxErr = err;
        if (err > 1e-12) {
          fail(`identity broken r=${r} ${dir}: p·m=${product} expected ${target}`);
        }
      }
    }
    pass(`identity holds across all (r, direction); max err = ${maxErr.toExponential(2)}`);

    // Spot check multiplier values:
    //   r=6 (rank 8), higher: p=4*7/52=28/52, m=0.99/(28/52)=0.99*52/28 ≈ 1.839
    {
      const m = hiloMultiplierStep(hiloWinProbability("higher", 6));
      if (Math.abs(m - 1.839) > 0.01) fail(`r=6 higher m ${m} != ~1.839`);
      pass(`spot check: r=6 higher → ${m.toFixed(3)}× (~1.84×)`);
    }
  }

  /* -------------------------------------------------------------------------
   *  3. Card draw uniformity (with-replacement)
   * ----------------------------------------------------------------------- */
  header("3. card draw uniformity (N=500_000)");
  {
    const seedPair = newSeedPair({ userId: "uniform" });
    const N = 500_000;
    const rng = new HmacRngStream(seedPair, 1);
    const count = new Array<number>(52).fill(0);
    for (let i = 0; i < N; i++) count[drawHiloCard(rng)]++;
    const expected = N / 52;
    let maxDrift = 0;
    for (let c = 0; c < 52; c++) {
      const drift = Math.abs(count[c] - expected) / expected;
      if (drift > maxDrift) maxDrift = drift;
    }
    // std-err ≈ sqrt(N · (1/52) · (51/52)) / (N/52) = sqrt(51/N) ≈ 1% at 500k.
    // Tolerate 5% worst-cell drift.
    if (maxDrift > 0.05) fail(`draw uniformity drift ${(maxDrift * 100).toFixed(2)}% > 5%`);
    pass(`every card appears 1/52 +/- ${(maxDrift * 100).toFixed(2)}%`);
  }

  /* -------------------------------------------------------------------------
   *  4. Replay determinism
   * ----------------------------------------------------------------------- */
  header("4. replay determinism");
  {
    const seedPair = newSeedPair({ userId: "replay" });
    const r1 = new HmacRngStream(seedPair, 42);
    const r2 = new HmacRngStream(seedPair, 42);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 20; i++) seqA.push(drawHiloCard(r1));
    for (let i = 0; i < 20; i++) seqB.push(drawHiloCard(r2));
    for (let i = 0; i < 20; i++) {
      if (seqA[i] !== seqB[i]) fail(`replay draw[${i}] mismatch: ${seqA[i]} != ${seqB[i]}`);
    }
    pass("identical (seed, nonce) streams produce identical card sequences");

    const r3 = new HmacRngStream(seedPair, 43);
    const seqC: number[] = [];
    for (let i = 0; i < 20; i++) seqC.push(drawHiloCard(r3));
    let same = 0;
    for (let i = 0; i < 20; i++) if (seqA[i] === seqC[i]) same++;
    if (same > 10) fail(`nonce 42 vs 43 too similar: ${same}/20 positions identical`);
    pass(`different nonce → meaningfully different sequence (${same}/20 coincide)`);
  }

  /* -------------------------------------------------------------------------
   *  5. Pick action mechanics
   * ----------------------------------------------------------------------- */
  header("5. pick action mechanics");
  {
    const seedPair = newSeedPair({ userId: "mech" });
    const bet = {
      sessionId: "s",
      userId: "u",
      gameId: "hilo" as const,
      chainId: "dev-mock" as const,
      token: DEV_TOKEN,
      stake: 1_000_000n,
      config: {} as Record<string, unknown>,
    };

    // Winning pick — find a nonce whose starting card is a 2 (rank 0).
    // Then "higher" is a guaranteed win regardless of next draw.
    let nonceWith2: number | null = null;
    for (let n = 1; n <= 500; n++) {
      const rng = new HmacRngStream(seedPair, n);
      const s = hiloGame.initialState(bet, rng);
      if (rankIndexOf(s.currentCardIndex) === 0) {
        nonceWith2 = n;
        break;
      }
    }
    if (nonceWith2 === null) fail("could not find nonce whose start is a 2");

    {
      const rng = new HmacRngStream(seedPair, nonceWith2!);
      let s: HiloState = hiloGame.initialState(bet, rng);
      // "higher" on a 2 is a guaranteed win (P=1.0, multiplier × 0.99).
      s = hiloGame.step(s, { type: "guess", direction: "higher" }, rng);
      if (s.phase !== "running") fail(`expected running after guaranteed win, got ${s.phase}`);
      if (Math.abs(s.multiplier - 0.99) > 1e-9) fail(`mult ${s.multiplier} != 0.99`);
      if (s.picks.length !== 1) fail(`picks ${s.picks.length} != 1`);
      if (!s.picks[0].won) fail("pick should have won");
      pass(`guaranteed-win pick (higher on rank 2): multiplier → ${s.multiplier.toFixed(4)}×`);
    }

    // Cashout-before-any-pick should throw.
    {
      const rng = new HmacRngStream(seedPair, 1);
      const s: HiloState = hiloGame.initialState(bet, rng);
      let threw = false;
      try {
        hiloGame.step(s, { type: "cashout" }, rng);
      } catch {
        threw = true;
      }
      if (!threw) fail("cashout with zero picks should throw");
      pass("cashout requires at least one pick");
    }

    // Losing pick — find a nonce where the starting card is an A (rank 12)
    // and the next drawn card has rank < 12.
    {
      let nonceLose: number | null = null;
      for (let n = 1; n <= 8000; n++) {
        const rng = new HmacRngStream(seedPair, n);
        const s = hiloGame.initialState(bet, rng);
        if (rankIndexOf(s.currentCardIndex) !== 12) continue;
        // Peek the next draw to check rank < 12 — clone the rng state by
        // reconstructing from scratch and consuming one extra draw.
        const peek = new HmacRngStream(seedPair, n);
        // burn the initial-card draw
        peek.nextInt(52);
        const nextCard = peek.nextInt(52);
        if (rankIndexOf(nextCard) < 12) {
          nonceLose = n;
          break;
        }
      }
      if (nonceLose === null) {
        pass("(skipping loss probe — no A→<A pair found in first 8000 nonces)");
      } else {
        const rng = new HmacRngStream(seedPair, nonceLose);
        let s: HiloState = hiloGame.initialState(bet, rng);
        s = hiloGame.step(s, { type: "guess", direction: "higher" }, rng);
        if (s.phase !== "lost") fail(`expected lost on A→<A with 'higher', got ${s.phase}`);
        if (s.multiplier !== 0) fail(`lost mult ${s.multiplier} != 0`);
        pass(`losing pick (higher on rank A → lower rank): multiplier → 0`);
      }
    }

    // Book-keeping invariant: play "always higher" until terminal, verify
    // revealedHistory + picks + currentCardIndex stay coherent.
    {
      const rng = new HmacRngStream(seedPair, 1);
      let s: HiloState = hiloGame.initialState(bet, rng);
      let safety = 0;
      while (s.phase === "running" && safety < 200) {
        s = hiloGame.step(s, { type: "guess", direction: "higher" }, rng);
        safety++;
      }
      if (s.phase === "running") fail("safety loop exceeded — never terminated");
      // Invariants:
      const totalPicks = s.picks.length;
      if (s.revealedHistory.length !== totalPicks + 1) {
        fail(`revealedHistory ${s.revealedHistory.length} != picks+1 ${totalPicks + 1}`);
      }
      if (s.currentCardIndex !== s.revealedHistory[s.revealedHistory.length - 1]) {
        fail("currentCardIndex != revealedHistory last entry");
      }
      const wins = s.picks.filter((p) => p.won).length;
      if (s.phase === "cashed_out") {
        if (wins !== totalPicks) fail("cashed_out but some pick lost");
      } else {
        if (wins !== totalPicks - 1) {
          fail(`lost but wins ${wins} != totalPicks-1 ${totalPicks - 1}`);
        }
      }
      pass(`book-keeping invariant holds across a play-out (${totalPicks} picks, phase ${s.phase})`);
    }
  }

  /* -------------------------------------------------------------------------
   *  6. Settle math (bigint)
   * ----------------------------------------------------------------------- */
  header("6. settle math");
  {
    const seedPair = newSeedPair({ userId: "settle" });
    const bet = {
      sessionId: "s",
      userId: "u",
      gameId: "hilo" as const,
      chainId: "dev-mock" as const,
      token: DEV_TOKEN,
      stake: 1_000_000n,
      config: {} as Record<string, unknown>,
    };
    for (let nonce = 1; nonce <= 30; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      let s: HiloState = hiloGame.initialState(bet, rng);
      // Pick one round. Direction by majority (higher if rank < 6, lower otherwise).
      const firstRank = rankIndexOf(s.currentCardIndex);
      const dir: HiloDirection = firstRank < 6 ? "higher" : "lower";
      s = hiloGame.step(s, { type: "guess", direction: dir }, rng);
      if (s.phase === "running") {
        s = hiloGame.step(s, { type: "cashout" }, rng);
      }
      const settled = hiloGame.settle(s, bet);
      if (s.phase === "cashed_out") {
        const expected = (1_000_000n * s.multiplierMicro) / 1_000_000n;
        if (settled.totalPayoutUnits !== expected) {
          fail(`nonce=${nonce} payout ${settled.totalPayoutUnits} != ${expected}`);
        }
      } else if (settled.totalPayoutUnits !== 0n) {
        fail(`lost payout should be 0, got ${settled.totalPayoutUnits}`);
      }
    }
    pass("30 rounds: payout = stake · multiplier_micro / 1e6 exactly");
  }

  /* -------------------------------------------------------------------------
   *  7. RTP convergence — guess-and-cashout strategy
   *  Theoretical EV for any single-pick-then-cashout strategy is 0.99.
   * ----------------------------------------------------------------------- */
  header("7. RTP convergence (50k rounds per direction)");
  {
    const seedPair = newSeedPair({ userId: "rtp" });
    const N = 50_000;
    const stake = 1_000_000n;
    const bet = {
      sessionId: "s",
      userId: "u",
      gameId: "hilo" as const,
      chainId: "dev-mock" as const,
      token: DEV_TOKEN,
      stake,
      config: {} as Record<string, unknown>,
    };
    // Two strategies: "always lower" and "always higher". Both have 0.99 EV
    // regardless of the deck because the rank of the starting card is
    // uniform over 0..12 (each appears 4/52 of the time).
    for (const dir of ["higher", "lower"] as HiloDirection[]) {
      let totalStaked = 0n;
      let totalPayout = 0n;
      for (let nonce = 1; nonce <= N; nonce++) {
        const rng = new HmacRngStream(seedPair, nonce);
        let s: HiloState = hiloGame.initialState(bet, rng);
        s = hiloGame.step(s, { type: "guess", direction: dir }, rng);
        if (s.phase === "running") {
          s = hiloGame.step(s, { type: "cashout" }, rng);
        }
        const settled = hiloGame.settle(s, bet);
        totalStaked += stake;
        totalPayout += settled.totalPayoutUnits;
      }
      const empirical = Number(totalPayout) / Number(totalStaked);
      const target = expectedReturnAtPick(dir, 6); // 0.99 (rank-independent)
      const drift = Math.abs(empirical - target);
      console.log(
        `  always-${dir}: empirical ${(empirical * 100).toFixed(2)}% (target ${(target * 100).toFixed(2)}%) drift ${(drift * 100).toFixed(2)}pp`,
      );
      // The biggest single-round payout is at rank A with "higher" → 12.87×
      // (only A→A wins). Std dev per round at that extreme is bounded; over
      // 50k rounds averaging over all starting ranks, ~0.5pp drift is typical.
      if (drift > 0.015) fail(`always-${dir} drift ${(drift * 100).toFixed(2)}pp > 1.5pp`);
    }
    pass("both 'always higher' and 'always lower' converge to 99% RTP");

    // Multi-pick strategy: "always higher, cash out after 3 wins".
    // EV = 0.99³ ≈ 0.970 (compounded edge). High payout variance (e.g. three
    // wins from ace) needs more samples than the single-pick strategies above.
    const N_COMPOUND = 200_000;
    {
      let totalStaked = 0n;
      let totalPayout = 0n;
      for (let nonce = 1; nonce <= N_COMPOUND; nonce++) {
        const rng = new HmacRngStream(seedPair, nonce);
        let s: HiloState = hiloGame.initialState(bet, rng);
        while (s.phase === "running" && s.picks.length < 3) {
          s = hiloGame.step(s, { type: "guess", direction: "higher" }, rng);
        }
        if (s.phase === "running") {
          s = hiloGame.step(s, { type: "cashout" }, rng);
        }
        const settled = hiloGame.settle(s, bet);
        totalStaked += stake;
        totalPayout += settled.totalPayoutUnits;
      }
      const empirical = Number(totalPayout) / Number(totalStaked);
      const target = Math.pow(0.99, 3);
      const drift = Math.abs(empirical - target);
      console.log(
        `  always-higher×3: empirical ${(empirical * 100).toFixed(2)}% (target ${(target * 100).toFixed(2)}%) drift ${(drift * 100).toFixed(2)}pp`,
      );
      if (drift > 0.05) fail(`3-pick higher drift ${(drift * 100).toFixed(2)}pp > 5pp`);
      pass(`compound RTP (3 picks higher): ${(empirical * 100).toFixed(2)}% vs target ${(target * 100).toFixed(2)}%`);
    }
  }

  console.log("\nAll hilo smoke tests passed +");
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
