/* ===========================================================================
 *  Smoke: video poker (Jacks or Better)
 *  Run: npx tsx scripts/smoke-casino-video-poker.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  payMultiplierForHand,
  bestHand,
  newSessionId,
  videoPokerGame,
  verifySession,
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
  console.log("=== smoke-casino-video-poker ===\n");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });
  const pair = getSeedPair();
  const hold: [boolean, boolean, boolean, boolean, boolean] = [
    false,
    false,
    false,
    false,
    false,
  ];

  let s = await driver.openSession(videoPokerGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "video-poker",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: {},
  });
  if (s.state.phase !== "holding") fail("holding phase");
  s = await driver.applyAction(videoPokerGame, s, { type: "draw", hold });
  s = await driver.settleSession(videoPokerGame, s);
  if (!s.result) fail("no result");

  const revealed = pair.serverSeed;
  if (!revealed) fail("need server seed on dev pair");
  const v = verifySession({
    game: videoPokerGame,
    serverSeed: revealed,
    serverSeedHash: pair.serverSeedHash,
    clientSeed: pair.clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "video-poker",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: 1 },
    },
    actions: s.actions.map((a) => ({
      ordinal: a.ordinal,
      action: a.action,
      actor: a.actor,
    })),
    expectedStateHashes: s.actions.map((a) => a.stateHash ?? ""),
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify replay");
  pass("driver deal · draw · settle · verify");

  const jacksHand = bestHand([
    cardFromIndex(9),
    cardFromIndex(22),
    cardFromIndex(0),
    cardFromIndex(1),
    cardFromIndex(2),
  ]);
  if (payMultiplierForHand(jacksHand) !== 2) fail("jacks pair should pay 2×");

  const high = bestHand([
    cardFromIndex(0),
    cardFromIndex(14),
    cardFromIndex(28),
    cardFromIndex(42),
    cardFromIndex(7),
  ]);
  if (payMultiplierForHand(high) !== 0) fail("high card should pay 0");

  pass("pay table spot checks");

  console.log("\nAll video poker smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
