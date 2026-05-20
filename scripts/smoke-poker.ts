/**
 * Smoke: Texas Hold'em engine — deal, bot actions, showdown.
 * Run: npx tsx scripts/smoke-poker.ts
 */
import {
  DEV_TOKEN,
  HmacRngStream,
  hashServerSeed,
  pokerGame,
  pickBotAction,
  type Bet,
  type PokerAction,
} from "../lib/casino";

const serverSeed = "ab".repeat(32);
const pair = {
  id: "smoke",
  userId: "smoke-user",
  serverSeed,
  serverSeedHash: hashServerSeed(serverSeed),
  clientSeed: "smoke",
  nonce: 0,
  status: "active" as const,
  createdAt: new Date().toISOString(),
  retiredAt: null,
};

const bet: Bet = {
  sessionId: "smoke-poker",
  userId: "smoke-user",
  gameId: "poker",
  chainId: "dev-mock",
  token: DEV_TOKEN,
  stake: 1000n * 10n ** 6n,
  config: { bigBlind: 20n * 10n ** 6n },
};

let nonce = 1;
let state = pokerGame.initialState(bet, new HmacRngStream(pair, nonce++));

let steps = 0;
while (!pokerGame.isTerminal(state) && steps < 200) {
  const seat = state.activeSeat;
  if (seat === null) {
    const rng = new HmacRngStream(pair, nonce++);
    state = pokerGame.step(state, { type: "advance_street" }, rng);
    steps++;
    continue;
  }
  const action: PokerAction =
    seat === 0
      ? state.currentBet === state.players[0].betThisRound
        ? { type: "check" }
        : { type: "call" }
      : pickBotAction(state);
  const rng = new HmacRngStream(pair, nonce++);
  state = pokerGame.step(state, action, rng);
  steps++;
}

if (!pokerGame.isTerminal(state)) {
  console.error("FAIL: hand did not complete", state.phase, state.activeSeat);
  process.exit(1);
}

const result = pokerGame.settle(state, bet);
console.log("OK poker smoke:", {
  steps,
  phase: state.phase,
  pnl: result.pnlUnits.toString(),
  winners: state.winners,
});
