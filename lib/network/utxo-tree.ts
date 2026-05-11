/* ================================================================== *
 *  MoneyFund Network — UTXO Accumulator                                *
 *                                                                      *
 *  THE PRIVACY-AT-SCALE PRIMITIVE                                      *
 *  ───────────────────────────────                                     *
 *  Replaces the chain's `Map<oneTimeAddr → entry>` with a cryptographic *
 *  accumulator: a fixed-depth, append-only Merkle tree over every       *
 *  output ever produced. The 32-byte tree root is committed into each   *
 *  block header. Three immediate consequences:                          *
 *                                                                      *
 *    • Light clients verify "this output existed at height h" with a   *
 *      single 32-byte root + a O(log N) sibling path. No need to       *
 *      replay history or download the full UTXO set.                   *
 *                                                                      *
 *    • Ring signatures over the FULL UTXO set become tractable. A     *
 *      spend can prove "I own SOME leaf in the tree" with a            *
 *      log-size membership proof — the foundation of the Triptych /    *
 *      Lelantus / Spats family of log-size ring sigs that succeed      *
 *      CLSAG. Anonymity set = every output ever, not 16 decoys.        *
 *                                                                      *
 *    • zk-SNARK composition. The tree's leaf hash is a single field    *
 *      element; a SNARK can prove "I know an opening of leaf at idx   *
 *      i with root R" in constant proof size, regardless of how big    *
 *      the tree gets.                                                  *
 *                                                                      *
 *  DESIGN: ZCASH-STYLE INCREMENTAL MERKLE TREE                         *
 *  ─────────────────────────────────────────                           *
 *  Fixed depth D (default 32 = 4 billion leaves of capacity). Leaves   *
 *  are appended left-to-right. Unfilled positions are taken to be a    *
 *  precomputed "empty leaf" hash; the corresponding empty interior     *
 *  hashes are likewise precomputed and cached as `zeros[d]`. This is   *
 *  the same "sparse Merkle tree with all-zero padding" used by Zcash   *
 *  Sapling/Orchard, Aztec, and Mina — battle-tested and SNARK-           *
 *  friendly.                                                            *
 *                                                                      *
 *  COMPLEXITY                                                          *
 *  ──────────                                                          *
 *    append(leaf)              O(D) hashes, O(D) state mutations       *
 *    root()                    O(1) — top of the sparse map            *
 *    membershipProof(idx)      O(D) sibling fetches                    *
 *    verifyMembership(...)     O(D) hashes                             *
 *                                                                      *
 *  SECURITY                                                            *
 *  ────────                                                            *
 *    • Domain-separated hashes (UTXO_LEAF / UTXO_NODE / UTXO_EMPTY)    *
 *      so the tree's pre-image space is disjoint from every other     *
 *      hash structure on the chain (storage Merkle, tx-id, block-id). *
 *    • 32-byte (sha512[0..32]) hashes — same collision-resistance     *
 *      bound as the rest of the chain.                                 *
 *    • Append-only: deletions are NEVER permitted. Spent outputs       *
 *      remain in the tree; the spent-key-image set is what tracks     *
 *      unspendability. This is precisely Monero's anonymity-set       *
 *      model and the reason ring signatures stay sound.                *
 * ================================================================== */

import { DOMAIN, dhash, bytesToHex } from "./codec";
import type { CurvePoint } from "./primitives";

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                          */
/* ------------------------------------------------------------------ */

/** Tree depth. 2^32 leaves = ~4.29 × 10⁹ outputs of capacity. Hard-     *
 *  coded into the protocol — a network reset is needed to change it.   *
 *  All implementations MUST use the same depth or the roots diverge.   */
export const UTXO_TREE_DEPTH = 32;

/** Pre-derived "empty leaf" hash. Domain-separated and constant. */
export const EMPTY_LEAF: Uint8Array = dhash(DOMAIN.UTXO_EMPTY, new Uint8Array(0));

/* ------------------------------------------------------------------ */
/*  STATE                                                              */
/* ------------------------------------------------------------------ */

/** A position-keyed sparse storage of non-empty Merkle nodes. Positions *
 *  are encoded as `depth:index` where depth ∈ [0, UTXO_TREE_DEPTH] and  *
 *  index ∈ [0, 2^(D-depth)). Only nodes that have at least one non-     *
 *  empty descendant leaf are stored; everything else falls back to the *
 *  pre-computed zero hashes.                                            */
export interface UtxoTreeState {
  nodes: Map<string, Uint8Array>;
  leafCount: number;
  /** Cached chain of zero hashes, one per depth level (length = D+1).    *
   *  zeros[0] = EMPTY_LEAF; zeros[d+1] = dhash(NODE, zeros[d], zeros[d]).*/
  zeros: Uint8Array[];
}

/** Pre-compute the zero hashes for all depths [0..D]. */
function computeZeros(depth: number): Uint8Array[] {
  const zs: Uint8Array[] = [EMPTY_LEAF];
  for (let d = 1; d <= depth; d++) {
    zs.push(dhash(DOMAIN.UTXO_NODE, zs[d - 1], zs[d - 1]));
  }
  return zs;
}

/** A fresh, empty UTXO tree. The root of an empty tree is zeros[D]. */
export function emptyUtxoTree(): UtxoTreeState {
  return {
    nodes: new Map(),
    leafCount: 0,
    zeros: computeZeros(UTXO_TREE_DEPTH),
  };
}

/* ------------------------------------------------------------------ */
/*  LEAF ENCODING                                                      */
/* ------------------------------------------------------------------ */

/** Domain-separated leaf hash for a UTXO. Binds the one-time stealth    *
 *  address P, the amount commitment C, and the block height at which   *
 *  the output was anchored. Height inclusion ties the leaf to a        *
 *  specific point in chain history — a wallet's membership witness     *
 *  is therefore valid only against the tree state at-or-after that     *
 *  height.                                                              */
export function utxoLeafHash(
  oneTimeAddr: CurvePoint,
  amountCommit: CurvePoint,
  height: number
): Uint8Array {
  const heightBytes = new Uint8Array(4);
  const view = new DataView(heightBytes.buffer);
  view.setUint32(0, height, false /* big-endian */);
  return dhash(
    DOMAIN.UTXO_LEAF,
    oneTimeAddr.toBytes(),
    amountCommit.toBytes(),
    heightBytes
  );
}

/* ------------------------------------------------------------------ */
/*  APPEND                                                             */
/* ------------------------------------------------------------------ */

/** Append a new leaf and return the resulting tree state. PURE: the     *
 *  input state is not mutated; the returned state shares no mutable     *
 *  references with it. This matches the rest of the chain-state API    *
 *  where applyBlock builds `next` immutably so a failed validation can *
 *  cleanly discard.                                                     */
export function appendUtxo(
  state: UtxoTreeState,
  leaf: Uint8Array
): UtxoTreeState {
  if (leaf.length !== 32) {
    throw new Error(`utxo-tree: leaf must be 32 bytes (got ${leaf.length})`);
  }
  const idx = state.leafCount;
  if (idx >= 2 ** UTXO_TREE_DEPTH) {
    // Practically unreachable (4 billion outputs!), but a hard error
    // here is better than a silent overflow.
    throw new Error(`utxo-tree: capacity exhausted at depth ${UTXO_TREE_DEPTH}`);
  }

  const next: UtxoTreeState = {
    nodes: new Map(state.nodes),
    leafCount: idx + 1,
    zeros: state.zeros,
  };

  let cur = leaf;
  next.nodes.set(`0:${idx}`, cur);
  let pos = idx;
  for (let d = 0; d < UTXO_TREE_DEPTH; d++) {
    const sibPos = pos ^ 1;
    const sib = next.nodes.get(`${d}:${sibPos}`) ?? state.zeros[d];
    const isLeftChild = (pos & 1) === 0;
    cur = isLeftChild
      ? dhash(DOMAIN.UTXO_NODE, cur, sib)
      : dhash(DOMAIN.UTXO_NODE, sib, cur);
    pos >>>= 1;
    next.nodes.set(`${d + 1}:${pos}`, cur);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/*  ROOT                                                               */
/* ------------------------------------------------------------------ */

/** The 32-byte Merkle root. Constant-time lookup. */
export function utxoTreeRoot(state: UtxoTreeState): Uint8Array {
  return state.nodes.get(`${UTXO_TREE_DEPTH}:0`) ?? state.zeros[UTXO_TREE_DEPTH];
}

/* ------------------------------------------------------------------ */
/*  MEMBERSHIP PROOF                                                   */
/* ------------------------------------------------------------------ */

export interface UtxoMembershipProof {
  /** Index of the leaf being proved (0-based, left-to-right append order).*/
  leafIdx: number;
  /** D sibling hashes from leaf (depth 0) up to the root (depth D-1). */
  siblings: Uint8Array[];
}

/** Build a membership proof for the leaf at `leafIdx`. The returned     *
 *  proof verifies against the CURRENT root. If the tree grows (more    *
 *  leaves appended), the proof remains valid for the leaf in question  *
 *  but only against the root AT THE TIME of proof generation — caller  *
 *  must pin the matching root (typically from a known block header).   */
export function utxoMembershipProof(
  state: UtxoTreeState,
  leafIdx: number
): UtxoMembershipProof {
  if (leafIdx < 0 || leafIdx >= state.leafCount) {
    throw new Error(
      `utxo-tree: leafIdx ${leafIdx} out of range [0, ${state.leafCount})`
    );
  }
  const siblings: Uint8Array[] = [];
  let pos = leafIdx;
  for (let d = 0; d < UTXO_TREE_DEPTH; d++) {
    const sibPos = pos ^ 1;
    const sib = state.nodes.get(`${d}:${sibPos}`) ?? state.zeros[d];
    siblings.push(sib);
    pos >>>= 1;
  }
  return { leafIdx, siblings };
}

/** Verify a membership proof. Recomputes the root from leaf + siblings  *
 *  and compares against the expected root. Constant-time-ish: same     *
 *  number of hashes regardless of input, but a final compareBytes      *
 *  returns early on mismatch. For consensus we don't need full         *
 *  constant-time since the inputs are public.                          */
export function verifyUtxoMembership(
  leaf: Uint8Array,
  proof: UtxoMembershipProof,
  expectedRoot: Uint8Array
): boolean {
  if (leaf.length !== 32 || expectedRoot.length !== 32) return false;
  if (proof.siblings.length !== UTXO_TREE_DEPTH) return false;
  let cur = leaf;
  let pos = proof.leafIdx;
  for (let d = 0; d < UTXO_TREE_DEPTH; d++) {
    const sib = proof.siblings[d];
    if (sib.length !== 32) return false;
    const isLeftChild = (pos & 1) === 0;
    cur = isLeftChild
      ? dhash(DOMAIN.UTXO_NODE, cur, sib)
      : dhash(DOMAIN.UTXO_NODE, sib, cur);
    pos >>>= 1;
  }
  return bytesEqual(cur, expectedRoot);
}

/* ------------------------------------------------------------------ */
/*  UTILITY                                                            */
/* ------------------------------------------------------------------ */

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  // Constant-time-ish comparison: XOR fold, no early return.
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Pretty-print a root or sibling hash for logs. */
export function shortRoot(b: Uint8Array): string {
  return `${bytesToHex(b).slice(0, 8)}…${bytesToHex(b).slice(-4)}`;
}
