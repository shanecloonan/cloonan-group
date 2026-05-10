/* ================================================================== *
 *  MoneyFund Network — Wallet                                          *
 *                                                                      *
 *  WHAT THIS IS                                                        *
 *  ────────────                                                        *
 *  A self-contained wallet that owns:                                  *
 *                                                                      *
 *    • a (viewPriv, spendPriv) stealth keypair                         *
 *    • a local index of detected outputs (scanned from chain)          *
 *    • a local index of spent key images                               *
 *                                                                      *
 *  CAPABILITIES                                                        *
 *  ────────────                                                        *
 *    • `scan(store)` walks the chain (incrementally) and finds every  *
 *      output destined for this wallet via Monero-style stealth DH.   *
 *      For each detected output, opens the encrypted amount blob,     *
 *      verifies the Pedersen commitment matches, and records spend    *
 *      key + key image.                                                *
 *    • `balance()` returns the sum of unspent output values.          *
 *    • `buildSpend(...)` constructs a real CLSAG ring + Bulletproof   *
 *      transaction sending a chosen amount to a recipient address,    *
 *      with a fee and automatic change.                                *
 *                                                                      *
 *  PERSISTENCE                                                         *
 *  ───────────                                                         *
 *    • `Wallet.save(path)` writes a JSON file with keys + scan index. *
 *    • `Wallet.load(path)` reads it back.                              *
 *                                                                      *
 *  This is a node-side wallet — it accesses the chain via a local     *
 *  ChainStore reference. An HTTP-RPC variant can be added later.       *
 * ================================================================== */

import { readFileSync, writeFileSync } from "node:fs";
import {
  G,
  H,
  L,
  Point,
  randomScalar,
  hashToPoint,
  indexedStealthDetect,
  indexedStealthSpendKey,
  decryptOutputAmount,
  type CurvePoint,
} from "../network/primitives";

/** Key image  I = x · H_p(P)  for a one-time address P with spend key x. */
function computeKeyImage(spendKey: bigint, oneTimeAddr: CurvePoint): CurvePoint {
  return hashToPoint(oneTimeAddr.toBytes()).multiply(spendKey);
}
import {
  signTransaction,
  txId,
  type TransactionWire,
  type InputSpec,
} from "../network/transaction";
import { type ChainStore } from "../network/store";
import { bytesToHex, hexToBytes } from "../network/codec";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

export interface Address {
  viewPub: CurvePoint;
  spendPub: CurvePoint;
}

export interface WalletKeys {
  viewPriv: bigint;
  viewPub: CurvePoint;
  spendPriv: bigint;
  spendPub: CurvePoint;
}

/** A single output recovered from chain that this wallet owns. */
export interface WalletOutput {
  /** Block height where this output first appeared. */
  height: number;
  /** Transaction id (32 bytes). */
  txId: Uint8Array;
  /** Index of this output within the transaction. */
  outputIndex: number;
  /** Stealth one-time address P. */
  oneTimeAddr: CurvePoint;
  /** Pedersen commitment C = G·r + H·v. */
  amountCommit: CurvePoint;
  /** Recovered cleartext value. */
  value: bigint;
  /** Recovered blinding factor r. */
  blinding: bigint;
  /** Spend key x with P = x·G. */
  spendKey: bigint;
  /** Cached key image I = x · H_p(P). */
  keyImageHex: string;
  /** Whether this output's key image has been observed on chain. */
  spent: boolean;
}

/* ------------------------------------------------------------------ */
/*  PERSISTENCE FORMAT (JSON)                                          */
/* ------------------------------------------------------------------ */

interface WalletJson {
  version: 1;
  keys: {
    viewPriv: string;  // hex
    spendPriv: string; // hex
  };
  scannedHeight: number;
  outputs: {
    height: number;
    txId: string;
    outputIndex: number;
    oneTimeAddr: string;
    amountCommit: string;
    value: string;
    blinding: string;
    spendKey: string;
    keyImageHex: string;
    spent: boolean;
  }[];
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function scalarToHex(x: bigint): string {
  let h = x.toString(16);
  if (h.length % 2 !== 0) h = "0" + h;
  return h.padStart(64, "0");
}

function hexToScalar(h: string): bigint {
  return BigInt("0x" + h);
}

/* ------------------------------------------------------------------ */
/*  WALLET                                                             */
/* ------------------------------------------------------------------ */

export class Wallet {
  readonly keys: WalletKeys;
  private outputs: Map<string, WalletOutput> = new Map(); // key: "txid:outIdx"
  private byKeyImage: Map<string, string> = new Map();    // ki hex → outputs key
  private scannedHeight: number = -1;

  private constructor(keys: WalletKeys) {
    this.keys = keys;
  }

  /* ---------------------------------------------------------------- */
  /*  CONSTRUCTION                                                     */
  /* ---------------------------------------------------------------- */

  static generate(): Wallet {
    const viewPriv = randomScalar();
    const spendPriv = randomScalar();
    return new Wallet({
      viewPriv,
      viewPub: G.multiply(viewPriv),
      spendPriv,
      spendPub: G.multiply(spendPriv),
    });
  }

  static fromKeys(viewPriv: bigint, spendPriv: bigint): Wallet {
    return new Wallet({
      viewPriv,
      viewPub: G.multiply(viewPriv),
      spendPriv,
      spendPub: G.multiply(spendPriv),
    });
  }

  static load(path: string): Wallet {
    const raw = readFileSync(path, "utf8");
    const json: WalletJson = JSON.parse(raw);
    if (json.version !== 1) throw new Error(`Wallet: unsupported version ${json.version}`);

    const w = Wallet.fromKeys(
      hexToScalar(json.keys.viewPriv),
      hexToScalar(json.keys.spendPriv),
    );
    w.scannedHeight = json.scannedHeight;
    for (const o of json.outputs) {
      const wo: WalletOutput = {
        height: o.height,
        txId: hexToBytes(o.txId),
        outputIndex: o.outputIndex,
        oneTimeAddr: Point.fromHex(o.oneTimeAddr),
        amountCommit: Point.fromHex(o.amountCommit),
        value: BigInt("0x" + o.value),
        blinding: hexToScalar(o.blinding),
        spendKey: hexToScalar(o.spendKey),
        keyImageHex: o.keyImageHex,
        spent: o.spent,
      };
      const k = `${o.txId}:${o.outputIndex}`;
      w.outputs.set(k, wo);
      w.byKeyImage.set(o.keyImageHex, k);
    }
    return w;
  }

  save(path: string): void {
    const json: WalletJson = {
      version: 1,
      keys: {
        viewPriv: scalarToHex(this.keys.viewPriv),
        spendPriv: scalarToHex(this.keys.spendPriv),
      },
      scannedHeight: this.scannedHeight,
      outputs: [...this.outputs.values()].map((o) => ({
        height: o.height,
        txId: bytesToHex(o.txId),
        outputIndex: o.outputIndex,
        oneTimeAddr: o.oneTimeAddr.toHex(),
        amountCommit: o.amountCommit.toHex(),
        value: o.value.toString(16),
        blinding: scalarToHex(o.blinding),
        spendKey: scalarToHex(o.spendKey),
        keyImageHex: o.keyImageHex,
        spent: o.spent,
      })),
    };
    writeFileSync(path, JSON.stringify(json, null, 2));
  }

  /* ---------------------------------------------------------------- */
  /*  ADDRESS                                                          */
  /* ---------------------------------------------------------------- */

  address(): Address {
    return { viewPub: this.keys.viewPub, spendPub: this.keys.spendPub };
  }

  /* ---------------------------------------------------------------- */
  /*  SCAN                                                             */
  /* ---------------------------------------------------------------- */

  /** Walk new blocks since `scannedHeight` and find every output this   *
   *  wallet owns. Idempotent: calling repeatedly only processes the     *
   *  blocks added since the last call.                                  */
  scan(store: ChainStore): { newOutputs: number; height: number } {
    const head = store.head();
    let newOutputs = 0;
    const state = store.currentState();

    for (let h = this.scannedHeight + 1; h <= head.height; h++) {
      const block = store.getBlock(h);
      if (!block) continue;

      for (const tx of block.txs) {
        const R = tx.R;
        const tid = txId(tx);
        for (let i = 0; i < tx.outputs.length; i++) {
          const out = tx.outputs[i];
          const mine = indexedStealthDetect(R, out.oneTimeAddr, i, {
            viewPriv: this.keys.viewPriv,
            spendPub: this.keys.spendPub,
          });
          if (!mine) continue;

          // Skip if we already recorded this output (idempotent rescans).
          const key = `${bytesToHex(tid)}:${i}`;
          if (this.outputs.has(key)) continue;

          // Open the encrypted amount blob.
          const { value, blinding } = decryptOutputAmount(
            R, i, this.keys.viewPriv, out.encAmount
          );

          // Verify the commitment matches (filters out malformed enc blobs).
          const expected = G.multiply(blinding).add(H.multiply(value));
          if (!expected.equals(out.amount)) {
            // Output is stealth-addressed to us but the amount blob is
            // garbage — likely a misdirected tx or replay. Skip.
            continue;
          }

          const spendKey = indexedStealthSpendKey(R, i, {
            viewPriv: this.keys.viewPriv,
            spendPriv: this.keys.spendPriv,
          });

          // Sanity: spendKey · G must equal oneTimeAddr.
          const recomputedP = G.multiply(spendKey);
          if (!recomputedP.equals(out.oneTimeAddr)) continue;

          const ki = computeKeyImage(spendKey, out.oneTimeAddr);
          const kiHex = ki.toHex();
          const spent = state.spentKeyImages.has(kiHex);

          const wo: WalletOutput = {
            height: h,
            txId: tid,
            outputIndex: i,
            oneTimeAddr: out.oneTimeAddr,
            amountCommit: out.amount,
            value,
            blinding,
            spendKey,
            keyImageHex: kiHex,
            spent,
          };
          this.outputs.set(key, wo);
          this.byKeyImage.set(kiHex, key);
          newOutputs++;
        }
      }
    }

    // Refresh `spent` flags for previously-known outputs (in case we
    // missed a spend that happened in this scan window).
    for (const wo of this.outputs.values()) {
      if (!wo.spent && state.spentKeyImages.has(wo.keyImageHex)) {
        wo.spent = true;
      }
    }

    this.scannedHeight = head.height;
    return { newOutputs, height: head.height };
  }

  /* ---------------------------------------------------------------- */
  /*  BALANCE / SELECTION                                              */
  /* ---------------------------------------------------------------- */

  balance(): bigint {
    let sum = 0n;
    for (const o of this.outputs.values()) if (!o.spent) sum += o.value;
    return sum;
  }

  unspent(): WalletOutput[] {
    return [...this.outputs.values()].filter((o) => !o.spent);
  }

  allOutputs(): WalletOutput[] { return [...this.outputs.values()]; }

  /** Select unspent outputs greedily until target is met. */
  private selectInputs(target: bigint): WalletOutput[] {
    const sortedDesc = this.unspent().sort((a, b) =>
      a.value < b.value ? 1 : a.value > b.value ? -1 : 0
    );
    const picked: WalletOutput[] = [];
    let acc = 0n;
    for (const o of sortedDesc) {
      picked.push(o);
      acc += o.value;
      if (acc >= target) break;
    }
    if (acc < target) throw new Error(`Wallet: insufficient funds (need ${target}, have ${acc})`);
    return picked;
  }

  /* ---------------------------------------------------------------- */
  /*  SPEND                                                            */
  /* ---------------------------------------------------------------- */

  /** Build a signed transaction sending `amount` to `to`, paying `fee`. *
   *  Selects inputs greedily, generates change to a fresh stealth       *
   *  address of THIS wallet, and decoys the ring from `decoyPool`.      *
   *  `decoyPool` should be the chain UTXO set (caller-provided).        */
  buildSpend(args: {
    to: Address;
    amount: bigint;
    fee: bigint;
    ringSize: number;
    decoyPool: { P: CurvePoint; C: CurvePoint }[];
  }): TransactionWire {
    const { to, amount, fee, ringSize } = args;
    if (amount <= 0n) throw new Error("Wallet: amount must be positive");
    if (fee < 0n) throw new Error("Wallet: fee cannot be negative");
    if (ringSize < 1) throw new Error("Wallet: ringSize >= 1");

    const target = amount + fee;
    const picks = this.selectInputs(target);
    const inSum = picks.reduce((acc, p) => acc + p.value, 0n);
    const change = inSum - target; // >= 0

    const inputs: InputSpec[] = picks.map((p) => {
      // Build a ring around p.oneTimeAddr using random decoys.
      const ringP: CurvePoint[] = [];
      const ringC: CurvePoint[] = [];
      const decoys = [...args.decoyPool]
        .filter((d) => !d.P.equals(p.oneTimeAddr))
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.max(0, ringSize - 1));
      for (const d of decoys) {
        ringP.push(d.P);
        ringC.push(d.C);
      }
      const signerIdx = Math.floor(Math.random() * (ringP.length + 1));
      ringP.splice(signerIdx, 0, p.oneTimeAddr);
      ringC.splice(signerIdx, 0, p.amountCommit);

      return {
        ring: { P: ringP, C: ringC },
        signerIdx,
        spendPriv: p.spendKey,
        value: p.value,
        blinding: p.blinding,
      };
    });

    const outputs = [{ recipient: to, value: amount }] as Parameters<typeof signTransaction>[1];
    if (change > 0n) {
      // Send change back to ourselves.
      outputs.push({ recipient: this.address(), value: change });
    }

    const signed = signTransaction(inputs, outputs, fee);

    // Optimistically mark inputs as spent — we still need network ack.
    for (const p of picks) p.spent = true;

    return signed.tx;
  }

  /* ---------------------------------------------------------------- */
  /*  ACCESS                                                           */
  /* ---------------------------------------------------------------- */

  scannedTo(): number { return this.scannedHeight; }
  outputCount(): number { return this.outputs.size; }
}

void L;
