/* ===========================================================================
 *  Smoke: keno draw + pay table + verify
 *  Run: npx tsx scripts/smoke-casino-keno.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  countHits,
  drawKenoNumbers,
  kenoGame,
  newSessionId,
  payMultiplierForHits,
  verifySession,
  DEV_TOKEN,
  HmacRngStream,
  newSeedPair,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

(async () => {
  console.log("=== smoke-casino-keno ===\n");

  const pair = newSeedPair({ userId: "smoke" });
  const rng = new HmacRngStream(pair, 1);
  const drawn = drawKenoNumbers(rng);
  if (drawn.length !== 20) fail("draw count");
  if (new Set(drawn).size !== 20) fail("draw unique");
  if (drawn.some((n) => n < 1 || n > 80)) fail("draw range");
  pass("draw 20 unique from 80");

  const picks = [1, 2, 3, 4, 5];
  const hits = countHits(picks, drawn);
  if (hits > 5) fail("hits cap");
  pass("count hits");

  if (payMultiplierForHits(1, 1) !== 3) fail("1 pick 1 hit pay");
  if (payMultiplierForHits(10, 10) !== 10000) fail("10 pick jackpot");
  pass("pay table");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(kenoGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "keno",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: { picks: [7, 14, 21, 28, 35] },
  });
  s = await driver.settleSession(kenoGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: kenoGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "keno",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { picks: s.state.picks },
    },
    actions: [],
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  const rs = v.replayedState as typeof s.state;
  if (rs.hits !== s.state.hits || rs.payMultiplier !== s.state.payMultiplier) fail("replay mismatch");
  pass("driver open · settle · verify");

  console.log("\nAll keno smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
