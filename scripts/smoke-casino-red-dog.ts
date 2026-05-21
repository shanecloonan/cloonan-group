/* ===========================================================================
 *  Smoke: red dog spread + driver + verify
 *  Run: npx tsx scripts/smoke-casino-red-dog.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  buildShoe,
  cardFromIndex,
  evaluateRedDogHand,
  redDogGame,
  redDogRankIndex,
  spreadReturnHint,
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
  console.log("=== smoke-casino-red-dog ===\n");

  const two = cardFromIndex(0);
  const five = cardFromIndex(3);
  const four = cardFromIndex(2);
  if (redDogRankIndex(two.rank) !== 0) fail("2 low index");
  const pair = evaluateRedDogHand(two, cardFromIndex(13), null);
  if (!pair.pushed) fail("pair push");
  const consec = evaluateRedDogHand(two, cardFromIndex(1), null);
  if (!consec.pushed) fail("consecutive push");
  const win = evaluateRedDogHand(two, five, four);
  if (!win.won || win.spread !== 2) fail("between win");
  if (spreadReturnHint(2) !== 3) fail("spread 2 pay");
  pass("spread rules");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(redDogGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "red-dog",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: {},
  });
  s = await driver.settleSession(redDogGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: redDogGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "red-dog",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: [],
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  const rs = v.replayedState as typeof s.state;
  if (rs.spread !== s.state.spread || rs.won !== s.state.won) fail("replay mismatch");
  pass("driver open · settle · verify");

  if (buildShoe(1).cards.length !== 52) fail("shoe size");
  pass("shoe build");

  console.log("\nAll red dog smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
