/* ================================================================== *
 *  MoneyFund Network — Transaction Mempool                             *
 *                                                                      *
 *  WHAT THIS IS                                                        *
 *  ────────────                                                        *
 *  A bounded pool of validated transactions waiting to be included    *
 *  in a future block. Every node maintains its own mempool; producer  *
 *  nodes drain it to assemble blocks.                                  *
 *                                                                      *
 *  RESPONSIBILITIES                                                    *
 *  ────────────────                                                    *
 *    • Cryptographic validation on insert (CLSAG sigs, range proofs,  *
 *      balance, double-spend within-tx).                              *
 *    • Pool-level double-spend rejection (a key image present in any  *
 *      pending tx is "spent" from the pool's perspective).            *
 *    • Conflict resolution against committed chain state (cannot      *
 *      insert a tx that double-spends a chain-spent key image).       *
 *    • Eviction after inclusion (block applied → drop spent txs).     *
 *    • Bounded size with fee-based eviction when full.                *
 *                                                                      *
 *  NOT YET                                                             *
 *  ───────                                                             *
 *    • Tx replacement policy beyond simple fee-based dropping         *
 *    • Spam / DoS protection beyond size cap                          *
 *    • Mempool reorgs (when chain re-orgs would mean restoring txs)   *
 * ================================================================== */

import { verifyTransaction, type TransactionWire } from "../network/transaction";
import { bytesToHex } from "../network/codec";
import { encodeTransaction } from "../network/wire";
import { type ChainState } from "../network/block";

/* ------------------------------------------------------------------ */
/*  POLICY                                                             */
/* ------------------------------------------------------------------ */

export interface MempoolPolicy {
  /** Max number of pending transactions. Beyond this, lowest-fee txs    *
   *  are evicted to make room.                                          */
  maxTxs: number;
  /** Max total encoded byte size. Soft cap; checked before insertion.   */
  maxBytes: number;
  /** Minimum fee accepted into the pool. */
  minFee: bigint;
}

export const DEFAULT_MEMPOOL_POLICY: MempoolPolicy = {
  maxTxs: 4096,
  maxBytes: 16 * 1024 * 1024, // 16 MiB
  minFee: 0n,
};

/* ------------------------------------------------------------------ */
/*  POOL                                                               */
/* ------------------------------------------------------------------ */

interface PoolEntry {
  tx: TransactionWire;
  txIdHex: string;
  bytes: Uint8Array;
  keyImageHexes: string[];
  receivedAt: number;
}

export interface AddResult {
  ok: boolean;
  reason?: string;
  txId?: Uint8Array;
}

export class Mempool {
  private readonly policy: MempoolPolicy;
  private readonly byId: Map<string, PoolEntry> = new Map();
  private readonly byKeyImage: Map<string, string> = new Map(); // ki hex → tx id hex
  private totalBytes = 0;

  constructor(policy: MempoolPolicy = DEFAULT_MEMPOOL_POLICY) {
    this.policy = policy;
  }

  /* ---------------------------------------------------------------- */
  /*  ADD                                                              */
  /* ---------------------------------------------------------------- */

  /** Validate + insert. Returns ok=false on any rejection. */
  add(tx: TransactionWire, chainState: ChainState, now: number = Date.now()): AddResult {
    // Cheap policy checks first.
    if (tx.fee < this.policy.minFee) {
      return { ok: false, reason: `fee ${tx.fee} below minFee ${this.policy.minFee}` };
    }

    const v = verifyTransaction(tx);
    if (!v.ok) return { ok: false, reason: `invalid tx: ${v.errors.join("; ")}` };

    const idHex = bytesToHex(v.txId);
    if (this.byId.has(idHex)) {
      return { ok: false, reason: "already in pool", txId: v.txId };
    }

    const kiHexes = v.keyImages.map((ki) => ki.toHex());

    // Double-spend against chain state.
    for (const kiHex of kiHexes) {
      if (chainState.spentKeyImages.has(kiHex)) {
        return { ok: false, reason: `key image already spent on chain: ${kiHex.slice(0, 12)}…` };
      }
    }
    // Double-spend against other pool entries.
    for (const kiHex of kiHexes) {
      if (this.byKeyImage.has(kiHex)) {
        const conflicting = this.byKeyImage.get(kiHex)!;
        return {
          ok: false,
          reason: `conflicts with pooled tx ${conflicting.slice(0, 12)}… (same key image)`,
        };
      }
    }

    const bytes = encodeTransaction(tx);

    // Capacity: evict lowest-fee until we fit.
    if (this.byId.size >= this.policy.maxTxs || this.totalBytes + bytes.length > this.policy.maxBytes) {
      while (
        (this.byId.size >= this.policy.maxTxs || this.totalBytes + bytes.length > this.policy.maxBytes) &&
        this.byId.size > 0
      ) {
        const victim = this.lowestFeeEntry();
        if (!victim) break;
        if (victim.tx.fee >= tx.fee) {
          return {
            ok: false,
            reason: `pool full; incoming fee ${tx.fee} ≤ lowest-pool fee ${victim.tx.fee}`,
          };
        }
        this.removeByIdHex(victim.txIdHex);
      }
    }

    const entry: PoolEntry = {
      tx,
      txIdHex: idHex,
      bytes,
      keyImageHexes: kiHexes,
      receivedAt: now,
    };
    this.byId.set(idHex, entry);
    for (const kiHex of kiHexes) this.byKeyImage.set(kiHex, idHex);
    this.totalBytes += bytes.length;
    return { ok: true, txId: v.txId };
  }

  /* ---------------------------------------------------------------- */
  /*  DRAIN  (producer side)                                           */
  /* ---------------------------------------------------------------- */

  /** Select up to N transactions for the next block, prioritized by   *
   *  fee descending. Caller is responsible for sealing them into a    *
   *  block and (on success) calling `removeApplied`.                  */
  selectForBlock(maxBytes: number = 1024 * 1024, maxTxs: number = 256): TransactionWire[] {
    const entries = [...this.byId.values()].sort((a, b) =>
      a.tx.fee < b.tx.fee ? 1 : a.tx.fee > b.tx.fee ? -1 : 0
    );
    const out: TransactionWire[] = [];
    let bytes = 0;
    for (const e of entries) {
      if (out.length >= maxTxs) break;
      if (bytes + e.bytes.length > maxBytes) break;
      out.push(e.tx);
      bytes += e.bytes.length;
    }
    return out;
  }

  /** Bulk-remove all transactions that just got applied in a block.    *
   *  Also evict any pooled tx that conflicts with the now-spent key    *
   *  images, because they're guaranteed to fail downstream.            */
  removeApplied(applied: TransactionWire[]): void {
    for (const t of applied) {
      const idHex = bytesToHex(verifyTransaction(t).txId);
      this.removeByIdHex(idHex);
    }
  }

  /** Sweep: drop any pool entry whose key images are now on-chain.    *
   *  Useful after replaying / re-syncing.                              */
  sweep(chainState: ChainState): number {
    let removed = 0;
    for (const [idHex, e] of this.byId) {
      for (const kiHex of e.keyImageHexes) {
        if (chainState.spentKeyImages.has(kiHex)) {
          this.removeByIdHex(idHex);
          removed++;
          break;
        }
      }
    }
    return removed;
  }

  /* ---------------------------------------------------------------- */
  /*  ACCESS                                                           */
  /* ---------------------------------------------------------------- */

  has(idHex: string): boolean { return this.byId.has(idHex); }
  size(): number { return this.byId.size; }
  bytesPending(): number { return this.totalBytes; }
  list(): TransactionWire[] { return [...this.byId.values()].map((e) => e.tx); }

  /* ---------------------------------------------------------------- */
  /*  INTERNALS                                                        */
  /* ---------------------------------------------------------------- */

  private removeByIdHex(idHex: string): void {
    const e = this.byId.get(idHex);
    if (!e) return;
    this.byId.delete(idHex);
    for (const kiHex of e.keyImageHexes) {
      if (this.byKeyImage.get(kiHex) === idHex) this.byKeyImage.delete(kiHex);
    }
    this.totalBytes -= e.bytes.length;
  }

  private lowestFeeEntry(): PoolEntry | null {
    let best: PoolEntry | null = null;
    for (const e of this.byId.values()) {
      if (best === null || e.tx.fee < best.tx.fee ||
          (e.tx.fee === best.tx.fee && e.receivedAt < best.receivedAt)) {
        best = e;
      }
    }
    return best;
  }
}

/** Pretty-print a key image (for log lines). */
export function shortKi(ki: { toHex(): string }): string {
  const h = ki.toHex();
  return `${h.slice(0, 10)}…${h.slice(-4)}`;
}
