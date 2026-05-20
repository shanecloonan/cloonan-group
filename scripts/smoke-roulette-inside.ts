/**
 * Smoke: roulette inside bets (split, street, corner, six_line) validate and settle.
 */
import {
  CHAIN_ADAPTERS,
  HmacRngStream,
  hashServerSeed,
  placementFor,
  rouletteGame,
  sixLineKey,
  splitKey,
  streetKey,
  cornerKey,
  type Bet,
} from "../lib/casino";

const serverSeed = "ab".repeat(32);
const pair = {
  id: "smoke",
  userId: "smoke-user",
  serverSeed,
  serverSeedHash: hashServerSeed(serverSeed),
  clientSeed: "roulette-inside",
  nonce: 1,
  status: "active" as const,
  createdAt: new Date().toISOString(),
  retiredAt: null,
};

const stake = 1_000_000n;
const placements = [
  placementFor("split", stake, [1, 2]),
  placementFor("street", stake, [1, 2, 3]),
  placementFor("corner", stake, [1, 2, 4, 5]),
  placementFor("six_line", stake, [1, 2, 3, 4, 5, 6]),
];

const bet: Bet = {
  sessionId: "smoke-roulette-inside",
  userId: pair.userId,
  gameId: "roulette",
  chainId: "dev-mock",
  token: CHAIN_ADAPTERS["dev-mock"].supportedTokens[0],
  stake: stake * BigInt(placements.length),
  config: { placements },
};

const rng = new HmacRngStream(pair, 1);
let state = rouletteGame.initialState(bet, rng);
if (!rouletteGame.isTerminal(state)) throw new Error("expected settled state");

const keys = [splitKey(1, 2), streetKey(1, 2, 3), cornerKey(1, 2, 4, 5), sixLineKey(1, 2, 3, 4, 5, 6)];
console.log("OK roulette inside smoke:", {
  pocket: state.pocket,
  placements: state.perPlacement.length,
  keys: keys.length,
  totalPayout: state.totalPayout.toString(),
});
