/* ===========================================================================
 *  Smoke: let it ride pay table + driver + verify
 *  Run: npx tsx scripts/smoke-casino-let-it-ride.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  cardFromIndex,
  letItRideGame,
  letItRidePayReturn,
  letItRideQualifies,
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
  console.log("=== smoke-casino-let-it-ride ===\n");

  const tens = five([8, 21, 39, 28, 17]);
  const scoreTens = bestHand(tens);
  if (!letItRideQualifies(scoreTens)) fail("pair of 10s qualifies");
  if (letItRidePayReturn(scoreTens) !== 2) fail("pair pays 1:1");
  const low = five([0, 14, 30, 44, 20]);
  if (letItRideQualifies(bestHand(low))) fail("high no qualify");
  pass("pay table");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  const unit = 1_000_000n;
  let s = await driver.openSession(letItRideGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "let-it-ride",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: unit * 3n,
    config: {},
  });
  s = await driver.applyAction(letItRideGame, s, { type: "pull_bet1" });
  s = await driver.applyAction(letItRideGame, s, { type: "ride_bet2" });
  s = await driver.settleSession(letItRideGame, s);
  if (!s.result) fail("no result");
  if (s.result.totalStakedUnits !== unit * 3n) fail("staked lock");
  if (s.state.bet1Active) fail("bet1 pulled");
  if (!s.state.bet2Active || !s.state.bet3Active) fail("bets 2/3 ride");
  pass("driver pull · ride · settle");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: letItRideGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "let-it-ride",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { numDecks: s.state.config.numDecks },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("verify replay");

  console.log("\nAll let it ride smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
