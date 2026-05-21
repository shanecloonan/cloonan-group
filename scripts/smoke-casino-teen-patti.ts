/* ===========================================================================
 *  Smoke: teen patti + driver + verify
 *  Run: npx tsx scripts/smoke-casino-teen-patti.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  teenPattiGame,
  evalThreeCardHand,
  compareThreeCardHands,
  verifySession,
  newSessionId,
  DEV_TOKEN,
  cardFromIndex,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

(async () => {
  console.log("=== smoke-casino-teen-patti ===\n");

  const trail = [cardFromIndex(0), cardFromIndex(13), cardFromIndex(26)];
  const pair = [cardFromIndex(0), cardFromIndex(13), cardFromIndex(1)];
  if (compareThreeCardHands(evalThreeCardHand(trail), evalThreeCardHand(pair)) <= 0) {
    fail("trail beats pair");
  }
  pass("3-card rank");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(teenPattiGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "teen-patti",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: {},
  });
  s = await driver.applyAction(teenPattiGame, s, { type: "play" }, s.stake);
  s = await driver.settleSession(teenPattiGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: teenPattiGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "teen-patti",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("driver play · settle · verify");

  console.log("\nAll teen patti smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
