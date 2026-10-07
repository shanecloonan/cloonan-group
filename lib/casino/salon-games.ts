/**
 * Salon table coup resolution.
 *
 * Keep this file in lockstep with
 * infra/supabase/migrations/2026-10-07-casino-salon-tables.sql.
 * The database function is the runtime authority. This module replays a
 * revealed seed and covers the smoke test.
 *
 * One HMAC-SHA256 per integer. Message is `${clientSeed}:${nonce}:${cursor}`.
 * The first four bytes are a big-endian uint32. Rejection sampling uses
 * lim = floor(2^32 / span) * span. This is independent of HmacRngStream.
 *
 * Baccarat draws with replacement from a 52-card shoe (infinite shoe),
 * alternating Player, Banker, Player, Banker, then thirds. Card index
 * matches deck.ts: suit * 13 + rank, rank 0 = 2 … 12 = Ace.
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { RED_POCKETS, pocketColor } from "./roulette";
import { hashServerSeed, hexToBytes } from "./rng";

export type SalonGame = "roulette" | "baccarat" | "sicbo" | "derby" | "nerve" | "oddone" | "ticker";

export const SALON_GAMES: SalonGame[] = ["roulette", "baccarat", "sicbo", "derby", "nerve", "oddone", "ticker"];

/** Games whose result is drawn from the committed seed and can be replayed. */
export const SEEDED_SALON_GAMES: SalonGame[] = ["roulette", "baccarat", "sicbo", "derby", "nerve"];

/** Games where a player's choice is sealed until the reveal. */
export const SEALED_SALON_GAMES: SalonGame[] = ["nerve", "oddone"];

export const DERBY_WEIGHTS = [300, 230, 180, 130, 95, 65];
export const DERBY_RETURN_TENTHS = [32, 42, 54, 75, 102, 149];
export const DERBY_TICKS = 12;
export const NERVE_MIN_TARGET = 110;
export const NERVE_MAX_TARGET = 5000;

export type SalonBet = {
  playerId: string;
  kind: string;
  stake: number;
  n?: number | null;
};

export type SalonPayout = {
  playerId: string;
  kind: string;
  stake: number;
  payout: number;
  n: number | null;
};

export type SalonRouletteResult = { pocket: number; color: "red" | "black" | "green" };
export type SalonBaccaratResult = {
  player: number[];
  banker: number[];
  playerTotal: number;
  bankerTotal: number;
  winner: "player" | "banker" | "tie";
  natural: boolean;
};
export type SalonSicBoResult = { dice: [number, number, number]; sum: number; triple: boolean };
export type SalonDerbyResult = { winner: number; ticks: number[][]; totals: number[] };
export type SalonNerveResult = {
  bust: number;
  commits: { playerId: string; target: number | null; stake: number }[];
};
export type SalonOddOneResult = {
  picks: { playerId: string; n: number | null; stake: number }[];
  winner: string | null;
  number: number | null;
  pot: number;
  carry: number;
};
export type SalonTickerResult = {
  open: string;
  close: string;
  lockedAt: string;
  settledAt: string;
  direction: "up" | "down" | "flat";
};

export type SalonResult =
  | SalonRouletteResult
  | SalonBaccaratResult
  | SalonSicBoResult
  | SalonDerbyResult
  | SalonNerveResult
  | SalonOddOneResult
  | SalonTickerResult;

const UINT32 = 4294967296;

function u32(seedHex: string, clientSeed: string, nonce: number, cursor: number): number {
  const block = hmac(sha256, hexToBytes(seedHex), new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor}`));
  return ((block[0] * 16777216) + (block[1] * 65536) + (block[2] * 256) + block[3]) >>> 0;
}

/** Raw uint32 at a cursor. Nerve reads one of these. */
export function salonU32(seedHex: string, clientSeed: string, nonce: number, cursor: number): number {
  return u32(seedHex, clientSeed, nonce, cursor);
}

/** Crash-style bust in cents from a uint32. 99% return, floor 1.00x. */
export function nerveBustCents(u: number): number {
  return Math.max(100, Math.floor((99 * UINT32) / (UINT32 - u)));
}

export function salonNextInt(
  seedHex: string,
  clientSeed: string,
  nonce: number,
  cursor: number,
  span: number,
): { value: number; cursor: number } {
  if (!Number.isInteger(span) || span < 1) throw new Error("salonNextInt: bad span");
  const lim = Math.floor(UINT32 / span) * span;
  let c = cursor;
  for (let i = 0; i < 64; i++) {
    const u = u32(seedHex, clientSeed, nonce, c);
    c += 1;
    if (u < lim) return { value: u % span, cursor: c };
  }
  const u = u32(seedHex, clientSeed, nonce, c);
  return { value: u % span, cursor: c + 1 };
}

/** Baccarat pip from a canonical card index. Rank 12 (Ace) = 1, tens and faces = 0. */
export function salonPip(index: number): number {
  const rank = index % 13;
  if (rank === 12) return 1;
  if (rank >= 8) return 0;
  return rank + 2;
}

function handTotal(cards: number[]): number {
  let s = 0;
  for (const c of cards) s += salonPip(c);
  return s % 10;
}

/** Same tableau as bankerDrawsThird in baccarat.ts. `third` is the pip, or null. */
export function salonBankerDraws(bankerTotal: number, third: number | null): boolean {
  if (third === null) return bankerTotal <= 5;
  switch (bankerTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return third !== 8;
    case 4:
      return third >= 2 && third <= 7;
    case 5:
      return third >= 4 && third <= 7;
    case 6:
      return third === 6 || third === 7;
    default:
      return false;
  }
}

function dealBaccarat(seed: string, client: string, nonce: number): { result: SalonBaccaratResult; cursor: number } {
  let cursor = 0;
  const draw = () => {
    const n = salonNextInt(seed, client, nonce, cursor, 52);
    cursor = n.cursor;
    return n.value;
  };
  const p0 = draw();
  const b0 = draw();
  const p1 = draw();
  const b1 = draw();
  const player = [p0, p1];
  const banker = [b0, b1];
  let playerTotal = handTotal(player);
  let bankerTotal = handTotal(banker);
  const natural = playerTotal >= 8 || bankerTotal >= 8;
  let third: number | null = null;
  if (!natural && playerTotal <= 5) {
    third = draw();
    player.push(third);
    playerTotal = handTotal(player);
  }
  if (!natural && salonBankerDraws(bankerTotal, third === null ? null : salonPip(third))) {
    banker.push(draw());
    bankerTotal = handTotal(banker);
  }
  const winner = playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie";
  return {
    cursor,
    result: { player, banker, playerTotal, bankerTotal, winner, natural },
  };
}

function rouletteReturn(kind: string, n: number | null, pocket: number): number {
  const color = pocketColor(pocket);
  switch (kind) {
    case "straight":
      return n === pocket ? 36 : 0;
    case "red":
      return color === "red" ? 2 : 0;
    case "black":
      return color === "black" ? 2 : 0;
    case "odd":
      return pocket !== 0 && pocket % 2 === 1 ? 2 : 0;
    case "even":
      return pocket !== 0 && pocket % 2 === 0 ? 2 : 0;
    case "low":
      return pocket >= 1 && pocket <= 18 ? 2 : 0;
    case "high":
      return pocket >= 19 && pocket <= 36 ? 2 : 0;
    case "dozen1":
      return pocket >= 1 && pocket <= 12 ? 3 : 0;
    case "dozen2":
      return pocket >= 13 && pocket <= 24 ? 3 : 0;
    case "dozen3":
      return pocket >= 25 && pocket <= 36 ? 3 : 0;
    default:
      return 0;
  }
}

function baccaratReturn(kind: string, stake: number, winner: SalonBaccaratResult["winner"]): number {
  if (winner === "tie") {
    if (kind === "tie") return stake * 9;
    if (kind === "player" || kind === "banker") return stake;
    return 0;
  }
  if (kind !== winner) return 0;
  if (kind === "player") return stake * 2;
  if (kind === "banker") return Math.floor((stake * 195) / 100);
  return 0;
}

function sicBoReturn(kind: string, dice: [number, number, number]): number {
  const sum = dice[0] + dice[1] + dice[2];
  const triple = dice[0] === dice[1] && dice[1] === dice[2];
  switch (kind) {
    case "big":
      return !triple && sum >= 11 && sum <= 17 ? 2 : 0;
    case "small":
      return !triple && sum >= 4 && sum <= 10 ? 2 : 0;
    case "odd":
      return !triple && sum % 2 === 1 ? 2 : 0;
    case "even":
      return !triple && sum % 2 === 0 ? 2 : 0;
    case "any_triple":
      return triple ? 31 : 0;
    default:
      return 0;
  }
}

function runDerby(seedHex: string, clientSeed: string, nonce: number): SalonDerbyResult {
  const first = salonNextInt(seedHex, clientSeed, nonce, 0, 1000);
  let cursor = first.cursor;
  let winner = 6;
  let acc = 0;
  for (let h = 0; h < 6; h++) {
    acc += DERBY_WEIGHTS[h];
    if (first.value < acc) {
      winner = h + 1;
      break;
    }
  }
  const totals = [0, 0, 0, 0, 0, 0];
  const ticks: number[][] = [];
  for (let t = 0; t < DERBY_TICKS; t++) {
    const row: number[] = [];
    for (let h = 0; h < 6; h++) {
      const d = salonNextInt(seedHex, clientSeed, nonce, cursor, 3);
      cursor = d.cursor;
      const step = d.value + 1;
      totals[h] += step;
      row.push(step);
    }
    ticks.push(row);
  }
  let maxOther = 0;
  for (let h = 0; h < 6; h++) if (h !== winner - 1 && totals[h] > maxOther) maxOther = totals[h];
  if (totals[winner - 1] <= maxOther) {
    const gap = maxOther - totals[winner - 1] + 1;
    ticks[DERBY_TICKS - 1][winner - 1] += gap;
    totals[winner - 1] += gap;
  }
  return { winner, ticks, totals };
}

export function resolveSalonRound(
  seedHex: string,
  clientSeed: string,
  nonce: number,
  game: SalonGame,
  bets: SalonBet[],
  opts: { carryIn?: number } = {},
): { result: SalonResult; payouts: SalonPayout[] } {
  if (game === "ticker") {
    throw new Error("Ticker settles on a live price, not the seed");
  }
  if (game === "derby") {
    const result = runDerby(seedHex, clientSeed, nonce);
    const payouts = bets.map((b) => ({
      playerId: b.playerId,
      kind: b.kind,
      stake: b.stake,
      n: b.n ?? null,
      payout:
        b.kind === "win" && b.n === result.winner
          ? Math.floor((b.stake * DERBY_RETURN_TENTHS[result.winner - 1]) / 10)
          : 0,
    }));
    return { result, payouts };
  }
  if (game === "nerve") {
    const bust = nerveBustCents(salonU32(seedHex, clientSeed, nonce, 0));
    const commits = bets.map((b) => ({ playerId: b.playerId, target: b.n ?? null, stake: b.stake }));
    const result: SalonNerveResult = { bust, commits };
    const payouts = bets.map((b) => {
      const target = b.n ?? null;
      return {
        playerId: b.playerId,
        kind: "nerve",
        stake: b.stake,
        n: target,
        payout: target !== null && target <= bust ? Math.floor((b.stake * target) / 100) : 0,
      };
    });
    return { result, payouts };
  }
  if (game === "oddone") {
    const counts = new Array<number>(11).fill(0);
    let pot = opts.carryIn ?? 0;
    for (const b of bets) {
      pot += b.stake;
      if (b.n !== null && b.n !== undefined && b.n >= 1 && b.n <= 10) counts[b.n] += 1;
    }
    let number: number | null = null;
    for (let i = 1; i <= 10; i++) {
      if (counts[i] === 1) {
        number = i;
        break;
      }
    }
    const winner = number === null ? null : (bets.find((b) => b.n === number)?.playerId ?? null);
    const result: SalonOddOneResult = {
      picks: bets.map((b) => ({ playerId: b.playerId, n: b.n ?? null, stake: b.stake })),
      winner,
      number,
      pot,
      carry: winner === null ? pot : 0,
    };
    const payouts = bets.map((b) => ({
      playerId: b.playerId,
      kind: "pick",
      stake: b.stake,
      n: b.n ?? null,
      payout: winner !== null && b.playerId === winner ? pot : 0,
    }));
    return { result, payouts };
  }
  if (game === "roulette") {
    const draw = salonNextInt(seedHex, clientSeed, nonce, 0, 37);
    const pocket = draw.value;
    const result: SalonRouletteResult = { pocket, color: pocketColor(pocket) };
    const payouts = bets.map((b) => ({
      playerId: b.playerId,
      kind: b.kind,
      stake: b.stake,
      n: b.n ?? null,
      payout: b.stake * rouletteReturn(b.kind, b.n ?? null, pocket),
    }));
    return { result, payouts };
  }
  if (game === "baccarat") {
    const { result } = dealBaccarat(seedHex, clientSeed, nonce);
    const payouts = bets.map((b) => ({
      playerId: b.playerId,
      kind: b.kind,
      stake: b.stake,
      n: b.n ?? null,
      payout: baccaratReturn(b.kind, b.stake, result.winner),
    }));
    return { result, payouts };
  }
  let cursor = 0;
  const dice = [0, 0, 0] as [number, number, number];
  for (let i = 0; i < 3; i++) {
    const d = salonNextInt(seedHex, clientSeed, nonce, cursor, 6);
    cursor = d.cursor;
    dice[i] = d.value + 1;
  }
  const result: SalonSicBoResult = {
    dice,
    sum: dice[0] + dice[1] + dice[2],
    triple: dice[0] === dice[1] && dice[1] === dice[2],
  };
  const payouts = bets.map((b) => ({
    playerId: b.playerId,
    kind: b.kind,
    stake: b.stake,
    n: b.n ?? null,
    payout: b.stake * sicBoReturn(b.kind, dice),
  }));
  return { result, payouts };
}

function sameResult(game: SalonGame, a: SalonResult, b: SalonResult): boolean {
  if (game === "derby") {
    const x = a as SalonDerbyResult;
    const y = b as SalonDerbyResult;
    if (x.winner !== y.winner || x.ticks.length !== y.ticks.length) return false;
    return x.ticks.every((row, t) => row.length === y.ticks[t]?.length && row.every((v, h) => v === y.ticks[t][h]));
  }
  if (game === "nerve") {
    const x = a as SalonNerveResult;
    const y = b as SalonNerveResult;
    return x.bust === y.bust;
  }
  if (game === "oddone") {
    const x = a as SalonOddOneResult;
    const y = b as SalonOddOneResult;
    return x.winner === y.winner && x.number === y.number && x.pot === y.pot && x.carry === y.carry;
  }
  if (game === "ticker") return false;
  if (game === "roulette") {
    const x = a as SalonRouletteResult;
    const y = b as SalonRouletteResult;
    return x.pocket === y.pocket && x.color === y.color;
  }
  if (game === "sicbo") {
    const x = a as SalonSicBoResult;
    const y = b as SalonSicBoResult;
    return x.sum === y.sum && x.triple === y.triple && x.dice[0] === y.dice[0] && x.dice[1] === y.dice[1] && x.dice[2] === y.dice[2];
  }
  const x = a as SalonBaccaratResult;
  const y = b as SalonBaccaratResult;
  const eq = (p: number[], q: number[]) => p.length === q.length && p.every((v, i) => v === q[i]);
  return (
    x.playerTotal === y.playerTotal &&
    x.bankerTotal === y.bankerTotal &&
    x.winner === y.winner &&
    x.natural === y.natural &&
    eq(x.player, y.player) &&
    eq(x.banker, y.banker)
  );
}

/**
 * True when the revealed seed hashes to the pre-coup commitment and replays the
 * published coup. The published payouts carry each sealed choice in `n`, so they
 * double as the bet list for the replay. Returns null for games that never
 * touch the seed (Odd One Out, Ticker).
 */
export function salonCoupChecksOut(args: {
  revealedSeed: string;
  committedHash: string;
  clientSeed: string;
  nonce: number;
  game: SalonGame;
  result: SalonResult;
  payouts: SalonPayout[];
}): boolean | null {
  if (args.game === "ticker" || args.game === "oddone") return null;
  if (hashServerSeed(args.revealedSeed) !== args.committedHash) return false;
  const bets: SalonBet[] = args.payouts.map((p) => ({ playerId: p.playerId, kind: p.kind, stake: p.stake, n: p.n }));
  const replay = resolveSalonRound(args.revealedSeed, args.clientSeed, args.nonce, args.game, bets);
  if (!sameResult(args.game, replay.result, args.result)) return false;
  if (replay.payouts.length !== args.payouts.length) return false;
  return replay.payouts.every((p, i) => {
    const q = args.payouts[i];
    return p.playerId === q.playerId && p.kind === q.kind && p.stake === q.stake && p.payout === q.payout && p.n === (q.n ?? null);
  });
}

/** Replays Odd One Out from the published picks. No seed involved. */
export function oddOneChecksOut(result: SalonOddOneResult, payouts: SalonPayout[]): boolean {
  const stakes = result.picks.reduce((s, p) => s + p.stake, 0);
  const bets: SalonBet[] = result.picks.map((p) => ({ playerId: p.playerId, kind: "pick", stake: p.stake, n: p.n }));
  const replay = resolveSalonRound("00", "", 0, "oddone", bets, { carryIn: result.pot - stakes });
  if (!sameResult("oddone", replay.result, result)) return false;
  if (replay.payouts.length !== payouts.length) return false;
  return replay.payouts.every((p, i) => p.playerId === payouts[i].playerId && p.payout === payouts[i].payout);
}

export function salonBetAllowed(game: SalonGame, kind: string, n: number | null): boolean {
  if (game === "derby") return kind === "win" && n !== null && Number.isInteger(n) && n >= 1 && n <= 6;
  if (game === "nerve") return kind === "nerve" && n !== null && Number.isInteger(n) && n >= NERVE_MIN_TARGET && n <= NERVE_MAX_TARGET;
  if (game === "oddone") return kind === "pick" && n !== null && Number.isInteger(n) && n >= 1 && n <= 10;
  if (game === "ticker") return n === null && (kind === "up" || kind === "down");
  if (game === "roulette") {
    if (kind === "straight") return n !== null && Number.isInteger(n) && n >= 0 && n <= 36;
    if (n !== null) return false;
    return ["red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3"].includes(kind);
  }
  if (n !== null) return false;
  if (game === "baccarat") return kind === "player" || kind === "banker" || kind === "tie";
  return kind === "big" || kind === "small" || kind === "odd" || kind === "even" || kind === "any_triple";
}

export { RED_POCKETS };
