/* ===========================================================================
 *  Smoke: trente et quarante points, settlement, deal invariants, verify
 *  Run: npx tsx scripts/smoke-casino-trente.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  newSessionId,
  trenteEtQuaranteGame,
  trentePoint,
  verifySession,
  DEV_TOKEN,
  type Bet,
  type TrenteEtQuaranteState,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

function baseState(over: Partial<TrenteEtQuaranteState>): TrenteEtQuaranteState {
  const ace = cardFromIndex(12);
  return {
    config: { numDecks: 6 },
    betSpot: "rouge",
    rouge: [ace],
    noir: [ace],
    rougeTotal: 32,
    noirTotal: 35,
    firstSuitRed: false,
    outcome: "rouge",
    couleurWins: false,
    stake: 100n,
    phase: "settled",
    ...over,
  };
}

function dummyBet(stake: bigint, spot: TrenteEtQuaranteState["betSpot"]): Bet {
  return {
    sessionId: "smoke",
    userId: "smoke",
    gameId: "trente-et-quarante",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake,
    config: { betSpot: spot, numDecks: 6 },
  };
}

(async () => {
  console.log("=== smoke-casino-trente ===\n");

  if (trentePoint("A") !== 1) fail("ace is 1");
  if (trentePoint("K") !== 10 || trentePoint("Q") !== 10 || trentePoint("J") !== 10 || trentePoint("10") !== 10) {
    fail("faces and ten are 10");
  }
  if (trentePoint("7") !== 7) fail("pip");
  pass("point values");

  const cases: { state: TrenteEtQuaranteState; payout: bigint; name: string }[] = [
    {
      name: "rouge even money",
      payout: 200n,
      state: baseState({ betSpot: "rouge", outcome: "rouge", couleurWins: false, stake: 100n }),
    },
    {
      name: "noir loses when rouge wins",
      payout: 0n,
      state: baseState({ betSpot: "noir", outcome: "rouge", couleurWins: true, firstSuitRed: true, stake: 100n }),
    },
    {
      name: "couleur matches first-card color",
      payout: 200n,
      state: baseState({ betSpot: "couleur", outcome: "noir", couleurWins: true, firstSuitRed: false, stake: 100n }),
    },
    {
      name: "inverse is the opposite of couleur",
      payout: 200n,
      state: baseState({ betSpot: "inverse", outcome: "rouge", couleurWins: false, firstSuitRed: false, stake: 100n }),
    },
    {
      name: "égalité pushes",
      payout: 100n,
      state: baseState({ betSpot: "couleur", outcome: "tie", couleurWins: null, rougeTotal: 33, noirTotal: 33, stake: 100n }),
    },
    {
      name: "refait returns half",
      payout: 50n,
      state: baseState({ betSpot: "noir", outcome: "refait", couleurWins: null, rougeTotal: 31, noirTotal: 31, stake: 100n }),
    },
  ];

  for (const c of cases) {
    const result = trenteEtQuaranteGame.settle(c.state, dummyBet(c.state.stake, c.state.betSpot));
    if (result.totalPayoutUnits !== c.payout) fail(`${c.name}: payout ${result.totalPayoutUnits} != ${c.payout}`);
    if (result.pnlUnits !== c.payout - c.state.stake) fail(`${c.name}: pnl`);
  }
  pass("settlement table");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let sawRefait = false;
  let sawTie = false;
  let sawRouge = false;
  let sawNoir = false;
  const spots = ["rouge", "noir", "couleur", "inverse"] as const;

  for (let i = 0; i < 40; i++) {
    let s = await driver.openSession(trenteEtQuaranteGame, {
      sessionId: newSessionId(),
      userId: "smoke",
      gameId: "trente-et-quarante",
      chainId: "dev-mock",
      token: DEV_TOKEN,
      stake: 1_000_000n,
      config: { betSpot: spots[i % spots.length], numDecks: 6 },
    });
    if (s.state.rougeTotal < 31 || s.state.noirTotal < 31) fail("row under 31");
    if (s.state.rouge.length === 0 || s.state.noir.length === 0) fail("empty row");
    const expected =
      s.state.rougeTotal === 31 && s.state.noirTotal === 31
        ? "refait"
        : s.state.rougeTotal === s.state.noirTotal
          ? "tie"
          : s.state.rougeTotal < s.state.noirTotal
            ? "rouge"
            : "noir";
    if (s.state.outcome !== expected) fail(`outcome ${s.state.outcome} != ${expected}`);
    if (s.state.outcome === "refait" || s.state.outcome === "tie") {
      if (s.state.couleurWins !== null) fail("couleur decided on a tie");
    } else {
      const want = s.state.firstSuitRed ? "rouge" : "noir";
      const couleur = s.state.outcome === want;
      if (s.state.couleurWins !== couleur) fail("couleur flag");
    }
    if (s.state.outcome === "refait") sawRefait = true;
    if (s.state.outcome === "tie") sawTie = true;
    if (s.state.outcome === "rouge") sawRouge = true;
    if (s.state.outcome === "noir") sawNoir = true;

    s = await driver.settleSession(trenteEtQuaranteGame, s);
    if (!s.result) fail("no result");
    if (i === 0) {
      const seed = getSeedPair().serverSeed;
      if (!seed) fail("no seed");
      const v = verifySession({
        game: trenteEtQuaranteGame,
        serverSeed: seed,
        serverSeedHash: getSeedPair().serverSeedHash,
        clientSeed: getSeedPair().clientSeed,
        startNonce: s.startNonce,
        bet: {
          sessionId: s.id,
          userId: s.userId,
          gameId: "trente-et-quarante",
          chainId: s.chainId,
          token: s.token,
          stake: s.stake,
          config: { betSpot: s.state.betSpot, numDecks: s.state.config.numDecks },
        },
        actions: [],
      });
      if (!v.hashOk || !v.finalStateMatches) fail("verify");
      const rs = v.replayedState as typeof s.state;
      if (rs.rougeTotal !== s.state.rougeTotal || rs.noirTotal !== s.state.noirTotal) fail("replay totals");
      if (rs.outcome !== s.state.outcome) fail("replay outcome");
    }
  }

  if (!sawRouge || !sawNoir) fail(`missing side wins rouge=${sawRouge} noir=${sawNoir}`);
  pass(`40 coups · rouge ${sawRouge} noir ${sawNoir} tie ${sawTie} refait ${sawRefait}`);
  pass("driver open · settle · verify");

  console.log("\nAll trente et quarante smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
