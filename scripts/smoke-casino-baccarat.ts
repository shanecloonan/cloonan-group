/* ===========================================================================
 *  Smoke: baccarat tableau + payouts + verify replay
 *  Run: npx tsx scripts/smoke-casino-baccarat.ts
 * ========================================================================= */

import {
  baccaratCardValue,
  baccaratGame,
  handTotal,
  verifySession,
  newSeedPair,
  HmacRngStream,
  type BaccaratSpot,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

(async () => {
  console.log("=== smoke-casino-baccarat ===\n");

  if (baccaratCardValue("A") !== 1) fail("A=1");
  if (baccaratCardValue("K") !== 0) fail("K=0");
  if (baccaratCardValue("5") !== 5) fail("5=5");
  pass("card values");

  const spots: BaccaratSpot[] = ["player", "banker", "tie"];
  for (const spot of spots) {
    const pair = newSeedPair({ userId: "smoke-user" });
    const rng = new HmacRngStream(pair, 1);
    const bet = {
      sessionId: "smoke-bac-1",
      userId: "smoke-user",
      gameId: "baccarat" as const,
      chainId: "dev-mock" as const,
      token: { symbol: "DEV", display: "DEV", decimals: 6, address: "0x0", isNative: false },
      stake: 100_000_000n,
      config: { betSpot: spot, numDecks: 8 },
    };
    const state = baccaratGame.initialState(bet, rng);
    if (!baccaratGame.isTerminal(state)) fail("not terminal");
    if (state.playerCards.length < 2 || state.bankerCards.length < 2) fail("need 2+ cards");
    if (state.playerTotal !== handTotal(state.playerCards)) fail("player total");
    if (state.bankerTotal !== handTotal(state.bankerCards)) fail("banker total");

    const result = baccaratGame.settle(state, bet);
    if (result.totalStakedUnits !== bet.stake) fail("stake mismatch");
    if (result.totalPayoutUnits < 0n || result.totalPayoutUnits > bet.stake * 9n) {
      fail(`payout out of range: ${result.totalPayoutUnits}`);
    }
    if (result.pnlUnits !== result.totalPayoutUnits - bet.stake) fail("pnl math");

    const revealed = pair.serverSeed!;
    const v = verifySession({
      game: baccaratGame,
      serverSeed: revealed,
      serverSeedHash: pair.serverSeedHash,
      clientSeed: pair.clientSeed,
      startNonce: 1,
      bet,
      actions: [],
    });
    if (!v.hashOk || !v.finalStateMatches) fail(`verify replay ${spot}`);
    if (v.replayedState.winner !== state.winner) fail("winner mismatch on replay");
  }
  pass("open/settle/verify for player, banker, tie");

  console.log("\nAll baccarat smoke tests passed ✓\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
