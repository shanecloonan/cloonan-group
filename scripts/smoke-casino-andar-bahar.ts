/* ===========================================================================
 *  Smoke: andar bahar deal + driver + verify
 *  Run: npx tsx scripts/smoke-casino-andar-bahar.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  buildShoe,
  cardFromIndex,
  dealAndarBahar,
  andarBaharGame,
  ranksMatch,
  verifySession,
  newSessionId,
  DEV_TOKEN,
  type RngStream,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

(async () => {
  console.log("=== smoke-casino-andar-bahar ===\n");

  if (!ranksMatch("Q", "Q")) fail("rank match");
  const shoe = buildShoe(1);
  const joker = cardFromIndex(10);
  const noopRng = { nextInt: (n: number) => 0, nextByte: () => 0 } as RngStream;
  const dealt = dealAndarBahar(shoe, noopRng, joker);
  if (dealt.baharCards.length < 1) fail("bahar gets first card");
  if (!ranksMatch(dealt.winningCard.rank, joker.rank)) fail("winning rank");
  pass("deal until match");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(andarBaharGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "andar-bahar",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: { betSide: "bahar" },
  });
  s = await driver.settleSession(andarBaharGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: andarBaharGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "andar-bahar",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { betSide: s.state.betSide },
    },
    actions: [],
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  pass("driver open · settle · verify");

  console.log("\nAll andar bahar smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
