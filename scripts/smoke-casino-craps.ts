/* ===========================================================================
 *  Smoke: craps pass line + driver + verify
 *  Run: npx tsx scripts/smoke-casino-craps.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  crapsGame,
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
  console.log("=== smoke-casino-craps ===\n");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(crapsGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "craps",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: { betType: "pass" },
  });
  s = await driver.settleSession(crapsGame, s);
  if (!s.result) fail("no result");
  if (s.state.rolls.length < 1) fail("rolls");
  pass("pass line round");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: crapsGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "craps",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { betType: "pass" },
    },
    actions: s.actions,
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("driver · settle · verify");

  console.log("\nAll craps smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
