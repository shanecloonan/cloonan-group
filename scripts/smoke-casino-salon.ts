/* ===========================================================================
 *  Smoke: shared salon coup resolution (roulette, baccarat, sic bo)
 *  Run: npx tsx scripts/smoke-casino-salon.ts
 *
 *  The SQL in infra/supabase/migrations/2026-10-07-casino-salon-tables.sql
 *  must stay in lockstep with lib/casino/salon-games.ts. This script checks
 *  the TypeScript mirror.
 * ========================================================================= */

import { hashServerSeed } from "../lib/casino/rng";
import {
  DERBY_RETURN_TENTHS,
  DERBY_TICKS,
  DERBY_WEIGHTS,
  nerveBustCents,
  oddOneChecksOut,
  resolveSalonRound,
  salonBankerDraws,
  salonBetAllowed,
  salonCoupChecksOut,
  salonNextInt,
  salonPip,
  salonU32,
  type SalonBaccaratResult,
  type SalonBet,
  type SalonDerbyResult,
  type SalonNerveResult,
  type SalonOddOneResult,
  type SalonRouletteResult,
  type SalonSicBoResult,
} from "../lib/casino/salon-games";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

const seed = "ab".repeat(32);
const client = "SALON1";

const first = salonNextInt(seed, client, 0, 0, 37);
const again = salonNextInt(seed, client, 0, 0, 37);
if (first.value !== again.value || first.cursor !== 1) fail("draw is not deterministic");
if (first.value < 0 || first.value > 36) fail("pocket out of range");
pass("roulette draw is deterministic and in 0..36");

let sawZero = false;
let sawRed = false;
let sawDozen = false;
for (let nonce = 0; nonce < 400; nonce++) {
  const pocket = salonNextInt(seed, client, nonce, 0, 37).value;
  if (pocket < 0 || pocket > 36) fail("pocket escaped 0..36");
  const bets: SalonBet[] = [
    { playerId: "a", kind: "red", stake: 10, n: null },
    { playerId: "a", kind: "straight", stake: 5, n: pocket },
    { playerId: "b", kind: "even", stake: 8, n: null },
    { playerId: "b", kind: "dozen1", stake: 4, n: null },
  ];
  const coup = resolveSalonRound(seed, client, nonce, "roulette", bets);
  const result = coup.result as SalonRouletteResult;
  if (result.pocket !== pocket) fail("resolve pocket drifted");
  for (const p of coup.payouts) if (p.payout < 0) fail("negative payout");
  const red = coup.payouts[0].payout;
  const straight = coup.payouts[1].payout;
  const even = coup.payouts[2].payout;
  const dozen = coup.payouts[3].payout;
  if (straight !== 5 * 36) fail("straight did not pay 36x");
  if (pocket === 0) {
    sawZero = true;
    if (red !== 0 || even !== 0 || dozen !== 0) fail("zero paid an outside bet");
  }
  if (result.color === "red") {
    sawRed = true;
    if (red !== 20) fail("red did not pay 2x");
  } else if (red !== 0) fail("red paid on a non-red pocket");
  if (pocket >= 1 && pocket <= 12) {
    sawDozen = true;
    if (dozen !== 12) fail("dozen did not pay 3x");
  } else if (dozen !== 0) fail("dozen paid outside 1-12");
  if (pocket !== 0 && pocket % 2 === 0 && even !== 16) fail("even money missed");
  if ((pocket === 0 || pocket % 2 === 1) && even !== 0) fail("even paid on odd or zero");
}
if (!sawZero || !sawRed || !sawDozen) fail("sample missed a zero, a red, or a first dozen");
pass("roulette outside bets lose on zero and pay the published multiples");

let sawTriple = false;
let sawBig = false;
for (let nonce = 0; nonce < 400; nonce++) {
  const bets: SalonBet[] = [
    { playerId: "a", kind: "big", stake: 10, n: null },
    { playerId: "a", kind: "any_triple", stake: 2, n: null },
    { playerId: "b", kind: "small", stake: 7, n: null },
  ];
  const coup = resolveSalonRound(seed, client, nonce, "sicbo", bets);
  const result = coup.result as SalonSicBoResult;
  if (result.dice.some((d) => d < 1 || d > 6)) fail("die escaped 1..6");
  if (result.sum !== result.dice[0] + result.dice[1] + result.dice[2]) fail("sum drifted");
  const big = coup.payouts[0].payout;
  const triple = coup.payouts[1].payout;
  const small = coup.payouts[2].payout;
  if (result.triple) {
    sawTriple = true;
    if (big !== 0 || small !== 0) fail("triple paid big or small");
    if (triple !== 62) fail("any triple did not pay 31x");
  } else {
    if (triple !== 0) fail("any triple paid on a non-triple");
    if (result.sum >= 11 && result.sum <= 17) {
      sawBig = true;
      if (big !== 20 || small !== 0) fail("big settlement drifted");
    } else if (result.sum >= 4 && result.sum <= 10) {
      if (small !== 14 || big !== 0) fail("small settlement drifted");
    }
  }
}
if (!sawTriple || !sawBig) fail("sample missed a triple or a big");
pass("sic bo triples void even-money and any triple pays 31x");

let sawNatural = false;
let sawThird = false;
let sawBanker = false;
let sawTie = false;
for (let nonce = 0; nonce < 300; nonce++) {
  const bets: SalonBet[] = [
    { playerId: "a", kind: "player", stake: 100, n: null },
    { playerId: "a", kind: "banker", stake: 100, n: null },
    { playerId: "b", kind: "banker", stake: 3, n: null },
    { playerId: "b", kind: "tie", stake: 5, n: null },
  ];
  const coup = resolveSalonRound(seed, client, nonce, "baccarat", bets);
  const result = coup.result as SalonBaccaratResult;
  if (result.playerTotal < 0 || result.playerTotal > 9 || result.bankerTotal < 0 || result.bankerTotal > 9) {
    fail("baccarat total escaped 0..9");
  }
  const cards = [...result.player, ...result.banker];
  if (cards.some((c) => c < 0 || c > 51)) fail("card index escaped 0..51");
  if (result.player.length < 2 || result.player.length > 3 || result.banker.length < 2 || result.banker.length > 3) {
    fail("hand length drifted");
  }
  const twoPlayer = (salonPip(result.player[0]) + salonPip(result.player[1])) % 10;
  const twoBanker = (salonPip(result.banker[0]) + salonPip(result.banker[1])) % 10;
  if (result.natural !== (twoPlayer >= 8 || twoBanker >= 8)) fail("natural flag drifted");
  if (result.natural && (result.player.length !== 2 || result.banker.length !== 2)) fail("natural drew a third");
  if (!result.natural && twoPlayer <= 5 && result.player.length !== 3) fail("player stood on 0-5");
  if (!result.natural && twoPlayer >= 6 && result.player.length !== 2) fail("player drew on 6 or 7");
  const third = result.player.length === 3 ? salonPip(result.player[2]) : null;
  const bankerShould = !result.natural && salonBankerDraws(twoBanker, third);
  if (bankerShould !== (result.banker.length === 3)) fail("banker tableau drifted");
  if (result.natural) sawNatural = true;
  if (result.player.length === 3 || result.banker.length === 3) sawThird = true;
  const playerPay = coup.payouts[0].payout;
  const bankerPay = coup.payouts[1].payout;
  const bankerOdd = coup.payouts[2].payout;
  const tiePay = coup.payouts[3].payout;
  if (result.winner === "player") {
    if (playerPay !== 200 || bankerPay !== 0 || tiePay !== 0) fail("player win settlement");
  } else if (result.winner === "banker") {
    sawBanker = true;
    if (playerPay !== 0 || bankerPay !== 195 || bankerOdd !== 5 || tiePay !== 0) fail("banker commission drifted");
  } else {
    sawTie = true;
    if (playerPay !== 100 || bankerPay !== 100 || tiePay !== 45) fail("tie push or 8:1 drifted");
  }
}
if (!sawNatural || !sawThird || !sawBanker || !sawTie) fail("sample missed a natural, a third card, a banker win, or a tie");
pass("baccarat tableau, commission, and tie pushes match the single-player rules");

if (salonBetAllowed("roulette", "straight", 36) !== true) fail("straight 36");
if (salonBetAllowed("roulette", "straight", 37) !== false) fail("straight 37");
if (salonBetAllowed("roulette", "column_1", null) !== false) fail("column leaked into the salon");
if (salonBetAllowed("sicbo", "big", 1) !== false) fail("sic bo n");
pass("salon spots are the published set");

const sampleBets: SalonBet[] = [{ playerId: "a", kind: "red", stake: 10, n: null }];
const published = resolveSalonRound(seed, client, 3, "roulette", sampleBets);
const committed = hashServerSeed(seed);
if (
  salonCoupChecksOut({
    revealedSeed: seed,
    committedHash: committed,
    clientSeed: client,
    nonce: 3,
    game: "roulette",
    result: published.result,
    payouts: published.payouts,
  }) !== true
) {
  fail("replay rejected a genuine coup");
}
if (
  salonCoupChecksOut({
    revealedSeed: seed,
    committedHash: "00".repeat(32),
    clientSeed: client,
    nonce: 3,
    game: "roulette",
    result: published.result,
    payouts: published.payouts,
  }) !== false
) {
  fail("replay accepted a bad commitment");
}
pass("revealed seed replays only against its commitment");

/* ---- The Derby ---- */
const wins = [0, 0, 0, 0, 0, 0];
const derbyRounds = 6000;
for (let nonce = 0; nonce < derbyRounds; nonce++) {
  const bets: SalonBet[] = [1, 2, 3, 4, 5, 6].map((h) => ({ playerId: `p${h}`, kind: "win", stake: 10, n: h }));
  const coup = resolveSalonRound(seed, client, nonce, "derby", bets);
  const r = coup.result as SalonDerbyResult;
  if (r.winner < 1 || r.winner > 6) fail("derby winner out of range");
  if (r.ticks.length !== DERBY_TICKS || r.ticks.some((row) => row.length !== 6)) fail("derby tick grid drifted");
  const totals = [0, 0, 0, 0, 0, 0];
  for (const row of r.ticks) for (let h = 0; h < 6; h++) totals[h] += row[h];
  if (totals.some((t, h) => t !== r.totals[h])) fail("derby totals do not sum the ticks");
  const lead = totals[r.winner - 1];
  if (totals.some((t, h) => h !== r.winner - 1 && t >= lead)) fail("derby winner did not finish strictly first");
  for (let t = 0; t < DERBY_TICKS - 1; t++) for (const s of r.ticks[t]) if (s < 1 || s > 3) fail("derby step outside 1..3");
  wins[r.winner - 1] += 1;
  for (const p of coup.payouts) {
    const expect = p.n === r.winner ? Math.floor((10 * DERBY_RETURN_TENTHS[r.winner - 1]) / 10) : 0;
    if (p.payout !== expect) fail("derby payout drifted");
  }
}
for (let h = 0; h < 6; h++) {
  const share = wins[h] / derbyRounds;
  const expect = DERBY_WEIGHTS[h] / 1000;
  if (Math.abs(share - expect) > 0.03) fail(`derby horse ${h + 1} won ${(share * 100).toFixed(1)}%, line says ${expect * 100}%`);
}
const derbyRtps = DERBY_WEIGHTS.map((w, h) => (w / 1000) * (DERBY_RETURN_TENTHS[h] / 10));
for (const [h, rtp] of derbyRtps.entries()) {
  if (rtp < 0.95 || rtp > 0.98) fail(`derby horse ${h + 1} returns ${rtp}`);
}
pass(`derby form holds over ${derbyRounds} races, every horse returns ${Math.min(...derbyRtps).toFixed(3)}–${Math.max(...derbyRtps).toFixed(3)}`);

/* ---- Nerve ---- */
let over2 = 0;
const nerveRounds = 20000;
for (let nonce = 0; nonce < nerveRounds; nonce++) {
  const bust = nerveBustCents(salonU32(seed, client, nonce, 0));
  if (bust < 100) fail("bust below 1.00x");
  if (bust >= 200) over2 += 1;
}
const pOver2 = over2 / nerveRounds;
if (Math.abs(pOver2 - 0.495) > 0.015) fail(`P(bust >= 2x) = ${pOver2}, expected ≈ 0.495`);
if (nerveBustCents(0) !== 100) fail("u = 0 should bust at the floor");
if (nerveBustCents(4294967295) <= 100000) fail("u = max should bust very high");
{
  const bets: SalonBet[] = [
    { playerId: "a", kind: "nerve", stake: 100, n: 150 },
    { playerId: "b", kind: "nerve", stake: 100, n: 5000 },
  ];
  const coup = resolveSalonRound(seed, client, 7, "nerve", bets);
  const r = coup.result as SalonNerveResult;
  const a = coup.payouts[0];
  const b = coup.payouts[1];
  if (a.payout !== (r.bust >= 150 ? 150 : 0)) fail("nerve payout for 1.50x drifted");
  if (b.payout !== (r.bust >= 5000 ? 5000 : 0)) fail("nerve payout for 50x drifted");
  if (
    salonCoupChecksOut({
      revealedSeed: seed,
      committedHash: committed,
      clientSeed: client,
      nonce: 7,
      game: "nerve",
      result: r,
      payouts: coup.payouts,
    }) !== true
  ) {
    fail("nerve replay rejected its own coup");
  }
}
pass(`nerve bust follows the 99% curve (P(>=2x) = ${pOver2.toFixed(3)}) and replays`);

/* ---- Odd One Out ---- */
{
  const bets: SalonBet[] = [
    { playerId: "a", kind: "pick", stake: 20, n: 1 },
    { playerId: "b", kind: "pick", stake: 20, n: 1 },
    { playerId: "c", kind: "pick", stake: 20, n: 3 },
    { playerId: "d", kind: "pick", stake: 20, n: 2 },
  ];
  const coup = resolveSalonRound("00", "", 0, "oddone", bets, { carryIn: 40 });
  const r = coup.result as SalonOddOneResult;
  if (r.number !== 2 || r.winner !== "d") fail("lowest unique should be 2 by d");
  if (r.pot !== 120 || r.carry !== 0) fail("odd one pot drifted");
  if (coup.payouts.find((p) => p.playerId === "d")?.payout !== 120) fail("odd one winner should take the pot");
  if (!oddOneChecksOut(r, coup.payouts)) fail("odd one replay rejected its own result");
  const clash = resolveSalonRound("00", "", 0, "oddone", [
    { playerId: "a", kind: "pick", stake: 10, n: 4 },
    { playerId: "b", kind: "pick", stake: 10, n: 4 },
  ]);
  const cr = clash.result as SalonOddOneResult;
  if (cr.winner !== null || cr.carry !== 20) fail("a full clash should carry the pot");
  if (clash.payouts.some((p) => p.payout !== 0)) fail("nobody should be paid on a clash");
}
pass("odd one out pays the lowest unique number and carries on a clash");

if (!salonBetAllowed("derby", "win", 6) || salonBetAllowed("derby", "win", 7)) fail("derby spots");
if (!salonBetAllowed("nerve", "nerve", 110) || salonBetAllowed("nerve", "nerve", 5001)) fail("nerve range");
if (!salonBetAllowed("oddone", "pick", 10) || salonBetAllowed("oddone", "pick", 0)) fail("odd one range");
if (!salonBetAllowed("ticker", "up", null) || salonBetAllowed("ticker", "up", 1)) fail("ticker spots");
pass("arcade spots are the published set");

const pinned = salonNextInt("11".repeat(32), "ROOM01", 0, 0, 37);
if (pinned.value !== 32 || pinned.cursor !== 1) fail(`pinned draw drifted (${pinned.value})`);
pass("pinned draw matches the SQL comment (ROOM01 nonce 0 cursor 0 → 32)");
