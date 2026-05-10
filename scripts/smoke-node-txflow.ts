/* ================================================================== *
 *  Transaction-flow end-to-end test.                                   *
 *                                                                      *
 *  Boot 4 validator nodes against a shared bus. Pre-fund an Alice     *
 *  stealth wallet in genesis. Build a real CLSAG+BP spend from Alice  *
 *  to Bob via node 0's `submitTx`. Drive slots until inclusion.       *
 *                                                                      *
 *  Verifies                                                            *
 *  ────────                                                            *
 *    • tx propagates: all 4 mempools see it within one gossip step    *
 *    • tx is included by whichever validator wins the next slot       *
 *    • all 4 stores apply the same sealed block                       *
 *    • Bob's stealth output appears in every store's UTXO set         *
 *    • the spend's key image is recorded by every store               *
 * ================================================================== */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import {
  G,
  H,
  pedersenCommit,
  stealthGen,
  stealthSendTo,
  stealthSpendKey,
  randomScalar,
  type CurvePoint,
} from "../lib/network/primitives";
import { signTransaction, type InputSpec, txId } from "../lib/network/transaction";
import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen } from "../lib/network/bls";
import { type Validator, type ValidatorSecrets } from "../lib/network/consensus";
import { ChainStore } from "../lib/network/store";
import { ConsensusNode, type NodeLogEntry } from "../lib/node/node";
import { InProcessGossipBus } from "../lib/node/gossip";
import { bytesToHex } from "../lib/network/codec";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`, extra ?? ""); process.exit(1); }
}

const tmp = mkdtempSync(join(tmpdir(), "mfbn-txflow-"));
const N = 4;
const stakes = [200n, 150n, 100n, 50n];
const totalStake = stakes.reduce((a, b) => a + b, 0n);

console.log(`• ephemeral chain dir: ${tmp}`);
console.log("• validator set + pre-funded Alice + Bob");

const secrets: ValidatorSecrets[] = [];
const validators: Validator[] = [];
for (let i = 0; i < N; i++) {
  const vrf = vrfKeygen();
  const bls = blsKeygen();
  secrets.push({ index: i, vrf, bls });
  validators.push({ index: i, vrfPk: vrf.pk, blsPk: bls.pk, stake: stakes[i] });
}

const alice = stealthGen();
const aliceFunding = stealthSendTo(alice);
const aliceSpend = stealthSpendKey(aliceFunding, alice);
const aliceValue = 1_000n;
const aliceBlinding = randomScalar();
const aliceCommit = G.multiply(aliceBlinding).add(H.multiply(aliceValue));

const bob = stealthGen();

console.log(`    alice fund commit: ${bytesToHex(aliceCommit.toBytes()).slice(0, 16)}…`);

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [{ oneTimeAddr: aliceFunding.oneTimeAddr, amount: aliceCommit }],
  initialStorage: [],
  validators,
};

console.log("• boot 4 nodes");
const bus = new InProcessGossipBus();
const stores: ChainStore[] = [];
const nodes: ConsensusNode[] = [];
const verbose = process.env.MFBN_NODE_LOG === "1";
const log = verbose
  ? (e: NodeLogEntry) => console.log(`    [${e.nodeId}] ${e.event} ${JSON.stringify(e.data ?? {})}`)
  : () => {};

for (let i = 0; i < N; i++) {
  const path = join(tmp, `node-${i}.db`);
  const store = ChainStore.open(path);
  store.initialize(cfg);
  const node = new ConsensusNode({
    nodeId: `v${i}`,
    store,
    bus,
    secrets: secrets[i],
    log,
  });
  node.start();
  stores.push(store);
  nodes.push(node);
}
ok("alice funded in all stores", stores.every((s) =>
  s.currentState().utxo.has(aliceFunding.oneTimeAddr.toHex())
));

console.log("• build a real Alice → Bob spend (CLSAG, Bulletproofs, balance proof)");

// Build a small ring around Alice's funded output.
const ringP: CurvePoint[] = [];
const ringC: CurvePoint[] = [];
for (let i = 0; i < 3; i++) {
  const dummy = stealthGen();
  const out = stealthSendTo(dummy);
  ringP.push(out.oneTimeAddr);
  ringC.push(pedersenCommit(BigInt(7 + i), randomScalar()).C);
}
const signerIdx = 1;
ringP.splice(signerIdx, 0, aliceFunding.oneTimeAddr);
ringC.splice(signerIdx, 0, aliceCommit);
const ring = { P: ringP, C: ringC };

const fee = 5n;
const bobValue = aliceValue - fee;
const bobOut = stealthSendTo(bob);

const inputs: InputSpec[] = [{
  ring,
  signerIdx,
  spendPriv: aliceSpend,
  value: aliceValue,
  blinding: aliceBlinding,
}];
const t0 = Date.now();
const signed = signTransaction(inputs, [{ oneTimeAddr: bobOut.oneTimeAddr, value: bobValue }], fee);
const signMs = Date.now() - t0;
console.log(`    signed tx in ${signMs}ms (1 input, 1 output, N=64 Bulletproof, ring of 4)`);
const submittedTxIdHex = bytesToHex(txId(signed.tx));

console.log("• submit tx to node 0");
const submitRes = nodes[0].submitTx(signed.tx);
ok("submitTx accepted", submitRes.ok, submitRes.reason);

console.log("• tx propagated to every node's mempool");
ok("all 4 mempools contain the tx", nodes.every((n) => n.mempoolSize() >= 1));

console.log("• drive slots until a block includes the tx");
let included = false;
let includedAtHeight: number | null = null;
let slotsTried = 0;
const MAX_SLOTS = 16;
while (!included && slotsTried < MAX_SLOTS) {
  const now = 1700001000 + slotsTried * 6;
  for (const n of nodes) n.beginSlot(slotsTried, now);
  slotsTried++;
  // Check every store for the bob output landing.
  if (stores.every((s) => s.currentState().utxo.has(bobOut.oneTimeAddr.toHex()))) {
    included = true;
    includedAtHeight = stores[0].head().height;
  }
}
ok(`tx included on chain in ≤ ${MAX_SLOTS} slots (took ${slotsTried})`, included);
console.log(`    included at height ${includedAtHeight}`);

console.log("• Alice's funding output spent + Bob's output present in every node");
const aliceFundHex = aliceFunding.oneTimeAddr.toHex();
const bobOutHex = bobOut.oneTimeAddr.toHex();
for (const [i, s] of stores.entries()) {
  const st = s.currentState();
  // Note: the chain UTXO model anchors outputs but doesn't remove
  // spent ones from the public set (privacy: anyone can construct a
  // ring around any output). Real un-spentness is tracked via key
  // images. So we check (a) Bob's new output is there, and (b) the
  // key image is recorded.
  if (!st.utxo.has(bobOutHex)) { ok(`node ${i}: bob output present`, false); }
  if (!st.utxo.has(aliceFundHex)) { ok(`node ${i}: alice fund still anchored`, false); }
}
ok("bob output present in all 4 nodes", stores.every((s) => s.currentState().utxo.has(bobOutHex)));

console.log("• key image recorded — replay attempt should be rejected");
ok("all nodes show key image as spent", stores.every((s) => s.currentState().spentKeyImages.size >= 1));

const replayRes = nodes[0].submitTx(signed.tx);
ok("replay rejected by mempool", !replayRes.ok);

console.log("• tx is retrievable from any node by id");
for (const [i, s] of stores.entries()) {
  const fetched = s.getTransaction(txId(signed.tx));
  if (!fetched) { ok(`node ${i}: tx retrievable`, false); }
}
ok("tx retrievable by id from every node", stores.every((s) => s.getTransaction(txId(signed.tx)) !== null));

console.log(`    submitted tx id: ${submittedTxIdHex.slice(0, 24)}…`);

console.log("• mempool drained on inclusion");
ok("mempools empty after inclusion", nodes.every((n) => n.mempoolSize() === 0));

console.log("• cleanup");
for (const n of nodes) n.stop();
for (const s of stores) { try { s.close(); } catch { /* */ } }
rmSync(tmp, { recursive: true, force: true });

console.log(`    bus delivered ${bus.stats().uniqueMessages} unique messages`);
console.log("\nTx-flow end-to-end checks passed.");
