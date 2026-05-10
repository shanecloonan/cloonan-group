/* ================================================================== *
 *  Smoke: HTTP RPC + remote client                                    *
 *                                                                      *
 *  Boots a single-validator ConsensusNode behind an HTTP RPC server   *
 *  and exercises the RPC pipe from an out-of-process client:          *
 *                                                                      *
 *    • /health responds                                               *
 *    • info() reports a sane chain head                               *
 *    • getBlock() round-trips both by height and by id                *
 *    • getBlock(missing) returns null                                 *
 *    • Wallet.scanRpc() finds no outputs on empty chain               *
 *    • submitTx rejects garbage                                       *
 *    • getDecoyPool returns [] on empty UTXO                          *
 *    • produce a few blocks; client.info() reflects new height        *
 * ================================================================== */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wallet } from "../lib/wallet/wallet";
import { ChainStore } from "../lib/network/store";
import { ConsensusNode } from "../lib/node/node";
import { startRpcServer } from "../lib/node/rpc";
import { RpcClient } from "../lib/wallet/rpc-client";
import { InProcessGossipBus } from "../lib/node/gossip";
import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen } from "../lib/network/bls";
import {
  type Validator,
  type ValidatorSecrets,
} from "../lib/network/consensus";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

async function main() {
  console.log("\n== Smoke: HTTP RPC + remote client ==\n");

  const tmp = mkdtempSync(join(tmpdir(), "mfbn-rpc-"));
  console.log(`• ephemeral dir: ${tmp}`);

  /* -------------------------------------------------------------- *
   *  1. Single-validator genesis.                                  *
   * -------------------------------------------------------------- */
  const vrf = vrfKeygen();
  const bls = blsKeygen();
  const secrets: ValidatorSecrets = { index: 0, vrf, bls };
  const validator: Validator = {
    index: 0,
    vrfPk: vrf.pk,
    blsPk: bls.pk,
    stake: 1_000_000n,
  };

  const cfg = {
    timestamp: 1700000000,
    initialOutputs: [],
    initialStorage: [],
    validators: [validator],
  };

  const store = ChainStore.open(join(tmp, "node.db"));
  store.initialize(cfg);

  const bus = new InProcessGossipBus();
  const node = new ConsensusNode({
    nodeId: "rpc-host",
    store,
    bus,
    secrets,
  });
  node.start();

  /* -------------------------------------------------------------- *
   *  2. RPC server.                                                *
   * -------------------------------------------------------------- */
  const rpc = await startRpcServer(node, store, {
    port: 0,
    host: "127.0.0.1",
    authToken: "test-secret",
  });
  const url = `http://127.0.0.1:${rpc.port()}`;
  console.log(`• RPC listening on ${url}`);
  const client = new RpcClient({ url, authToken: "test-secret" });

  /* -------------------------------------------------------------- *
   *  3. Health + info.                                             *
   * -------------------------------------------------------------- */
  const h = await client.health();
  ok("/health → ok", h.ok === true && h.nodeId === "rpc-host");

  const info0 = await client.info();
  ok("info(): height 0", info0.height === 0);
  ok("info(): 1 validator", info0.validators === 1);
  ok("info(): mempool empty", info0.mempool === 0);
  ok("info(): isValidator true", info0.isValidator === true);

  /* -------------------------------------------------------------- *
   *  4. getBlock round-trip (genesis).                             *
   * -------------------------------------------------------------- */
  const g0 = await client.getBlock({ height: 0 });
  ok("getBlock(0) returned genesis", g0 !== null && g0.header.height === 0);

  const g0ById = await client.getBlock({ idHex: info0.headIdHex });
  ok(
    "getBlock(idHex) returned same genesis",
    g0ById !== null && g0ById.header.height === 0
  );

  const missing = await client.getBlock({ height: 9999 });
  ok("getBlock(missing) → null", missing === null);

  /* -------------------------------------------------------------- *
   *  5. Auth check: wrong token rejected.                          *
   * -------------------------------------------------------------- */
  const badClient = new RpcClient({ url, authToken: "wrong" });
  let authRejected = false;
  try {
    await badClient.info();
  } catch (e) {
    authRejected = /unauthorized/i.test((e as Error).message);
  }
  ok("info() with wrong auth → unauthorized", authRejected);

  /* -------------------------------------------------------------- *
   *  6. Empty wallet scan via RPC.                                 *
   * -------------------------------------------------------------- */
  const wallet = Wallet.generate();
  const scan0 = await wallet.scanRpc(client);
  ok("scanRpc on empty chain → 0 new outputs", scan0.newOutputs === 0);

  /* -------------------------------------------------------------- *
   *  7. Garbage submitTx is rejected by the node.                  *
   * -------------------------------------------------------------- */
  let gotSubmitErr = false;
  try {
    // Send a hex payload that isn't a valid encoded transaction.
    await client.call("submitTx", { txHex: "00".repeat(8) });
  } catch (e) {
    gotSubmitErr = /./.test((e as Error).message);
  }
  ok("submitTx with malformed payload errors", gotSubmitErr);

  /* -------------------------------------------------------------- *
   *  8. Decoy pool on empty UTXO.                                  *
   * -------------------------------------------------------------- */
  const decoys = await client.getDecoyPool(8);
  ok("getDecoyPool → []", decoys.length === 0);

  /* -------------------------------------------------------------- *
   *  9. Drive a few slots, prove RPC reflects new height.          *
   * -------------------------------------------------------------- */
  let producedHeight = 0;
  for (let slot = 0; slot < 30 && producedHeight < 3; slot++) {
    const now = 1700001000 + slot * 6;
    node.beginSlot(slot, now);
    if (node.head().height > producedHeight) {
      producedHeight = node.head().height;
    }
  }
  ok("≥ 3 blocks produced", producedHeight >= 3);

  const info1 = await client.info();
  ok(
    "info().height reflects local head",
    info1.height === node.head().height
  );
  ok("info().height > 0", info1.height > 0);

  // getBlock(1) should work.
  const b1 = await client.getBlock({ height: 1 });
  ok("getBlock(1) decoded", b1 !== null && b1.header.height === 1);

  // Wallet rescan picks up nothing (no funds), but the height advances.
  const scan1 = await wallet.scanRpc(client);
  ok("scanRpc after producing blocks → height advanced", scan1.height === info1.height);
  ok("scanRpc still 0 new outputs (wallet got no funds)", scan1.newOutputs === 0);

  /* -------------------------------------------------------------- *
   *  Teardown.                                                     *
   * -------------------------------------------------------------- */
  await rpc.stop();
  store.close();

  console.log("\nALL CHECKS PASSED.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
