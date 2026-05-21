/* ===========================================================================
 *  Smoke: mississippi stud pay table + driver + verify
 *  Run: npx tsx scripts/smoke-casino-mississippi-stud.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  mississippiStudGame,
  mississippiStudPayReturn,
  mississippiStudQualifies,
  bestHand,
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

function five(indices: number[]) {
  return indices.map(cardFromIndex);
}

(async () => {
  console.log("=== smoke-casino-mississippi-stud ===\n");

  const sixes = five([4, 17, 39, 28, 20]);
  const score6 = bestHand(sixes);
  if (!mississippiStudQualifies(score6)) fail("pair of 6s qualifies");
  if (mississippiStudPayReturn(score6) !== 2) fail("pair pays even money");
  const low = five([0, 14, 30, 44, 20]);
  if (mississippiStudQualifies(bestHand(low))) fail("high no qualify");
  pass("pay table");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  const ante = 1_000_000n;
  let s = await driver.openSession(mississippiStudGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "mississippi-stud",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: ante,
    config: {},
  });
  s = await driver.applyAction(mississippiStudGame, s, { type: "bet_1" }, ante);
  s = await driver.applyAction(mississippiStudGame, s, { type: "bet_2" }, ante * 2n);
  s = await driver.applyAction(mississippiStudGame, s, { type: "bet_3" }, ante * 3n);
  s = await driver.settleSession(mississippiStudGame, s);
  if (!s.result) fail("no result");
  if (s.result.totalStakedUnits !== ante * 7n) fail("full street staked");
  pass("driver streets · settle");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: mississippiStudGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "mississippi-stud",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("verify replay");

  console.log("\nAll mississippi stud smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
