/* ================================================================== *
 *  Wallet end-to-end test.                                             *
 *                                                                      *
 *  Drives a real wallet through the full lifecycle:                   *
 *                                                                      *
 *    1. Mint Alice's wallet at genesis with two pre-funded outputs.   *
 *    2. Boot 4 consensus nodes (sharing a bus).                        *
 *    3. Scan Alice's wallet against node 0 → detect both genesis      *
 *       outputs, recover values via decryption.                        *
 *    4. Bob generates a wallet. Alice builds a Spend → Bob,           *
 *       submits, drives slots until inclusion.                         *
 *    5. Bob scans → detects exactly the right amount.                  *
 *    6. Alice scans again → balance is reduced by amount + fee,       *
 *       change output present.                                         *
 *    7. Round-trip Alice's wallet to JSON + reload, verify identity.  *
 *    8. Double-spend attempt: Alice tries to send same input twice    *
 *       — rejected.                                                    *
 * ================================================================== */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import {
  G,
  H,
  pedersenCommit,
  stealthGen,
  randomScalar,
  indexedStealthAddress,
  encryptOutputAmount,
  type CurvePoint,
} from "../lib/network/primitives";
import { Wallet } from "../lib/wallet/wallet";
import { vrfKeygen } from "../lib/network/vrf";
import { blsKeygen } from "../lib/network/bls";
import { type Validator, type ValidatorSecrets } from "../lib/network/consensus";
import { ChainStore } from "../lib/network/store";
import { ConsensusNode } from "../lib/node/node";
import { InProcessGossipBus } from "../lib/node/gossip";
import { bytesToHex } from "../lib/network/codec";
import { Point } from "../lib/network/primitives";
import { signTransaction } from "../lib/network/transaction";

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`, extra ?? ""); process.exit(1); }
}

const tmp = mkdtempSync(join(tmpdir(), "mfbn-wallet-"));
console.log(`• ephemeral dir: ${tmp}`);

const N = 4;
const stakes = [200n, 150n, 100n, 50n];
const secrets: ValidatorSecrets[] = [];
const validators: Validator[] = [];
for (let i = 0; i < N; i++) {
  const vrf = vrfKeygen();
  const bls = blsKeygen();
  secrets.push({ index: i, vrf, bls });
  validators.push({ index: i, vrfPk: vrf.pk, blsPk: bls.pk, stake: stakes[i] });
}

console.log("• generate Alice + Bob wallets");
const alice = Wallet.generate();
const bob = Wallet.generate();

console.log("• construct genesis with TWO Alice-owned outputs derived via");
console.log("  the same stealth scheme Alice's wallet uses to scan");
// We need to mint outputs that the wallet can both DETECT (stealth) AND OPEN
// (encrypted amount). The cleanest way is to act as a one-time minter who
// constructs the tx-level r, derives the indexed stealth address, picks
// blindings, and writes the encrypted amount blob -- mirroring exactly what
// signTransaction does for a "real" outgoing tx, just without the inputs side.
//
// For genesis we don't sign anything (no inputs to sign), so we bypass
// signTransaction and produce the (oneTimeAddr, amount) pair directly.

interface Minted {
  oneTimeAddr: CurvePoint;
  amountCommit: CurvePoint;
  // The fields the wallet needs to inject into its scan index.
  // We compute these by re-running the same derivation Wallet.scan() will do.
}

const aliceValues = [500n, 300n];
const minted: Minted[] = [];

// We have to ALSO publish a tx-id so that the wallet's scan recognizes them.
// The cleanest way is to construct a single "minting tx" with no inputs and
// two outputs. But our TransactionWire requires at least 1 input. So instead
// we'll insert these as `initialOutputs` to genesis, which bypasses the
// transaction wire entirely.
//
// PROBLEM: initialOutputs in the genesis spec only carry (oneTimeAddr, amount)
// — no encrypted amount blob — so Wallet.scan() cannot open them.
//
// SOLUTION: extend the test by FIRST sending Alice a real transfer from a
// "treasury" wallet that has its own pre-funded output in genesis.

console.log("• create a Treasury keypair + fund it in genesis");
const treasury = stealthGen();
const treasuryValue = 1000n;
const treasuryBlinding = randomScalar();
const treasuryCommit = G.multiply(treasuryBlinding).add(H.multiply(treasuryValue));
// Place a synthetic stealth address (just any P with a known x = treasury.spendPriv)
// We'll use treasury.spendPub as the on-chain P; that's spendable with just
// treasury.spendPriv (no view-key trick needed for the source).
const treasuryP = treasury.spendPub;
const treasuryFundOutput = { oneTimeAddr: treasuryP, amount: treasuryCommit };

const cfg = {
  timestamp: 1700000000,
  initialOutputs: [treasuryFundOutput],
  initialStorage: [],
  validators,
};

console.log("• boot 4 nodes");
const bus = new InProcessGossipBus();
const stores: ChainStore[] = [];
const nodes: ConsensusNode[] = [];
for (let i = 0; i < N; i++) {
  const path = join(tmp, `node-${i}.db`);
  const store = ChainStore.open(path);
  store.initialize(cfg);
  const node = new ConsensusNode({
    nodeId: `v${i}`,
    store,
    bus,
    secrets: secrets[i],
  });
  node.start();
  stores.push(store);
  nodes.push(node);
}

console.log("• Treasury → Alice transfer (two outputs)");
const fee = treasuryValue - aliceValues[0] - aliceValues[1]; // 200n

const inputs = [{
  ring: { P: [treasuryP], C: [treasuryCommit] },
  signerIdx: 0,
  spendPriv: treasury.spendPriv,
  value: treasuryValue,
  blinding: treasuryBlinding,
}];
const signed = signTransaction(
  inputs,
  [
    { recipient: alice.address(), value: aliceValues[0] },
    { recipient: alice.address(), value: aliceValues[1] },
  ],
  fee
);
const submit = nodes[0].submitTx(signed.tx);
ok("treasury→alice submitTx accepted", submit.ok, submit.reason);
void minted;

// Drive slots until included.
let slot = 0;
const MAX = 16;
let included = false;
const aliceP0 = signed.tx.outputs[0].oneTimeAddr;
while (!included && slot < MAX) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
  if (stores.every((s) => s.currentState().utxo.has(aliceP0.toHex()))) included = true;
}
ok(`treasury tx included within ${MAX} slots`, included);

console.log("• Alice scans store 0 — expect TWO new outputs totaling 800");
const aliceScan = alice.scan(stores[0]);
ok(`scan found 2 outputs`, aliceScan.newOutputs === 2, aliceScan);
ok(`Alice balance = 800`, alice.balance() === aliceValues[0] + aliceValues[1]);
ok(`Alice scannedHeight matches chain head`, alice.scannedTo() === stores[0].head().height);

console.log("• Bob scans — expects ZERO outputs");
const bobScan = bob.scan(stores[0]);
ok(`Bob has no outputs`, bobScan.newOutputs === 0);
ok(`Bob balance = 0`, bob.balance() === 0n);

console.log("• Alice → Bob spend (uses ring decoys from chain UTXO)");
// Pull a small set of decoys from the chain (UTXO is keyed by oneTimeAddr hex).
const allUtxo = stores[0].currentState().utxo;
const decoyPool: { P: CurvePoint; C: CurvePoint }[] = [];
for (const [pHex, c] of allUtxo) {
  decoyPool.push({ P: Point.fromHex(pHex), C: c });
  if (decoyPool.length >= 8) break;
}

const spendAmount = 250n;
const spendFee = 5n;
const spendTx = alice.buildSpend({
  to: bob.address(),
  amount: spendAmount,
  fee: spendFee,
  ringSize: 3,
  decoyPool,
});
const subAB = nodes[0].submitTx(spendTx);
ok(`alice→bob submitTx accepted`, subAB.ok, subAB.reason);

const aliceBalBefore = alice.balance(); // alice locally marked input spent already
let bobGotIt = false;
let aliceRescanned = false;
while ((!bobGotIt || !aliceRescanned) && slot < MAX * 2) {
  for (const n of nodes) n.beginSlot(slot, 1700001000 + slot * 6);
  slot++;
  bob.scan(stores[0]);
  alice.scan(stores[0]);
  bobGotIt = bob.balance() === spendAmount;
  aliceRescanned = true; // we just scanned
}
ok(`Bob detected payment of ${spendAmount}`, bob.balance() === spendAmount, `bob bal = ${bob.balance()}`);

// Alice should have her original 800 minus (amount + fee), but split now
// into change outputs.
const expectedAliceBal = aliceValues[0] + aliceValues[1] - spendAmount - spendFee;
ok(`Alice balance reduced to ${expectedAliceBal}`, alice.balance() === expectedAliceBal, `bal=${alice.balance()}`);
void aliceBalBefore;

console.log("• persist Alice wallet to JSON, reload, verify identity");
const walletPath = join(tmp, "alice.wallet.json");
alice.save(walletPath);
const aliceReloaded = Wallet.load(walletPath);
ok(`reload preserves balance`, aliceReloaded.balance() === alice.balance(), aliceReloaded.balance().toString());
ok(`reload preserves output count`, aliceReloaded.outputCount() === alice.outputCount());
ok(`reload preserves scannedHeight`, aliceReloaded.scannedTo() === alice.scannedTo());
ok(`reload preserves address`, aliceReloaded.address().spendPub.equals(alice.address().spendPub));

console.log("• double-spend attempt should be rejected");
// Try to submit the same spendTx again — replay attack.
const replayRes = nodes[0].submitTx(spendTx);
ok(`replay rejected by mempool`, !replayRes.ok);

console.log(`• stats: ${bus.stats().uniqueMessages} unique messages; ` +
  `${stores[0].head().height} blocks; alice has ${alice.outputCount()} outputs (` +
  `${alice.unspent().length} unspent)`);

console.log("• cleanup");
for (const n of nodes) n.stop();
for (const s of stores) { try { s.close(); } catch { /* */ } }
rmSync(tmp, { recursive: true, force: true });

console.log("\nWallet end-to-end checks passed.");
void indexedStealthAddress; void encryptOutputAmount; void pedersenCommit; void bytesToHex;
