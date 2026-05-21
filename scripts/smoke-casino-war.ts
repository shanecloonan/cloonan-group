/* ===========================================================================
 *  Smoke: casino war compare + war/surrender + verify
 *  Run: npx tsx scripts/smoke-casino-war.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  buildShoe,
  cardFromIndex,
  casinoWarCompare,
  casinoWarGame,
  verifySession,
  newSessionId,
  DEV_TOKEN,
  type RngStream,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

(async () => {
  console.log("=== smoke-casino-war ===\n");

  const ace = cardFromIndex(12);
  const king = cardFromIndex(11);
  const two = cardFromIndex(0);
  if (casinoWarCompare(ace, king) !== "player") fail("ace beats king");
  if (casinoWarCompare(two, ace) !== "dealer") fail("2 loses to ace");
  if (casinoWarCompare(king, king) !== "tie") fail("same rank ties");
  pass("rank compare (ace high)");

  const twoA = cardFromIndex(0);
  const twoB = cardFromIndex(13);
  if (casinoWarCompare(twoA, twoB) !== "tie") fail("fixture ranks");
  const s0: import("../lib/casino").CasinoWarState = {
    config: { numDecks: 6 },
    shoe: buildShoe(6),
    playerCard: twoA,
    dealerCard: twoB,
    warPlayerCard: null,
    warDealerCard: null,
    warStake: 0n,
    resolution: null,
    stake: 1_000_000n,
    phase: "tie_choice",
  };
  const noopRng = { nextInt: (_n: number) => 0, nextByte: () => 0 } as RngStream;
  const surrendered = casinoWarGame.step(s0, { type: "surrender" }, noopRng);
  const surRes = casinoWarGame.settle(surrendered, {
    sessionId: "tie-test",
    userId: "smoke",
    gameId: "casino-war",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
  });
  if (surRes.totalPayoutUnits !== 500_000n) fail("surrender half");
  pass("surrender half back");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(casinoWarGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "casino-war",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: {},
  });
  if (s.state.phase === "tie_choice") {
    s = await driver.applyAction(casinoWarGame, s, { type: "surrender" });
  }
  s = await driver.settleSession(casinoWarGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: casinoWarGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "casino-war",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("driver open · action · settle · verify");

  console.log("\nAll casino war smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
