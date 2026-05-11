/* ================================================================== *
 *  MoneyFund Wallet — RPC Client                                       *
 *                                                                      *
 *  A thin wrapper around fetch() that talks JSON-RPC 2.0 to a running *
 *  ConsensusNode + RPC server. All binary objects (Block, Tx, etc.)   *
 *  are sent as hex strings; this module decodes them via the same    *
 *  wire codec the network uses, so what comes back is the same       *
 *  TransactionWire / Block / etc. that lives on the chain.            *
 *                                                                      *
 *  Used by: lib/wallet/wallet.ts (.scanRpc()), the wallet CLI, and    *
 *  any external app that wants to read or push to the network.       *
 * ================================================================== */

import {
  decodeBlock,
  decodeTransaction,
  encodeTransaction,
} from "../network/wire";
import {
  type TransactionWire,
} from "../network/transaction";
import { Point, type CurvePoint } from "../network/primitives";
import { bytesToHex, hexToBytes } from "../network/codec";
import { type Block } from "../network/block";

/* ------------------------------------------------------------------ */
/*  CLIENT                                                             */
/* ------------------------------------------------------------------ */

export interface RpcClientOptions {
  url: string;
  /** Optional bearer token, matching the server's authToken. */
  authToken?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface NodeInfo {
  nodeId: string;
  isValidator: boolean;
  height: number;
  headIdHex: string;
  validators: number;
  activeValidators: number;
  totalStake: string;
  mempool: number;
  utxoCount: number;
  spentKeyImages: number;
  storageCount: number;
  consensusParams: unknown;
}

/** One candidate decoy returned by getDecoyPool. Includes the block      *
 *  height at which the output was anchored so wallets can do gamma       *
 *  selection on age (vs. the older uniform-random scheme).               */
export interface DecoyPoolEntry {
  P: CurvePoint;
  C: CurvePoint;
  height: number;
}

export interface SubmitTxResponse {
  ok: boolean;
  reason?: string;
  txIdHex: string;
}

export class RpcClient {
  private readonly url: string;
  private readonly authToken?: string;

  constructor(opts: RpcClientOptions) {
    this.url = opts.url.replace(/\/$/, "");
    this.authToken = opts.authToken;
  }

  /* ---------------------------------------------------------------- */
  /*  TYPED METHODS                                                    */
  /* ---------------------------------------------------------------- */

  async info(): Promise<NodeInfo> {
    return this.call<NodeInfo>("info", {});
  }

  async getBlock(args: { height?: number; idHex?: string }): Promise<Block | null> {
    const r = await this.call<{ blockHex: string } | null>("getBlock", args);
    if (!r) return null;
    return decodeBlock(hexToBytes(r.blockHex));
  }

  async getTx(args: { idHex: string }): Promise<TransactionWire | null> {
    const r = await this.call<{ txHex: string } | null>("getTx", args);
    if (!r) return null;
    return decodeTransaction(hexToBytes(r.txHex));
  }

  async submitTx(tx: TransactionWire): Promise<SubmitTxResponse> {
    return this.call<SubmitTxResponse>("submitTx", {
      txHex: bytesToHex(encodeTransaction(tx)),
    });
  }

  /** Fetch a range of blocks for wallet scanning. Each entry contains   *
   *  the encoded block; the wallet decodes + scans locally so view-keys *
   *  never leave the device.                                            */
  async getBlocks(fromHeight: number, toHeight: number): Promise<Block[]> {
    const r = await this.call<{
      blocks: { height: number; blockHex: string }[];
    }>("getOutputs", { fromHeight, toHeight });
    return r.blocks.map((b) => decodeBlock(hexToBytes(b.blockHex)));
  }

  async getDecoyPool(max: number = 32): Promise<DecoyPoolEntry[]> {
    const r = await this.call<{
      pool: { oneTimeAddrHex: string; amountCommitHex: string; height: number }[];
    }>("getDecoyPool", { max });
    return r.pool.map((e) => ({
      P: Point.fromHex(e.oneTimeAddrHex),
      C: Point.fromHex(e.amountCommitHex),
      height: e.height,
    }));
  }

  /* ---------------------------------------------------------------- */
  /*  LOW-LEVEL                                                        */
  /* ---------------------------------------------------------------- */

  async call<T>(method: string, params: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.authToken) headers["authorization"] = `Bearer ${this.authToken}`;

    const res = await fetch(`${this.url}/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    const text = await res.text();
    let parsed: { result?: T; error?: { code: number; message: string } };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`RPC: invalid JSON response (status ${res.status}): ${text.slice(0, 120)}`);
    }
    if (parsed.error) {
      throw new Error(`RPC error ${parsed.error.code}: ${parsed.error.message}`);
    }
    return parsed.result as T;
  }

  async health(): Promise<{ ok: boolean; nodeId: string }> {
    const res = await fetch(`${this.url}/health`);
    return res.json() as Promise<{ ok: boolean; nodeId: string }>;
  }
}
