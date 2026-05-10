#!/usr/bin/env node
/* ================================================================== *
 *  mfbn-wallet — MoneyFund Blockchain Network client wallet           *
 *                                                                      *
 *  Talks to a running mfbn-node over HTTP RPC. Keys never leave the   *
 *  local machine; only encoded transactions and hex requests do.      *
 *                                                                      *
 *  Subcommands                                                        *
 *  ───────────                                                        *
 *    generate    create a fresh stealth keypair and save to --wallet  *
 *    address     print the wallet's stealth address                   *
 *    scan        walk new blocks from the daemon and detect owned     *
 *                outputs (writes back to --wallet)                     *
 *    balance     scan, then print the unlocked balance                *
 *    send        construct a RingCT-style spend and submit it to the  *
 *                daemon. Args: --to <addr> --amount N [--fee N]        *
 * ================================================================== */

import { existsSync } from "node:fs";

import { Wallet } from "../lib/wallet/wallet";
import { RpcClient } from "../lib/wallet/rpc-client";
import { Point } from "../lib/network/primitives";
import { bytesToHex } from "../lib/network/codec";

/* ------------------------------------------------------------------ */
/*  ARG PARSING                                                        */
/* ------------------------------------------------------------------ */

interface Args {
  cmd: string;
  flags: Record<string, string | true>;
  rest: string[];
}

function parseArgs(argv: string[]): Args {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[k] = next;
        i++;
      } else {
        flags[k] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd: cmd ?? "", flags, rest: positional };
}

function flag(args: Args, name: string, fallback?: string): string | undefined {
  const v = args.flags[name];
  if (typeof v === "string") return v;
  return fallback;
}

function requiredFlag(args: Args, name: string): string {
  const v = flag(args, name);
  if (!v) {
    console.error(`missing required --${name}`);
    process.exit(1);
  }
  return v;
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function makeClient(args: Args): RpcClient {
  const url = flag(args, "rpc", "http://127.0.0.1:7799")!;
  const token = flag(args, "rpc-token");
  return new RpcClient({ url, authToken: token });
}

function usage(): never {
  console.log(`mfbn-wallet <cmd> [flags]

Common flags:
  --wallet <path>      wallet file (required)
  --rpc <url>          node RPC URL (default http://127.0.0.1:7799)
  --rpc-token <token>  bearer token if the node requires auth

Subcommands:
  generate --wallet <path>
      Create a new wallet and write to <path>. Refuses to overwrite.

  address --wallet <path>
      Print the stealth address (viewPub || spendPub) for the wallet.

  scan --wallet <path> [--rpc ...] [--rpc-token ...]
      Walk new blocks over RPC and detect any outputs paid to this
      wallet. Persists scan state.

  balance --wallet <path> [--rpc ...] [--rpc-token ...]
      Scan, then print the total unspent value.

  send --wallet <path> --to <hexAddr> --amount N [--fee N]
       [--rpc ...] [--rpc-token ...]
      Build a RingCT-style spend, submit it via RPC.

Examples:
  mfbn-wallet generate --wallet ./alice.wallet.json
  mfbn-wallet balance --wallet ./alice.wallet.json
  mfbn-wallet send --wallet ./alice.wallet.json --to ABC...DEF --amount 1000
`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/*  SUBCOMMANDS                                                        */
/* ------------------------------------------------------------------ */

function cmdGenerate(args: Args): void {
  const path = requiredFlag(args, "wallet");
  if (existsSync(path)) {
    console.error(`generate: refusing to overwrite ${path}`);
    process.exit(1);
  }
  const w = Wallet.generate();
  w.save(path);
  console.log(`wrote ${path}`);
  console.log(`  address: ${w.addressHex()}`);
}

function cmdAddress(args: Args): void {
  const path = requiredFlag(args, "wallet");
  const w = Wallet.load(path);
  console.log(w.addressHex());
}

async function cmdScan(args: Args): Promise<void> {
  const path = requiredFlag(args, "wallet");
  const client = makeClient(args);
  const w = Wallet.load(path);
  const before = w.balance();
  const result = await w.scanRpc(client);
  w.save(path);
  const after = w.balance();
  console.log(
    `scanned to height ${result.height}; ${result.newOutputs} new output(s); balance ${before} → ${after}`
  );
}

async function cmdBalance(args: Args): Promise<void> {
  const path = requiredFlag(args, "wallet");
  const client = makeClient(args);
  const w = Wallet.load(path);
  await w.scanRpc(client);
  w.save(path);
  console.log(`${w.balance()}`);
}

async function cmdSend(args: Args): Promise<void> {
  const path = requiredFlag(args, "wallet");
  const toHex = requiredFlag(args, "to");
  const amount = BigInt(requiredFlag(args, "amount"));
  const fee = BigInt(flag(args, "fee") ?? "0");
  const ringSize = Number(flag(args, "ring", "11"));

  const client = makeClient(args);
  const w = Wallet.load(path);

  console.log("• scanning chain via RPC...");
  await w.scanRpc(client);
  w.save(path);
  console.log(`  balance: ${w.balance()}`);

  if (toHex.length !== 128) {
    console.error(`send: --to must be 128 hex chars (viewPub || spendPub), got ${toHex.length}`);
    process.exit(1);
  }
  const viewPub = Point.fromHex(toHex.slice(0, 64));
  const spendPub = Point.fromHex(toHex.slice(64));

  console.log("• fetching decoy pool from node...");
  const decoyPool = await client.getDecoyPool(Math.max(64, ringSize * 6));
  if (decoyPool.length < ringSize - 1) {
    console.error(
      `send: not enough decoys on chain (have ${decoyPool.length}, need ${ringSize - 1})`
    );
    process.exit(1);
  }

  console.log("• building RingCT spend...");
  const tx = w.buildSpend({
    to: { viewPub, spendPub },
    amount,
    fee,
    ringSize,
    decoyPool,
  });

  console.log("• submitting...");
  const r = await client.submitTx(tx);
  if (!r.ok) {
    console.error(`submitTx failed: ${r.reason ?? "(no reason)"}`);
    process.exit(1);
  }
  console.log(`accepted: txid ${r.txIdHex}`);

  // Re-sync wallet so the change output / spent inputs reflect in balance.
  // Wait a beat for the node to seal and apply.
  setTimeout(() => {
    void (async () => {
      await w.scanRpc(client);
      w.save(path);
      console.log(`  new balance: ${w.balance()}`);
    })();
  }, 250);
}

/* ------------------------------------------------------------------ */
/*  MAIN                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.cmd) {
    case "":
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    case "generate":
      cmdGenerate(args);
      break;
    case "address":
      cmdAddress(args);
      break;
    case "scan":
      await cmdScan(args);
      break;
    case "balance":
      await cmdBalance(args);
      break;
    case "send":
      await cmdSend(args);
      break;
    default:
      console.error(`unknown command: ${args.cmd}\n`);
      usage();
  }

  // Suppress unused-warning.
  void bytesToHex;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
