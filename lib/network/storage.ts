/* ================================================================== *
 *  MoneyFund Network — Storage Commitments                             *
 *                                                                      *
 *  THE PERMANENCE LAYER                                                *
 *  ────────────────────                                                *
 *  This is what makes MoneyFund different from Monero. Every output    *
 *  on this network can optionally bind a permanent data payload —     *
 *  the L1 itself becomes the storage substrate, not just a payment    *
 *  rail.                                                               *
 *                                                                      *
 *  A storage commitment is a content-addressed binding:                *
 *     dataRoot     — Merkle root of the data, chunk by chunk           *
 *     sizeBytes    — total size in bytes                               *
 *     chunkSize    — the chunk granularity (power of two)              *
 *     numChunks    — derived; ⌈sizeBytes / chunkSize⌉                  *
 *     replication  — minimum number of replicas the network promises   *
 *     endowment    — Pedersen commitment to the locked endowment       *
 *                    amount (hidden, like all RingCT amounts)          *
 *                                                                      *
 *  The dataRoot is the Merkle root of a binary tree where each leaf   *
 *  is dhash("chunk-hash", chunkBytes). This lets the network later     *
 *  audit storage operators with O(log N)-sized Merkle proofs of        *
 *  random-access (SPoRA-style): "produce chunk #i and a proof rooted   *
 *  at dataRoot." Operators who can't respond fail their attestation    *
 *  and forfeit a slashable stake. (The slashing layer itself lives in  *
 *  the staking module — not in scope here, but the data primitives     *
 *  are designed to support it.)                                        *
 *                                                                      *
 *  PRIVACY                                                             *
 *  ───────                                                             *
 *  The endowment amount is hidden behind a Pedersen commitment, so     *
 *  external observers see that storage was paid for but cannot tell    *
 *  *how much* was paid (which would otherwise leak the data size's     *
 *  endowment-band, partially de-anonymizing the storer). The data      *
 *  itself can be encrypted with a key derived from the stealth         *
 *  shared secret, so the network stores the bytes but only the         *
 *  recipient can read them.                                            *
 * ================================================================== */

import { sha512 } from "@noble/hashes/sha2.js";
import {
  pedersenCommit,
  pedersenVerify,
  type CurvePoint,
} from "./primitives";
import {
  DOMAIN,
  Writer,
  Reader,
  dhash,
  bytesToHex,
} from "./codec";

/* ------------------------------------------------------------------ */
/*  CHUNKING                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_CHUNK_SIZE = 1 << 18; // 256 KiB

/** Split data into fixed-size chunks. The last chunk may be short. */
export function chunkData(data: Uint8Array, chunkSize: number = DEFAULT_CHUNK_SIZE): Uint8Array[] {
  if (chunkSize <= 0 || (chunkSize & (chunkSize - 1)) !== 0) {
    throw new Error("chunkSize must be a positive power of two");
  }
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    out.push(data.slice(i, Math.min(i + chunkSize, data.length)));
  }
  if (out.length === 0) out.push(new Uint8Array(0));
  return out;
}

/** Hash a single chunk for use as a Merkle leaf.
 *  Domain-separated so a chunk can never be confused with an interior node. */
export function chunkHash(chunk: Uint8Array): Uint8Array {
  return dhash(DOMAIN.MERKLE_LEAF, chunk);
}

/* ------------------------------------------------------------------ */
/*  MERKLE TREE                                                        */
/*                                                                     *
 *  Standard binary Merkle tree with explicit leaf / node domain        *
 *  separation. When a level has an odd count we duplicate the last    *
 *  hash (the same scheme Bitcoin uses) — simple and unambiguous.      *
 * ------------------------------------------------------------------ */

export interface MerkleTree {
  /** Level 0 = leaves; level N = single-element root array. */
  levels: Uint8Array[][];
  /** Convenience: levels[N-1][0]. */
  root: Uint8Array;
}

export function merkleTreeFromChunks(chunks: Uint8Array[]): MerkleTree {
  if (chunks.length === 0) throw new Error("merkle: empty input");
  const leaves = chunks.map(chunkHash);
  return merkleTreeFromLeaves(leaves);
}

export function merkleTreeFromLeaves(leaves: Uint8Array[]): MerkleTree {
  if (leaves.length === 0) throw new Error("merkle: empty input");

  const levels: Uint8Array[][] = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : prev[i]; // duplicate odd
      next.push(dhash(DOMAIN.MERKLE_NODE, left, right));
    }
    levels.push(next);
  }
  return { levels, root: levels[levels.length - 1][0] };
}

export function merkleRoot(chunks: Uint8Array[]): Uint8Array {
  return merkleTreeFromChunks(chunks).root;
}

/* ------------------------------------------------------------------ */
/*  MERKLE PROOFS  (SPoRA-style storage challenge)                     *
 *                                                                     *
 *  Given a chunk index, produce the sibling-hash path needed to       *
 *  re-derive the root. Verifier supplies (chunk, proof, root, idx).   *
 * ------------------------------------------------------------------ */

export interface MerkleProof {
  /** Sibling hashes from leaf level upward (excluding the root). */
  siblings: Uint8Array[];
  /** For each step: 0 = sibling is on the right, 1 = sibling is on the left. */
  rightSide: number[];
  /** The leaf index this proof targets. */
  index: number;
}

export function merkleProof(tree: MerkleTree, leafIdx: number): MerkleProof {
  if (leafIdx < 0 || leafIdx >= tree.levels[0].length) {
    throw new Error("merkle: leaf index out of range");
  }
  const siblings: Uint8Array[] = [];
  const rightSide: number[] = [];
  let idx = leafIdx;

  for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
    const layer = tree.levels[lvl];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : Math.min(idx + 1, layer.length - 1);
    siblings.push(layer[siblingIdx]);
    rightSide.push(isRight ? 1 : 0);
    idx = idx >> 1;
  }
  return { siblings, rightSide, index: leafIdx };
}

export function verifyMerkleProof(
  chunk: Uint8Array,
  proof: MerkleProof,
  root: Uint8Array
): boolean {
  let acc = chunkHash(chunk);
  for (let i = 0; i < proof.siblings.length; i++) {
    const sib = proof.siblings[i];
    if (proof.rightSide[i] === 1) {
      acc = dhash(DOMAIN.MERKLE_NODE, sib, acc);
    } else {
      acc = dhash(DOMAIN.MERKLE_NODE, acc, sib);
    }
  }
  if (acc.length !== root.length) return false;
  for (let i = 0; i < acc.length; i++) {
    if (acc[i] !== root[i]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  STORAGE COMMITMENT                                                 */
/* ------------------------------------------------------------------ */

export interface StorageCommitment {
  /** Merkle root of the data chunks. */
  dataRoot: Uint8Array;
  /** Total size of the original data, in bytes. */
  sizeBytes: bigint;
  /** Chunk size used in the Merkle tree (power of two). */
  chunkSize: number;
  /** Number of leaves (chunks). */
  numChunks: number;
  /** Minimum replication factor the network must maintain. */
  replication: number;
  /** Pedersen commitment to the endowment amount paid for permanence. */
  endowment: CurvePoint;
}

/** Build a storage commitment from raw data + an endowment amount.
 *  Returns the commitment plus the per-chunk Merkle tree (caller can keep
 *  it around to answer SPoRA-style audits). */
export function buildStorageCommitment(
  data: Uint8Array,
  endowmentAmount: bigint,
  options: {
    chunkSize?: number;
    replication?: number;
    blinding?: bigint;
  } = {}
): {
  commit: StorageCommitment;
  tree: MerkleTree;
  blinding: bigint;
} {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const replication = options.replication ?? 3;
  if (replication < 1) throw new Error("storage: replication must be ≥ 1");

  const chunks = chunkData(data, chunkSize);
  const tree = merkleTreeFromChunks(chunks);
  const ped = pedersenCommit(endowmentAmount, options.blinding);

  return {
    commit: {
      dataRoot: tree.root,
      sizeBytes: BigInt(data.length),
      chunkSize,
      numChunks: chunks.length,
      replication,
      endowment: ped.C,
    },
    tree,
    blinding: ped.blinding,
  };
}

/** Domain-separated hash of a storage commitment. This is the storage's
 *  unique on-chain identity — the value transactions reference and that
 *  blocks merkle-ize. */
export function storageCommitmentHash(c: StorageCommitment): Uint8Array {
  const w = new Writer();
  w.push(c.dataRoot);
  w.u64(c.sizeBytes);
  w.u32(c.chunkSize);
  w.u32(c.numChunks);
  w.u8(c.replication);
  w.point(c.endowment);
  return dhash(DOMAIN.STORAGE_COMMIT, w.bytes());
}

/** Verifier-side: confirm that an opened endowment really matches the
 *  Pedersen commitment in a storage commitment. (Optional — most
 *  consumers will treat the endowment as opaque.) */
export function verifyEndowmentOpening(
  c: StorageCommitment,
  amount: bigint,
  blinding: bigint
): boolean {
  return pedersenVerify({ C: c.endowment, value: amount, blinding });
}

/* ------------------------------------------------------------------ */
/*  STORAGE AUDIT (proof of replication)                               */
/*                                                                     *
 *  At any block height the protocol can challenge an operator:         *
 *      "produce chunk #i for storage commitment X."                   *
 *  The operator returns (chunk, MerkleProof), the verifier rebuilds   *
 *  the root, and either accepts or slashes.                           *
 * ------------------------------------------------------------------ */

export interface StorageChallenge {
  commitHash: Uint8Array;
  chunkIndex: number;
}

export interface StorageResponse {
  chunk: Uint8Array;
  proof: MerkleProof;
}

/** Deterministic challenge: pick a chunk index from a per-block seed.
 *  In production the seed is the block hash; here it's an arbitrary
 *  byte string so callers can drive it deterministically. */
export function challengeFromSeed(
  commit: StorageCommitment,
  seed: Uint8Array
): StorageChallenge {
  const h = sha512(
    new Uint8Array([...storageCommitmentHash(commit), ...seed])
  );
  // Use the first 8 bytes as a uniform u64, mod numChunks.
  const dv = new DataView(h.buffer, h.byteOffset, 8);
  const r = dv.getBigUint64(0, false);
  const idx = Number(r % BigInt(commit.numChunks));
  return { commitHash: storageCommitmentHash(commit), chunkIndex: idx };
}

export function respondToChallenge(
  data: Uint8Array,
  tree: MerkleTree,
  chunkSize: number,
  challenge: StorageChallenge
): StorageResponse {
  const chunks = chunkData(data, chunkSize);
  const idx = challenge.chunkIndex;
  if (idx < 0 || idx >= chunks.length) throw new Error("challenge index out of range");
  return {
    chunk: chunks[idx],
    proof: merkleProof(tree, idx),
  };
}

export function verifyChallengeResponse(
  commit: StorageCommitment,
  challenge: StorageChallenge,
  response: StorageResponse
): boolean {
  // Challenge must reference this exact commitment.
  const cHash = storageCommitmentHash(commit);
  if (cHash.length !== challenge.commitHash.length) return false;
  for (let i = 0; i < cHash.length; i++) {
    if (cHash[i] !== challenge.commitHash[i]) return false;
  }
  if (response.proof.index !== challenge.chunkIndex) return false;
  return verifyMerkleProof(response.chunk, response.proof, commit.dataRoot);
}

/* ------------------------------------------------------------------ */
/*  PER-BLOCK STORAGE CHALLENGE                                        */
/*                                                                     *
 *  Every block deterministically challenges every active storage     *
 *  commitment to produce ONE random chunk. The chunk index is         *
 *  derived from (prevBlockId || slot || commitHash) so that every    *
 *  node arrives at the same expected challenge without coordination. *
 *                                                                     *
 *  Producers MAY answer challenges by including StorageProof items   *
 *  in the block they propose. A successful proof updates the         *
 *  commitment's `lastProvenAt` height; commitments that go unproven  *
 *  for too long are subject to slashing / eviction (out of scope     *
 *  for the on-chain primitives but read by network policy).          *
 * ------------------------------------------------------------------ */

export function chunkIndexForChallenge(
  prevBlockId: Uint8Array,
  slot: number,
  commitHash: Uint8Array,
  numChunks: number
): number {
  if (numChunks <= 0) return 0;
  const w = new Writer();
  w.push(prevBlockId);
  w.u32(slot);
  w.push(commitHash);
  const h = dhash(DOMAIN.CHUNK_HASH, w.bytes());
  const dv = new DataView(h.buffer, h.byteOffset, 8);
  const r = dv.getBigUint64(0, false);
  return Number(r % BigInt(numChunks));
}

/** Wire-format storage proof. Included in Block.storageProofs.       *
 *  The block's (prevBlockId, slot) plus the on-chain commit         *
 *  determine the expected chunkIndex uniquely, so we don't put it    *
 *  in the proof itself — the verifier recomputes.                    */
export interface StorageProof {
  commitHash: Uint8Array;
  chunk: Uint8Array;
  proof: MerkleProof;
}

export function encodeStorageProof(p: StorageProof): Uint8Array {
  const w = new Writer();
  w.push(p.commitHash);
  w.blob(p.chunk);
  w.varint(p.proof.index);
  w.varint(p.proof.siblings.length);
  for (let i = 0; i < p.proof.siblings.length; i++) {
    w.push(p.proof.siblings[i]);
    w.u8(p.proof.rightSide[i]);
  }
  return w.bytes();
}

export function decodeStorageProof(bytes: Uint8Array): StorageProof {
  const r = new Reader(bytes);
  const commitHash = r.bytes(32);
  const chunk = r.blob();
  const index = Number(r.varint());
  const n = Number(r.varint());
  const siblings: Uint8Array[] = new Array(n);
  const rightSide: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    siblings[i] = r.bytes(32);
    rightSide[i] = r.u8();
  }
  return { commitHash, chunk, proof: { index, siblings, rightSide } };
}

/** Verify a storage proof against an on-chain commitment and the         *
 *  block context that issued the challenge. Returns ok=true iff:        *
 *    - the proof's chunk-index matches chunkIndexForChallenge(...)      *
 *    - the Merkle proof correctly opens the chunk under commit.dataRoot */
export function verifyStorageProof(
  commit: StorageCommitment,
  prevBlockId: Uint8Array,
  slot: number,
  proof: StorageProof
): { ok: boolean; reason?: string } {
  const cHash = storageCommitmentHash(commit);
  if (cHash.length !== proof.commitHash.length) {
    return { ok: false, reason: "commitHash length mismatch" };
  }
  for (let i = 0; i < cHash.length; i++) {
    if (cHash[i] !== proof.commitHash[i]) {
      return { ok: false, reason: "commitHash mismatch" };
    }
  }
  const expectedIdx = chunkIndexForChallenge(prevBlockId, slot, cHash, commit.numChunks);
  if (proof.proof.index !== expectedIdx) {
    return { ok: false, reason: `wrong chunk index: expected ${expectedIdx}, got ${proof.proof.index}` };
  }
  if (!verifyMerkleProof(proof.chunk, proof.proof, commit.dataRoot)) {
    return { ok: false, reason: "merkle proof invalid" };
  }
  return { ok: true };
}

/** Producer helper: given the FULL data + Merkle tree the prover         *
 *  is holding for a commitment, build the storage proof for the          *
 *  current block context.                                                */
export function buildStorageProof(
  commit: StorageCommitment,
  prevBlockId: Uint8Array,
  slot: number,
  data: Uint8Array,
  tree: MerkleTree
): StorageProof {
  const cHash = storageCommitmentHash(commit);
  const idx = chunkIndexForChallenge(prevBlockId, slot, cHash, commit.numChunks);
  const chunks = chunkData(data, commit.chunkSize);
  return {
    commitHash: cHash,
    chunk: chunks[idx],
    proof: merkleProof(tree, idx),
  };
}

/* ------------------------------------------------------------------ */
/*  CONVENIENCE                                                        */
/* ------------------------------------------------------------------ */

export function shortHex(b: Uint8Array, head = 6, tail = 4): string {
  const s = bytesToHex(b);
  if (s.length <= head + tail + 2) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
