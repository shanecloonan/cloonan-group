/* ===========================================================================
 *  MoneyFund Casino — Provably-fair RNG (Layer 2)
 *  ---------------------------------------------------------------------------
 *  Industry-standard commit-reveal HMAC-SHA256 random number stream.
 *
 *  Scheme:
 *    key      = server_seed (32 random bytes, hash published in advance)
 *    message  = `${client_seed}:${nonce}:${cursor}`
 *    block_k  = HMAC-SHA256(key, `${msg}:${k}`)
 *    stream   = block_0 || block_1 || block_2 || ...   (32 bytes per block)
 *
 *  The stream is consumed lazily for every draw. To pick an unbiased
 *  integer in [0, n) we use rejection sampling on uint32 reads, which
 *  guarantees no modulo bias even when n is not a power of 2.
 *
 *  Verifiability:
 *    • Before the session, the player sees `server_seed_hash`.
 *    • After the player rotates their client seed, the old server seed is
 *      published; anyone can replay any past hand bit-for-bit by recomputing
 *      this exact function.
 *
 *  Zero dependencies beyond @noble/hashes (already in package.json).
 * ========================================================================= */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { RngStream, SeedPair } from "./types";

const HMAC_BLOCK_BYTES = 32;
const UINT32_MAX = 0x100000000; // 2^32

/* ---------------------------------------------------------------------------
 *  Encoding helpers (browser-safe — no Buffer)
 * ------------------------------------------------------------------------- */

const textEncoder = new TextEncoder();

function utf8(s: string): Uint8Array {
  return textEncoder.encode(s);
}

export function bytesToHex(buf: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hexToBytes: odd length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Random 32-byte hex string. Crypto-secure in browsers and Node 20+. */
export function generateServerSeed(): string {
  const buf = new Uint8Array(32);
  if (typeof globalThis !== "undefined" && (globalThis as { crypto?: Crypto }).crypto?.getRandomValues) {
    (globalThis as { crypto: Crypto }).crypto.getRandomValues(buf);
  } else {
    // Last-resort fallback. In production we never hit this branch.
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(buf);
}

/** SHA-256 hash of a server seed, hex-encoded. Published up-front. */
export function hashServerSeed(serverSeedHex: string): string {
  return bytesToHex(sha256(hexToBytes(serverSeedHex)));
}

/** Generates a default client seed (12 hex chars). User may override at will. */
export function generateClientSeed(): string {
  const buf = new Uint8Array(6);
  if (typeof globalThis !== "undefined" && (globalThis as { crypto?: Crypto }).crypto?.getRandomValues) {
    (globalThis as { crypto: Crypto }).crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(buf);
}

/* ---------------------------------------------------------------------------
 *  Pure HMAC stream — pull as many bytes as you like
 * ------------------------------------------------------------------------- */

/**
 * Pure deterministic byte stream for a single action (one card, one dice
 * roll, etc.). `cursor` is the *byte offset* within this action; we hash
 * a new 32-byte block each time the consumer crosses a block boundary.
 *
 * This function exposes no state: given the same inputs it always
 * returns the same byte. The `RngStream` class below wraps it with a
 * cursor counter so consumers can ask for the "next" byte.
 */
export function hmacStreamByte(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  byteOffset: number,
): number {
  const blockIndex = Math.floor(byteOffset / HMAC_BLOCK_BYTES);
  const offsetInBlock = byteOffset % HMAC_BLOCK_BYTES;
  const msg = utf8(`${clientSeed}:${nonce}:${blockIndex}`);
  const block = hmac(sha256, hexToBytes(serverSeedHex), msg);
  return block[offsetInBlock];
}

/* ---------------------------------------------------------------------------
 *  Stateful RngStream — wraps the pure stream for ergonomic consumption
 * ------------------------------------------------------------------------- */

/**
 * `RngStream` is a *thin* stateful wrapper around the pure byte stream
 * above. It holds a cursor and provides `nextByte / nextUint32 / nextInt`.
 *
 * It does *not* mutate the underlying seed pair — that's the responsibility
 * of the session layer (which bumps `pair.nonce` once per action and
 * persists the result).
 */
export class HmacRngStream implements RngStream {
  public readonly pair: SeedPair;
  public readonly nonce: number;
  private cursor: number;
  private readonly serverSeed: string;

  constructor(pair: SeedPair, nonce: number, serverSeed?: string) {
    if (pair.status !== "active" && !serverSeed) {
      throw new Error(
        "HmacRngStream: a retired seed pair requires its revealed server seed to be passed in",
      );
    }
    // While active, the server seed lives in memory on the server only.
    // We accept it either via the pair (when an operator constructs one
    // in-process) or via the explicit `serverSeed` arg (verification path).
    const seed = serverSeed ?? pair.serverSeed;
    if (!seed) {
      throw new Error("HmacRngStream: no server seed available");
    }
    this.pair = pair;
    this.nonce = nonce;
    this.serverSeed = seed;
    this.cursor = 0;
  }

  nextByte(): number {
    const b = hmacStreamByte(this.serverSeed, this.pair.clientSeed, this.nonce, this.cursor);
    this.cursor += 1;
    return b;
  }

  nextUint32(): number {
    const a = this.nextByte();
    const b = this.nextByte();
    const c = this.nextByte();
    const d = this.nextByte();
    // Big-endian assembly — matches our verifier doc and Stake's convention.
    // `>>> 0` forces unsigned interpretation of the 32-bit result.
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }

  /**
   * Rejection-sampled integer in [0, max). Eliminates modulo bias for any
   * `max` that doesn't divide 2^32 evenly. The bound is
   *
   *     ceiling = 2^32 - (2^32 mod max)
   *
   * and we keep rolling until `nextUint32() < ceiling`.
   */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new Error(`nextInt: maxExclusive must be a positive integer (got ${maxExclusive})`);
    }
    if (maxExclusive === 1) return 0;
    const ceiling = UINT32_MAX - (UINT32_MAX % maxExclusive);
    // In pathological cases (n=1) ceiling == 2^32, in which case the loop
    // exits on the first iteration. Bounded loop to stop runaway recursion.
    for (let i = 0; i < 256; i++) {
      const v = this.nextUint32();
      if (v < ceiling) return v % maxExclusive;
    }
    // Statistically impossible (~0% chance after 256 rejections), but
    // bail with a deterministic answer rather than infinite-looping.
    return this.nextUint32() % maxExclusive;
  }

  bytesConsumed(): number {
    return this.cursor;
  }
}

/* ---------------------------------------------------------------------------
 *  Seed-pair factory + rotation
 * ------------------------------------------------------------------------- */

/**
 * Build a fresh seed pair. The server seed only lives in the returned
 * object — callers (the session driver) should immediately:
 *   1. persist `serverSeedHash` + `clientSeed` to the DB,
 *   2. keep `serverSeed` in *server memory only*,
 *   3. publish `serverSeedHash` to the client.
 */
export function newSeedPair(args: { userId: string; clientSeed?: string }): SeedPair {
  const serverSeed = generateServerSeed();
  return {
    id: cryptoRandomUuid(),
    userId: args.userId,
    serverSeed,
    serverSeedHash: hashServerSeed(serverSeed),
    clientSeed: args.clientSeed?.trim() || generateClientSeed(),
    nonce: 0,
    status: "active",
    createdAt: new Date().toISOString(),
    retiredAt: null,
  };
}

/**
 * Retire a seed pair (revealing the server seed) and return both:
 *   - the now-retired pair (with seed visible),
 *   - a freshly minted active pair to replace it.
 */
export function rotateSeedPair(
  current: SeedPair,
  newClientSeed?: string,
): { retired: SeedPair; next: SeedPair } {
  if (current.status !== "active") {
    throw new Error("rotateSeedPair: pair is already retired");
  }
  const retired: SeedPair = {
    ...current,
    status: "retired",
    retiredAt: new Date().toISOString(),
  };
  const next = newSeedPair({ userId: current.userId, clientSeed: newClientSeed });
  return { retired, next };
}

/* ---------------------------------------------------------------------------
 *  Verification helpers
 * ------------------------------------------------------------------------- */

/**
 * Replay an RNG draw deterministically. Used by the "Verify" UI to
 * confirm a settled hand against the now-revealed server seed.
 *
 * Returns the integer that would have been drawn at this nonce+cursor.
 */
export function replayInt(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  maxExclusive: number,
  startCursor = 0,
): { value: number; bytesUsed: number } {
  if (maxExclusive < 1) throw new Error("replayInt: maxExclusive must be positive");
  if (maxExclusive === 1) return { value: 0, bytesUsed: 0 };
  const ceiling = UINT32_MAX - (UINT32_MAX % maxExclusive);
  let cursor = startCursor;
  for (let i = 0; i < 256; i++) {
    const a = hmacStreamByte(serverSeedHex, clientSeed, nonce, cursor);
    const b = hmacStreamByte(serverSeedHex, clientSeed, nonce, cursor + 1);
    const c = hmacStreamByte(serverSeedHex, clientSeed, nonce, cursor + 2);
    const d = hmacStreamByte(serverSeedHex, clientSeed, nonce, cursor + 3);
    cursor += 4;
    const v = (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
    if (v < ceiling) return { value: v % maxExclusive, bytesUsed: cursor - startCursor };
  }
  const fallback = hmacStreamByte(serverSeedHex, clientSeed, nonce, cursor) % maxExclusive;
  return { value: fallback, bytesUsed: cursor + 1 - startCursor };
}

/** Confirm that a revealed server seed hashes to the published hash. */
export function verifyServerSeed(serverSeedHex: string, publishedHash: string): boolean {
  return hashServerSeed(serverSeedHex).toLowerCase() === publishedHash.toLowerCase();
}

/* ---------------------------------------------------------------------------
 *  Small helpers
 * ------------------------------------------------------------------------- */

/**
 * Crypto-secure random ID. Used for ledger mutation references, debug
 * tags, etc. Format: 16 hex chars (64 bits of entropy).
 */
export function cryptoRandomId(): string {
  const buf = new Uint8Array(8);
  if (typeof globalThis !== "undefined" && (globalThis as { crypto?: Crypto }).crypto?.getRandomValues) {
    (globalThis as { crypto: Crypto }).crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(buf);
}

/**
 * Crypto-secure UUID v4. Required for IDs that need to fit Postgres `uuid`
 * columns (session id, seed pair id). We don't rely on `crypto.randomUUID`
 * directly because not all bundled environments expose it.
 */
export function cryptoRandomUuid(): string {
  const buf = new Uint8Array(16);
  if (typeof globalThis !== "undefined" && (globalThis as { crypto?: Crypto }).crypto?.getRandomValues) {
    (globalThis as { crypto: Crypto }).crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 v4 markers.
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = bytesToHex(buf);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
