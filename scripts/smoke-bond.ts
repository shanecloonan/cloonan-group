/* ================================================================== *
 *  Smoke: bond wire + Merkle + applyBlock (no validator set / no       *
 *  producer proof path). Mirrors `mfn-consensus` bond_wire tests in TS. *
 * ================================================================== */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { G } from "../lib/network/primitives";
import { blsKeygen } from "../lib/network/bls";
import {
  buildGenesis,
  applyGenesis,
  buildUnsealedHeader,
  sealBlock,
  applyBlock,
  blockId,
} from "../lib/network/block";
import {
  encodeBondOp,
  decodeBondOp,
  bondMerkleRoot,
  type BondOp,
} from "../lib/network/bond";
import {
  DEFAULT_BONDING_PARAMS,
  decodeBondingParams,
  encodeBondingParams,
} from "../lib/network/bonding";
import { encodeBlock, decodeBlock } from "../lib/network/wire";
import { ChainStore } from "../lib/network/store";

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("• bonding params encode/decode round-trip");
const encBp = encodeBondingParams(DEFAULT_BONDING_PARAMS);
const decBp = decodeBondingParams(encBp);
ok(
  "bonding params round-trip",
  decBp.minValidatorStake === DEFAULT_BONDING_PARAMS.minValidatorStake &&
    decBp.maxEntryChurnPerEpoch === DEFAULT_BONDING_PARAMS.maxEntryChurnPerEpoch
);

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

console.log("• encodeBlock / decodeBlock round-trip preserves bond path");
const wire1 = encodeBlock(block);
const round = decodeBlock(wire1);
const wire2 = encodeBlock(round);
ok(
  "wire bytes idempotent",
  wire1.length === wire2.length && wire1.every((b, i) => b === wire2[i])
);
ok("decoded bond ops length", (round.bondOps ?? []).length === 1);
ok(
  "decoded bond root matches header",
  round.header.bondRoot !== undefined &&
    eqBytes(round.header.bondRoot, bondMerkleRoot(round.bondOps ?? []))
);
ok(
  "block id stable across wire",
  eqBytes(blockId(block.header), blockId(round.header))
);

const r = applyBlock(state0, block);
ok("block accepted", r.ok, r.errors);
ok("one validator registered", r.state.validators.length === 1);
ok("index 0", r.state.validators[0].index === 0);
ok("stake matches", r.state.validators[0].stake === op.stake);
ok("bond epoch entry count", r.state.bondEpochEntryCount === 1);
ok("next validator index", r.state.nextValidatorIndex === 1);

console.log("• applyBlock rejects second bond when entry churn cap is 1");
const tightCfg = {
  ...cfg,
  bondingParams: {
    ...DEFAULT_BONDING_PARAMS,
    maxEntryChurnPerEpoch: 1,
  },
};
const genesisT = buildGenesis(tightCfg);
const stateT = applyGenesis(genesisT, tightCfg);
const blsB = blsKeygen();
const opB: BondOp = {
  kind: "register",
  stake: DEFAULT_BONDING_PARAMS.minValidatorStake,
  vrfPk: G.multiply(3n),
  blsPk: blsB.pk,
};
const bondOpsTwo = [op, opB];
const unsealedT = buildUnsealedHeader({
  state: stateT,
  txs: [],
  bondOps: bondOpsTwo,
  slot: 1,
  timestamp: 100,
});
const blockChurn = sealBlock(
  unsealedT,
  [],
  new Uint8Array(0),
  [],
  [],
  bondOpsTwo
);
const churnR = applyBlock(stateT, blockChurn);
ok("churn block rejected", !churnR.ok);
ok(
  "bond_ops[1] entry churn error",
  churnR.errors.some(
    (e) =>
      e.includes("bond_ops[1]") &&
      e.includes("max_entry_churn_per_epoch")
  )
);

console.log("• ChainStore replay preserves bond-applied validator");
const tmpD = mkdtempSync(join(tmpdir(), "mfbn-bond-store-"));
const dbPath = join(tmpD, "chain.db");
try {
  const st = ChainStore.open(dbPath);
  st.initialize(cfg);
  const ar = st.applyBlock(block);
  ok("store apply ok", ar.ok);
  const nVal = st.currentState().validators.length;
  const nIdx = st.currentState().nextValidatorIndex;
  st.close();
  const st2 = ChainStore.open(dbPath);
  const restored = st2.initializeOrRestore(cfg);
  ok("restore validator count", restored.validators.length === nVal);
  ok("restore nextValidatorIndex", restored.nextValidatorIndex === nIdx);
  ok("restore bondEpochEntryCount", restored.bondEpochEntryCount === 1);
  st2.close();
} finally {
  rmSync(tmpD, { recursive: true, force: true });
}

console.log("• ChainStore restores custom bondingParams from meta");
const tmpB = mkdtempSync(join(tmpdir(), "mfbn-bond-params-"));
const dbB = join(tmpB, "chain.db");
try {
  const customBp = {
    ...DEFAULT_BONDING_PARAMS,
    maxEntryChurnPerEpoch: 2,
    minValidatorStake: 2_000_000n,
  };
  const cfgBp = { ...cfg, bondingParams: customBp };
  const stB = ChainStore.open(dbB);
  stB.initialize(cfgBp);
  ok(
    "live state has custom min stake",
    stB.currentState().bondingParams.minValidatorStake === 2_000_000n
  );
  stB.close();
  const stB2 = ChainStore.open(dbB);
  const restoredBp = stB2.initializeOrRestore(cfg);
  ok(
    "restore bondingParams.minValidatorStake",
    restoredBp.bondingParams.minValidatorStake === 2_000_000n
  );
  ok(
    "restore maxEntryChurnPerEpoch",
    restoredBp.bondingParams.maxEntryChurnPerEpoch === 2
  );
  stB2.close();
} finally {
  rmSync(tmpB, { recursive: true, force: true });
}

console.log("\nALL CHECKS PASSED.\n");
