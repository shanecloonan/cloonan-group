/* ================================================================== *
 *  Smoke: bond wire + Merkle + applyBlock (no validator set / no       *
 *  producer proof path). Mirrors `mfn-consensus` bond_wire tests in TS. *
 * ================================================================== */

import { G } from "../lib/network/primitives";
import { blsKeygen } from "../lib/network/bls";
import {
  buildGenesis,
  applyGenesis,
  buildUnsealedHeader,
  sealBlock,
  applyBlock,
} from "../lib/network/block";
import {
  encodeBondOp,
  decodeBondOp,
  bondMerkleRoot,
  type BondOp,
} from "../lib/network/bond";
import { DEFAULT_BONDING_PARAMS } from "../lib/network/bonding";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("• bond op encode/decode round-trip");
const bls = blsKeygen();
const op: BondOp = {
  kind: "register",
  stake: DEFAULT_BONDING_PARAMS.minValidatorStake,
  vrfPk: G,
  blsPk: bls.pk,
};
const enc = encodeBondOp(op);
const dec = decodeBondOp(enc);
const enc2 = encodeBondOp(dec);
ok(
  "round-trip wire bytes match",
  enc.length === enc2.length && enc.every((b, i) => b === enc2[i])
);

console.log("• empty bond Merkle root is zero");
const z = bondMerkleRoot([]);
ok("32 zero bytes", z.every((b) => b === 0));

console.log("• applyBlock: genesis (no validators) + height-1 block with bond");
const cfg = {
  timestamp: 0,
  initialOutputs: [] as { oneTimeAddr: typeof G; amount: typeof G }[],
  initialStorage: [],
};
const genesis = buildGenesis(cfg);
const state0 = applyGenesis(genesis, cfg);
ok("genesis has no validators", state0.validators.length === 0);

const bondOps: BondOp[] = [op];
const unsealed = buildUnsealedHeader({
  state: state0,
  txs: [],
  bondOps,
  slot: 1,
  timestamp: 100,
});
const block = sealBlock(unsealed, [], new Uint8Array(0), [], [], bondOps);
const r = applyBlock(state0, block);
ok("block accepted", r.ok, r.errors);
ok("one validator registered", r.state.validators.length === 1);
ok("index 0", r.state.validators[0].index === 0);
ok("stake matches", r.state.validators[0].stake === op.stake);

console.log("\nALL CHECKS PASSED.\n");
