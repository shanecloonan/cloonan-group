/* ================================================================== *
 *  Smoke: storage-treasury end-to-end                                  *
 *                                                                      *
 *  Validates the hybrid funding model:                                 *
 *    • Privacy-tx fees split 90/10 between treasury and producer.     *
 *    • Storage rewards drain the treasury first.                      *
 *    • When the treasury can't cover the bill, emission MINTS the     *
 *      shortfall as a backstop — producer still receives the full    *
 *      per-proof amount.                                               *
 *                                                                      *
 *  Stages                                                              *
 *  ──────                                                              *
 *    1. Block @1: a real Alice→Bob CLSAG spend with fee = 0.5 MFN.   *
 *       → treasury fills with 0.45 MFN, producer tip = 0.05 MFN.    *
 *    2. Block @2: 3 storage proofs, no fees.                          *
 *       → treasury drains by 0.3 MFN, producer earns coinbase =     *
 *          emission(2) + 0.3 MFN.                                     *
 *    3. Block @3: 3 storage proofs, no fees, treasury would go        *
 *       negative.                                                     *
 *       → treasury drains to 0, the shortfall is minted, producer   *
 *          still receives coinbase = emission(3) + 0.3 MFN.          *
 *    4. Block @4: 3 storage proofs, treasury empty.                   *
 *       → entire 0.3 MFN is minted, treasury stays at 0.            *
 * ================================================================== */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChainStore } from "../lib/network/store";
import { vrfKeygen, type VrfKeypair } from "../lib/network/vrf";
import { blsKeygen, blsSign, type BlsKeypair } from "../lib/network/bls";
import {
  type Validator,
  type ValidatorSecrets,
  tryProduceSlot,
  finalize,
  encodeFinalityProof,
} from "../lib/network/consensus";
import {
  buildBlock,
  buildUnsealedHeader,
  headerSigningHash,
  applyBlock,
  type ChainState,
  type Block,
} from "../lib/network/block";
import {
  G,
  H,
  pedersenCommit,
  stealthGen,
  stealthSendTo,
  stealthSpendKey,
  randomScalar,
  indexedStealthDetect,
  decryptOutputAmount,
  type CurvePoint,
} from "../lib/network/primitives";
import { signTransaction, type InputSpec } from "../lib/network/transaction";
import {
  buildStorageCommitment,
  buildStorageProof,
  type StorageCommitment,
} from "../lib/network/storage";
import {
  DEFAULT_EMISSION_PARAMS,
  emissionAtHeight,
} from "../lib/network/emission";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("\n== Smoke: storage-treasury end-to-end ==\n");

const EMISSION = DEFAULT_EMISSION_PARAMS;
const PROOF_REWARD = EMISSION.storageProofReward; // 0.1 MFN = 10_000_000
const FEE_BPS = EMISSION.feeToTreasuryBps; // 9000
const FEE_DIV = 10_000n;

ok(
  `defaults sane: storageProofReward=${PROOF_REWARD} feeToTreasuryBps=${FEE_BPS}`,
  PROOF_REWARD === 10_000_000n && FEE_BPS === 9000
);

/* -------------------------------------------------------------- *
 *  Setup: 3 validators with payouts, 1 pre-funded Alice, 12       *
 *  storage commitments (enough to prove 3 different ones across   *
 *  several blocks without duplicates).                            *
 * -------------------------------------------------------------- */
const N = 3;
const stakes = [1000n, 1000n, 1000n];
const totalStake = stakes.reduce((a, b) => a + b, 0n);
const vrfs: VrfKeypair[] = [];
const bls: BlsKeypair[] = [];
const payouts = [stealthGen(), stealthGen(), stealthGen()];
for (let i = 0; i < N; i++) {
  vrfs.push(vrfKeygen());
  bls.push(blsKeygen());
}
const validators: Validator[] = [];
const secrets: ValidatorSecrets[] = [];
for (let i = 0; i < N; i++) {
  validators.push({
    index: i,
    vrfPk: vrfs[i].pk,
    blsPk: bls[i].pk,
    stake: stakes[i],
    payoutAddress: { viewPub: payouts[i].viewPub, spendPub: payouts[i].spendPub },
  });
  secrets.push({ index: i, vrf: vrfs[i], bls: bls[i] });
}

const alice = stealthGen();
const aliceFunding = stealthSendTo(alice);
const aliceSpend = stealthSpendKey(aliceFunding, alice);
const ALICE_VALUE = 5_000_000_000n; // 50 MFN, lots of headroom
const aliceBlinding = randomScalar();
const aliceCommit = G.multiply(aliceBlinding).add(H.multiply(ALICE_VALUE));

const NUM_COMMITS = 12;
const datas: Uint8Array[] = [];
const trees: { commit: StorageCommitment; tree: ReturnType<typeof buildStorageCommitment>["tree"] }[] = [];
for (let i = 0; i < NUM_COMMITS; i++) {
  const d = new Uint8Array(16 * 1024);
  for (let j = 0; j < d.length; j++) d[j] = (i * 97 + j * 13) & 0xff;
  datas.push(d);
  const built = buildStorageCommitment(d, 1000n, { replication: 3 });
  trees.push({ commit: built.commit, tree: built.tree });
}

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [{ oneTimeAddr: aliceFunding.oneTimeAddr, amount: aliceCommit }],
  initialStorage: trees.map((t) => t.commit),
  validators,
};

const tmp = mkdtempSync(join(tmpdir(), "mfbn-treasury-"));
const store = ChainStore.open(join(tmp, "chain.db"));
let state = store.initialize(cfg);

ok("genesis treasury = 0", state.treasury === 0n);
ok(`genesis anchored ${NUM_COMMITS} storage commitments`, state.storage.size === NUM_COMMITS);

/* -------------------------------------------------------------- *
 *  Helper: drive a slot loop until a producer is VRF-eligible on  *
 *  the actual sealed header hash. Returns the sealed Block +      *
 *  metadata.                                                       *
 * -------------------------------------------------------------- */
function sealBlockAt(
  s: ChainState,
  startSlot: number,
  txs: ReturnType<typeof signTransaction>["tx"][],
  proofIndices: number[]
): { sealed: Block; producerIdx: number; slot: number } {
  const prevHash = s.blockIds[s.blockIds.length - 1];
  for (let slot = startSlot; slot < startSlot + 200; slot++) {
    for (let i = 0; i < N; i++) {
      const storageProofs = proofIndices.map((pi) =>
        buildStorageProof(trees[pi].commit, prevHash, slot, datas[pi], trees[pi].tree)
      );
      // Build the *would-be* block (with coinbase + correct proofs) so we
      // hash the final header — tryProduceSlot binds to that hash.
      const candidate = buildBlock({
        state: s,
        txs,
        slot,
        timestamp: cfg.timestamp + slot,
        storageProofs,
        producerPayout: validators[i].payoutAddress,
      });
      const headerHash = headerSigningHash(candidate.header);
      const realProducer = tryProduceSlot(
        { height: s.height + 1, slot, prevHash },
        secrets[i],
        validators[i],
        totalStake,
        s.params.expectedProposersPerSlot,
        headerHash
      );
      if (!realProducer) continue;
      const votes = validators.map((_v, vi) => ({
        index: vi,
        sig: blsSign(headerHash, secrets[vi].bls.sk),
      }));
      const finality = finalize(headerHash, votes, validators.length);
      const sealed: Block = {
        ...candidate,
        header: {
          ...candidate.header,
          producerProof: encodeFinalityProof({
            producer: realProducer,
            finality,
            signingStake: totalStake,
          }),
        },
      };
      return { sealed, producerIdx: i, slot };
    }
  }
  throw new Error(`no VRF-eligible producer in 200 slots from ${startSlot}`);
}

/* -------------------------------------------------------------- *
 *  STAGE 1 — Alice → Bob spend with fee = 0.5 MFN.                *
 *  feeSum=50_000_000; treasury += 45_000_000; producer fee = 5M.  *
 * -------------------------------------------------------------- */
console.log("\n• stage 1: real Alice→Bob spend funds the treasury");
const FEE_1 = 50_000_000n; // 0.5 MFN
const TREASURY_GAIN_1 = (FEE_1 * BigInt(FEE_BPS)) / FEE_DIV;
const PRODUCER_FEE_1 = FEE_1 - TREASURY_GAIN_1;
const bob = stealthGen();
const bobOut = stealthSendTo(bob);

// Mini ring of 4 (Alice + 3 dummies).
const ringP: CurvePoint[] = [];
const ringC: CurvePoint[] = [];
for (let i = 0; i < 3; i++) {
  const dummy = stealthGen();
  const out = stealthSendTo(dummy);
  ringP.push(out.oneTimeAddr);
  ringC.push(pedersenCommit(BigInt(7 + i), randomScalar()).C);
}
const SIGNER_IDX = 1;
ringP.splice(SIGNER_IDX, 0, aliceFunding.oneTimeAddr);
ringC.splice(SIGNER_IDX, 0, aliceCommit);

const inputs: InputSpec[] = [{
  ring: { P: ringP, C: ringC },
  signerIdx: SIGNER_IDX,
  spendPriv: aliceSpend,
  value: ALICE_VALUE,
  blinding: aliceBlinding,
}];
const aliceTx = signTransaction(
  inputs,
  [{ oneTimeAddr: bobOut.oneTimeAddr, value: ALICE_VALUE - FEE_1 }],
  FEE_1
);
ok("alice→bob spend signed", true);

const stage1 = sealBlockAt(state, 0, [aliceTx.tx], []);
const r1 = applyBlock(state, stage1.sealed);
ok("stage 1: applyBlock accepts spend + coinbase", r1.ok, r1.errors);
state = r1.state;

ok(
  `stage 1: treasury = ${TREASURY_GAIN_1} (90% of ${FEE_1})`,
  state.treasury === TREASURY_GAIN_1,
  `got=${state.treasury}`
);

// Verify producer's coinbase = emission(1) + producerFee + 0 storage rewards
const cb1 = stage1.sealed.txs[0];
const detect1 = indexedStealthDetect(
  cb1.R,
  cb1.outputs[0].oneTimeAddr,
  0,
  { viewPriv: payouts[stage1.producerIdx].viewPriv, spendPub: payouts[stage1.producerIdx].spendPub }
);
ok("stage 1: producer detects coinbase", detect1);
const { value: coinbaseValue1 } = decryptOutputAmount(
  cb1.R, 0, payouts[stage1.producerIdx].viewPriv, cb1.outputs[0].encAmount
);
const expectedCoinbase1 = emissionAtHeight(stage1.sealed.header.height) + PRODUCER_FEE_1;
ok(
  `stage 1: coinbase = emission(${stage1.sealed.header.height}) + ${PRODUCER_FEE_1} (10% tip)`,
  coinbaseValue1 === expectedCoinbase1,
  `got=${coinbaseValue1} expected=${expectedCoinbase1}`
);

/* -------------------------------------------------------------- *
 *  STAGE 2 — 3 storage proofs paid FULLY from treasury.           *
 *  Treasury balance: 45_000_000 → 15_000_000 (drained 30M).      *
 * -------------------------------------------------------------- */
console.log("\n• stage 2: storage rewards drain the treasury (no mint)");
const NUM_PROOFS_2 = 3;
const PROOF_PAYOUT_2 = PROOF_REWARD * BigInt(NUM_PROOFS_2);
const treasuryBefore2 = state.treasury;
const stage2 = sealBlockAt(state, stage1.slot + 1, [], [0, 1, 2]);
const r2 = applyBlock(state, stage2.sealed);
ok("stage 2: applyBlock accepts storage-proof block", r2.ok, r2.errors);
state = r2.state;

ok(
  `stage 2: treasury drained by ${PROOF_PAYOUT_2}: ${treasuryBefore2} → ${state.treasury}`,
  state.treasury === treasuryBefore2 - PROOF_PAYOUT_2,
  `got=${state.treasury} expected=${treasuryBefore2 - PROOF_PAYOUT_2}`
);

const cb2 = stage2.sealed.txs[0];
const { value: coinbaseValue2 } = decryptOutputAmount(
  cb2.R, 0, payouts[stage2.producerIdx].viewPriv, cb2.outputs[0].encAmount
);
const expectedCoinbase2 =
  emissionAtHeight(stage2.sealed.header.height) + PROOF_PAYOUT_2;
ok(
  `stage 2: coinbase = emission + ${PROOF_PAYOUT_2} storage reward (no mint flag, but value is same to producer)`,
  coinbaseValue2 === expectedCoinbase2,
  `got=${coinbaseValue2} expected=${expectedCoinbase2}`
);

/* -------------------------------------------------------------- *
 *  STAGE 3 — Storage rewards EXCEED treasury balance: backstop    *
 *  mints the shortfall.                                            *
 *  Treasury before: 15_000_000; demanded: 30_000_000.             *
 *  After: 0 (15M drained, 15M minted as backstop).                *
 * -------------------------------------------------------------- */
console.log("\n• stage 3: treasury can't cover; emission mints the shortfall");
const treasuryBefore3 = state.treasury;
const stage3 = sealBlockAt(state, stage2.slot + 1, [], [3, 4, 5]);
const r3 = applyBlock(state, stage3.sealed);
ok("stage 3: applyBlock accepts despite under-funded treasury", r3.ok, r3.errors);
state = r3.state;

ok(
  `stage 3: treasury drained to 0 (was ${treasuryBefore3})`,
  state.treasury === 0n,
  `got=${state.treasury}`
);

const cb3 = stage3.sealed.txs[0];
const { value: coinbaseValue3 } = decryptOutputAmount(
  cb3.R, 0, payouts[stage3.producerIdx].viewPriv, cb3.outputs[0].encAmount
);
const expectedCoinbase3 =
  emissionAtHeight(stage3.sealed.header.height) + PROOF_PAYOUT_2;
ok(
  `stage 3: producer STILL receives full ${PROOF_PAYOUT_2} storage reward`,
  coinbaseValue3 === expectedCoinbase3,
  `got=${coinbaseValue3} expected=${expectedCoinbase3}`
);

/* -------------------------------------------------------------- *
 *  STAGE 4 — Empty treasury, fully minted backstop.               *
 *  Confirms the chain keeps paying storage rewards indefinitely    *
 *  via emission even when no privacy fees are flowing.            *
 * -------------------------------------------------------------- */
console.log("\n• stage 4: empty treasury, full mint backstop");
const stage4 = sealBlockAt(state, stage3.slot + 1, [], [6, 7, 8]);
const r4 = applyBlock(state, stage4.sealed);
ok("stage 4: applyBlock accepts (treasury empty, full mint)", r4.ok, r4.errors);
state = r4.state;

ok("stage 4: treasury stays at 0", state.treasury === 0n);

const cb4 = stage4.sealed.txs[0];
const { value: coinbaseValue4 } = decryptOutputAmount(
  cb4.R, 0, payouts[stage4.producerIdx].viewPriv, cb4.outputs[0].encAmount
);
ok(
  `stage 4: coinbase = emission + ${PROOF_PAYOUT_2} (all minted)`,
  coinbaseValue4 === emissionAtHeight(stage4.sealed.header.height) + PROOF_PAYOUT_2,
  `got=${coinbaseValue4}`
);

/* -------------------------------------------------------------- *
 *  Long-run sanity: emission monotonically issues the security    *
 *  subsidy + (occasional) backstop, while treasury is the chain's *
 *  observable indicator of permanence sustainability.             *
 * -------------------------------------------------------------- */
console.log("\n• summary");
console.log(`    final chain height = ${state.height}`);
console.log(`    final treasury     = ${state.treasury} base units`);
console.log(`    Σ emission(1..4)   = ${emissionAtHeight(1) + emissionAtHeight(2) + emissionAtHeight(3) + emissionAtHeight(4)}`);

store.close();

console.log("\nALL CHECKS PASSED.\n");
