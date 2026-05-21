/* ===========================================================================
 *  Smoke: dragon tiger ranks + settle + verify
 *  Run: npx tsx scripts/smoke-casino-dragon-tiger.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  dragonTigerGame,
  dragonTigerRankValue,
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
  console.log("=== smoke-casino-dragon-tiger ===\n");

  if (dragonTigerRankValue("A") !== 1) fail("ace low");
  if (dragonTigerRankValue("K") !== 13) fail("king high");
  pass("rank order");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(dragonTigerGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "dragon-tiger",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: { betSpot: "dragon" },
  });
  s = await driver.settleSession(dragonTigerGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: dragonTigerGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "dragon-tiger",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { betSpot: s.state.betSpot, numDecks: s.state.config.numDecks },
    },
    actions: [],
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  const rs = v.replayedState as typeof s.state;
  if (rs.winner !== s.state.winner) fail("winner mismatch");
  pass("driver open · settle · verify");

  console.log("\nAll dragon tiger smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
