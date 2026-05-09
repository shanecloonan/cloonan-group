/* End-to-end smoke test: build a wallet, sign a tx, validate a block. */

import {
  stealthGen,
  stealthSendTo,
  stealthSpendKey,
  pedersenCommit,
  G,
  randomScalar,
  type CurvePoint,
} from "../lib/network/primitives";
import {
  signTransaction,
  verifyTransaction,
  type InputSpec,
} from "../lib/network/transaction";
import {
  buildStorageCommitment,
  challengeFromSeed,
  respondToChallenge,
  verifyChallengeResponse,
} from "../lib/network/storage";
import {
  buildGenesis,
  applyGenesis,
  buildBlock,
  applyBlock,
} from "../lib/network/block";
import {
  rangeProve,
  rangeVerify,
} from "../lib/network/range";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

console.log("• range proofs");
{
  const v = 12345n;
  const r = randomScalar();
  const { C, proof } = rangeProve(v, r);
  ok("rangeVerify(C, proof)", rangeVerify(C, proof));
  const tampered = { ...proof, s0: [proof.s0[0] + 1n, ...proof.s0.slice(1)] };
  ok("rejects tampered proof", !rangeVerify(C, tampered));
  let threw = false;
  try {
    rangeProve(1n << 64n, r);
  } catch {
    threw = true;
  }
  ok("rejects v ≥ 2^N", threw);
}

console.log("• storage commitment + audit");
{
  const data = new Uint8Array(1 << 20);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;
  const { commit, tree } = buildStorageCommitment(data, 1_000_000n, {
    chunkSize: 1 << 16,
  });

  const seed = new Uint8Array([1, 2, 3]);
  const challenge = challengeFromSeed(commit, seed);
  const resp = respondToChallenge(data, tree, commit.chunkSize, challenge);
  ok("storage challenge passes", verifyChallengeResponse(commit, challenge, resp));

  const tampered = {
    chunk: new Uint8Array(resp.chunk),
    proof: resp.proof,
  };
  tampered.chunk[0] ^= 0xff;
  ok("storage challenge rejects tamper", !verifyChallengeResponse(commit, challenge, tampered));
}

console.log("• transaction round-trip with stealth + ring");
{
  const recipient = stealthGen();
  const fundOwner = stealthGen();
  const fundOutput = stealthSendTo(fundOwner);
  const x_input = stealthSpendKey(fundOutput, fundOwner);
  ok(
    "spend key matches one-time address",
    G.multiply(x_input).equals(fundOutput.oneTimeAddr)
  );

  const inputValue = 100n;
  const inputBlinding = randomScalar();
  const inputCommit = pedersenCommit(inputValue, inputBlinding).C;

  // Decoy ring members.
  const ringP: CurvePoint[] = [];
  const ringC: CurvePoint[] = [];
  for (let i = 0; i < 4; i++) {
    const dummy = stealthGen();
    const out = stealthSendTo(dummy);
    ringP.push(out.oneTimeAddr);
    ringC.push(pedersenCommit(BigInt(i + 1), randomScalar()).C);
  }
  const signerIdx = 2;
  ringP.splice(signerIdx, 0, fundOutput.oneTimeAddr);
  ringC.splice(signerIdx, 0, inputCommit);
  const ring = { P: ringP, C: ringC };

  const recipientOut = stealthSendTo(recipient);

  const inputs: InputSpec[] = [
    {
      ring,
      signerIdx,
      spendPriv: x_input,
      value: inputValue,
      blinding: inputBlinding,
    },
  ];

  const signed = signTransaction(
    inputs,
    [{ oneTimeAddr: recipientOut.oneTimeAddr, value: 99n }],
    1n
  );
  const v = verifyTransaction(signed.tx);
  ok("tx verifies", v.ok, v.errors);

  const bad = { ...signed.tx, fee: signed.tx.fee + 1n };
  ok("tx rejects fee-tamper", !verifyTransaction(bad).ok);

  // Block round-trip.
  const genCfg = { timestamp: 0, initialOutputs: [], initialStorage: [] };
  const genesis = buildGenesis(genCfg);
  const state0 = applyGenesis(genesis, genCfg);
  ok("genesis applied", state0.height === 0);

  // Build a second tx that bears a storage commitment.
  const data = new Uint8Array(8192);
  for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
  const { commit: storageCommit } = buildStorageCommitment(data, 50_000n, {
    chunkSize: 1024,
  });

  const fundOwner2 = stealthGen();
  const fundOutput2 = stealthSendTo(fundOwner2);
  const x_input2 = stealthSpendKey(fundOutput2, fundOwner2);
  const v2 = 50n;
  const r2 = randomScalar();
  const c2 = pedersenCommit(v2, r2).C;
  const ring2 = { P: [fundOutput2.oneTimeAddr], C: [c2] };
  const stoOut = stealthSendTo(stealthGen());

  const signed2 = signTransaction(
    [
      {
        ring: ring2,
        signerIdx: 0,
        spendPriv: x_input2,
        value: v2,
        blinding: r2,
      },
    ],
    [
      {
        oneTimeAddr: stoOut.oneTimeAddr,
        value: 49n,
        storage: storageCommit,
      },
    ],
    1n
  );
  ok("tx with storage commitment verifies", verifyTransaction(signed2.tx).ok);

  const block = buildBlock({
    state: state0,
    txs: [signed.tx, signed2.tx],
    timestamp: 1,
  });
  const applied = applyBlock(state0, block);
  ok("block applies", applied.ok, applied.errors);
  ok("block height = 1", applied.state.height === 1);
  ok("storage anchored", applied.state.storage.size === 1);

  const replayBlock = buildBlock({
    state: applied.state,
    txs: [signed.tx],
    timestamp: 2,
  });
  ok("rejects double-spend", !applyBlock(applied.state, replayBlock).ok);
}

console.log("\nAll smoke checks passed.");

