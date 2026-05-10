/* ================================================================== *
 *  MoneyFund Network — Gossip Bus                                      *
 *                                                                      *
 *  An abstraction over the message-passing layer. Production nodes    *
 *  bind this to libp2p / HTTP / sockets; tests bind it to an          *
 *  in-process synchronous bus that delivers messages immediately.     *
 *                                                                      *
 *  Contract:                                                           *
 *    publish(msg)                  broadcast to all subscribers       *
 *                                  (excluding the sender, optionally) *
 *    subscribe(fn) → unsubscribe   receive every published message    *
 *                                                                      *
 *  De-duplication is intentionally NOT done in the bus itself — that  *
 *  decision belongs to the ConsensusNode, which knows whether a       *
 *  given message is novel (e.g. a vote it has already counted).       *
 * ================================================================== */

import { gossipMsgHash, type GossipMsg } from "./messages";
import { bytesToHex } from "../network/codec";

/* ------------------------------------------------------------------ */
/*  ABSTRACT                                                           */
/* ------------------------------------------------------------------ */

export interface GossipBus {
  publish(msg: GossipMsg, fromNodeId?: string): void;
  subscribe(nodeId: string, handler: (msg: GossipMsg, fromNodeId?: string) => void): () => void;
}

/* ------------------------------------------------------------------ */
/*  IN-PROCESS SYNCHRONOUS BUS                                         */
/*                                                                     *
 *  Used by tests and the multi-validator simulation. Synchronous      *
 *  delivery means consensus rounds run to completion within a single  *
 *  call stack — convenient for deterministic testing.                 */
/* ------------------------------------------------------------------ */

export class InProcessGossipBus implements GossipBus {
  private subs: Map<string, (msg: GossipMsg, from?: string) => void> = new Map();
  private deliveredHashes: Set<string> = new Set();
  private totalDelivered = 0;

  publish(msg: GossipMsg, fromNodeId?: string): void {
    const h = bytesToHex(gossipMsgHash(msg));
    if (this.deliveredHashes.has(h)) return;
    this.deliveredHashes.add(h);
    this.totalDelivered++;

    // Deliver to all subscribers except the sender.
    for (const [id, fn] of this.subs) {
      if (id === fromNodeId) continue;
      try {
        fn(msg, fromNodeId);
      } catch (e) {
        // Don't let one buggy subscriber poison the bus.
        console.error(`gossip subscriber ${id} threw:`, e);
      }
    }
  }

  subscribe(nodeId: string, handler: (msg: GossipMsg, fromNodeId?: string) => void): () => void {
    if (this.subs.has(nodeId)) {
      throw new Error(`gossip: nodeId ${nodeId} already subscribed`);
    }
    this.subs.set(nodeId, handler);
    return () => { this.subs.delete(nodeId); };
  }

  /** Number of unique messages delivered through this bus. Useful for
   *  smoke-test instrumentation. */
  stats(): { uniqueMessages: number; subscribers: number } {
    return { uniqueMessages: this.totalDelivered, subscribers: this.subs.size };
  }

  /** Clear the de-dup cache. Used between independent test runs that    *
   *  reuse the bus.                                                     */
  reset(): void {
    this.deliveredHashes.clear();
    this.totalDelivered = 0;
  }
}
