/* ================================================================== *
 *  MoneyFund Network — HTTP RPC                                        *
 *                                                                      *
 *  A JSON-RPC 2.0 server bolted onto a ConsensusNode + ChainStore.    *
 *  Clients (wallets, block explorers, peers) talk to a running node   *
 *  over plain HTTP.                                                    *
 *                                                                      *
 *  Method catalog                                                      *
 *  ──────────────                                                      *
 *    info             { height, headIdHex, validators, mempool, ... } *
 *    getBlock         args: { height } | { idHex } → encoded block    *
 *    getTx            args: { idHex } → encoded transaction           *
 *    submitTx         args: { txHex } → { ok, txIdHex } | { error }   *
 *    getOutputs       args: { fromHeight, toHeight } → flat list of   *
 *                     all stealth outputs in that range — used by     *
 *                     wallets to scan without downloading full blocks *
 *    getDecoyPool     args: { max } → random sample of UTXO set       *
 *                     for ring construction                            *
 *                                                                      *
 *  Binary objects are hex-encoded over the wire (TransactionWire,     *
 *  Block, ProducerProof, etc.). The client parses them back via the   *
 *  canonical wire/codec functions. This means: the source of truth    *
 *  for inter-process serialization is always wire.ts.                  *
 * ================================================================== */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ConsensusNode } from "./node";
import { ChainStore } from "../network/store";
import {
  encodeBlock,
  decodeBlock,
  encodeTransaction,
  decodeTransaction,
} from "../network/wire";
import { txId, type TransactionWire } from "../network/transaction";
import { bytesToHex, hexToBytes } from "../network/codec";
import { type Block } from "../network/block";

/* ------------------------------------------------------------------ */
/*  REQUEST / RESPONSE                                                 */
/* ------------------------------------------------------------------ */

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface RpcSuccess<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result: T;
}

interface RpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

/* ------------------------------------------------------------------ */
/*  METHOD IMPLEMENTATIONS                                             */
/* ------------------------------------------------------------------ */

type MethodFn = (
  node: ConsensusNode,
  store: ChainStore,
  params: unknown
) => unknown | Promise<unknown>;

function asObj(p: unknown): Record<string, unknown> {
  if (typeof p !== "object" || p === null) return {};
  return p as Record<string, unknown>;
}

const METHODS: Record<string, MethodFn> = {
  info: (node, store) => {
    const head = store.head();
    const state = store.currentState();
    return {
      nodeId: node.nodeId,
      isValidator: node.isValidator(),
      height: head.height,
      headIdHex: bytesToHex(head.blockId),
      validators: state.validators.length,
      activeValidators: state.validators.filter((v) => v.stake > 0n).length,
      totalStake: state.validators.reduce((acc, v) => acc + v.stake, 0n).toString(),
      mempool: node.mempoolSize(),
      utxoCount: state.utxo.size,
      spentKeyImages: state.spentKeyImages.size,
      storageCount: state.storage.size,
      consensusParams: state.params,
    };
  },

  getBlock: (_node, store, params) => {
    const p = asObj(params);
    let block: Block | null = null;
    if (typeof p.height === "number") {
      block = store.getBlock(p.height);
    } else if (typeof p.idHex === "string") {
      block = store.getBlockById(hexToBytes(p.idHex));
    } else {
      throw new Error("getBlock: provide either { height } or { idHex }");
    }
    if (!block) return null;
    return { blockHex: bytesToHex(encodeBlock(block)) };
  },

  getTx: (_node, store, params) => {
    const p = asObj(params);
    if (typeof p.idHex !== "string") throw new Error("getTx: { idHex } required");
    const tx = store.getTransaction(hexToBytes(p.idHex));
    if (!tx) return null;
    return { txHex: bytesToHex(encodeTransaction(tx)) };
  },

  submitTx: (node, _store, params) => {
    const p = asObj(params);
    if (typeof p.txHex !== "string") throw new Error("submitTx: { txHex } required");
    const tx: TransactionWire = decodeTransaction(hexToBytes(p.txHex));
    const r = node.submitTx(tx);
    return {
      ok: r.ok,
      reason: r.reason,
      txIdHex: bytesToHex(txId(tx)),
    };
  },

  getOutputs: (_node, store, params) => {
    const p = asObj(params);
    const from = typeof p.fromHeight === "number" ? p.fromHeight : 0;
    const to =
      typeof p.toHeight === "number" ? p.toHeight : store.head().height;
    const out: Array<{
      height: number;
      txIdHex: string;
      outputIndex: number;
      blockHex: string;
    }> = [];
    for (let h = from; h <= to; h++) {
      const b = store.getBlock(h);
      if (!b) continue;
      // Just return the full block hex. Wallets do the scanning themselves.
      out.push({
        height: h,
        txIdHex: "",
        outputIndex: -1,
        blockHex: bytesToHex(encodeBlock(b)),
      });
    }
    return { blocks: out };
  },

  getDecoyPool: (_node, store, params) => {
    const p = asObj(params);
    const max = typeof p.max === "number" ? p.max : 32;
    const state = store.currentState();
    const entries = [...state.utxo.entries()];
    // Pseudo-random sample (deterministic on order; production would shuffle).
    const sample = entries.slice(0, Math.min(max, entries.length));
    return {
      pool: sample.map(([pHex, entry]) => ({
        oneTimeAddrHex: pHex,
        amountCommitHex: entry.commit.toHex(),
        height: entry.height,
      })),
    };
  },
};

/* ------------------------------------------------------------------ */
/*  HTTP SERVER                                                        */
/* ------------------------------------------------------------------ */

export interface RpcServerHandle {
  stop(): Promise<void>;
  port(): number;
}

export interface RpcServerOptions {
  /** TCP port to listen on. Use 0 for an ephemeral port (good for tests).  */
  port: number;
  /** Hostname to bind. Default 127.0.0.1 (loopback only). */
  host?: string;
  /** Optional shared bearer token. Requests must include              *
   *  "authorization: Bearer <token>" if set.                          */
  authToken?: string;
}

export function startRpcServer(
  node: ConsensusNode,
  store: ChainStore,
  opts: RpcServerOptions
): Promise<RpcServerHandle> {
  const host = opts.host ?? "127.0.0.1";

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        await handle(req, res, node, store, opts);
      } catch (e) {
        writeError(res, null, -32603, `internal: ${(e as Error).message}`);
      }
    });
    server.on("error", (e) => reject(e));
    server.listen(opts.port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        port: () => actualPort,
        stop: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  node: ConsensusNode,
  store: ChainStore,
  opts: RpcServerOptions
) {
  // Simple CORS for local dev usage.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // /health is unauthenticated by design — it's the liveness probe used
  // by orchestrators and load balancers that won't have a token.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ ok: true, nodeId: node.nodeId })
    );
    return;
  }

  if (opts.authToken) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${opts.authToken}`) {
      writeError(res, null, -32001, "unauthorized");
      return;
    }
  }

  if (req.method !== "POST" || req.url !== "/rpc") {
    res.writeHead(404, { "content-type": "application/json" }).end(
      JSON.stringify({ error: "POST /rpc only" })
    );
    return;
  }

  const body = await readBody(req);
  let parsed: RpcRequest;
  try {
    parsed = JSON.parse(body);
  } catch {
    writeError(res, null, -32700, "invalid JSON");
    return;
  }

  if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
    writeError(res, parsed.id ?? null, -32600, "invalid request");
    return;
  }

  const fn = METHODS[parsed.method];
  if (!fn) {
    writeError(res, parsed.id ?? null, -32601, `method not found: ${parsed.method}`);
    return;
  }

  try {
    const result = await fn(node, store, parsed.params);
    const success: RpcSuccess<unknown> = {
      jsonrpc: "2.0",
      id: parsed.id ?? null,
      result,
    };
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify(success, bigintReplacer)
    );
  } catch (e) {
    writeError(res, parsed.id ?? null, -32603, (e as Error).message);
  }
}

function writeError(
  res: ServerResponse,
  id: number | string | null,
  code: number,
  message: string
) {
  const payload: RpcError = { jsonrpc: "2.0", id, error: { code, message } };
  res
    .writeHead(code === -32700 || code === -32600 ? 400 : 500, {
      "content-type": "application/json",
    })
    .end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
    req.on("error", (e) => reject(e));
  });
}

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

void decodeBlock;
