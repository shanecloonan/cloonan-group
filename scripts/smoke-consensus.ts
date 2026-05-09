/* Consensus smoke test: run a real slot. */
import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen, blsSign } from "../lib/network/bls";
import {
  tryProduceSlot,
  verifyProducerProof,
  pickWinner,
  castVote,
  finalize,
  verifyFinalityProof,
  verifyEquivocation,
  type Validator,
  type ValidatorSecrets,
  type SlotContext,
  type FinalityProof,
} from "../lib/network/consensus";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("• validator set");
const N = 16;
const stakes = [
  100n, 100n, 100n, 100n, 100n, 100n, 100n, 100n,
  50n,  50n,  50n,  50n,  50n,  50n,  50n,  50n,
];
const totalStake = stakes.reduce((a, b) => a + b, 0n);

const secrets: ValidatorSecrets[] = [];
const validators: Validator[] = [];
for (let i = 0; i < N; i++) {
  const vrf = vrfKeygen();
  const bls = blsKeygen();
  secrets.push({ index: i, vrf, bls });
  validators.push({ index: i, vrfPk: vrf.pk, blsPk: bls.pk, stake: stakes[i] });
}
ok(`built ${N} validators`, validators.length === N);

console.log("• run a slot and find a producer");
const ctx: SlotContext = {
  height: 1,
  slot: 0,
  prevHash: new Uint8Array(32).fill(0xa1),
};
const headerHash = new Uint8Array(32).fill(0xb2);

let candidates = [];
for (let s = 0; s < N; s++) {
  const candidate = tryProduceSlot(
    ctx,
    secrets[s],
    validators[s],
    totalStake,
    1.2,                          // ~1.2 expected eligible per slot
    headerHash
  );
  if (candidate) candidates.push(candidate);
}
ok(
  `at least one candidate eligible (${candidates.length}/${N})`,
  candidates.length >= 1
);

const winner = pickWinner(candidates)!;
ok("winner has valid VRF", verifyProducerProof(
  ctx, winner, validators[winner.validatorIndex], totalStake, 1.2, headerHash
).ok);

console.log("• committee votes finalize the block");
// All other validators verify the producer + sign the header.
const votes = secrets.map((sec) =>
  castVote(headerHash, sec, ctx, winner, validators[winner.validatorIndex], totalStake, 1.2)
);
const finality = finalize(headerHash, votes, N);

let signedStake = 0n;
for (let i = 0; i < N; i++) {
  if ((finality.bitmap[i >> 3] & (1 << (i & 7))) !== 0) signedStake += stakes[i];
}

const finProof: FinalityProof = { producer: winner, finality, signingStake: signedStake };
const fv = verifyFinalityProof(ctx, finProof, validators, 1.2, 6667, headerHash);
ok("finality proof verifies (super-majority)", fv.ok, fv.reason);

console.log("• reject below-quorum finality");
// Only first 5 sign (well below 2/3 of 16) — should fail quorum.
const sparseVotes = votes.slice(0, 5);
const sparseFinality = finalize(headerHash, sparseVotes, N);
let sparseStake = 0n;
for (let i = 0; i < N; i++) {
  if ((sparseFinality.bitmap[i >> 3] & (1 << (i & 7))) !== 0) sparseStake += stakes[i];
}
const sparseProof: FinalityProof = {
  producer: winner,
  finality: sparseFinality,
  signingStake: sparseStake,
};
const sparseV = verifyFinalityProof(ctx, sparseProof, validators, 1.2, 6667, headerHash);
ok("rejects below-quorum block", !sparseV.ok);

console.log("• equivocation slashing");
// Validator 7 signs TWO different headers at the same height — slashable.
const headerA = new Uint8Array(32).fill(0xc1);
const headerB = new Uint8Array(32).fill(0xc2);
const sigA = blsSign(headerA, secrets[7].bls.sk);
const sigB = blsSign(headerB, secrets[7].bls.sk);
const equivProof = {
  validatorIndex: 7,
  height: 1,
  headerHashA: headerA,
  sigA,
  headerHashB: headerB,
  sigB,
};
const ev = verifyEquivocation(equivProof, validators);
ok("equivocation proof is valid", ev.ok, ev.reason);

// Same headers ⇒ not equivocation.
const same = verifyEquivocation({ ...equivProof, headerHashB: headerA, sigB: sigA }, validators);
ok("rejects identical-header 'equivocation'", !same.ok);

console.log("\nConsensus smoke checks passed.");
