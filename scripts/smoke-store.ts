/* ================================================================== *
 *  Persistence smoke test.                                             *
 *                                                                      *
 *  Spin up a SQLite-backed ChainStore, run real consensus to produce  *
 *  several blocks, close the DB, reopen it, and verify the state is   *
 *  byte-identical via deterministic replay.                            *
 * ================================================================== */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, statSync } from "node:fs";

import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen } from "../lib/network/bls";
import {
  tryProduceSlot,
  pickWinner,
  castVote,
  finalize,
  encodeFinalityProof,
  type Validator,
  type ValidatorSecrets,
  type FinalityProof,
} from "../lib/network/consensus";
import {
  buildUnsealedHeader,
  sealBlock,
  headerSigningHash,
} from "../lib/network/block";
import { ChainStore } from "../lib/network/store";
import { bytesToHex } from "../lib/network/codec";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "mfbn-store-"));
const dbPath = join(tmp, "chain.db");

console.log(`• ephemeral chain at ${dbPath}`);

const N = 4;
const stakes = [200n, 150n, 100n, 50n];
const totalStake = stakes.reduce((a, b) => a + b, 0n);
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

console.log("• open + initialize");
const store1 = ChainStore.open(dbPath);
const state0 = store1.initialize(cfg);
ok("genesis applied", state0.height === 0);
ok("validators persisted", state0.validators.length === N);

console.log("• produce 5 blocks");
function produceBlockAt(slot: number, store: ChainStore, when: number): boolean {
  const state = store.currentState();
  const unsealed = buildUnsealedHeader({ state, txs: [], slot, timestamp: when });
  const headerHash = headerSigningHash(unsealed);
  const ctx = { height: unsealed.height, slot, prevHash: unsealed.prevHash };
  const candidates = [];
  for (let i = 0; i < N; i++) {
    const c = tryProduceSlot(
      ctx,
      secrets[i],
      validators[i],
      totalStake,
      state.params.expectedProposersPerSlot,
      headerHash
    );
    if (c) candidates.push(c);
  }
  const winner = pickWinner(candidates);
  if (!winner) return false;
  const votes = secrets.map((sec) =>
    castVote(headerHash, sec, ctx, winner, validators[winner.validatorIndex], totalStake, state.params.expectedProposersPerSlot)
  );
  const fin = finalize(headerHash, votes, N);
  let signedStake = 0n;
  for (let i = 0; i < N; i++) {
    if ((fin.bitmap[i >> 3] & (1 << (i & 7))) !== 0) signedStake += stakes[i];
  }
  const fp: FinalityProof = { producer: winner, finality: fin, signingStake: signedStake };
  const block = sealBlock(unsealed, [], encodeFinalityProof(fp));
  const r = store.applyBlock(block);
  if (!r.ok) {
    console.error("apply failed:", r.errors);
    return false;
  }
  return true;
}

let slot = 0;
let produced = 0;
while (produced < 5 && slot < 100) {
  if (produceBlockAt(slot, store1, 1700001000 + slot * 12)) produced++;
  slot++;
}
ok(`produced 5 blocks (slots tried: ${slot})`, produced === 5);
ok("store reports height 5", store1.head().height === 5);

const headBefore = bytesToHex(store1.head().blockId);
const utxoCountBefore = store1.currentState().utxo.size;
const blockIdsBefore = store1.currentState().blockIds.map((b) => bytesToHex(b));
console.log(`    head: ${headBefore.slice(0, 16)}…`);
console.log(`    blockIds: ${blockIdsBefore.length}`);

console.log("• close + reopen + replay");
store1.close();
const fileSize = statSync(dbPath).size;
console.log(`    on-disk size: ${fileSize} bytes`);

const store2 = ChainStore.open(dbPath);
ok("hasGenesis recognized after reopen", store2.hasGenesis());
const restoredState = store2.restore();

ok("height matches", restoredState.height === 5);
ok("head id matches", bytesToHex(store2.head().blockId) === headBefore);
ok("utxo count matches", restoredState.utxo.size === utxoCountBefore);
ok("blockIds count matches", restoredState.blockIds.length === blockIdsBefore.length);
const blockIdsAfter = restoredState.blockIds.map((b) => bytesToHex(b));
let allMatch = true;
for (let i = 0; i < blockIdsBefore.length; i++) {
  if (blockIdsBefore[i] !== blockIdsAfter[i]) { allMatch = false; break; }
}
ok("blockIds byte-identical", allMatch);
ok("validators rehydrated", restoredState.validators.length === N);
ok(
  "validator stakes preserved",
  restoredState.validators.every((v, i) => v.stake === stakes[i])
);

console.log("• can keep producing past restore");
while (!produceBlockAt(slot++, store2, 1700020000 + slot * 12)) {}
ok("post-restore block applied", store2.head().height === 6);

console.log("• fetch a historical block");
const block3 = store2.getBlock(3);
ok("block 3 retrievable", block3 !== null && block3.header.height === 3);

console.log("• cleanup");
store2.close();
rmSync(tmp, { recursive: true, force: true });

console.log("\nPersistence smoke checks passed.");
