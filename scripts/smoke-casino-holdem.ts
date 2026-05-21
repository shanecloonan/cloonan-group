/* ===========================================================================
 *  Smoke: casino hold'em qualify + driver + verify
 *  Run: npx tsx scripts/smoke-casino-holdem.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  casinoHoldemDealerQualifies,
  casinoHoldemGame,
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

function seven(hole: number[], board: number[]) {
  return [...hole.map(cardFromIndex), ...board.map(cardFromIndex)];
}

(async () => {
  console.log("=== smoke-casino-holdem ===\n");

  const pair4 = seven([2, 15], [0, 1, 28, 41, 51]);
  if (!casinoHoldemDealerQualifies(pair4)) fail("pair of 4s qualifies");
  const pair2 = seven([0, 13], [3, 18, 33, 48, 11]);
  if (casinoHoldemDealerQualifies(pair2)) fail("pair of 2s no qualify");
  const high = seven([0, 14], [30, 44, 9, 20, 24]);
  if (casinoHoldemDealerQualifies(high)) fail("high no qualify");
  pass("dealer qualify");

  if (bestHand(pair4).category < 1) fail("7-card eval");
  pass("7-card eval");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(casinoHoldemGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "casino-holdem",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: {},
  });
  s = await driver.applyAction(casinoHoldemGame, s, { type: "call" }, s.stake * 2n);
  s = await driver.settleSession(casinoHoldemGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: casinoHoldemGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "casino-holdem",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("driver open · call · settle · verify");

  console.log("\nAll casino hold'em smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
