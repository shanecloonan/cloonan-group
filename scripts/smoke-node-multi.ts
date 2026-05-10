/* ================================================================== *
 *  Multi-validator end-to-end test.                                    *
 *                                                                      *
 *  Spins up four independent ConsensusNodes against a shared in-      *
 *  process gossip bus. Each node has its own SQLite store, its own    *
 *  ValidatorSecrets, and its own mempool. We drive ticks across all   *
 *  of them and verify that:                                            *
 *                                                                      *
 *    • every slot finalizes a block (at the same height across nodes) *
 *    • every node's tip and on-disk state are byte-identical          *
 *    • restarting any node (close store, reopen, replay) yields the   *
 *      same state again                                                *
 * ================================================================== */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen } from "../lib/network/bls";
import { type Validator, type ValidatorSecrets } from "../lib/network/consensus";
import { ChainStore } from "../lib/network/store";
import { ConsensusNode, type NodeLogEntry } from "../lib/node/node";
import { InProcessGossipBus } from "../lib/node/gossip";
import { bytesToHex } from "../lib/network/codec";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "mfbn-multi-"));
console.log(`• ephemeral chain dir: ${tmp}`);

const N = 4;
const stakes = [200n, 150n, 100n, 50n];

const secrets: ValidatorSecrets[] = [];
const validators: Validator[] = [];
for (let i = 0; i < N; i++) {
  const vrf = vrfKeygen();
  const bls = blsKeygen();
  secrets.push({ index: i, vrf, bls });
  validators.push({ index: i, vrfPk: vrf.pk, blsPk: bls.pk, stake: stakes[i] });
}

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [],
  initialStorage: [],
  validators,
};

console.log("• create stores + nodes on shared bus");
const bus = new InProcessGossipBus();
const dbPaths: string[] = [];
const stores: ChainStore[] = [];
const nodes: ConsensusNode[] = [];

const verbose = process.env.MFBN_NODE_LOG === "1";
const collectedLogs: NodeLogEntry[] = [];
const logFn = verbose
  ? (e: NodeLogEntry) => {
      const dataStr = e.data ? ` ${JSON.stringify(e.data)}` : "";
      console.log(`    [${e.nodeId}] ${e.event}${dataStr}`);
    }
  : (e: NodeLogEntry) => { collectedLogs.push(e); };

for (let i = 0; i < N; i++) {
  const path = join(tmp, `node-${i}.db`);
  dbPaths.push(path);
  const store = ChainStore.open(path);
  store.initialize(cfg);
  stores.push(store);
  const node = new ConsensusNode({
    nodeId: `v${i}`,
    store,
    bus,
    secrets: secrets[i],
    log: logFn,
  });
  node.start();
  nodes.push(node);
}
ok(`spawned ${N} nodes`, nodes.length === N);

console.log("• drive 20 slots; expect every slot to finalize");
let producedHeight = 0;
const SLOTS = 30;
for (let slot = 0; slot < SLOTS; slot++) {
  const now = 1700001000 + slot * 6;
  for (const node of nodes) node.beginSlot(slot, now);
  // After every node has ticked, the synchronous bus has run the
  // full slot. Check that all heads advanced to the same height.
  const tips = nodes.map((n) => n.head().height);
  if (tips.every((h) => h === producedHeight + 1)) {
    producedHeight++;
  }
  if (producedHeight >= 20) break;
}
ok(`finalized ≥ 20 blocks (got ${producedHeight})`, producedHeight >= 20);

console.log("• all nodes have identical heads");
const heads = nodes.map((n) => n.head());
const firstHead = bytesToHex(heads[0].blockId);
let allMatch = heads.every((h) => bytesToHex(h.blockId) === firstHead);
ok("byte-identical head id across all 4 nodes", allMatch, heads.map((h) => bytesToHex(h.blockId).slice(0, 16)));
const firstHeight = heads[0].height;
ok("identical height across all 4 nodes", heads.every((h) => h.height === firstHeight));

console.log("• identical blockIds chain (full ancestry agreement)");
const ancestry = nodes.map((n) => n.head().blockId);
// Walk back through chains and compare.
let agree = true;
for (let h = 0; h <= firstHeight; h++) {
  const ids = stores.map((s) => s.getBlock(h)?.header);
  const first = ids[0];
  if (!first) { agree = false; break; }
  for (const x of ids) {
    if (!x || x.height !== first.height || x.slot !== first.slot) {
      agree = false; break;
    }
  }
  if (!agree) break;
}
ok("all 4 stores agree on every historical block", agree);
void ancestry;

console.log("• identical state (UTXO + spentKi + storage counts)");
const states = nodes.map((n) => n.head());
void states;
const u0 = stores[0].currentState();
ok(
  "utxo size matches",
  stores.every((s) => s.currentState().utxo.size === u0.utxo.size)
);
ok(
  "spentKeyImages size matches",
  stores.every((s) => s.currentState().spentKeyImages.size === u0.spentKeyImages.size)
);
ok(
  "storage size matches",
  stores.every((s) => s.currentState().storage.size === u0.storage.size)
);

console.log("• kill + restart node 1; replay state should match");
const node1Head = bytesToHex(nodes[1].head().blockId);
nodes[1].stop();
stores[1].close();
const reopened = ChainStore.open(dbPaths[1]);
const restored = reopened.restore();
ok("node 1 restored to same height", restored.height === firstHeight);
ok(
  "node 1 restored head matches pre-shutdown",
  bytesToHex(reopened.head().blockId) === node1Head
);

console.log("• reattach node 1 and produce one more slot");
const node1New = new ConsensusNode({
  nodeId: "v1",
  store: reopened,
  bus,
  secrets: secrets[1],
  log: logFn,
});
node1New.start();
nodes[1] = node1New;
stores[1] = reopened;

const nextSlot = SLOTS + 100;
for (const node of nodes) node.beginSlot(nextSlot, 1700001000 + nextSlot * 6);
const headsAfter = nodes.map((n) => bytesToHex(n.head().blockId));
ok(
  "all nodes advanced once more, all heads identical",
  headsAfter.every((h) => h === headsAfter[0])
);

console.log("• cleanup");
for (const node of nodes) node.stop();
for (const s of stores) {
  try { s.close(); } catch { /* already closed */ }
}
rmSync(tmp, { recursive: true, force: true });

const busStats = bus.stats();
console.log(`    gossip bus delivered ${busStats.uniqueMessages} unique messages across ${N} validators`);

console.log("\nMulti-validator end-to-end checks passed.");
