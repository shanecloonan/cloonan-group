/* ===========================================================================
 *  Smoke: three card poker hands + driver + verify
 *  Run: npx tsx scripts/smoke-casino-three-card-poker.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  compareThreeCardHands,
  dealerQualifiesThreeCard,
  evalThreeCardHand,
  threeCardPokerGame,
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
  console.log("=== smoke-casino-three-card-poker ===\n");

  const straight = [cardFromIndex(0), cardFromIndex(14), cardFromIndex(28)];
  const flush = [cardFromIndex(0), cardFromIndex(3), cardFromIndex(7)];
  const sScore = evalThreeCardHand(straight);
  const fScore = evalThreeCardHand(flush);
  if (sScore.category !== 3 || fScore.category !== 2) fail("straight/flush cats");
  if (compareThreeCardHands(sScore, fScore) <= 0) fail("straight beats flush");
  pass("3-card rankings");

  const q64 = [cardFromIndex(10), cardFromIndex(4), cardFromIndex(2)];
  if (!dealerQualifiesThreeCard(q64)) fail("Q-6-4 qualifies");
  const q53 = [cardFromIndex(10), cardFromIndex(3), cardFromIndex(2)];
  if (dealerQualifiesThreeCard(q53)) fail("Q-5-4 no qualify");
  pass("dealer qualify");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(threeCardPokerGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "three-card-poker",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: {},
  });
  if (s.state.phase !== "player_turn") fail("player turn");
  s = await driver.applyAction(threeCardPokerGame, s, { type: "play" }, s.stake);
  s = await driver.settleSession(threeCardPokerGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: threeCardPokerGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "three-card-poker",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("driver open · play · settle · verify");

  console.log("\nAll three card poker smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
