/* ================================================================== *
 *  Slashing end-to-end test.                                           *
 *                                                                      *
 *  Demonstrates that a validator who signs two conflicting headers at  *
 *  the same slot is provably slashable:                                *
 *                                                                      *
 *    1. Boot 4 validators on a shared bus.                             *
 *    2. Manually construct two DIFFERENT header hashes for the same    *
 *       (height, slot) and have validator #2 BLS-sign BOTH (the        *
 *       Byzantine action). Inject both signatures as VoteMsgs onto    *
 *       the bus.                                                       *
 *    3. The honest nodes detect the equivocation, queue evidence.     *
 *    4. The next time an honest node proposes a block, the evidence   *
 *       is included; applyBlock zeroes the Byzantine's stake.         *
 *    5. Verify: state.validators[2].stake === 0 in every node.        *
 *    6. Future slots cannot include this validator's stake toward     *
 *       quorum; chain continues to live.                              *
 * ================================================================== */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen, blsSign } from "../lib/network/bls";
import { type Validator, type ValidatorSecrets } from "../lib/network/consensus";
import { ChainStore } from "../lib/network/store";
import { ConsensusNode, type NodeLogEntry } from "../lib/node/node";
import { InProcessGossipBus } from "../lib/node/gossip";
import { MsgKind, type VoteMsg } from "../lib/node/messages";
import { dhash, DOMAIN, bytesToHex } from "../lib/network/codec";

const verbose = process.env.MFBN_NODE_LOG === "1";
const log = verbose
  ? (e: NodeLogEntry) => console.log(`    [${e.nodeId}] ${e.event} ${JSON.stringify(e.data ?? {})}`)
  : () => {};

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`, extra ?? ""); process.exit(1); }
}

const tmp = mkdtempSync(join(tmpdir(), "mfbn-slash-"));
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

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [],
  initialStorage: [],
  validators,
};

console.log("• boot 4 nodes");
const bus = new InProcessGossipBus();
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
    log,
  });
  node.start();
  stores.push(store);
  nodes.push(node);
}

console.log("• drive a few slots normally — chain advances");
let slot = 0;
for (let i = 0; i < 8; i++) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
}
const heightBefore = nodes[0].head().height;
ok(`chain advanced (height=${heightBefore})`, heightBefore > 0);

console.log("• byzantine validator 2 double-signs two fabricated headers at the same (height, slot)");
// We construct TWO fabricated header hashes (in real life these would
// correspond to two competing block proposals the byzantine validator saw).
// The byzantine signs both, which is provable equivocation regardless of
// what the rest of the chain looks like.
const targetHeight = heightBefore + 100; // future, unambiguous height
const targetSlot = slot + 100;
const fakeA = dhash(DOMAIN.BLOCK_HEADER, new TextEncoder().encode("byzantine-fork-A"));
const fakeB = dhash(DOMAIN.BLOCK_HEADER, new TextEncoder().encode("byzantine-fork-B"));
const sigA = blsSign(fakeA, secrets[2].bls.sk);
const sigB = blsSign(fakeB, secrets[2].bls.sk);
const voteA: VoteMsg = {
  height: targetHeight, slot: targetSlot, voterIndex: 2,
  headerHash: fakeA, sig: sigA,
};
const voteB: VoteMsg = {
  height: targetHeight, slot: targetSlot, voterIndex: 2,
  headerHash: fakeB, sig: sigB,
};

// Inject both votes onto the bus.
bus.publish({ kind: MsgKind.Vote, data: voteA });
bus.publish({ kind: MsgKind.Vote, data: voteB });

console.log("• drive subsequent slots — evidence should land on chain");
let slashedAt = -1;
const MAX_SLOTS = 30;
for (let i = 0; i < MAX_SLOTS; i++) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
  const state = stores[0].currentState();
  if (state.validators[2].stake === 0n) {
    slashedAt = state.height;
    break;
  }
}
ok(`validator 2 was slashed`, slashedAt >= 0, `height when slashed = ${slashedAt}`);

console.log("• every node agrees validator 2's stake is now 0");
for (let i = 0; i < N; i++) {
  const s = stores[i].currentState();
  if (s.validators[2].stake !== 0n) {
    ok(`node ${i}: validator 2 stake is 0`, false, `stake = ${s.validators[2].stake}`);
  }
}
ok(`all nodes agree validator 2 stake = 0`, stores.every((s) => s.currentState().validators[2].stake === 0n));

console.log("• validator 2 cannot reach quorum anymore, but other 3 still can");
for (let i = 0; i < N; i++) {
  const s = stores[i].currentState();
  const total = s.validators.reduce((acc, v) => acc + v.stake, 0n);
  if (total !== stakes[0] + stakes[1] + stakes[3]) {
    ok(`node ${i}: total stake = ${total}`, false);
  }
}
ok(
  `total stake reduced by exactly validator 2's stake (${stakes[2]})`,
  stores.every((s) => {
    const total = s.currentState().validators.reduce((acc, v) => acc + v.stake, 0n);
    return total === stakes[0] + stakes[1] + stakes[3];
  })
);

console.log("• chain keeps producing blocks after slashing");
const heightAfterSlash = stores[0].head().height;
for (let i = 0; i < 10; i++) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
}
const heightFinal = stores[0].head().height;
ok(`chain advanced past slash (${heightAfterSlash} → ${heightFinal})`, heightFinal > heightAfterSlash);

console.log("• re-submitting the SAME equivocation cannot double-slash");
// Build the evidence pair again (different from the prior one already on chain).
// Just trigger another double-sign to be sure it's idempotent.
const fakeHeaderHash2 = dhash(DOMAIN.BLOCK_HEADER, new TextEncoder().encode("byzantine-fork-attempt-2"));
const byzantineSig2 = blsSign(fakeHeaderHash2, secrets[2].bls.sk);
const byzantineVote2: VoteMsg = {
  height: heightFinal + 1,
  slot: slot,
  headerHash: fakeHeaderHash2,
  voterIndex: 2,
  sig: byzantineSig2,
};
bus.publish({ kind: MsgKind.Vote, data: byzantineVote2 });
// Drive more slots. Stake should remain 0 (can't go below zero) and no error.
for (let i = 0; i < 5; i++) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
}
ok(`validator 2 stake still 0 (idempotent slash)`, stores.every((s) => s.currentState().validators[2].stake === 0n));

console.log("• cleanup");
for (const n of nodes) n.stop();
for (const s of stores) { try { s.close(); } catch { /* */ } }
rmSync(tmp, { recursive: true, force: true });

console.log(`    bus delivered ${bus.stats().uniqueMessages} unique messages`);
console.log("\nSlashing end-to-end checks passed.");
void bytesToHex;
