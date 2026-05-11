/* ================================================================== *
 *  Smoke: UTXO accumulator end-to-end through applyBlock                *
 *                                                                      *
 *  Validates that the cryptographic accumulator root computed by       *
 *  buildBlock matches what applyBlock recomputes on the receiving      *
 *  side — i.e., every node arrives at the same 32-byte UTXO root for  *
 *  every block height. Also validates:                                 *
 *                                                                      *
 *    • genesis writes a non-empty utxoRoot when initialOutputs > 0    *
 *    • the genesis state's accumulator contains exactly N leaves       *
 *    • a block with K new outputs grows the accumulator by K leaves   *
 *    • applyBlock REJECTS a block whose header.utxoRoot is tampered   *
 *    • every output in every block has a verifiable membership proof  *
 *      against the latest header.utxoRoot                              *
 *    • blocks with no outputs (just storage proofs, no fee txs) leave *
 *      the accumulator untouched (only the coinbase adds leaves)      *
 * ================================================================== */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChainStore } from "../lib/network/store";
import { vrfKeygen, type VrfKeypair } from "../lib/network/vrf";
import { blsKeygen, blsSign, type BlsKeypair } from "../lib/network/bls";
import {
  type Validator, type ValidatorSecrets,
  tryProduceSlot, finalize, encodeFinalityProof,
} from "../lib/network/consensus";
import {
  buildBlock, applyBlock, headerSigningHash, type Block, type ChainState,
} from "../lib/network/block";
import {
  G, H, stealthGen, stealthSendTo, stealthSpendKey, pedersenCommit,
  randomScalar, type CurvePoint,
} from "../lib/network/primitives";
import { signTransaction, type InputSpec, type TransactionWire } from "../lib/network/transaction";
import {
  utxoLeafHash, utxoMembershipProof, verifyUtxoMembership,
} from "../lib/network/utxo-tree";
import { bytesToHex } from "../lib/network/codec";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`, extra ?? ""); process.exit(1); }
}
function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log("\n== Smoke: UTXO accumulator end-to-end ==\n");

/* -------------------------------------------------------------- */
const N = 3;
const stakes = [1000n, 1000n, 1000n];
const totalStake = stakes.reduce((a, b) => a + b, 0n);
const vrfs: VrfKeypair[] = [];
const bls: BlsKeypair[] = [];
const payouts = [stealthGen(), stealthGen(), stealthGen()];
for (let i = 0; i < N; i++) { vrfs.push(vrfKeygen()); bls.push(blsKeygen()); }
const validators: Validator[] = [];
const secrets: ValidatorSecrets[] = [];
for (let i = 0; i < N; i++) {
  validators.push({
    index: i, vrfPk: vrfs[i].pk, blsPk: bls[i].pk, stake: stakes[i],
    payoutAddress: { viewPub: payouts[i].viewPub, spendPub: payouts[i].spendPub },
  });
  secrets.push({ index: i, vrf: vrfs[i], bls: bls[i] });
}

const alice = stealthGen();
const aliceFunding = stealthSendTo(alice);
const aliceSpend = stealthSpendKey(aliceFunding, alice);
const ALICE_VALUE = 5_000_000_000n;
const aliceBlinding = randomScalar();
const aliceCommit = G.multiply(aliceBlinding).add(H.multiply(ALICE_VALUE));

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [{ oneTimeAddr: aliceFunding.oneTimeAddr, amount: aliceCommit }],
  initialStorage: [],
  validators,
};
const tmp = mkdtempSync(join(tmpdir(), "mfbn-utxo-acc-"));
const store = ChainStore.open(join(tmp, "chain.db"));
let state = store.initialize(cfg);

/* -------------------------------------------------------------- *
 *  Genesis invariants.                                            *
 * -------------------------------------------------------------- */
ok("genesis state has utxoTree.leafCount = 1 (alice)", state.utxoTree.leafCount === 1);

const aliceLeaf = utxoLeafHash(aliceFunding.oneTimeAddr, aliceCommit, 0);
const genesisProof = utxoMembershipProof(state.utxoTree, 0);

// Read the genesis block back from the store to confirm header.utxoRoot
// matches the state's tree root.
const genesisBlock = store.getBlock(0);
ok("genesis block readable from store", genesisBlock !== null);
ok(
  "genesis header.utxoRoot present",
  genesisBlock!.header.utxoRoot !== undefined &&
    genesisBlock!.header.utxoRoot.length === 32
);
ok(
  "genesis header.utxoRoot matches state.utxoTree root",
  bytesEq(
    genesisBlock!.header.utxoRoot!,
    state.utxoTree.nodes.get(`${32}:0`) ?? new Uint8Array(32)
  )
);
ok(
  "alice's genesis output verifies against the header's utxoRoot",
  verifyUtxoMembership(aliceLeaf, genesisProof, genesisBlock!.header.utxoRoot!)
);
console.log(`    genesis utxoRoot = ${bytesToHex(genesisBlock!.header.utxoRoot!).slice(0, 16)}…`);

/* -------------------------------------------------------------- *
 *  Helper: find a VRF-eligible producer for the candidate block.  *
 * -------------------------------------------------------------- */
function sealBlockAt(
  s: ChainState, startSlot: number, txs: TransactionWire[]
): { sealed: Block; producerIdx: number; slot: number } {
  const prevHash = s.blockIds[s.blockIds.length - 1];
  for (let slot = startSlot; slot < startSlot + 200; slot++) {
    for (let i = 0; i < N; i++) {
      const candidate = buildBlock({
        state: s, txs, slot, timestamp: cfg.timestamp + slot,
        storageProofs: [],
        producerPayout: validators[i].payoutAddress,
      });
      const hh = headerSigningHash(candidate.header);
      const real = tryProduceSlot(
        { height: s.height + 1, slot, prevHash },
        secrets[i], validators[i], totalStake,
        s.params.expectedProposersPerSlot, hh
      );
      if (!real) continue;
      const votes = validators.map((_v, vi) => ({
        index: vi, sig: blsSign(hh, secrets[vi].bls.sk),
      }));
      const fin = finalize(hh, votes, validators.length);
      return {
        sealed: {
          ...candidate,
          header: { ...candidate.header,
            producerProof: encodeFinalityProof({
              producer: real, finality: fin, signingStake: totalStake,
            }),
          },
        },
        producerIdx: i, slot,
      };
    }
  }
  throw new Error("no VRF-eligible producer in 200 slots");
}

/* -------------------------------------------------------------- *
 *  Block 1 — Alice → Bob spend. Adds Bob's output AND a change   *
 *  output (no change in this test, but coinbase will add 1).      *
 * -------------------------------------------------------------- */
console.log("\n• block 1: real Alice→Bob spend with fee");

const FEE = 50_000_000n;
const bob = stealthGen();
const bobOut = stealthSendTo(bob);
const ringP: CurvePoint[] = [];
const ringC: CurvePoint[] = [];
for (let i = 0; i < 3; i++) {
  const d = stealthGen(); const o = stealthSendTo(d);
  ringP.push(o.oneTimeAddr); ringC.push(pedersenCommit(BigInt(7+i), randomScalar()).C);
}
const SIDX = 1;
ringP.splice(SIDX, 0, aliceFunding.oneTimeAddr);
ringC.splice(SIDX, 0, aliceCommit);
const inputs: InputSpec[] = [{
  ring: { P: ringP, C: ringC }, signerIdx: SIDX, spendPriv: aliceSpend,
  value: ALICE_VALUE, blinding: aliceBlinding,
}];
const tx1 = signTransaction(
  inputs,
  [{ oneTimeAddr: bobOut.oneTimeAddr, value: ALICE_VALUE - FEE }],
  FEE
);

const stage1 = sealBlockAt(state, 0, [tx1.tx]);
const before1 = state.utxoTree.leafCount;
const r1 = applyBlock(state, stage1.sealed);
ok("block 1: applyBlock accepts", r1.ok, r1.errors);
state = r1.state;

// Block 1 should add: 1 coinbase output + 1 tx output (bob) = 2 leaves.
const expectedNewLeaves = 2;
ok(
  `block 1: accumulator grew by exactly ${expectedNewLeaves} leaves (was=${before1}, now=${state.utxoTree.leafCount})`,
  state.utxoTree.leafCount === before1 + expectedNewLeaves
);

const root1 = state.utxoTree.nodes.get(`32:0`)!;
ok(
  "block 1: header.utxoRoot == applyBlock-computed root (proposer ↔ verifier agreement)",
  bytesEq(stage1.sealed.header.utxoRoot!, root1)
);

// Verify Bob's output membership against the new root.
const bobLeafIdx = before1 + 1; // coinbase=before1, bob=before1+1
const bobLeaf = utxoLeafHash(bobOut.oneTimeAddr, tx1.tx.outputs[0].amount, stage1.sealed.header.height);
const bobProof = utxoMembershipProof(state.utxoTree, bobLeafIdx);
ok(
  "block 1: bob's output verifies against new utxoRoot",
  verifyUtxoMembership(bobLeaf, bobProof, root1)
);

// Alice's original output is STILL provable against the new root — append-only.
const aliceProofAfter = utxoMembershipProof(state.utxoTree, 0);
ok(
  "block 1: alice's pre-existing output STILL verifies (append-only)",
  verifyUtxoMembership(aliceLeaf, aliceProofAfter, root1)
);

/* -------------------------------------------------------------- *
 *  Tamper resistance: a block whose header forges the utxoRoot   *
 *  must be rejected.                                              *
 * -------------------------------------------------------------- */
console.log("\n• block 2: tamper resistance");
const stage2 = sealBlockAt(state, stage1.slot + 1, []);
// Real block, but flip 1 byte of utxoRoot.
const evilRoot = new Uint8Array(stage2.sealed.header.utxoRoot!);
evilRoot[0] ^= 0xff;
const evilBlock: Block = {
  ...stage2.sealed,
  header: { ...stage2.sealed.header, utxoRoot: evilRoot },
};
const r2 = applyBlock(state, evilBlock);
ok(
  "block 2 with TAMPERED utxoRoot is rejected",
  !r2.ok && r2.errors.some((e) => e.includes("utxoRoot mismatch")),
  r2.errors
);

// The legit version should still apply.
const r2legit = applyBlock(state, stage2.sealed);
ok("block 2 legit: applyBlock accepts", r2legit.ok, r2legit.errors);
state = r2legit.state;
// Block 2 only adds a coinbase output (no fee txs in this block).
ok(
  "block 2: accumulator grew by exactly 1 leaf (coinbase only)",
  state.utxoTree.leafCount === before1 + expectedNewLeaves + 1
);

console.log("\n• summary");
console.log(`    final leaf count = ${state.utxoTree.leafCount}`);
console.log(`    final utxoRoot   = ${bytesToHex(stage2.sealed.header.utxoRoot!).slice(0, 16)}…`);

store.close();
console.log("\nALL CHECKS PASSED.\n");
