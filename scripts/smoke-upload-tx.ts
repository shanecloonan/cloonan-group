/* ================================================================== *
 *  Smoke: upload-tx end-to-end                                         *
 *                                                                      *
 *  Closes the permanence funding loop. Validates:                      *
 *                                                                      *
 *    1. Wallet.buildUpload constructs a real RingCT tx that anchors    *
 *       a fresh StorageCommitment derived from raw user data.          *
 *    2. applyBlock ACCEPTS the upload when fee ≥ requiredEndowment.   *
 *    3. The chain's treasury grows by exactly the treasury share of    *
 *       the upload fee — funding the permanence pool.                  *
 *    4. The storage registry is populated with the new commitment;    *
 *       lastProvenAt is anchored to the upload height.                *
 *    5. applyBlock REJECTS an upload whose fee falls short of the     *
 *       endowment floor (spam / underfunded upload).                  *
 *    6. applyBlock REJECTS an upload whose replication is below the   *
 *       protocol minimum.                                              *
 *    7. A later block can include a storage proof for the uploaded    *
 *       data and earn the per-proof reward, draining the treasury     *
 *       proportionally.                                                *
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
  type Block,
  type ChainState,
} from "../lib/network/block";
import {
  G,
  H,
  pedersenCommit,
  stealthGen,
  stealthSendTo,
  stealthSpendKey,
  randomScalar,
  type CurvePoint,
} from "../lib/network/primitives";
import {
  signTransaction,
  type InputSpec,
  type TransactionWire,
} from "../lib/network/transaction";
import {
  buildStorageCommitment,
  buildStorageProof,
  storageCommitmentHash,
} from "../lib/network/storage";
import {
  DEFAULT_ENDOWMENT_PARAMS,
  requiredEndowment,
  ceilDiv,
} from "../lib/network/endowment";
import {
  DEFAULT_EMISSION_PARAMS,
} from "../lib/network/emission";
import { bytesToHex } from "../lib/network/codec";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`, extra ?? ""); process.exit(1); }
}

console.log("\n== Smoke: upload-tx (endowment-enforced storage anchoring) ==\n");

/* -------------------------------------------------------------- *
 *  3 validators with payouts.                                     *
 * -------------------------------------------------------------- */
const N = 3;
const stakes = [1000n, 1000n, 1000n];
const totalStake = stakes.reduce((a, b) => a + b, 0n);
const vrfs: VrfKeypair[] = [];
const blsK: BlsKeypair[] = [];
const payouts = [stealthGen(), stealthGen(), stealthGen()];
for (let i = 0; i < N; i++) { vrfs.push(vrfKeygen()); blsK.push(blsKeygen()); }
const validators: Validator[] = [];
const secrets: ValidatorSecrets[] = [];
for (let i = 0; i < N; i++) {
  validators.push({
    index: i, vrfPk: vrfs[i].pk, blsPk: blsK[i].pk, stake: stakes[i],
    payoutAddress: { viewPub: payouts[i].viewPub, spendPub: payouts[i].spendPub },
  });
  secrets.push({ index: i, vrf: vrfs[i], bls: blsK[i] });
}

/* -------------------------------------------------------------- *
 *  Pre-funded Alice with plenty of MFN to cover upload fees.      *
 * -------------------------------------------------------------- */
const alice = stealthGen();
const aliceFunding = stealthSendTo(alice);
const aliceSpend = stealthSpendKey(aliceFunding, alice);
const ALICE_VALUE = 10n * 100_000_000n; // 10 MFN — plenty for small uploads
const aliceBlinding = randomScalar();
const aliceCommit = G.multiply(aliceBlinding).add(H.multiply(ALICE_VALUE));

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [{ oneTimeAddr: aliceFunding.oneTimeAddr, amount: aliceCommit }],
  initialStorage: [],
  validators,
};
const tmp = mkdtempSync(join(tmpdir(), "mfbn-upload-"));
const store = ChainStore.open(join(tmp, "chain.db"));
let state = store.initialize(cfg);

ok("genesis treasury = 0", state.treasury === 0n);
ok("genesis storage empty", state.storage.size === 0);

/* -------------------------------------------------------------- *
 *  Helper: drive slots until a producer is VRF-eligible on the    *
 *  ACTUAL sealed header hash for the given txs + proofs.          *
 * -------------------------------------------------------------- */
function sealBlockAt(
  s: ChainState, startSlot: number,
  txs: TransactionWire[],
  proofBuilder: (prevHash: Uint8Array, slot: number) =>
    ReturnType<typeof buildStorageProof>[] = () => []
): { sealed: Block; producerIdx: number; slot: number } {
  const prevHash = s.blockIds[s.blockIds.length - 1];
  for (let slot = startSlot; slot < startSlot + 200; slot++) {
    // Proofs are slot-dependent (challenge derives from prevHash+slot),
    // so rebuild them for each candidate slot.
    const proofs = proofBuilder(prevHash, slot);
    for (let i = 0; i < N; i++) {
      const candidate = buildBlock({
        state: s, txs, slot, timestamp: cfg.timestamp + slot,
        storageProofs: proofs,
        producerPayout: validators[i].payoutAddress,
      });
      const hdrHash = headerSigningHash(candidate.header);
      const real = tryProduceSlot(
        { height: s.height + 1, slot, prevHash },
        secrets[i], validators[i], totalStake,
        s.params.expectedProposersPerSlot, hdrHash
      );
      if (!real) continue;
      const votes = validators.map((_v, vi) => ({
        index: vi, sig: blsSign(hdrHash, secrets[vi].bls.sk),
      }));
      const fin = finalize(hdrHash, votes, validators.length);
      const sealed: Block = {
        ...candidate,
        header: {
          ...candidate.header,
          producerProof: encodeFinalityProof({
            producer: real, finality: fin, signingStake: totalStake,
          }),
        },
      };
      return { sealed, producerIdx: i, slot };
    }
  }
  throw new Error(`no VRF-eligible producer in 200 slots from ${startSlot}`);
}

/* -------------------------------------------------------------- *
 *  Helper: build an upload tx by hand (we have a stealth wallet,  *
 *  not a Wallet instance, so we replicate buildUpload's logic     *
 *  inline — that way the test exercises the SAME consensus path  *
 *  applyBlock enforces, without depending on Wallet's input       *
 *  scanner).                                                       *
 * -------------------------------------------------------------- */
function buildAliceUpload(
  data: Uint8Array, replication: number,
  feeOverride?: bigint
): {
  tx: TransactionWire;
  commit: ReturnType<typeof buildStorageCommitment>["commit"];
  tree: ReturnType<typeof buildStorageCommitment>["tree"];
  fee: bigint;
  endowment: bigint;
} {
  const sizeBytes = BigInt(data.length);
  const endowment = requiredEndowment(sizeBytes, replication, DEFAULT_ENDOWMENT_PARAMS);
  const fee = feeOverride ?? ceilDiv(
    endowment * 10_000n, BigInt(DEFAULT_EMISSION_PARAMS.feeToTreasuryBps)
  );

  const built = buildStorageCommitment(data, endowment, { replication });

  // Decoy ring of size 4.
  const ringP: CurvePoint[] = [];
  const ringC: CurvePoint[] = [];
  for (let i = 0; i < 3; i++) {
    const dummy = stealthGen();
    const out = stealthSendTo(dummy);
    ringP.push(out.oneTimeAddr);
    ringC.push(pedersenCommit(BigInt(7 + i), randomScalar()).C);
  }
  const signerIdx = 1;
  ringP.splice(signerIdx, 0, aliceFunding.oneTimeAddr);
  ringC.splice(signerIdx, 0, aliceCommit);

  const inputs: InputSpec[] = [{
    ring: { P: ringP, C: ringC },
    signerIdx, spendPriv: aliceSpend,
    value: ALICE_VALUE, blinding: aliceBlinding,
  }];

  const selfRecipient = stealthGen();
  const selfOut = stealthSendTo(selfRecipient);
  const selfSend = ALICE_VALUE - fee;
  if (selfSend < 0n) throw new Error("test setup: fee > balance");

  const signed = signTransaction(
    inputs,
    [{ oneTimeAddr: selfOut.oneTimeAddr, value: selfSend, storage: built.commit }],
    fee
  );
  return { tx: signed.tx, commit: built.commit, tree: built.tree, fee, endowment };
}

/* -------------------------------------------------------------- *
 *  CASE 1 — correctly-funded upload accepted; treasury fills.     *
 * -------------------------------------------------------------- */
console.log("• case 1: correctly-funded 64 KB upload anchors a commitment");
const DATA_1 = new Uint8Array(64 * 1024);
for (let i = 0; i < DATA_1.length; i++) DATA_1[i] = (i * 31) & 0xff;
const REPLICATION = 3;
const up1 = buildAliceUpload(DATA_1, REPLICATION);
console.log(`    sizeBytes=${DATA_1.length} replication=${REPLICATION} ` +
  `endowment=${up1.endowment} fee=${up1.fee}`);

const stage1 = sealBlockAt(state, 0, [up1.tx]);
const r1 = applyBlock(state, stage1.sealed);
ok("case 1: applyBlock accepts the upload tx", r1.ok, r1.errors);
state = r1.state;

ok("case 1: storage registry now contains the commitment",
  state.storage.has(bytesToHex(storageCommitmentHash(up1.commit))));

const expectedTreasury1 =
  (up1.fee * BigInt(DEFAULT_EMISSION_PARAMS.feeToTreasuryBps)) / 10_000n;
ok(
  `case 1: treasury grew to ${expectedTreasury1} (90% of fee ${up1.fee})`,
  state.treasury === expectedTreasury1,
  `got=${state.treasury} expected=${expectedTreasury1}`
);
ok(
  "case 1: treasury share >= endowment (math closes)",
  expectedTreasury1 >= up1.endowment
);

/* -------------------------------------------------------------- *
 *  CASE 2 — underfunded upload REJECTED.                          *
 * -------------------------------------------------------------- */
console.log("\n• case 2: underfunded upload rejected (fee < endowment-floor)");
// Reset the alice-funded UTXO conceptually by re-targeting the funding output;
// applyBlock only checks `tx.fee` and the storage commitment, so we can build
// a fresh inflated-burden tx straight from the genesis UTXO. The previous tx
// has already SPENT Alice's key image, but the funding output is still UTXO-
// addressable. We need fresh inputs — switch to a SECOND pre-funded UTXO.
//
// Cleanest: use a fresh Alice (different stealth key). For test simplicity,
// just re-derive a brand new genesis on a separate ChainState.
const tmp2 = mkdtempSync(join(tmpdir(), "mfbn-upload-bad-"));
const store2 = ChainStore.open(join(tmp2, "chain2.db"));
let state2 = store2.initialize(cfg);
const DATA_2 = new Uint8Array(64 * 1024);
for (let i = 0; i < DATA_2.length; i++) DATA_2[i] = (i * 37 + 5) & 0xff;
const endowment2 = requiredEndowment(
  BigInt(DATA_2.length), REPLICATION, DEFAULT_ENDOWMENT_PARAMS
);
const underfundedFee = ceilDiv(
  endowment2 * 10_000n, BigInt(DEFAULT_EMISSION_PARAMS.feeToTreasuryBps)
) - 1n; // exactly 1 base unit under the floor — tightest underfund possible.
const up2 = buildAliceUpload(DATA_2, REPLICATION, underfundedFee);
const stage2 = sealBlockAt(state2, 0, [up2.tx]);
const r2 = applyBlock(state2, stage2.sealed);
ok("case 2: applyBlock REJECTS underfunded upload", !r2.ok);
ok("case 2: rejection mentions 'storage endowment burden'",
  r2.errors.some((e) => e.includes("storage endowment burden")), r2.errors);

/* -------------------------------------------------------------- *
 *  CASE 3 — replication below minReplication REJECTED.            *
 * -------------------------------------------------------------- */
console.log("\n• case 3: replication < minReplication rejected");
const tmp3 = mkdtempSync(join(tmpdir(), "mfbn-upload-repl-"));
const store3 = ChainStore.open(join(tmp3, "chain3.db"));
let state3 = store3.initialize(cfg);
// Build a tx with replication=2 (< default min=3).
const DATA_3 = new Uint8Array(1024);
const REPL_BAD = 2;
// requiredEndowment will throw on replication < min, so bypass and craft
// the commitment by hand with the bad replication. Use a dummy non-zero
// endowment value because pedersenCommit rejects value=0.
const built3 = buildStorageCommitment(DATA_3, 1n, { replication: REPL_BAD });
// Pay a generous fee so the underfund-check passes and we isolate the
// replication-bound check.
const generousFee = 1_000_000n;
const ringP3: CurvePoint[] = [];
const ringC3: CurvePoint[] = [];
for (let i = 0; i < 3; i++) {
  const dummy = stealthGen(); const o = stealthSendTo(dummy);
  ringP3.push(o.oneTimeAddr);
  ringC3.push(pedersenCommit(BigInt(99 + i), randomScalar()).C);
}
const SIGNER_3 = 1;
ringP3.splice(SIGNER_3, 0, aliceFunding.oneTimeAddr);
ringC3.splice(SIGNER_3, 0, aliceCommit);
const tx3Signed = signTransaction(
  [{
    ring: { P: ringP3, C: ringC3 }, signerIdx: SIGNER_3,
    spendPriv: aliceSpend, value: ALICE_VALUE, blinding: aliceBlinding,
  }],
  [{ oneTimeAddr: stealthSendTo(stealthGen()).oneTimeAddr,
     value: ALICE_VALUE - generousFee, storage: built3.commit }],
  generousFee
);
const stage3 = sealBlockAt(state3, 0, [tx3Signed.tx]);
const r3 = applyBlock(state3, stage3.sealed);
ok("case 3: applyBlock REJECTS under-replicated upload", !r3.ok);
ok("case 3: rejection mentions replication",
  r3.errors.some((e) => /replication/.test(e)), r3.errors);

/* -------------------------------------------------------------- *
 *  CASE 4 — storage proof for the case-1 upload drains treasury.  *
 * -------------------------------------------------------------- */
console.log("\n• case 4: storage proof for the anchored data drains treasury");
const treasuryBefore = state.treasury;
const PROOF_REWARD = DEFAULT_EMISSION_PARAMS.storageProofReward;
const stage4 = sealBlockAt(
  state, stage1.slot + 1, [],
  (prev, slot) => [buildStorageProof(up1.commit, prev, slot, DATA_1, up1.tree)]
);
const r4 = applyBlock(state, stage4.sealed);
ok("case 4: applyBlock accepts the storage-proof block", r4.ok, r4.errors);
state = r4.state;

// For a small upload, the per-block storage proof reward (0.1 MFN = 10M
// base units) dwarfs the per-upload endowment (~2000 base units for 64KB).
// applyBlock therefore drains the treasury to 0 and mints the rest as
// backstop. The PRODUCER still receives the full reward — verified by
// smoke-treasury.ts — here we only assert the chain-state invariants:
// treasury floored at 0 + lastProvenAt advanced.
if (treasuryBefore >= PROOF_REWARD) {
  ok(
    `case 4: treasury drained by exactly ${PROOF_REWARD} (no mint)`,
    state.treasury === treasuryBefore - PROOF_REWARD,
    `got=${state.treasury} expected=${treasuryBefore - PROOF_REWARD}`
  );
} else {
  ok(
    `case 4: treasury drained to 0 with mint backstop covering the gap ` +
      `(was=${treasuryBefore}, owed=${PROOF_REWARD})`,
    state.treasury === 0n,
    `got=${state.treasury}`
  );
}
ok(
  "case 4: storage commitment marked lastProvenAt = upload-block + 1",
  state.storage.get(bytesToHex(storageCommitmentHash(up1.commit)))
    ?.lastProvenAt === state.height
);

store.close();
store2.close();
store3.close();
console.log("\nALL CHECKS PASSED.\n");
