/* ================================================================== *
 *  MoneyFund Network — Consensus Node                                  *
 *                                                                      *
 *  THE BLOCK PRODUCTION + AGREEMENT MACHINE                            *
 *  ────────────────────────────────────────                            *
 *  This is the thing that actually runs the chain. A node owns:       *
 *                                                                      *
 *    • a ChainStore                      (state + on-disk log)        *
 *    • a Mempool                         (pending transactions)       *
 *    • an optional ValidatorSecrets       (if this node validates)     *
 *    • a GossipBus subscription          (peer-to-peer messaging)     *
 *                                                                      *
 *  PER-SLOT PROTOCOL                                                   *
 *  ─────────────────                                                   *
 *  Every node calls `beginSlot(slot, now)` when its local slot timer  *
 *  fires (typically every 6–12 s). Inside that one call:              *
 *                                                                      *
 *    1. If this node is a VALIDATOR AND eligible (VRF), it builds a   *
 *       block from its mempool, signs the header, publishes a         *
 *       ProposalMsg.                                                  *
 *    2. On each proposal it receives (gossip-driven), the node:       *
 *         - verifies the producer's VRF eligibility                   *
 *         - verifies every tx                                         *
 *         - tracks it as a candidate; the smallest-β proposal wins    *
 *    3. When the slot's "vote window" opens (we model that as: as    *
 *       soon as a slot has at least one valid proposal), the node    *
 *       casts a BLS vote on the current winner if it hasn't voted    *
 *       yet for this slot.                                            *
 *    4. On every Vote it receives, the node updates per-proposal     *
 *       vote tallies. When stake-weighted votes ≥ 2/3, it aggregates *
 *       into a FinalityProof, seals the block, applies it locally,   *
 *       and publishes a BlockMsg.                                     *
 *    5. On a BlockMsg, every node validates + applies + drops the    *
 *       included txs from its mempool.                                *
 *                                                                      *
 *  This is a deliberately simplified Tendermint-style single-round    *
 *  protocol. Production hardenings (timeouts, view changes, double-   *
 *  signing detection beyond the slashing primitive) are explicit      *
 *  follow-ups; they all hang off the same data flow without changing  *
 *  the message format.                                                *
 * ================================================================== */

import { ChainStore } from "../network/store";
import {
  buildStorageProof,
  verifyStorageProof,
  type StorageProof,
  type MerkleTree,
} from "../network/storage";
import { Mempool, type AddResult } from "./mempool";
import {
  buildUnsealedHeader,
  sealBlock,
  blockId,
  headerSigningHash,
  type Block,
} from "../network/block";
import {
  tryProduceSlot,
  verifyProducerProof,
  finalize,
  encodeFinalityProof,
  type Validator,
  type ValidatorSecrets,
  type SlotContext,
  type FinalityProof,
} from "../network/consensus";
import {
  blsSign,
  blsVerify,
  type CommitteeVote,
} from "../network/bls";
import { bytesToHex } from "../network/codec";
import {
  verifyTransaction,
  type TransactionWire,
} from "../network/transaction";
import {
  MsgKind,
  type GossipMsg,
  type ProposalMsg,
  type VoteMsg,
} from "./messages";
import { type GossipBus } from "./gossip";

/* ------------------------------------------------------------------ */
/*  CONFIG + CONSTRUCTION                                              */
/* ------------------------------------------------------------------ */

export interface NodeConfig {
  /** Unique id of this node within the local process / network.       */
  nodeId: string;
  /** Persistent chain store. Must already be initialized or restored. */
  store: ChainStore;
  /** Gossip bus this node will subscribe to.                          */
  bus: GossipBus;
  /** This node's validator secrets — omit to run an observer-only     *
   *  node (e.g. a wallet RPC, or a transaction relay).                */
  secrets?: ValidatorSecrets;
  /** Mempool to use; defaults to a fresh one with default policy.     */
  mempool?: Mempool;
  /** Local storage cache: any storage commitments this node is acting *
   *  as a prover for. When proposing a block, the node will answer    *
   *  per-block challenges for every commitHash in this cache.         */
  storageCache?: StorageHoldings;
  /** Logger callback. Defaults to silent. */
  log?: (entry: NodeLogEntry) => void;
}

/** Per-commitment full data + pre-computed Merkle tree. Anyone holding *
 *  this can answer SPoRA-style challenges in O(log N) time.            */
export interface StorageHoldings {
  /** Map from commitHash hex → { data, tree } */
  byCommit: Map<string, { data: Uint8Array; tree: MerkleTree }>;
}

export function emptyStorageHoldings(): StorageHoldings {
  return { byCommit: new Map() };
}

export interface NodeLogEntry {
  nodeId: string;
  level: "info" | "warn" | "error";
  event: string;
  data?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  PER-SLOT BOOKKEEPING                                               */
/* ------------------------------------------------------------------ */

interface ProposalRecord {
  msg: ProposalMsg;
  headerHash: Uint8Array;
  headerHashHex: string;
  /** Tally of votes seen for this exact header hash. Index → BLS sig. */
  votes: Map<number, CommitteeVote>;
  /** Stake-weight sum of unique voters so far. */
  stakeSigned: bigint;
}

interface SlotState {
  slot: number;
  height: number;
  /** All valid proposals received in this slot, keyed by header-hash hex. */
  proposals: Map<string, ProposalRecord>;
  /** Whether this node has already cast a vote in this slot. */
  voted: boolean;
  /** Whether a finalized block for this slot has already been applied. */
  sealed: boolean;
}

/* ------------------------------------------------------------------ */
/*  NODE                                                               */
/* ------------------------------------------------------------------ */

export class ConsensusNode {
  readonly nodeId: string;
  private readonly store: ChainStore;
  private readonly mempool: Mempool;
  private readonly bus: GossipBus;
  private readonly secrets: ValidatorSecrets | undefined;
  private readonly storageCache: StorageHoldings;
  private readonly log: (entry: NodeLogEntry) => void;

  private unsubscribe: (() => void) | null = null;
  private slot: SlotState | null = null;

  constructor(cfg: NodeConfig) {
    this.nodeId = cfg.nodeId;
    this.store = cfg.store;
    this.bus = cfg.bus;
    this.secrets = cfg.secrets;
    this.mempool = cfg.mempool ?? new Mempool();
    this.storageCache = cfg.storageCache ?? emptyStorageHoldings();
    this.log = cfg.log ?? (() => {});
  }

  /** Register data this node is willing to prove storage of. Returns   *
   *  the commitment hash hex of the resulting registration.            */
  registerStorageData(commitHashHex: string, data: Uint8Array, tree: MerkleTree): void {
    this.storageCache.byCommit.set(commitHashHex, { data, tree });
  }

  /* ---------------------------------------------------------------- */
  /*  LIFECYCLE                                                        */
  /* ---------------------------------------------------------------- */

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe(this.nodeId, (m, from) => this.onGossip(m, from));
    this.info("start", { isValidator: !!this.secrets });
  }

  stop(): void {
    if (!this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
    this.info("stop");
  }

  isValidator(): boolean { return !!this.secrets; }

  /* ---------------------------------------------------------------- */
  /*  PUBLIC API                                                       */
  /* ---------------------------------------------------------------- */

  /** Submit a transaction to this node's mempool. Re-broadcasts on    *
   *  success so peers can pick it up.                                 */
  submitTx(tx: TransactionWire): AddResult {
    const r = this.mempool.add(tx, this.store.currentState());
    if (r.ok) {
      this.info("tx-accepted", { txId: r.txId ? bytesToHex(r.txId) : null });
      this.bus.publish({ kind: MsgKind.Tx, data: { tx } }, this.nodeId);
    } else {
      this.info("tx-rejected", { reason: r.reason });
    }
    return r;
  }

  head(): { height: number; blockId: Uint8Array } {
    return this.store.head();
  }

  mempoolSize(): number { return this.mempool.size(); }

  /** Begin a slot. Triggers proposal if this node is an eligible      *
   *  validator. Voting and sealing happen reactively as gossip        *
   *  messages arrive (and synchronously in InProcessGossipBus).       */
  beginSlot(slot: number, now: number): void {
    const state = this.store.currentState();
    const nextHeight = state.height + 1;

    // Initialize per-slot bookkeeping.
    this.slot = {
      slot,
      height: nextHeight,
      proposals: new Map(),
      voted: false,
      sealed: false,
    };

    if (!this.secrets || state.validators.length === 0) {
      this.info("slot-begin-observer", { slot, height: nextHeight });
      return;
    }

    // Construct an unsealed header that proposes my mempool's contents.
    const txs = this.mempool.selectForBlock();
    const unsealed = buildUnsealedHeader({ state, txs, slot, timestamp: now });
    const headerHash = headerSigningHash(unsealed);

    // Build storage proofs for any commitment in state.storage that we
    // also have cached data for. Skip proofs for commits being anchored
    // in this same block (they're not in state.storage yet) -- those
    // will be answerable starting next block.
    const storageProofs: StorageProof[] = [];
    for (const [cHashHex, entry] of state.storage) {
      const held = this.storageCache.byCommit.get(cHashHex);
      if (!held) continue;
      try {
        const sp = buildStorageProof(
          entry.commit,
          unsealed.prevHash,
          slot,
          held.data,
          held.tree
        );
        storageProofs.push(sp);
      } catch (e) {
        this.warn("storage-proof-build-failed", { commit: cHashHex.slice(0, 12), error: (e as Error).message });
      }
    }

    const me = state.validators[this.secrets.index];
    if (!me) {
      this.warn("not-in-validator-set", { idx: this.secrets.index });
      return;
    }
    const totalStake = state.validators.reduce((acc, v) => acc + v.stake, 0n);

    const ctx: SlotContext = {
      height: nextHeight,
      slot,
      prevHash: unsealed.prevHash,
    };

    const producer = tryProduceSlot(
      ctx,
      this.secrets,
      me,
      totalStake,
      state.params.expectedProposersPerSlot,
      headerHash
    );
    if (!producer) {
      this.info("slot-not-eligible", { slot, height: nextHeight });
      return;
    }

    const proposalMsg: ProposalMsg = { header: unsealed, txs, producer, storageProofs };
    this.info("propose", {
      slot,
      height: nextHeight,
      betaPrefix: bytesToHex(producer.beta).slice(0, 12),
      txCount: txs.length,
      storageProofs: storageProofs.length,
    });

    // Locally ingest the proposal first, then broadcast.
    this.ingestProposal(proposalMsg);
    this.bus.publish({ kind: MsgKind.Proposal, data: proposalMsg }, this.nodeId);
  }

  /* ---------------------------------------------------------------- */
  /*  GOSSIP HANDLING                                                  */
  /* ---------------------------------------------------------------- */

  private onGossip(m: GossipMsg, _from?: string): void {
    switch (m.kind) {
      case MsgKind.Proposal: this.ingestProposal(m.data); break;
      case MsgKind.Vote:     this.ingestVote(m.data);     break;
      case MsgKind.Block:    this.ingestBlock(m.data.block); break;
      case MsgKind.Tx:       this.ingestTx(m.data.tx);     break;
    }
  }

  private ingestTx(tx: TransactionWire): void {
    // Don't re-publish — just add to local mempool.
    const r = this.mempool.add(tx, this.store.currentState());
    if (!r.ok) this.info("tx-rejected", { reason: r.reason });
  }

  private ingestProposal(p: ProposalMsg): void {
    const state = this.store.currentState();
    if (state.validators.length === 0) return;

    const sl = this.slot;
    if (!sl) return; // we haven't begun a slot yet — drop

    // Discard proposals not for this slot/height.
    if (p.header.slot !== sl.slot || p.header.height !== sl.height) {
      this.info("proposal-wrong-slot", {
        gotSlot: p.header.slot, gotHeight: p.header.height,
        wantSlot: sl.slot, wantHeight: sl.height,
      });
      return;
    }
    if (p.header.producerProof.length !== 0) {
      this.warn("proposal-has-proof", {});
      return;
    }

    const headerHash = headerSigningHash(p.header);
    const headerHashHex = bytesToHex(headerHash);
    if (sl.proposals.has(headerHashHex)) return; // dedup

    // Validate producer eligibility.
    const me = state.validators[p.producer.validatorIndex];
    if (!me) {
      this.warn("proposal-unknown-validator", { idx: p.producer.validatorIndex });
      return;
    }
    const totalStake = state.validators.reduce((acc, v) => acc + v.stake, 0n);
    const ctx: SlotContext = {
      height: sl.height, slot: sl.slot, prevHash: p.header.prevHash,
    };
    const v = verifyProducerProof(
      ctx, p.producer, me, totalStake,
      state.params.expectedProposersPerSlot, headerHash
    );
    if (!v.ok) {
      this.warn("proposal-producer-invalid", { reason: v.reason });
      return;
    }

    // Validate every storage proof against the on-chain registry.
    const seenStorageProof = new Set<string>();
    for (let i = 0; i < p.storageProofs.length; i++) {
      const sp = p.storageProofs[i];
      const cHashHex = bytesToHex(sp.commitHash);
      if (seenStorageProof.has(cHashHex)) {
        this.warn("proposal-storage-proof-duplicate", { i });
        return;
      }
      seenStorageProof.add(cHashHex);
      const entry = state.storage.get(cHashHex);
      if (!entry) {
        this.warn("proposal-storage-proof-unknown-commit", { i, commit: cHashHex.slice(0, 12) });
        return;
      }
      const v = verifyStorageProof(entry.commit, p.header.prevHash, p.header.slot, sp);
      if (!v.ok) {
        this.warn("proposal-storage-proof-invalid", { i, reason: v.reason });
        return;
      }
    }

    // Validate every tx without mutating the mempool. Three checks:
    //   1. each tx is cryptographically valid on its own
    //   2. no tx double-spends a key image already on-chain
    //   3. no two txs in the proposal share a key image
    const seenKi = new Set<string>();
    for (let i = 0; i < p.txs.length; i++) {
      const tx = p.txs[i];
      const vt = verifyTransaction(tx);
      if (!vt.ok) {
        this.warn("proposal-bad-tx", { i, reason: vt.errors.join("; ") });
        return;
      }
      for (const ki of vt.keyImages) {
        const kiHex = ki.toHex();
        if (state.spentKeyImages.has(kiHex)) {
          this.warn("proposal-double-spend-chain", { i, ki: kiHex.slice(0, 12) });
          return;
        }
        if (seenKi.has(kiHex)) {
          this.warn("proposal-double-spend-intra", { i, ki: kiHex.slice(0, 12) });
          return;
        }
        seenKi.add(kiHex);
      }
    }

    const record: ProposalRecord = {
      msg: p,
      headerHash,
      headerHashHex,
      votes: new Map(),
      stakeSigned: 0n,
    };
    sl.proposals.set(headerHashHex, record);

    // Cast our vote (only one per slot).
    this.maybeVote();

    // If we're behind the producer (we received their vote before ours
    // landed), check if we can already finalize.
    this.maybeFinalize(record);
  }

  private maybeVote(): void {
    const sl = this.slot;
    if (!sl || sl.voted || sl.sealed || !this.secrets) return;

    // Pick the proposal with the smallest VRF β among those we've seen.
    let winner: ProposalRecord | null = null;
    for (const rec of sl.proposals.values()) {
      if (!winner || ltBytes(rec.msg.producer.beta, winner.msg.producer.beta)) {
        winner = rec;
      }
    }
    if (!winner) return;

    const sig = blsSign(winner.headerHash, this.secrets.bls.sk);
    const vote: VoteMsg = {
      height: sl.height,
      slot: sl.slot,
      headerHash: winner.headerHash,
      voterIndex: this.secrets.index,
      sig,
    };
    sl.voted = true;

    // Self-ingest, then broadcast.
    this.ingestVote(vote);
    this.bus.publish({ kind: MsgKind.Vote, data: vote }, this.nodeId);
    this.info("vote", {
      slot: sl.slot,
      forBeta: bytesToHex(winner.msg.producer.beta).slice(0, 12),
    });
  }

  private ingestVote(v: VoteMsg): void {
    const state = this.store.currentState();
    const sl = this.slot;
    if (!sl || sl.sealed) return;
    if (v.slot !== sl.slot || v.height !== sl.height) return;

    const headerHashHex = bytesToHex(v.headerHash);
    const rec = sl.proposals.get(headerHashHex);
    if (!rec) return; // we haven't seen the corresponding proposal yet

    if (rec.votes.has(v.voterIndex)) return; // dedup

    const validator = state.validators[v.voterIndex];
    if (!validator) {
      this.warn("vote-unknown-voter", { idx: v.voterIndex });
      return;
    }
    if (!blsVerify(v.sig, v.headerHash, validator.blsPk)) {
      this.warn("vote-bad-sig", { idx: v.voterIndex });
      return;
    }

    rec.votes.set(v.voterIndex, { index: v.voterIndex, sig: v.sig });
    rec.stakeSigned += validator.stake;

    this.maybeFinalize(rec);
  }

  private maybeFinalize(rec: ProposalRecord): void {
    const sl = this.slot;
    const state = this.store.currentState();
    if (!sl || sl.sealed) return;
    if (state.validators.length === 0) return;

    const totalStake = state.validators.reduce((acc, v) => acc + v.stake, 0n);
    const quorum =
      (totalStake * BigInt(state.params.quorumStakeBps) + 9999n) / 10000n;
    if (rec.stakeSigned < quorum) return;

    // Aggregate the votes into a CommitteeAggregate.
    const votes = [...rec.votes.values()];
    const finality = finalize(rec.headerHash, votes, state.validators.length);
    const finalityProof: FinalityProof = {
      producer: rec.msg.producer,
      finality,
      signingStake: rec.stakeSigned,
    };

    const sealed = sealBlock(
      rec.msg.header,
      rec.msg.txs,
      encodeFinalityProof(finalityProof),
      rec.msg.storageProofs
    );
    sl.sealed = true;

    // Apply locally first, then broadcast the sealed block.
    const result = this.store.applyBlock(sealed);
    if (!result.ok) {
      this.error("self-apply-failed", { errors: result.errors });
      sl.sealed = false; // allow retry on next vote
      return;
    }
    this.mempool.removeApplied(sealed.txs);
    this.info("sealed", {
      height: sealed.header.height,
      slot: sealed.header.slot,
      txs: sealed.txs.length,
      signers: votes.length,
      storageProofs: sealed.storageProofs.length,
      blockId: bytesToHex(result.blockId).slice(0, 16),
    });

    this.bus.publish({ kind: MsgKind.Block, data: { block: sealed } }, this.nodeId);
  }

  private ingestBlock(block: Block): void {
    const sl = this.slot;
    // If we already applied at this height, ignore.
    if (this.store.currentState().height >= block.header.height) return;

    const result = this.store.applyBlock(block);
    if (!result.ok) {
      this.error("apply-failed", { height: block.header.height, errors: result.errors });
      return;
    }
    this.mempool.removeApplied(block.txs);
    this.info("applied", {
      height: block.header.height,
      blockId: bytesToHex(result.blockId).slice(0, 16),
    });

    if (sl && sl.height === block.header.height) {
      sl.sealed = true;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  LOGGING HELPERS                                                  */
  /* ---------------------------------------------------------------- */

  private info(event: string, data?: Record<string, unknown>): void {
    this.log({ nodeId: this.nodeId, level: "info", event, data });
  }
  private warn(event: string, data?: Record<string, unknown>): void {
    this.log({ nodeId: this.nodeId, level: "warn", event, data });
  }
  private error(event: string, data?: Record<string, unknown>): void {
    this.log({ nodeId: this.nodeId, level: "error", event, data });
  }
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function ltBytes(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return a.length < b.length;
}

void blockId;
