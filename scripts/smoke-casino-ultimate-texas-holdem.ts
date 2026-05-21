/* ===========================================================================
 *  Smoke: ultimate texas hold'em + driver + verify
 *  Run: npx tsx scripts/smoke-casino-ultimate-texas-holdem.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  ultimateTexasHoldemGame,
  ultimateHoldemDealerQualifies,
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
  console.log("=== smoke-casino-ultimate-texas-holdem ===\n");

  const pair = seven([0, 13], [2, 16, 29, 42, 20]);
  if (!ultimateHoldemDealerQualifies(pair)) fail("pair qualifies");
  const high = seven([0, 14], [30, 44, 9, 20, 24]);
  if (ultimateHoldemDealerQualifies(high)) fail("high no qualify");
  pass("dealer qualify");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  const ante = 1_000_000n;
  let s = await driver.openSession(ultimateTexasHoldemGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "ultimate-texas-holdem",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: ante,
    config: {},
  });
  s = await driver.applyAction(ultimateTexasHoldemGame, s, { type: "check" });
  s = await driver.applyAction(ultimateTexasHoldemGame, s, { type: "check" });
  s = await driver.applyAction(ultimateTexasHoldemGame, s, { type: "check" });
  s = await driver.applyAction(ultimateTexasHoldemGame, s, { type: "bet_1x" }, ante);
  s = await driver.settleSession(ultimateTexasHoldemGame, s);
  if (!s.result) fail("no result");
  if (s.state.playStake !== ante) fail("play 1x");
  pass("driver check chain · bet · settle");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: ultimateTexasHoldemGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "ultimate-texas-holdem",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("verify replay");

  console.log("\nAll ultimate texas hold'em smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
