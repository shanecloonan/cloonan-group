/* ================================================================== *
 *  MoneyFund Network — Block & Chain State                             *
 *                                                                      *
 *  This is the smallest layer that turns "verifiable transactions"     *
 *  into "an actual chain":                                              *
 *                                                                      *
 *    • Block             header + transactions, deterministically       *
 *                        hashed.                                        *
 *    • ChainState        the immutable-ish state machine: known         *
 *                        outputs, spent key images, storage registry,  *
 *                        and a list of accepted blocks.                *
 *    • applyBlock        pure function that validates a candidate      *
 *                        block against current state and either        *
 *                        returns a new state or an error.              *
 *                                                                      *
 *  This is intentionally NOT a full PoW / PoS / VRF leader-election    *
 *  implementation — that's the consensus layer above. What's here is   *
 *  sufficient for a deterministic state machine that any honest node   *
 *  can re-execute and arrive at the same answer.                       *
 * ================================================================== */

import {
  Point,
  type CurvePoint,
} from "./primitives";
import {
  TransactionWire,
  txId,
  verifyTransaction,
} from "./transaction";
import {
  storageCommitmentHash,
  type StorageCommitment,
  merkleTreeFromLeaves,
} from "./storage";
import {
  DOMAIN,
  Writer,
  dhash,
  bytesToHex,
} from "./codec";

/* ------------------------------------------------------------------ */
/*  HEADER + BLOCK                                                     */
/* ------------------------------------------------------------------ */

export interface BlockHeader {
  /** MFBN codec version. */
  version: number;
  /** Hash of the previous block's header. 32 bytes. */
  prevHash: Uint8Array;
  /** Block height (genesis = 0). */
  height: number;
  /** Wall-clock timestamp (seconds). Validator may reject blocks too far
   *  in the future relative to local clock — that policy lives at the
   *  network/consensus layer, not here. */
  timestamp: number;
  /** Merkle root of the block's transactions. */
  txRoot: Uint8Array;
  /** Merkle root of all storage commitments newly anchored in this block. */
  storageRoot: Uint8Array;
  /** Producer-supplied tag (consensus proof / VRF / nonce / signature —
   *  the consensus layer fills this in). 32 bytes by convention. */
  producerProof: Uint8Array;
}

export interface Block {
  header: BlockHeader;
  txs: TransactionWire[];
}

/* ------------------------------------------------------------------ */
/*  HASHING                                                            */
/* ------------------------------------------------------------------ */

export function blockHeaderBytes(h: BlockHeader): Uint8Array {
  const w = new Writer();
  w.varint(h.version);
  w.push(h.prevHash);
  w.u32(h.height);
  w.u64(BigInt(h.timestamp));
  w.push(h.txRoot);
  w.push(h.storageRoot);
  w.blob(h.producerProof);
  return w.bytes();
}

/** Block id = dhash("block-id", encoded header). */
export function blockId(h: BlockHeader): Uint8Array {
  return dhash(DOMAIN.BLOCK_ID, blockHeaderBytes(h));
}

/** Compute the tx Merkle root using domain-separated leaf and node hashes
 *  (delegated to the storage module's tree builder for consistency). */
export function txMerkleRoot(txs: TransactionWire[]): Uint8Array {
  if (txs.length === 0) {
    return new Uint8Array(32); // empty root sentinel
  }
  const leaves = txs.map((t) => txId(t));
  return merkleTreeFromLeaves(leaves).root;
}

/** Storage Merkle root: commit to the set of newly-anchored storage
 *  commitments in this block. Empty block → 32-byte zero. */
export function storageMerkleRoot(
  storages: StorageCommitment[]
): Uint8Array {
  if (storages.length === 0) return new Uint8Array(32);
  const leaves = storages.map((s) => storageCommitmentHash(s));
  return merkleTreeFromLeaves(leaves).root;
}

/* ------------------------------------------------------------------ */
/*  CHAIN STATE                                                        */
/* ------------------------------------------------------------------ */

/**
 *  State is keyed by string forms (hex) for convenient JS-object use.
 *  In a production node these would be on-disk merkle-Patricia tries
 *  or sparse Merkle trees. For now an in-memory implementation that's
 *  sufficient to power simulations and end-to-end tests.
 */
export interface ChainState {
  /** Block-height counter. Genesis state has height = -1, first block 0. */
  height: number;
  /** Known unspent outputs, keyed by stealth-address hex. The value is
   *  the output's amount commitment so the next spender can include it
   *  in their CLSAG ring. */
  utxo: Map<string, CurvePoint>;
  /** Spent key images. Used for double-spend detection. */
  spentKeyImages: Set<string>;
  /** Storage commitments anchored on-chain, keyed by their commitment
   *  hash hex. Value is the commitment object. */
  storage: Map<string, StorageCommitment>;
  /** Accepted block id chain: [genesis_id, block0_id, ...]. */
  blockIds: Uint8Array[];
}

export function emptyState(): ChainState {
  return {
    height: -1,
    utxo: new Map(),
    spentKeyImages: new Set(),
    storage: new Map(),
    blockIds: [],
  };
}

/* ------------------------------------------------------------------ */
/*  GENESIS                                                            */
/*                                                                     *
 *  Genesis allocates an initial set of stealth outputs and (optionally) *
 *  initial storage anchors. We don't sign these — genesis is part of   *
 *  the protocol's deterministic setup, not a transaction.              */
/* ------------------------------------------------------------------ */

export interface GenesisConfig {
  timestamp: number;
  initialOutputs: { oneTimeAddr: CurvePoint; amount: CurvePoint }[];
  initialStorage: StorageCommitment[];
  producerProof?: Uint8Array;
}

export function buildGenesis(cfg: GenesisConfig): Block {
  const header: BlockHeader = {
    version: 1,
    prevHash: new Uint8Array(32),
    height: 0,
    timestamp: cfg.timestamp,
    txRoot: new Uint8Array(32),
    storageRoot: storageMerkleRoot(cfg.initialStorage),
    producerProof: cfg.producerProof ?? new Uint8Array(32),
  };
  return { header, txs: [] };
}

export function applyGenesis(genesis: Block, cfg: GenesisConfig): ChainState {
  if (genesis.header.height !== 0) throw new Error("genesis height must be 0");
  const state = emptyState();
  for (const o of cfg.initialOutputs) {
    state.utxo.set(o.oneTimeAddr.toHex(), o.amount);
  }
  for (const s of cfg.initialStorage) {
    state.storage.set(bytesToHex(storageCommitmentHash(s)), s);
  }
  state.height = 0;
  state.blockIds = [blockId(genesis.header)];
  return state;
}

/* ------------------------------------------------------------------ */
/*  BLOCK APPLICATION                                                  */
/* ------------------------------------------------------------------ */

export interface ApplyResult {
  ok: boolean;
  errors: string[];
  /** New state if ok; reference to the input state otherwise. */
  state: ChainState;
  /** Hash of the block applied. */
  blockId: Uint8Array;
}

export function applyBlock(
  state: ChainState,
  block: Block,
  storagesInBlock: Map<string, StorageCommitment> = new Map()
): ApplyResult {
  const errors: string[] = [];

  /* ---- Header sanity ---- */
  if (block.header.height !== state.height + 1) {
    errors.push(
      `bad height: expected ${state.height + 1}, got ${block.header.height}`
    );
  }
  const expectedPrev = state.blockIds[state.blockIds.length - 1];
  if (expectedPrev) {
    if (block.header.prevHash.length !== expectedPrev.length) {
      errors.push("prevHash length mismatch");
    } else {
      for (let i = 0; i < expectedPrev.length; i++) {
        if (expectedPrev[i] !== block.header.prevHash[i]) {
          errors.push("prevHash does not match tip");
          break;
        }
      }
    }
  }

  /* ---- Tx merkle root ---- */
  const expectedTxRoot = txMerkleRoot(block.txs);
  if (!eqBytes(expectedTxRoot, block.header.txRoot)) {
    errors.push("txRoot mismatch");
  }

  /* ---- Tentative state copy (apply if everything passes) ---- */
  const next: ChainState = {
    height: state.height + 1,
    utxo: new Map(state.utxo),
    spentKeyImages: new Set(state.spentKeyImages),
    storage: new Map(state.storage),
    blockIds: [...state.blockIds],
  };

  // Storage anchors mentioned in the header must be supplied so we can
  // hash them into the storage root. The block format itself only carries
  // the commitment hashes (via outputs); the full StorageCommitment
  // objects are passed alongside via storagesInBlock.
  const newStorages: StorageCommitment[] = [];

  /* ---- Validate each tx ---- */
  for (let ti = 0; ti < block.txs.length; ti++) {
    const tx = block.txs[ti];
    const v = verifyTransaction(tx);
    if (!v.ok) {
      errors.push(`tx[${ti}] invalid: ${v.errors.join("; ")}`);
      continue;
    }

    // Double-spend across the chain.
    for (const ki of v.keyImages) {
      const kiHex = ki.toHex();
      if (next.spentKeyImages.has(kiHex)) {
        errors.push(`tx[${ti}] double-spend: key image ${kiHex.slice(0, 12)}…`);
      } else {
        next.spentKeyImages.add(kiHex);
      }
    }

    // Add new outputs to UTXO set.
    for (const out of tx.outputs) {
      next.utxo.set(out.oneTimeAddr.toHex(), out.amount);
      if (out.storage) {
        const h = bytesToHex(storageCommitmentHash(out.storage));
        next.storage.set(h, out.storage);
        newStorages.push(out.storage);
      }
    }
  }

  /* ---- Storage root must match what the txs anchored ---- */
  // Walk the tx outputs in declared order, gather all storage commitments.
  // Sort? No — the producer chooses an order, the verifier re-derives it.
  const expectedStorageRoot = storageMerkleRoot(newStorages);
  if (!eqBytes(expectedStorageRoot, block.header.storageRoot)) {
    errors.push("storageRoot mismatch");
  }
  // The supplied storagesInBlock is a courtesy parameter for callers who
  // want to also verify the block-level storage Merkle tree without the
  // commitments being inside the tx graph (e.g. genesis). For now we
  // ignore it during regular block application — the per-tx outputs are
  // the canonical source.
  void storagesInBlock;

  if (errors.length > 0) {
    return { ok: false, errors, state, blockId: blockId(block.header) };
  }

  next.blockIds.push(blockId(block.header));
  return {
    ok: true,
    errors: [],
    state: next,
    blockId: next.blockIds[next.blockIds.length - 1],
  };
}

/* ------------------------------------------------------------------ */
/*  BLOCK BUILDER  (producer side)                                     */
/* ------------------------------------------------------------------ */

export interface BuildBlockArgs {
  state: ChainState;
  txs: TransactionWire[];
  timestamp: number;
  producerProof?: Uint8Array;
}

export function buildBlock(args: BuildBlockArgs): Block {
  // Collect storage commitments anchored by these txs.
  const newStorages: StorageCommitment[] = [];
  for (const tx of args.txs) {
    for (const out of tx.outputs) if (out.storage) newStorages.push(out.storage);
  }

  const prevHash =
    args.state.blockIds[args.state.blockIds.length - 1] ?? new Uint8Array(32);

  const header: BlockHeader = {
    version: 1,
    prevHash,
    height: args.state.height + 1,
    timestamp: args.timestamp,
    txRoot: txMerkleRoot(args.txs),
    storageRoot: storageMerkleRoot(newStorages),
    producerProof: args.producerProof ?? new Uint8Array(32),
  };
  return { header, txs: args.txs };
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

void Point;
void DOMAIN;
