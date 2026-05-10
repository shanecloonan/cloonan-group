/* ================================================================== *
 *  Storage challenge / SPoRA end-to-end test.                          *
 *                                                                      *
 *  Demonstrates the permanence layer in action:                        *
 *                                                                      *
 *    1. Alice stores ~256 KiB of data via a regular transfer that      *
 *       carries a StorageCommitment in its output.                     *
 *    2. The four producer nodes register the data + Merkle tree in    *
 *       their storage cache (in a real deployment provers would        *
 *       gossip these out-of-band; here we hand them out directly).    *
 *    3. We drive several slots. In each slot, the elected producer    *
 *       includes a StorageProof answering the deterministic          *
 *       chunk-index challenge for the slot. The proof is verified     *
 *       by every validator before voting and applied to state.        *
 *    4. After enough slots, every node's storage registry shows       *
 *       `lastProvenAt` advancing — concrete on-chain evidence that    *
 *       SOMEONE in the network can still produce a random chunk.     *
 * ================================================================== */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";

import {
  G,
  H,
  randomScalar,
  stealthGen,
} from "../lib/network/primitives";
import { signTransaction } from "../lib/network/transaction";
import {
  buildStorageCommitment,
  storageCommitmentHash,
  verifyStorageProof,
  buildStorageProof,
  chunkIndexForChallenge,
} from "../lib/network/storage";
import { Wallet } from "../lib/wallet/wallet";
import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen } from "../lib/network/bls";
import { type Validator, type ValidatorSecrets } from "../lib/network/consensus";
import { ChainStore } from "../lib/network/store";
import {
  ConsensusNode,
  emptyStorageHoldings,
  type StorageHoldings,
} from "../lib/node/node";
import { InProcessGossipBus } from "../lib/node/gossip";
import { bytesToHex } from "../lib/network/codec";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`, extra ?? ""); process.exit(1); }
}

const tmp = mkdtempSync(join(tmpdir(), "mfbn-storage-"));
console.log(`• ephemeral dir: ${tmp}`);

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

console.log("• prepare 256 KiB of test data → 4 chunks @ 64 KiB");
const data = randomBytes(256 * 1024);
const endowmentValue = 5000n;
const built = buildStorageCommitment(data, endowmentValue, { chunkSize: 64 * 1024 });
console.log(`    commit hash: ${bytesToHex(storageCommitmentHash(built.commit)).slice(0, 16)}…`);
console.log(`    numChunks: ${built.commit.numChunks}, dataRoot: ${bytesToHex(built.commit.dataRoot).slice(0, 16)}…`);

console.log("• fund a Treasury → Alice transfer that carries the commitment");
const treasury = stealthGen();
const treasuryValue = 10_000n;
const treasuryBlinding = randomScalar();
const treasuryCommit = G.multiply(treasuryBlinding).add(H.multiply(treasuryValue));
const alice = Wallet.generate();

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [{ oneTimeAddr: treasury.spendPub, amount: treasuryCommit }],
  initialStorage: [],
  validators,
};

console.log("• boot 4 nodes with shared storage cache (the data they will prove)");
const bus = new InProcessGossipBus();
const sharedCache: StorageHoldings = emptyStorageHoldings();
sharedCache.byCommit.set(bytesToHex(storageCommitmentHash(built.commit)), {
  data,
  tree: built.tree,
});
const stores: ChainStore[] = [];
const nodes: ConsensusNode[] = [];
for (let i = 0; i < N; i++) {
  const path = join(tmp, `node-${i}.db`);
  const store = ChainStore.open(path);
  store.initialize(cfg);
  const node = new ConsensusNode({
    nodeId: `v${i}`,
    store,
    bus,
    secrets: secrets[i],
    // Every producer in this test is also a prover (typical for v0.1).
    storageCache: {
      byCommit: new Map(sharedCache.byCommit),
    },
  });
  node.start();
  stores.push(store);
  nodes.push(node);
}

console.log("• submit storage tx (treasury → garbage + commit)");
const aliceFee = 100n;
const aliceValue = treasuryValue - aliceFee;
const storageTx = signTransaction(
  [{
    ring: { P: [treasury.spendPub], C: [treasuryCommit] },
    signerIdx: 0,
    spendPriv: treasury.spendPriv,
    value: treasuryValue,
    blinding: treasuryBlinding,
  }],
  [{
    recipient: alice.address(),
    value: aliceValue,
    storage: built.commit,
  }],
  aliceFee
);
const sub = nodes[0].submitTx(storageTx.tx);
ok("storage tx accepted", sub.ok, sub.reason);

let slot = 0;
const MAX_SLOTS = 60;
let anchoredAt = -1;
while (anchoredAt < 0 && slot < MAX_SLOTS) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
  const cHashHex = bytesToHex(storageCommitmentHash(built.commit));
  if (stores.every((s) => s.currentState().storage.has(cHashHex))) {
    anchoredAt = stores[0].head().height;
  }
}
ok(`commit anchored on-chain at height ${anchoredAt}`, anchoredAt >= 0);

console.log("• drive several more slots; expect lastProvenAt to advance");
const cHashHex = bytesToHex(storageCommitmentHash(built.commit));
const provenInitially = stores[0].currentState().storage.get(cHashHex)!.lastProvenAt;
console.log(`    initial lastProvenAt: ${provenInitially}`);

let lastSeenProven = provenInitially;
let proofIncluded = 0;
const SLOTS_TO_DRIVE = 12;
for (let s = 0; s < SLOTS_TO_DRIVE; s++) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
  const now = stores[0].currentState().storage.get(cHashHex)?.lastProvenAt ?? -1;
  if (now > lastSeenProven) {
    proofIncluded++;
    lastSeenProven = now;
  }
}
ok(`storage proof included in ≥ 1 block`, proofIncluded >= 1, `proofIncluded=${proofIncluded}`);
ok(`lastProvenAt advanced past initial`, lastSeenProven > provenInitially, `${provenInitially} → ${lastSeenProven}`);

console.log("• every node agrees on lastProvenAt");
const provenAtPerNode = stores.map((s) => s.currentState().storage.get(cHashHex)!.lastProvenAt);
ok(`identical lastProvenAt across all 4 nodes`, provenAtPerNode.every((p) => p === provenAtPerNode[0]), provenAtPerNode);

console.log("• tamper a stored byte → next proof attempt should fail verification");
const tamperedData = new Uint8Array(data);
tamperedData[12345] ^= 0xff;
// Manually build a proof using tampered data: it should still pass the
// LOCAL build because we lie about the tree too. But against the on-chain
// commit (real Merkle root), it must fail.
const fakeBuilt = buildStorageCommitment(tamperedData, endowmentValue, { chunkSize: 64 * 1024 });
const fakeProof = buildStorageProof(
  fakeBuilt.commit, // wrong commit
  stores[0].head().blockId,
  slot + 100,
  tamperedData,
  fakeBuilt.tree
);
// Try to verify against the REAL commit on chain. Different commitHash → reject.
const fakeVerdict = verifyStorageProof(built.commit, stores[0].head().blockId, slot + 100, fakeProof);
ok("tamper-of-data → proof rejected (commitHash mismatch)", !fakeVerdict.ok);

console.log("• tamper a single chunk byte → Merkle path no longer reconstructs");
// More realistic: build a proof for the right commit but lie about the chunk.
const ch = chunkIndexForChallenge(stores[0].head().blockId, slot + 5, storageCommitmentHash(built.commit), built.commit.numChunks);
const realProof = buildStorageProof(built.commit, stores[0].head().blockId, slot + 5, data, built.tree);
const tamperedChunk = new Uint8Array(realProof.chunk);
tamperedChunk[0] ^= 0x01;
const tamperedProof = { ...realProof, chunk: tamperedChunk };
const tamperedVerdict = verifyStorageProof(built.commit, stores[0].head().blockId, slot + 5, tamperedProof);
ok("tamper-of-chunk-byte → proof rejected (merkle invalid)", !tamperedVerdict.ok);
void ch;

console.log("• cleanup");
for (const n of nodes) n.stop();
for (const s of stores) { try { s.close(); } catch { /* */ } }
rmSync(tmp, { recursive: true, force: true });

console.log("\nStorage SPoRA end-to-end checks passed.");
