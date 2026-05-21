/* ===========================================================================
 *  Smoke: sic bo dice + payouts + driver + verify
 *  Run: npx tsx scripts/smoke-casino-sic-bo.ts
 * ========================================================================= */

import {
  buildDevSessionDriver,
  rollSicBoDice,
  sicBoGame,
  sicBoIsTriple,
  sicBoSum,
  totalReturnForBet,
  verifySession,
  newSessionId,
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
  console.log("=== smoke-casino-sic-bo ===\n");

  const pair = newSeedPair({ userId: "smoke" });
  const rng = new HmacRngStream(pair, 1);
  const dice = rollSicBoDice(rng);
  if (dice.some((d) => d < 1 || d > 6)) fail("dice range");
  const sum = sicBoSum(dice);
  if (sum < 3 || sum > 18) fail("sum range");
  pass("roll three dice");

  const big = totalReturnForBet("big", [4, 5, 6], null);
  if (!big.won || big.payReturnMult !== 2) fail("big 4+5+6");
  const smallLose = totalReturnForBet("small", [4, 5, 6], null);
  if (smallLose.won) fail("small loses on 15");
  const trip = totalReturnForBet("any_triple", [3, 3, 3], null);
  if (!trip.won || trip.payReturnMult !== 31) fail("any triple");
  const t5 = totalReturnForBet("triple", [5, 5, 5], 5);
  if (!t5.won) fail("triple 5");
  const tot10 = totalReturnForBet("total", [3, 3, 4], 10);
  if (!tot10.won || tot10.payReturnMult !== 7) fail("total 10");
  pass("payout rules");

  const { driver, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "smoke",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n,
  });

  let s = await driver.openSession(sicBoGame, {
    sessionId: newSessionId(),
    userId: "smoke",
    gameId: "sic-bo",
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 1_000_000n,
    config: { betType: "odd" },
  });
  s = await driver.settleSession(sicBoGame, s);
  if (!s.result) fail("no result");

  const seed = getSeedPair().serverSeed;
  if (!seed) fail("no seed");
  const v = verifySession({
    game: sicBoGame,
    serverSeed: seed,
    serverSeedHash: getSeedPair().serverSeedHash,
    clientSeed: getSeedPair().clientSeed,
    startNonce: s.startNonce,
    bet: {
      sessionId: s.id,
      userId: s.userId,
      gameId: "sic-bo",
      chainId: s.chainId,
      token: s.token,
      stake: s.stake,
      config: { betType: s.state.betType, betValue: s.state.betValue },
    },
    actions: [],
  });
  if (!v.hashOk || !v.finalStateMatches) fail("verify");
  const rs = v.replayedState as typeof s.state;
  if (rs.sum !== s.state.sum || rs.won !== s.state.won) fail("replay mismatch");
  if (sicBoIsTriple(rs.dice) !== rs.isTriple) fail("triple flag");
  pass("driver open · settle · verify");

  console.log("\nAll sic bo smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
