/* ================================================================== *
 *  MoneyFund Network — Persistent Chain Store                          *
 *                                                                      *
 *  WHAT THIS IS                                                        *
 *  ────────────                                                        *
 *  A SQLite-backed `ChainStore` that turns the previously in-memory    *
 *  chain into something a node operator can run continuously: spin    *
 *  it up, accept blocks, kill -9, restart, and the chain is exactly   *
 *  where you left it.                                                  *
 *                                                                      *
 *  DESIGN                                                              *
 *  ──────                                                              *
 *  The single source of truth is the `blocks` table — a deterministic *
 *  log of every block, indexed by height. The in-memory `ChainState`  *
 *  (UTXO set / spent key images / storage map / validators) is the    *
 *  result of replaying that log from genesis. On startup we replay;  *
 *  on every applyBlock we both commit to disk and update the cache.   *
 *                                                                      *
 *  Because the state is purely a function of the block log we never   *
 *  have to worry about disk-vs-memory divergence — if the cache is    *
 *  ever wrong a fresh re-replay heals it. Snapshot/checkpoint support *
 *  is an obvious next optimization.                                    *
 *                                                                      *
 *  TABLES                                                              *
 *  ──────                                                              *
 *    meta       single-row k/v: chain id, current height, params,     *
 *               validator-set bytes, initial-outputs bytes,           *
 *               initial-storage bytes.                                *
 *    blocks     full encoded block bytes per height + block id hex.   *
 *               Indexed by both height and id.                        *
 *    txs       (denormalized) tx id → height,index for quick lookup.  *
 *    storage    storage commit hash hex → encoded commitment.         *
 * ================================================================== */

import Database from "better-sqlite3";
import {
  applyBlock as applyBlockPure,
  applyGenesis,
  buildGenesis,
  type Block,
  type ChainState,
  type GenesisConfig,
  type ApplyResult,
  blockId,
  emptyState,
  DEFAULT_CONSENSUS_PARAMS,
} from "./block";
import {
  decodeBlock,
  encodeBlock,
  encodeValidatorSet,
  decodeValidatorSet,
  encodeConsensusParams,
  decodeConsensusParams,
  encodeInitialOutputs,
  decodeInitialOutputs,
  encodeStorageList,
  decodeStorageList,
  decodeTransaction,
  encodeTransaction,
  type InitialOutputWire,
} from "./wire";
import { txId, type TransactionWire } from "./transaction";
import { bytesToHex, hexToBytes } from "./codec";
import { storageCommitmentHash } from "./storage";
import {
  decodeBondingParams,
  encodeBondingParams,
} from "./bonding";

/* ------------------------------------------------------------------ */
/*  STORE                                                              */
/* ------------------------------------------------------------------ */

export class ChainStore {
  private db: Database.Database;
  private state: ChainState;

  /** Open or create a SQLite-backed chain at `path`. Pass ":memory:" for
   *  an ephemeral in-process store (useful for tests). */
  static open(path: string): ChainStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    // Schema. CREATE TABLE IF NOT EXISTS makes restart idempotent.
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        id BLOB NOT NULL UNIQUE,
        bytes BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS txs (
        tx_id BLOB PRIMARY KEY,
        height INTEGER NOT NULL,
        idx INTEGER NOT NULL,
        bytes BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_txs_height ON txs(height);
    `);

    return new ChainStore(db);
  }

  private constructor(db: Database.Database) {
    this.db = db;
    this.state = emptyState();
  }

  close(): void {
    this.db.close();
  }

  /* ------------------------------------------------------------------ */
  /*  INITIALIZATION                                                     */
  /* ------------------------------------------------------------------ */

  /** Has this store been initialized with a genesis block? */
  hasGenesis(): boolean {
    const row = this.db
      .prepare("SELECT v FROM meta WHERE k = ?")
      .get("genesis_block_id") as { v: Uint8Array } | undefined;
    return !!row;
  }

  /** Initialize from a fresh GenesisConfig. Persists the config so any
   *  subsequent `restore()` can rebuild state deterministically. Throws
   *  if the store already has a genesis. */
  initialize(cfg: GenesisConfig): ChainState {
    if (this.hasGenesis()) {
      throw new Error("ChainStore: already initialized; use restore() instead");
    }

    const genesis = buildGenesis(cfg);
    const state = applyGenesis(genesis, cfg);

    const tx = this.db.transaction(() => {
      this.persistGenesisConfig(cfg);
      this.persistBlock(0, blockId(genesis.header), encodeBlock(genesis), genesis);
      this.setMeta("height", encodeNumber(0));
    });
    tx();

    this.state = state;
    return state;
  }

  /** Restore state by replaying every block on disk. Returns the
   *  reconstructed `ChainState`. */
  restore(): ChainState {
    if (!this.hasGenesis()) {
      throw new Error("ChainStore: no genesis present; call initialize() first");
    }

    const cfg = this.loadGenesisConfig();
    const genesisRow = this.db
      .prepare("SELECT bytes FROM blocks WHERE height = 0")
      .get() as { bytes: Uint8Array } | undefined;
    if (!genesisRow) throw new Error("ChainStore: genesis block missing");
    const genesis = decodeBlock(genesisRow.bytes);
    let state = applyGenesis(genesis, cfg);

    const blocks = this.db
      .prepare("SELECT bytes FROM blocks WHERE height > 0 ORDER BY height ASC")
      .all() as { bytes: Uint8Array }[];

    for (const row of blocks) {
      const block = decodeBlock(row.bytes);
      const result = applyBlockPure(state, block);
      if (!result.ok) {
        throw new Error(
          `ChainStore: replay failed at height ${block.header.height}: ${result.errors.join("; ")}`
        );
      }
      state = result.state;
    }

    this.state = state;
    return state;
  }

  /** Open or restore in one step. If genesis exists, restore; else      *
   *  initialize from `cfg`. Returns the resulting state.                */
  initializeOrRestore(cfg: GenesisConfig): ChainState {
    if (this.hasGenesis()) return this.restore();
    return this.initialize(cfg);
  }

  /* ------------------------------------------------------------------ */
  /*  APPLY                                                              */
  /* ------------------------------------------------------------------ */

  /** Apply a block atomically: validate against current state, persist
   *  on success, advance the cache. Returns the same shape as
   *  applyBlock so callers don't care whether we're in-memory or on disk. */
  applyBlock(block: Block): ApplyResult {
    const result = applyBlockPure(this.state, block);
    if (!result.ok) return result;

    const tx = this.db.transaction(() => {
      this.persistBlock(block.header.height, result.blockId, encodeBlock(block), block);
      this.setMeta("height", encodeNumber(block.header.height));
    });
    tx();

    this.state = result.state;
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  ACCESSORS                                                          */
  /* ------------------------------------------------------------------ */

  currentState(): ChainState {
    return this.state;
  }

  head(): { height: number; blockId: Uint8Array } {
    const h = this.state.height;
    const id = this.state.blockIds[this.state.blockIds.length - 1] ?? new Uint8Array(0);
    return { height: h, blockId: id };
  }

  getBlock(height: number): Block | null {
    const row = this.db
      .prepare("SELECT bytes FROM blocks WHERE height = ?")
      .get(height) as { bytes: Uint8Array } | undefined;
    if (!row) return null;
    return decodeBlock(row.bytes);
  }

  getBlockById(id: Uint8Array): Block | null {
    const row = this.db
      .prepare("SELECT bytes FROM blocks WHERE id = ?")
      .get(Buffer.from(id)) as { bytes: Uint8Array } | undefined;
    if (!row) return null;
    return decodeBlock(row.bytes);
  }

  getTransaction(id: Uint8Array): TransactionWire | null {
    const row = this.db
      .prepare("SELECT bytes FROM txs WHERE tx_id = ?")
      .get(Buffer.from(id)) as { bytes: Uint8Array } | undefined;
    if (!row) return null;
    return decodeTransaction(row.bytes);
  }

  blockCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM blocks").get() as { n: number };
    return row.n;
  }

  /* ------------------------------------------------------------------ */
  /*  INTERNAL                                                           */
  /* ------------------------------------------------------------------ */

  private persistBlock(
    height: number,
    id: Uint8Array,
    bytes: Uint8Array,
    block: Block
  ): void {
    this.db
      .prepare("INSERT INTO blocks(height, id, bytes) VALUES(?, ?, ?)")
      .run(height, Buffer.from(id), Buffer.from(bytes));

    const insertTx = this.db.prepare(
      "INSERT INTO txs(tx_id, height, idx, bytes) VALUES(?, ?, ?, ?)"
    );
    for (let i = 0; i < block.txs.length; i++) {
      const t = block.txs[i];
      insertTx.run(Buffer.from(txId(t)), height, i, Buffer.from(encodeTransaction(t)));
    }
  }

  private persistGenesisConfig(cfg: GenesisConfig): void {
    const params = cfg.params ?? DEFAULT_CONSENSUS_PARAMS;
    const validators = cfg.validators ?? [];
    const outputs: InitialOutputWire[] = cfg.initialOutputs.map((o) => ({
      oneTimeAddr: o.oneTimeAddr,
      amount: o.amount,
    }));

    this.setMeta("params", encodeConsensusParams(params));
    this.setMeta("validators", encodeValidatorSet(validators));
    this.setMeta("initial_outputs", encodeInitialOutputs(outputs));
    this.setMeta("initial_storage", encodeStorageList(cfg.initialStorage));
    this.setMeta("genesis_timestamp", encodeNumber(cfg.timestamp));
    if (cfg.producerProof) {
      this.setMeta("genesis_producer_proof", cfg.producerProof);
    }
    if (cfg.bondingParams !== undefined) {
      this.setMeta("bonding_params", encodeBondingParams(cfg.bondingParams));
    }

    // Mark a sentinel so hasGenesis() works.
    this.setMeta("genesis_block_id", new Uint8Array([1]));
  }

  private loadGenesisConfig(): GenesisConfig {
    const params = decodeConsensusParams(this.requireMeta("params"));
    const validators = decodeValidatorSet(this.requireMeta("validators"));
    const initialOutputs = decodeInitialOutputs(this.requireMeta("initial_outputs"));
    const initialStorage = decodeStorageList(this.requireMeta("initial_storage"));
    const timestamp = decodeNumber(this.requireMeta("genesis_timestamp"));
    const producerProof = this.tryGetMeta("genesis_producer_proof") ?? undefined;
    const bondingParamsBlob = this.tryGetMeta("bonding_params");
    const bondingParams = bondingParamsBlob
      ? decodeBondingParams(bondingParamsBlob)
      : undefined;

    return {
      timestamp,
      initialOutputs,
      initialStorage,
      validators,
      params,
      bondingParams,
      producerProof,
    };
  }

  private setMeta(k: string, v: Uint8Array): void {
    this.db
      .prepare("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)")
      .run(k, Buffer.from(v));
  }

  private requireMeta(k: string): Uint8Array {
    const v = this.tryGetMeta(k);
    if (!v) throw new Error(`ChainStore: missing meta key ${k}`);
    return v;
  }

  private tryGetMeta(k: string): Uint8Array | null {
    const row = this.db.prepare("SELECT v FROM meta WHERE k = ?").get(k) as
      | { v: Uint8Array }
      | undefined;
    return row ? row.v : null;
  }
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function encodeNumber(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(n), false);
  return buf;
}

function decodeNumber(b: Uint8Array): number {
  return Number(new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(0, false));
}

void bytesToHex;
void hexToBytes;
void storageCommitmentHash;
