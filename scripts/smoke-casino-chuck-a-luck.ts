/* ===========================================================================
 *  Smoke: chuck-a-luck matches + driver + verify
 *  Run: npx tsx scripts/smoke-casino-chuck-a-luck.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  chuckALuckGame,
  chuckALuckPayReturn,
  countChuckALuckMatches,
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
  console.log("=== smoke-casino-chuck-a-luck ===\n");

  if (countChuckALuckMatches([1, 1, 2], 1) !== 2) fail("count 2");
  if (chuckALuckPayReturn(3) !== 12) fail("triple return");
  if (chuckALuckPayReturn(0) !== 0) fail("zero");
  pass("match + pay");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(chuckALuckGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "chuck-a-luck",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: { pick: 4 },
  });
  s = await driver.settleSession(chuckALuckGame, s);
  if (!s.result) fail("no result");
  if (s.state.pick !== 4) fail("pick");
  pass("driver open · settle");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: chuckALuckGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "chuck-a-luck",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { pick: 4 },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("verify replay");

  console.log("\nAll chuck-a-luck smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
