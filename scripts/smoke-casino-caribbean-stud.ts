/* ===========================================================================
 *  Smoke: caribbean stud qualify + driver + verify
 *  Run: npx tsx scripts/smoke-casino-caribbean-stud.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  caribbeanStudDealerQualifies,
  caribbeanStudGame,
  bestHand,
  describeScore,
  verifySession,
  newSessionId,
  DEV_TOKEN,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

(async () => {
  console.log("=== smoke-casino-caribbean-stud ===\n");

  const pairHand = [cardFromIndex(0), cardFromIndex(13), cardFromIndex(2), cardFromIndex(16), cardFromIndex(29)];
  if (!caribbeanStudDealerQualifies(pairHand)) fail("pair qualifies");
  const akHigh = [
    cardFromIndex(51),
    cardFromIndex(50),
    cardFromIndex(0),
    cardFromIndex(1),
    cardFromIndex(2),
  ];
  if (!caribbeanStudDealerQualifies(akHigh)) fail("AK qualifies");
  const low = [cardFromIndex(0), cardFromIndex(15), cardFromIndex(31), cardFromIndex(46), cardFromIndex(22)];
  if (caribbeanStudDealerQualifies(low)) fail("low no qualify");
  pass("dealer qualify");

  if (bestHand(pairHand).category < 1) fail("pair category");
  pass("5-card eval");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(caribbeanStudGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "caribbean-stud",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: {},
  });
  s = await driver.applyAction(caribbeanStudGame, s, { type: "raise" }, s.stake);
  s = await driver.settleSession(caribbeanStudGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: caribbeanStudGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "caribbean-stud",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("driver open · raise · settle · verify");

  console.log("\nAll caribbean stud smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
