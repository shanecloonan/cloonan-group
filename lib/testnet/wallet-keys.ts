/**
 * Browser-side Permawrite wallet key derivation (mfn_wallet_v1).
 * Mirrors mfn-wallet::wallet_from_seed + mfn-cli address encoding.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const L = BigInt(
  "0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed",
);
const SEED_TAG_VIEW = new TextEncoder().encode("MFW_SEED_VIEW_V1");
const SEED_TAG_SPEND = new TextEncoder().encode("MFW_SEED_SPEND_V1");
const ADDRESS_PREFIX = "mf";
const ADDRESS_CHECKSUM_DOMAIN = new TextEncoder().encode(
  "permawrite-mf-address-v1",
);

export type GeneratedWallet = {
  seedHex: string;
  address: string;
  viewPubHex: string;
  spendPubHex: string;
  /** Minimal mfn-cli wallet.json (version 2, mfn_wallet_v1). */
  walletJson: string;
};

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function leBytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < b.length; i++) {
    x |= BigInt(b[i]!) << (8n * BigInt(i));
  }
  return x;
}

function bigIntToLe32(x: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let t = x;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  return out;
}

/** SHA-512(parts) → Scalar::from_bytes_mod_order_wide; ZERO → ONE. */
function hashToScalar(parts: Uint8Array[]): Uint8Array {
  const digest = sha512(concatBytes(...parts));
  let x = leBytesToBigInt(digest) % L;
  if (x === 0n) x = 1n;
  return bigIntToLe32(x);
}

function scalarToPub(scalarLe: Uint8Array): Uint8Array {
  return ed25519.Point.BASE.multiply(leBytesToBigInt(scalarLe)).toBytes();
}

function addressChecksum(payload: Uint8Array): Uint8Array {
  const dig = sha512(
    concatBytes(
      ADDRESS_CHECKSUM_DOMAIN,
      new TextEncoder().encode(ADDRESS_PREFIX),
      payload,
    ),
  );
  return dig.slice(0, 4);
}

export function encodeWalletAddress(
  viewPub: Uint8Array,
  spendPub: Uint8Array,
): string {
  const payload = concatBytes(viewPub, spendPub);
  const wire = concatBytes(payload, addressChecksum(payload));
  return `${ADDRESS_PREFIX}${bytesToHex(wire)}`;
}

export function decodeWalletAddress(address: string): {
  viewPubHex: string;
  spendPubHex: string;
} {
  const raw = address.trim();
  if (!raw.startsWith(ADDRESS_PREFIX)) {
    throw new Error(`address must start with ${ADDRESS_PREFIX}`);
  }
  const encoded = raw.slice(ADDRESS_PREFIX.length);
  if (encoded.length !== 136) {
    throw new Error("address payload length mismatch");
  }
  const wire = hexToBytes(encoded);
  const payload = wire.slice(0, 64);
  const sum = wire.slice(64);
  const expect = addressChecksum(payload);
  if (
    sum.length !== 4 ||
    expect[0] !== sum[0] ||
    expect[1] !== sum[1] ||
    expect[2] !== sum[2] ||
    expect[3] !== sum[3]
  ) {
    throw new Error("address checksum mismatch");
  }
  return {
    viewPubHex: bytesToHex(payload.slice(0, 32)),
    spendPubHex: bytesToHex(payload.slice(32)),
  };
}

export function walletFromSeed(seed: Uint8Array): GeneratedWallet {
  if (seed.length !== 32) {
    throw new Error("seed must be 32 bytes");
  }
  const viewPriv = hashToScalar([SEED_TAG_VIEW, seed]);
  const spendPriv = hashToScalar([SEED_TAG_SPEND, seed]);
  const viewPub = scalarToPub(viewPriv);
  const spendPub = scalarToPub(spendPriv);
  const seedHex = bytesToHex(seed);
  const walletJson = JSON.stringify(
    {
      version: 2,
      seed_hex: seedHex,
      key_derivation: "mfn_wallet_v1",
    },
    null,
    2,
  );
  return {
    seedHex,
    address: encodeWalletAddress(viewPub, spendPub),
    viewPubHex: bytesToHex(viewPub),
    spendPubHex: bytesToHex(spendPub),
    walletJson,
  };
}

export function generateWalletSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return seed;
}

export function generateTestnetWallet(): GeneratedWallet {
  return walletFromSeed(generateWalletSeed());
}

/** Dev / unit check: seed 0x01…01 → known address prefix. */
export function referenceWalletFromOnes(): GeneratedWallet {
  return walletFromSeed(new Uint8Array(32).fill(1));
}

export function seedFromHex(hex: string): Uint8Array {
  const t = hex.trim().replace(/^0x/i, "");
  if (t.length !== 64 || !/^[0-9a-fA-F]+$/.test(t)) {
    throw new Error("seed hex must be 64 hex characters");
  }
  return hexToBytes(t);
}
