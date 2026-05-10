/* ================================================================== *
 *  MoneyFund Network — Gossip Message Types                            *
 *                                                                      *
 *  The four messages every node speaks:                               *
 *                                                                      *
 *    PROPOSAL   "Here is a block I'd like to produce at this slot.    *
 *               It comes with my VRF proof of eligibility."           *
 *                                                                      *
 *    VOTE       "I have verified that proposal and I'm voting for     *
 *               it. Here is my BLS signature over its header hash."   *
 *                                                                      *
 *    BLOCK      "I have collected ≥ 2/3 stake-weighted votes for a   *
 *               proposal — here is the sealed, finalized block."     *
 *                                                                      *
 *    TX         "Here is a transaction. Please include it in your    *
 *               next block if you are the producer."                  *
 *                                                                      *
 *  Every message has a deterministic byte form and a stable hash so   *
 *  nodes can de-duplicate at the gossip layer.                        *
 * ================================================================== */

import { Writer, Reader, dhash, DOMAIN } from "../network/codec";
import {
  encodeBlockHeader,
  decodeBlockHeader,
  encodeTransaction,
  decodeTransaction,
  encodeBlock,
  decodeBlock,
} from "../network/wire";
import {
  encodeProducerProof,
  decodeProducerProof,
  type ProducerProof,
} from "../network/consensus";
import {
  encodeStorageProof,
  decodeStorageProof,
  type StorageProof,
} from "../network/storage";
import {
  encodeSignature,
  decodeSignature,
  type BlsSignature,
} from "../network/bls";
import { type BlockHeader, type Block } from "../network/block";
import { type TransactionWire } from "../network/transaction";

/* ------------------------------------------------------------------ */
/*  KIND TAGS                                                          */
/* ------------------------------------------------------------------ */

export enum MsgKind {
  Proposal = 1,
  Vote     = 2,
  Block    = 3,
  Tx       = 4,
}

/* ------------------------------------------------------------------ */
/*  PROPOSAL                                                           */
/* ------------------------------------------------------------------ */

export interface ProposalMsg {
  /** Unsealed header (producerProof.length === 0). */
  header: BlockHeader;
  /** Transactions the producer intends to include. */
  txs: TransactionWire[];
  /** Producer's eligibility proof + their BLS signature over the   *
   *  header hash (the same signature that ends up in the producer  *
   *  slot of the final FinalityProof).                              */
  producer: ProducerProof;
  /** Storage proofs the producer is offering this block. */
  storageProofs: StorageProof[];
}

export function encodeProposal(p: ProposalMsg): Uint8Array {
  const w = new Writer();
  w.blob(encodeBlockHeader(p.header));
  w.varint(p.txs.length);
  for (const tx of p.txs) w.blob(encodeTransaction(tx));
  w.blob(encodeProducerProof(p.producer));
  w.varint(p.storageProofs.length);
  for (const sp of p.storageProofs) w.blob(encodeStorageProof(sp));
  return w.bytes();
}

export function decodeProposal(bytes: Uint8Array): ProposalMsg {
  const r = new Reader(bytes);
  const header = decodeBlockHeader(r.blob());
  const nTx = Number(r.varint());
  const txs: TransactionWire[] = new Array(nTx);
  for (let i = 0; i < nTx; i++) txs[i] = decodeTransaction(r.blob());
  const producer = decodeProducerProof(r.blob());
  let storageProofs: StorageProof[] = [];
  if (!r.end()) {
    const n = Number(r.varint());
    storageProofs = new Array(n);
    for (let i = 0; i < n; i++) storageProofs[i] = decodeStorageProof(r.blob());
  }
  return { header, txs, producer, storageProofs };
}

/* ------------------------------------------------------------------ */
/*  VOTE                                                               */
/* ------------------------------------------------------------------ */

export interface VoteMsg {
  height: number;
  slot: number;
  /** dhash("BLOCK_HEADER", headerBytesWithoutProof). */
  headerHash: Uint8Array;
  voterIndex: number;
  sig: BlsSignature;
}

export function encodeVote(v: VoteMsg): Uint8Array {
  const w = new Writer();
  w.u32(v.height);
  w.u32(v.slot);
  w.push(v.headerHash);
  w.u32(v.voterIndex);
  w.push(encodeSignature(v.sig));
  return w.bytes();
}

export function decodeVote(bytes: Uint8Array): VoteMsg {
  const r = new Reader(bytes);
  const height = r.u32();
  const slot = r.u32();
  const headerHash = r.bytes(32);
  const voterIndex = r.u32();
  const sig = decodeSignature(r.bytes(96));
  return { height, slot, headerHash, voterIndex, sig };
}

/* ------------------------------------------------------------------ */
/*  BLOCK + TX (already encoded by wire.ts; just thin wrappers)       */
/* ------------------------------------------------------------------ */

export interface BlockMsg { block: Block }
export interface TxMsg    { tx: TransactionWire }

export function encodeBlockMsg(m: BlockMsg): Uint8Array { return encodeBlock(m.block); }
export function decodeBlockMsg(b: Uint8Array): BlockMsg { return { block: decodeBlock(b) }; }
export function encodeTxMsg(m: TxMsg): Uint8Array     { return encodeTransaction(m.tx); }
export function decodeTxMsg(b: Uint8Array): TxMsg     { return { tx: decodeTransaction(b) }; }

/* ------------------------------------------------------------------ */
/*  UNIFIED ENVELOPE                                                   */
/* ------------------------------------------------------------------ */

export type GossipMsg =
  | { kind: MsgKind.Proposal; data: ProposalMsg }
  | { kind: MsgKind.Vote;     data: VoteMsg     }
  | { kind: MsgKind.Block;    data: BlockMsg    }
  | { kind: MsgKind.Tx;       data: TxMsg       };

export function encodeGossip(m: GossipMsg): Uint8Array {
  const w = new Writer();
  w.u8(m.kind);
  switch (m.kind) {
    case MsgKind.Proposal: w.blob(encodeProposal(m.data));    break;
    case MsgKind.Vote:     w.blob(encodeVote(m.data));        break;
    case MsgKind.Block:    w.blob(encodeBlockMsg(m.data));    break;
    case MsgKind.Tx:       w.blob(encodeTxMsg(m.data));       break;
  }
  return w.bytes();
}

export function decodeGossip(bytes: Uint8Array): GossipMsg {
  const r = new Reader(bytes);
  const kind = r.u8() as MsgKind;
  const body = r.blob();
  switch (kind) {
    case MsgKind.Proposal: return { kind, data: decodeProposal(body) };
    case MsgKind.Vote:     return { kind, data: decodeVote(body) };
    case MsgKind.Block:    return { kind, data: decodeBlockMsg(body) };
    case MsgKind.Tx:       return { kind, data: decodeTxMsg(body) };
    default: throw new Error(`unknown gossip kind ${kind}`);
  }
}

/** Deterministic hash of a gossip message. Used for de-duplication at
 *  the bus / peer layer. */
export function gossipMsgHash(m: GossipMsg): Uint8Array {
  return dhash(DOMAIN.TX_ID, encodeGossip(m));
}

void Writer;
