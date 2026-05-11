/* ================================================================== *
 *  Smoke: UTXO accumulator (incremental Merkle tree)                   *
 *                                                                      *
 *  Unit-level tests for the cryptographic accumulator that will        *
 *  replace the chain's UTXO Map. Verifies:                             *
 *                                                                      *
 *    • empty tree root is deterministic and stable                     *
 *    • append produces a different root every time                     *
 *    • membership proofs verify against the post-append root           *
 *    • membership proofs FAIL against any other root (forgery resist)  *
 *    • tampering with the leaf or any sibling breaks verification      *
 *    • two histories appending the same leaves in the same order       *
 *      produce IDENTICAL roots (determinism / replay-safety)           *
 *    • histories that differ in leaf order produce DIFFERENT roots     *
 *    • a proof at one snapshot does NOT verify against a later root,  *
 *      because adjacent leaves shift the path's siblings (proof must  *
 *      be pinned to a specific snapshot)                                *
 * ================================================================== */

import {
  appendUtxo,
  emptyUtxoTree,
  utxoTreeRoot,
  utxoLeafHash,
  utxoMembershipProof,
  verifyUtxoMembership,
  EMPTY_LEAF,
  UTXO_TREE_DEPTH,
} from "../lib/network/utxo-tree";
import {
  G, H, pedersenCommit, randomScalar, stealthGen, stealthSendTo,
} from "../lib/network/primitives";
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

console.log("\n== Smoke: UTXO accumulator ==\n");

/* -------------------------------------------------------------- *
 *  Empty-tree invariants.                                         *
 * -------------------------------------------------------------- */
const empty1 = emptyUtxoTree();
const empty2 = emptyUtxoTree();
ok("empty tree: leafCount = 0", empty1.leafCount === 0);
ok("empty tree: depth = 32", UTXO_TREE_DEPTH === 32);
ok("empty tree: EMPTY_LEAF is 32 bytes", EMPTY_LEAF.length === 32);
ok(
  "empty tree: root is the precomputed zeros[D]",
  bytesEq(utxoTreeRoot(empty1), empty1.zeros[UTXO_TREE_DEPTH])
);
ok("empty tree: two fresh trees have the same root", bytesEq(utxoTreeRoot(empty1), utxoTreeRoot(empty2)));
console.log(`    empty root = ${bytesToHex(utxoTreeRoot(empty1)).slice(0, 16)}…`);

/* -------------------------------------------------------------- *
 *  Build 100 random UTXO leaves and incrementally append them.    *
 * -------------------------------------------------------------- */
const N = 100;
const leaves: Uint8Array[] = [];
for (let i = 0; i < N; i++) {
  const recipient = stealthGen();
  const out = stealthSendTo(recipient);
  const v = BigInt(1 + i * 13);
  const r = randomScalar();
  const c = G.multiply(r).add(H.multiply(v));
  leaves.push(utxoLeafHash(out.oneTimeAddr, c, i));
}

let t = emptyUtxoTree();
const rootsByStep: Uint8Array[] = [];
for (let i = 0; i < N; i++) {
  t = appendUtxo(t, leaves[i]);
  rootsByStep.push(utxoTreeRoot(t));
}
ok(`appended ${N} leaves`, t.leafCount === N);
ok(`tree depth invariant: every step changed the root`, (() => {
  for (let i = 1; i < rootsByStep.length; i++) {
    if (bytesEq(rootsByStep[i], rootsByStep[i - 1])) return false;
  }
  return true;
})());
console.log(`    final root  = ${bytesToHex(rootsByStep[N - 1]).slice(0, 16)}…`);

/* -------------------------------------------------------------- *
 *  Membership: every leaf verifies against the final root.        *
 * -------------------------------------------------------------- */
console.log("\n• membership proofs verify");
const finalRoot = rootsByStep[N - 1];
for (let i = 0; i < N; i++) {
  const proof = utxoMembershipProof(t, i);
  if (!verifyUtxoMembership(leaves[i], proof, finalRoot)) {
    ok(`leaf ${i}: proof verifies vs final root`, false);
  }
}
ok(`all ${N} leaves verify against the final root`, true);

/* -------------------------------------------------------------- *
 *  Forgery resistance.                                            *
 * -------------------------------------------------------------- */
console.log("\n• forgery resistance");
const proof17 = utxoMembershipProof(t, 17);

// Tamper the leaf: arbitrary 32-byte hash that's NOT leaves[17].
const fakeLeaf = new Uint8Array(32);
for (let i = 0; i < 32; i++) fakeLeaf[i] = (i * 7 + 3) & 0xff;
ok(
  "proof17 against TAMPERED leaf fails",
  !verifyUtxoMembership(fakeLeaf, proof17, finalRoot)
);

// Tamper a sibling.
const tamperedProof = {
  leafIdx: proof17.leafIdx,
  siblings: proof17.siblings.map((s, idx) => idx === 5 ? new Uint8Array(32) : s),
};
ok(
  "proof17 with TAMPERED sibling fails",
  !verifyUtxoMembership(leaves[17], tamperedProof, finalRoot)
);

// Tamper the index — should re-route the proof to a different position
// and verify to a different value than the root.
const wrongIdxProof = { ...proof17, leafIdx: proof17.leafIdx ^ 1 };
ok(
  "proof17 with FLIPPED low-bit-of-idx fails",
  !verifyUtxoMembership(leaves[17], wrongIdxProof, finalRoot)
);

// Verify the same proof against an OLDER root (before leaf 17 was added).
// Since 17 wasn't in the tree at root rootsByStep[16], this MUST fail.
ok(
  "proof17 against pre-insertion root (step 16) fails",
  !verifyUtxoMembership(leaves[17], proof17, rootsByStep[16])
);

// Empty root rejects everything.
ok(
  "proof17 against EMPTY root fails",
  !verifyUtxoMembership(leaves[17], proof17, utxoTreeRoot(emptyUtxoTree()))
);

/* -------------------------------------------------------------- *
 *  Determinism: appending the same leaves in the same order       *
 *  gives the same root, on a fresh tree.                          *
 * -------------------------------------------------------------- */
console.log("\n• determinism");
let t2 = emptyUtxoTree();
for (const l of leaves) t2 = appendUtxo(t2, l);
ok(
  "two independent histories with same leaves → same root",
  bytesEq(utxoTreeRoot(t2), finalRoot)
);

/* -------------------------------------------------------------- *
 *  Order-sensitivity: SWAPPING the order of any two leaves        *
 *  must yield a DIFFERENT root.                                    *
 * -------------------------------------------------------------- */
let t3 = emptyUtxoTree();
const reordered = [...leaves];
[reordered[3], reordered[4]] = [reordered[4], reordered[3]];
for (const l of reordered) t3 = appendUtxo(t3, l);
ok(
  "swapping the order of two leaves changes the root",
  !bytesEq(utxoTreeRoot(t3), finalRoot)
);

/* -------------------------------------------------------------- *
 *  Pinning: a proof generated at snapshot S verifies vs root_S    *
 *  but NOT vs any later root (since the path's siblings shift).   *
 * -------------------------------------------------------------- */
console.log("\n• proofs are pinned to a specific snapshot");
let tProgress = emptyUtxoTree();
for (let i = 0; i <= 25; i++) tProgress = appendUtxo(tProgress, leaves[i]);
const earlyProof = utxoMembershipProof(tProgress, 4);
const earlyRoot = utxoTreeRoot(tProgress);
ok(
  "early proof verifies against the snapshot it was generated at",
  verifyUtxoMembership(leaves[4], earlyProof, earlyRoot)
);
// Continue appending.
for (let i = 26; i < N; i++) tProgress = appendUtxo(tProgress, leaves[i]);
const laterRoot = utxoTreeRoot(tProgress);
ok(
  "early proof does NOT verify against later root (siblings shifted)",
  !verifyUtxoMembership(leaves[4], earlyProof, laterRoot)
);
// However: a FRESH proof for the same leaf against the later root works.
const refreshedProof = utxoMembershipProof(tProgress, 4);
ok(
  "fresh proof against later root works",
  verifyUtxoMembership(leaves[4], refreshedProof, laterRoot)
);

/* -------------------------------------------------------------- *
 *  Performance sanity at moderate scale.                           *
 * -------------------------------------------------------------- */
console.log("\n• performance check (10,000 leaves)");
const BIG = 10_000;
const tBig = (() => {
  let s = emptyUtxoTree();
  const t0 = Date.now();
  for (let i = 0; i < BIG; i++) {
    const v = utxoLeafHash(
      G.multiply(BigInt(i + 1)), H.multiply(BigInt(i + 1)), i
    );
    s = appendUtxo(s, v);
  }
  const dt = Date.now() - t0;
  console.log(`    appended ${BIG} leaves in ${dt}ms (${(dt / BIG).toFixed(2)}ms/leaf)`);
  return s;
})();
ok(`big tree leafCount = ${BIG}`, tBig.leafCount === BIG);
const bigProof = utxoMembershipProof(tBig, BIG - 1);
ok(
  `proof for last leaf (#${BIG - 1}) verifies`,
  verifyUtxoMembership(
    utxoLeafHash(
      G.multiply(BigInt(BIG)), H.multiply(BigInt(BIG)), BIG - 1
    ),
    bigProof,
    utxoTreeRoot(tBig)
  )
);
ok(
  `proof size = D siblings`,
  bigProof.siblings.length === UTXO_TREE_DEPTH
);

console.log("\nALL CHECKS PASSED.\n");
