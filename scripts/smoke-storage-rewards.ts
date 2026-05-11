/* ================================================================== *
 *  Smoke: storage-reward end-to-end                                    *
 *                                                                      *
 *  This is the permanence-side companion to smoke-tokenomics: validates *
 *  that storage providers actually GET PAID per accepted storage proof. *
 *                                                                      *
 *    • genesis seeds 3 validators (all with payoutAddresses) and       *
 *      anchors several storage commitments                             *
 *    • producer builds a block with valid storage proofs               *
 *    • applyBlock accepts; the coinbase = emission + N * proofReward   *
 *    • producer wallet decrypts the bonus into its balance             *
 *    • a block claiming storage rewards WITHOUT submitting proofs is   *
 *      rejected (the producer can't inflate coinbase from thin air)    *
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
} from "../lib/network/block";
import {
  stealthGen,
  indexedStealthDetect,
  decryptOutputAmount,
} from "../lib/network/primitives";
import {
  buildStorageCommitment,
  buildStorageProof,
  storageCommitmentHash,
} from "../lib/network/storage";
import {
  DEFAULT_EMISSION_PARAMS,
  emissionAtHeight,
} from "../lib/network/emission";
import { bytesToHex } from "../lib/network/codec";
import { buildCoinbase } from "../lib/network/coinbase";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("\n== Smoke: storage-reward end-to-end ==\n");

/* -------------------------------------------------------------- *
 *  Three validators with payouts.                                *
 * -------------------------------------------------------------- */
const N = 3;
const stakes = [1000n, 1000n, 1000n];
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

/* -------------------------------------------------------------- *
 *  Anchor a few storage commitments at genesis.                  *
 * -------------------------------------------------------------- */
const NUM_DATA = 3;
const datas: Uint8Array[] = [];
const trees: { commit: ReturnType<typeof buildStorageCommitment>["commit"]; tree: ReturnType<typeof buildStorageCommitment>["tree"] }[] = [];
for (let i = 0; i < NUM_DATA; i++) {
  // 16 KB pseudo-data per commitment.
  const d = new Uint8Array(16 * 1024);
  for (let j = 0; j < d.length; j++) d[j] = (i * 97 + j * 13) & 0xff;
  datas.push(d);
  const built = buildStorageCommitment(d, 1000n, { replication: 3 });
  trees.push({ commit: built.commit, tree: built.tree });
}

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [],
  initialStorage: trees.map((t) => t.commit),
  validators,
};

const tmp = mkdtempSync(join(tmpdir(), "mfbn-storage-reward-"));
const store = ChainStore.open(join(tmp, "chain.db"));
let state = store.initialize(cfg);

ok(
  `genesis anchored ${NUM_DATA} storage commitments`,
  state.storage.size === NUM_DATA
);

/* -------------------------------------------------------------- *
 *  Build a block with VALID storage proofs and assert that the   *
 *  producer earns emission + N * storageProofReward.             *
 * -------------------------------------------------------------- */
const PROOF_REWARD = DEFAULT_EMISSION_PARAMS.storageProofReward;
const totalStake = stakes.reduce((a, b) => a + b, 0n);
let prevHash = state.blockIds[state.blockIds.length - 1];
let producerIdx: number | null = null;
let producerProof = null;
let chosenSlot = -1;

for (let slot = 0; slot < 50 && producerIdx === null; slot++) {
  const trialHeader = buildUnsealedHeader({
    state, txs: [], slot, timestamp: cfg.timestamp + slot,
  });
  const trialHash = headerSigningHash(trialHeader);
  for (let i = 0; i < N; i++) {
    const out = tryProduceSlot(
      { height: state.height + 1, slot, prevHash },
      secrets[i], validators[i], totalStake,
      state.params.expectedProposersPerSlot, trialHash
    );
    if (out) {
      producerIdx = i;
      producerProof = out;
      chosenSlot = slot;
      break;
    }
  }
}
if (producerIdx === null) {
  console.error("  unlucky VRF in 50 slots, retry");
  process.exit(1);
}
ok(`elected producer ${producerIdx} at slot ${chosenSlot}`, true);

// Build storage proofs for ALL anchored commitments.
const storageProofs = trees.map(({ commit, tree }, i) =>
  buildStorageProof(commit, prevHash, chosenSlot, datas[i], tree)
);

// Build block with storage proofs and coinbase.
const block = buildBlock({
  state,
  txs: [],
  slot: chosenSlot,
  timestamp: cfg.timestamp + chosenSlot,
  storageProofs,
  producerPayout: validators[producerIdx].payoutAddress,
});
ok(`block prepended a coinbase`, block.txs.length === 1);
ok(`block carries ${NUM_DATA} storage proofs`, block.storageProofs.length === NUM_DATA);

// Seal it.
const headerHash = headerSigningHash(block.header);
const realProducer = tryProduceSlot(
  { height: state.height + 1, slot: chosenSlot, prevHash },
  secrets[producerIdx], validators[producerIdx], totalStake,
  state.params.expectedProposersPerSlot, headerHash
);
if (!realProducer) {
  console.error("  producer became ineligible on real header hash");
  process.exit(1);
}
const votes = validators.map((_v, i) => ({
  index: i,
  sig: blsSign(headerHash, secrets[i].bls.sk),
}));
const finality = finalize(headerHash, votes, validators.length);
const finalityProof = { producer: realProducer, finality, signingStake: totalStake };
const sealed = {
  ...block,
  header: { ...block.header, producerProof: encodeFinalityProof(finalityProof) },
};

const r = applyBlock(state, sealed);
ok("applyBlock accepts block with storage proofs + matching coinbase", r.ok, r.errors);
state = r.state;

/* -------------------------------------------------------------- *
 *  Producer's wallet should decrypt coinbase = emission + N*reward *
 * -------------------------------------------------------------- */
const cb = sealed.txs[0];
const mine = indexedStealthDetect(cb.R, cb.outputs[0].oneTimeAddr, 0, {
  viewPriv: payouts[producerIdx].viewPriv,
  spendPub: payouts[producerIdx].spendPub,
});
ok("producer detects coinbase output", mine);
const { value } = decryptOutputAmount(
  cb.R, 0, payouts[producerIdx].viewPriv, cb.outputs[0].encAmount
);
const expected = emissionAtHeight(sealed.header.height) + PROOF_REWARD * BigInt(NUM_DATA);
ok(
  `coinbase = emission(${sealed.header.height}) + ${NUM_DATA} * storageProofReward`,
  value === expected,
  `got=${value} expected=${expected}`
);

/* -------------------------------------------------------------- *
 *  Storage registry's lastProvenAt was updated for every proof.   *
 * -------------------------------------------------------------- */
for (let i = 0; i < NUM_DATA; i++) {
  const h = bytesToHex(storageCommitmentHash(trees[i].commit));
  const entry = state.storage.get(h);
  ok(
    `storage[${i}].lastProvenAt advanced to height ${sealed.header.height}`,
    entry?.lastProvenAt === sealed.header.height
  );
}

/* -------------------------------------------------------------- *
 *  NEGATIVE: a producer tries to claim storage rewards without    *
 *  including any proofs — should reject (coinbase mismatch). The   *
 *  outer loop retries until a slot is found where one producer is *
 *  VRF-eligible on the actual (inflated) header hash. With 3      *
 *  validators ≈ 60% per slot, so 200 attempts is overkill.        *
 * -------------------------------------------------------------- */
console.log("\n• producer cannot inflate coinbase by claiming non-existent proofs");
{
  const newPrevHash = state.blockIds[state.blockIds.length - 1];
  const heightEvil = state.height + 1;
  const inflated = emissionAtHeight(heightEvil) + PROOF_REWARD * 5n;
  let exercised = false;
  for (let s = chosenSlot + 1; s < chosenSlot + 200 && !exercised; s++) {
    // Try every producer for this slot. We must build the FINAL evil block
    // first because tryProduceSlot binds to the actual header hash.
    for (let i = 0; i < N && !exercised; i++) {
      const evilCoinbase = buildCoinbase(
        heightEvil, inflated, validators[i].payoutAddress!
      );
      const evilTxs = [evilCoinbase];
      const evilHeader = buildUnsealedHeader({
        state, txs: evilTxs, slot: s, timestamp: cfg.timestamp + s,
      });
      const evilHash = headerSigningHash(evilHeader);
      const realEvil = tryProduceSlot(
        { height: heightEvil, slot: s, prevHash: newPrevHash },
        secrets[i], validators[i], totalStake,
        state.params.expectedProposersPerSlot, evilHash
      );
      if (!realEvil) continue;
      const evilVotes = validators.map((_v, vi) => ({
        index: vi,
        sig: blsSign(evilHash, secrets[vi].bls.sk),
      }));
      const evilFinality = finalize(evilHash, evilVotes, validators.length);
      const sealedEvil = {
        header: {
          ...evilHeader,
          producerProof: encodeFinalityProof({
            producer: realEvil, finality: evilFinality, signingStake: totalStake,
          }),
        },
        txs: evilTxs,
        storageProofs: [],
        slashings: [],
      };
      const rEvil = applyBlock(state, sealedEvil);
      ok(
        `applyBlock REJECTS inflated coinbase (slot ${s}, validator ${i})`,
        !rEvil.ok && rEvil.errors.some((e) => e.includes("coinbase invalid"))
      );
      exercised = true;
    }
  }
  ok("negative case actually exercised (not VRF-skipped)", exercised);
}

store.close();

console.log("\nALL CHECKS PASSED.\n");
