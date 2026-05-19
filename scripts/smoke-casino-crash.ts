/* ===========================================================================
 *  Smoke test: lib/casino/crash — bust math + RTP convergence + replay
 *  ---------------------------------------------------------------------------
 *  Validates:
 *
 *   1. `bustFromDraw` returns exactly `1.00` at h = 0 (deterministic floor).
 *   2. `bustFromDraw` is monotonically increasing in h (higher draw →
 *      higher multiplier).
 *   3. Replay determinism: same seed/nonce → same bust point.
 *   4. End-to-end: place a bet, cash out at k, settle gives stake * k.
 *   5. End-to-end: place a bet, simulate a bust before player cashout,
 *      settle gives 0 payout.
 *   6. Auto-cashout: when bet specifies autoCashout=k and bustAt > k,
 *      the player exits at exactly k.
 *   7. Auto-cashout under bust: when autoCashout=k > bustAt, player
 *      gets busted at bustAt instead.
 *   8. RTP convergence: 100k simulated rounds at fixed cashout = 2.0×
 *      converge to ~99.5% RTP (close to the analytic prediction
 *      99 * 2 / 199 = 0.99497).
 *   9. P(bust > k) frequencies match the analytic formula 99/(100k - 1)
 *      for k ∈ {1.5, 2.0, 5.0, 10.0}.
 *  10. `verifyBlackjackSession`-style replay: a settled session can be
 *      re-derived from (server_seed, client_seed, start_nonce).
 *
 *  Run:  npx tsx scripts/smoke-casino-crash.ts
 * ========================================================================= */

import {
  bustFromDraw,
  bustMultiplier,
  buildAnonymousSessionDriver,
  crashGame,
  DEV_TOKEN,
  expectedRtpAtCashout,
  HmacRngStream,
  newSeedPair,
  probabilityBustAbove,
  verifySession,
  newSessionId,
  type CrashState,
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
  console.log("=== smoke-casino-crash ===");

  /* -------------------------------------------------------------------------
   *  1. Edge cases of the formula
   * ----------------------------------------------------------------------- */
  header("1. bustFromDraw edge cases");
  {
    const m0 = bustFromDraw(0n);
    if (Math.abs(m0 - 1.0) > 1e-9) fail(`h=0 → expected 1.00, got ${m0}`);
    pass(`h=0 → ${m0.toFixed(4)}× (floor)`);

    const E = 1n << 52n;
    const mLarge = bustFromDraw(E / 2n);
    // h = e/2 → (100e - e/2)/(e - e/2) = (99.5e)/(0.5e) = 199 → display 1.99
    if (Math.abs(mLarge - 1.99) > 0.01) fail(`h=e/2 → expected ~1.99, got ${mLarge}`);
    pass(`h=e/2 → ${mLarge.toFixed(2)}× ≈ 1.99`);

    // Monotonicity smoke test: walk h linearly through [0, e) and ensure
    // bustFromDraw is non-decreasing.
    let prev = -Infinity;
    for (let i = 0; i < 100; i++) {
      const h = (E * BigInt(i)) / 100n;
      const m = bustFromDraw(h);
      if (m < prev - 1e-9) fail(`monotonicity broken at i=${i}: ${prev} > ${m}`);
      prev = m;
    }
    pass("monotonic in h across 100 evenly-spaced samples");
  }

  /* -------------------------------------------------------------------------
   *  2. Replay determinism
   * ----------------------------------------------------------------------- */
  header("2. Replay determinism");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const rng1 = new HmacRngStream(seedPair, 1);
    const rng2 = new HmacRngStream(seedPair, 1);
    const a = bustMultiplier(rng1);
    const b = bustMultiplier(rng2);
    if (a !== b) fail(`same seed/nonce → different bust: ${a} vs ${b}`);
    pass(`same seed/nonce → same bust ${a.toFixed(4)}×`);

    const rng3 = new HmacRngStream(seedPair, 2);
    const c = bustMultiplier(rng3);
    if (a === c) fail("different nonce produced same bust (rng stream broken)");
    pass(`different nonce → different bust ${c.toFixed(4)}×`);
  }

  /* -------------------------------------------------------------------------
   *  3. End-to-end: cashout win path
   * ----------------------------------------------------------------------- */
  header("3. End-to-end cashout win");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const rng = new HmacRngStream(seedPair, 1);
    const stake = 10_000_000n; // 10 DEV @ 6 decimals
    const state = crashGame.initialState(
      {
        sessionId: "s",
        userId: "u",
        gameId: "crash",
        chainId: "dev-mock",
        token: DEV_TOKEN,
        stake,
      },
      rng,
    );
    if (state.bustAt < 1.0) fail(`bustAt ${state.bustAt} < 1.0`);
    pass(`bustAt = ${state.bustAt.toFixed(4)}× (sampled)`);

    // Pick a cashout strictly below bustAt.
    const cashoutAt = Math.min(state.bustAt - 0.5, 1.5);
    if (cashoutAt > 1.0) {
      const exited = crashGame.step(state, { type: "cashout", multiplier: cashoutAt }, rng);
      if (exited.phase !== "cashed_out") fail(`expected cashed_out, got ${exited.phase}`);
      const r = crashGame.settle(exited, {
        sessionId: "s",
        userId: "u",
        gameId: "crash",
        chainId: "dev-mock",
        token: DEV_TOKEN,
        stake,
      });
      const expected = (stake * BigInt(Math.floor(cashoutAt * 1_000_000))) / 1_000_000n;
      if (r.totalPayoutUnits !== expected) fail(`payout ${r.totalPayoutUnits} ≠ expected ${expected}`);
      pass(`cashout @ ${cashoutAt.toFixed(2)}× pays ${r.totalPayoutUnits} (stake ${stake})`);
    } else {
      // Round busts before reaching any cashout — exercise the bust path
      // here too.
      const busted = crashGame.step(state, { type: "bust" }, rng);
      const r = crashGame.settle(busted, {
        sessionId: "s",
        userId: "u",
        gameId: "crash",
        chainId: "dev-mock",
        token: DEV_TOKEN,
        stake,
      });
      if (r.totalPayoutUnits !== 0n) fail(`busted round must pay 0, got ${r.totalPayoutUnits}`);
      pass(`bustAt=${state.bustAt.toFixed(2)}× was too low; busted round pays 0`);
    }
  }

  /* -------------------------------------------------------------------------
   *  4. Auto-cashout determinism
   * ----------------------------------------------------------------------- */
  header("4. Auto-cashout determinism");
  {
    // Find a seed/nonce that produces a moderate bust point, then
    // configure auto-cashout below it.
    const seedPair = newSeedPair({ userId: "smoke" });
    let found = false;
    for (let nonce = 1; nonce < 1000 && !found; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      const peek = bustMultiplier(rng);
      if (peek >= 3.0 && peek <= 10.0) {
        const target = 2.0;
        const rng2 = new HmacRngStream(seedPair, nonce);
        const state = crashGame.initialState(
          {
            sessionId: "s",
            userId: "u",
            gameId: "crash",
            chainId: "dev-mock",
            token: DEV_TOKEN,
            stake: 1_000_000n,
            config: { autoCashoutMultiplier: target },
          },
          rng2,
        );
        if (Math.abs(state.bustAt - peek) > 1e-6) {
          fail(`replay mismatch: peek=${peek} vs state=${state.bustAt}`);
        }
        const exited = crashGame.step(state, { type: "cashout", multiplier: target }, rng2);
        if (exited.phase !== "cashed_out") fail(`expected cashed_out at autoCashout, got ${exited.phase}`);
        if (exited.exitMultiplier !== target) fail(`exit ${exited.exitMultiplier} ≠ target ${target}`);
        pass(`auto-cashout @ ${target}× while bust @ ${peek.toFixed(2)}× → settled at ${target}×`);
        found = true;
      }
    }
    if (!found) fail("could not find a bust ∈ [3, 10] in 1000 nonces (RNG broken?)");
  }

  /* -------------------------------------------------------------------------
   *  5. Auto-cashout above bust point falls back to bust
   * ----------------------------------------------------------------------- */
  header("5. Auto-cashout above bust → busted");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    let found = false;
    for (let nonce = 1; nonce < 1000 && !found; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      const peek = bustMultiplier(rng);
      if (peek >= 1.0 && peek <= 1.5) {
        const target = 10.0;
        const rng2 = new HmacRngStream(seedPair, nonce);
        const state = crashGame.initialState(
          {
            sessionId: "s",
            userId: "u",
            gameId: "crash",
            chainId: "dev-mock",
            token: DEV_TOKEN,
            stake: 1_000_000n,
            config: { autoCashoutMultiplier: target },
          },
          rng2,
        );
        const result = crashGame.step(state, { type: "cashout", multiplier: target }, rng2);
        if (result.phase !== "busted") fail(`expected busted, got ${result.phase}`);
        if (Math.abs((result.exitMultiplier ?? 0) - peek) > 1e-6) {
          fail(`busted exit ${result.exitMultiplier} ≠ bustAt ${peek}`);
        }
        pass(`autoCashout @ ${target}× while bust @ ${peek.toFixed(2)}× → busted at ${peek.toFixed(2)}×`);
        found = true;
      }
    }
    if (!found) fail("could not find a bust ∈ [1.0, 1.5] in 1000 nonces");
  }

  /* -------------------------------------------------------------------------
   *  6. RTP convergence at fixed cashout k=2.0
   * ----------------------------------------------------------------------- */
  header("6. RTP convergence at cashout k = 2.0× (100k rounds)");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const k = 2.0;
    let totalStaked = 0n;
    let totalPayout = 0n;
    let winCount = 0;
    const N = 100_000;
    const stake = 1_000_000n;
    for (let nonce = 1; nonce <= N; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      const m = bustMultiplier(rng);
      totalStaked += stake;
      if (m > k) {
        totalPayout += (stake * BigInt(Math.floor(k * 1_000_000))) / 1_000_000n;
        winCount++;
      }
    }
    const empiricalRtp = Number(totalPayout) / Number(totalStaked);
    const winRate = winCount / N;
    const expectedWinRate = probabilityBustAbove(k);
    const expectedRtp = expectedRtpAtCashout(k);
    console.log(
      `  ${N.toLocaleString()} rounds @ k=${k}× · win rate ${(winRate * 100).toFixed(2)}% (expect ${(expectedWinRate * 100).toFixed(2)}%) · empirical RTP ${(empiricalRtp * 100).toFixed(2)}% (expect ${(expectedRtp * 100).toFixed(2)}%)`,
    );
    if (Math.abs(empiricalRtp - expectedRtp) > 0.01) {
      fail(`RTP off by > 1pp: empirical=${empiricalRtp}, expected=${expectedRtp}`);
    }
    pass("RTP within 1pp of analytic prediction");
  }

  /* -------------------------------------------------------------------------
   *  7. P(bust > k) frequencies at several thresholds
   * ----------------------------------------------------------------------- */
  header("7. P(bust > k) matches 99/(100k-1)");
  {
    const seedPair = newSeedPair({ userId: "smoke" });
    const thresholds = [1.5, 2.0, 5.0, 10.0];
    const counts: Record<number, number> = {};
    for (const k of thresholds) counts[k] = 0;
    const N = 50_000;
    for (let nonce = 1; nonce <= N; nonce++) {
      const rng = new HmacRngStream(seedPair, nonce);
      const m = bustMultiplier(rng);
      for (const k of thresholds) if (m > k) counts[k]++;
    }
    for (const k of thresholds) {
      const empirical = counts[k] / N;
      const expected = probabilityBustAbove(k);
      const diff = Math.abs(empirical - expected);
      console.log(
        `  k=${k.toFixed(1).padStart(4)}× · empirical ${(empirical * 100).toFixed(2)}% (expect ${(expected * 100).toFixed(2)}%)  Δ ${(diff * 100).toFixed(2)}pp`,
      );
      if (diff > 0.015) fail(`P(bust > ${k}) off by > 1.5pp`);
    }
    pass("all thresholds within tolerance");
  }

  /* -------------------------------------------------------------------------
   *  8. Session driver: lock, settle, audit log, replay
   * ----------------------------------------------------------------------- */
  header("8. Session driver + replay verification");
  {
    const { driver, getSeedPair } = buildAnonymousSessionDriver({
      defaultUserId: "smoke-crash",
      defaultChainId: "dev-mock",
      defaultToken: DEV_TOKEN,
      seedInitialBalance: 1_000_000_000n,
    });

    // Walk a few rounds, picking different cashout strategies. We feed
    // each round through the full open → step → settle → verify pipeline
    // to ensure the casino driver, audit log, and verify replay all
    // agree on the same bust point + payout.
    let totalSessionsRun = 0;
    for (let i = 0; i < 5; i++) {
      const sessionId = newSessionId();
      const stake = 10_000_000n;
      const target = 1.5;
      const bet = {
        sessionId,
        userId: "smoke-crash",
        gameId: "crash" as const,
        chainId: "dev-mock" as const,
        token: DEV_TOKEN,
        stake,
        config: { autoCashoutMultiplier: target },
      };

      // Snapshot the seed pair at open time — we'll need its raw
      // serverSeed to verify the session below.
      const seedAtOpen = getSeedPair();
      if (!seedAtOpen.serverSeed) fail("anon seed pair must have a raw serverSeed");

      const session = await driver.openSession(crashGame, bet);
      const stepped = await driver.applyAction(crashGame, session, {
        type: "cashout",
        multiplier: target,
      });
      const settled = await driver.settleSession(crashGame, stepped);

      const finalState = settled.state as CrashState;
      const won = finalState.phase === "cashed_out";

      // Replay verification.
      const v = verifySession({
        game: crashGame,
        serverSeed: seedAtOpen.serverSeed,
        serverSeedHash: settled.serverSeedHash,
        clientSeed: settled.clientSeed,
        startNonce: settled.startNonce,
        bet: {
          sessionId: settled.id,
          userId: settled.userId,
          gameId: "crash",
          chainId: settled.chainId,
          token: settled.token,
          stake: settled.stake,
          config: bet.config,
        },
        actions: settled.actions
          .filter((a) => a.actor === "player")
          .map((a) => ({
            ordinal: a.ordinal,
            action: a.action as Parameters<typeof crashGame.step>[1],
            actor: a.actor,
          })),
        expectedStateHashes: settled.actions.map((a) => a.stateHash ?? ""),
      });
      if (!v.hashOk) fail(`hash mismatch on session ${i + 1}`);
      if (!v.finalStateMatches) fail(`final state mismatch on session ${i + 1}`);

      const replayed = v.replayedState as CrashState;
      if (Math.abs(replayed.bustAt - finalState.bustAt) > 1e-9) {
        fail(`replay bust ${replayed.bustAt} ≠ live bust ${finalState.bustAt}`);
      }
      totalSessionsRun++;
      console.log(
        `  round ${i + 1}: bust ${finalState.bustAt.toFixed(2)}×, ${won ? `cashed @ ${target}×` : "busted"}, pnl ${settled.result?.pnlUnits ?? 0n}`,
      );
    }
    pass(`${totalSessionsRun} crash sessions opened/stepped/settled/verified`);
  }

  /* -------------------------------------------------------------------------
   *  9. expectedRtpAtCashout sanity
   * ----------------------------------------------------------------------- */
  header("9. RTP analytic surface");
  {
    const samples = [1.5, 2.0, 5.0, 100.0];
    for (const k of samples) {
      const rtp = expectedRtpAtCashout(k);
      const expected = (99 * k) / (100 * k - 1);
      if (Math.abs(rtp - expected) > 1e-12) fail(`rtp(${k}) ≠ analytic`);
    }
    pass("RTP function matches analytic formula");
  }

  console.log("\nAll crash smoke tests passed ✓");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
