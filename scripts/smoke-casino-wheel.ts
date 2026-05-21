/* ===========================================================================
 *  Smoke: money wheel segments + driver + verify
 *  Run: npx tsx scripts/smoke-casino-wheel.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  segmentCountForMult,
  verifySession,
  wheelGame,
  WHEEL_BET_OPTIONS,
  WHEEL_SEGMENT_COUNT,
  WHEEL_SEGMENT_MULTS,
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
  console.log("=== smoke-casino-wheel ===\n");

  if (WHEEL_SEGMENT_MULTS.length !== WHEEL_SEGMENT_COUNT) fail("segment length");
  if (segmentCountForMult(1) !== 24) fail("1x count");
  if (segmentCountForMult(2) !== 15) fail("2x count");
  if (segmentCountForMult(40) !== 2) fail("40x count");
  pass("54-segment layout");

  for (const m of WHEEL_BET_OPTIONS) {
    if (segmentCountForMult(m) < 1) fail(`no segments for ${m}`);
  }
  pass("bet options covered");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(wheelGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "wheel",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: { betOn: 5 },
  });
  s = await driver.settleSession(wheelGame, s);
  if (!s.result) fail("no result");
  if (s.state.segmentIndex < 0 || s.state.segmentIndex >= WHEEL_SEGMENT_COUNT) fail("index range");
  if (WHEEL_SEGMENT_MULTS[s.state.segmentIndex] !== s.state.landedMult) fail("index mult");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: wheelGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "wheel",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { betOn: s.state.betOn },
    },
    actions: [],
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  const rs = v.replayedState as typeof s.state;
  if (rs.segmentIndex !== s.state.segmentIndex || rs.landedMult !== s.state.landedMult) fail("replay mismatch");
  pass("driver open · settle · verify");

  console.log("\nAll wheel smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
