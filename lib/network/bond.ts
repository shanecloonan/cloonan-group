/* ================================================================== *
 *  Bond operation wire + Merkle root — TS port of                      *
 *  `permawrite/mfn-consensus/src/bond_wire.rs`.                        *
 * ================================================================== */

import type { CurvePoint } from "./primitives";
import { Writer, Reader, dhash, DOMAIN } from "./codec";
import {
  encodePublicKey,
  decodePublicKey,
  type BlsPublicKey,
} from "./bls";
import { merkleTreeFromLeaves } from "./storage";

export const BOND_OP_REGISTER = 0;

export type BondOp =
  | {
      kind: "register";
      stake: bigint;
      vrfPk: CurvePoint;
      blsPk: BlsPublicKey;
      payout?: { viewPub: CurvePoint; spendPub: CurvePoint };
    };

export function encodeBondOp(op: BondOp): Uint8Array {
  const w = new Writer();
  if (op.kind !== "register") {
    throw new Error("encodeBondOp: unknown op kind");
  }
  w.u8(BOND_OP_REGISTER);
  w.u64(op.stake);
  w.point(op.vrfPk);
  w.push(encodePublicKey(op.blsPk));
  if (op.payout) {
    w.u8(1);
    w.point(op.payout.viewPub);
    w.point(op.payout.spendPub);
  } else {
    w.u8(0);
  }
  return w.bytes();
}

export function decodeBondOp(bytes: Uint8Array): BondOp {
  const r = new Reader(bytes);
  const tag = r.u8();
  if (tag !== BOND_OP_REGISTER) {
    throw new Error(`decodeBondOp: unknown bond op tag ${tag}`);
  }
  const stake = r.u64();
  const vrfPk = r.point();
  const blsPk = decodePublicKey(r.bytes(48));
  const hasPayout = r.u8();
  let payout: { viewPub: CurvePoint; spendPub: CurvePoint } | undefined;
  if (hasPayout === 1) {
    payout = { viewPub: r.point(), spendPub: r.point() };
  } else if (hasPayout !== 0) {
    throw new Error(`decodeBondOp: bad payout flag ${hasPayout}`);
  }
  if (r.remaining() !== 0) throw new Error("decodeBondOp: trailing bytes");
  return { kind: "register", stake, vrfPk, blsPk, payout };
}

export function bondOpLeafHash(op: BondOp): Uint8Array {
  return dhash(DOMAIN.BOND_OP_LEAF, encodeBondOp(op));
}

export function bondMerkleRoot(ops: BondOp[]): Uint8Array {
  if (ops.length === 0) return new Uint8Array(32);
  const leaves = ops.map(bondOpLeafHash);
  return merkleTreeFromLeaves(leaves).root;
}
