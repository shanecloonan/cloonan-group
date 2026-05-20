/**
 * Fast slots RTP — direct game engine (no session driver).
 * Run: npx tsx scripts/smoke-slots-rtp-direct.ts [spins]
 */
import { slotsGame, DEV_TOKEN, HmacRngStream, newSeedPair } from "../lib/casino";

const N = Number(process.argv[2] ?? 20_000);
const bet = {
  sessionId: "rtp",
  userId: "u",
  gameId: "slots" as const,
  chainId: "dev-mock" as const,
  token: DEV_TOKEN,
  stake: 20_000_000n,
};

const pair = newSeedPair({ userId: "rtp" });
let wagered = 0n;
let payout = 0n;
const t0 = Date.now();

for (let n = 1; n <= N; n++) {
  const rng = new HmacRngStream(pair, n);
  const st = slotsGame.initialState(bet, rng);
  const res = slotsGame.settle(st, bet);
  wagered += bet.stake;
  payout += res.totalPayoutUnits;
}

const rtp = (Number(payout) / Number(wagered)) * 100;
console.log(`${N.toLocaleString()} spins · RTP ${rtp.toFixed(2)}% · ${Date.now() - t0} ms`);
