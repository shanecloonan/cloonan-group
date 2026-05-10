#!/usr/bin/env node
/* ================================================================== *
 *  mfbn-node — MoneyFund Blockchain Network daemon                    *
 *                                                                      *
 *  Boots a ConsensusNode against a persistent ChainStore, exposes a   *
 *  JSON-RPC server, and runs a wall-clock slot timer. This is the    *
 *  process you'd actually run as a validator or as a read-only       *
 *  archival/RPC node on a real machine.                               *
 *                                                                      *
 *  Subcommands                                                        *
 *  ───────────                                                        *
 *    init     create a brand-new chain at --data with a self-signed   *
 *             genesis (single validator from the local key file)       *
 *    keygen   generate fresh validator (vrf + bls) and writer the     *
 *             json keyset to --keys                                    *
 *    start    open an existing --data and start producing/serving      *
 *                                                                      *
 *  All subcommands accept --data <dir> for the chain dir, --keys      *
 *  <file> for the validator keyset, and --rpc-port / --rpc-token       *
 *  for the RPC server.                                                 *
 * ================================================================== */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

import { ChainStore } from "../lib/network/store";
import { ConsensusNode, type NodeLogEntry } from "../lib/node/node";
import { startRpcServer } from "../lib/node/rpc";
import { InProcessGossipBus } from "../lib/node/gossip";
import { vrfKeygen, type VrfKeypair } from "../lib/network/vrf";
import {
  blsKeygen,
  encodePublicKey as encodeBlsPub,
  decodePublicKey as decodeBlsPub,
  type BlsKeypair,
} from "../lib/network/bls";
import {
  type Validator,
  type ValidatorSecrets,
} from "../lib/network/consensus";
import { bytesToHex, hexToBytes } from "../lib/network/codec";
import { Point } from "../lib/network/primitives";

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

/* ------------------------------------------------------------------ */
/*  KEYSET I/O                                                         */
/* ------------------------------------------------------------------ */

interface KeysetFile {
  version: 1;
  vrf: { sk: string; x: string; pk: string };
  bls: { sk: string; pk: string };
}

function saveKeyset(path: string, vrf: VrfKeypair, bls: BlsKeypair): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: KeysetFile = {
    version: 1,
    vrf: {
      sk: bytesToHex(vrf.sk),
      x: vrf.x.toString(16),
      pk: vrf.pk.toHex(),
    },
    bls: {
      sk: bytesToHex(bls.sk),
      pk: bytesToHex(encodeBlsPub(bls.pk)),
    },
  };
  writeFileSync(path, JSON.stringify(file, null, 2));
}

function loadKeyset(path: string): { vrf: VrfKeypair; bls: BlsKeypair } {
  const file = JSON.parse(readFileSync(path, "utf8")) as KeysetFile;
  if (file.version !== 1) throw new Error(`keyset version ${file.version} unsupported`);
  const vrf: VrfKeypair = {
    sk: hexToBytes(file.vrf.sk),
    x: BigInt("0x" + file.vrf.x),
    pk: Point.fromHex(file.vrf.pk),
  };
  const bls: BlsKeypair = {
    sk: hexToBytes(file.bls.sk),
    pk: decodeBlsPub(hexToBytes(file.bls.pk)),
  };
  return { vrf, bls };
}

/* ------------------------------------------------------------------ */
/*  SUBCOMMANDS                                                        */
/* ------------------------------------------------------------------ */

function usage(): never {
  console.log(`mfbn-node <cmd> [flags]

Subcommands:
  keygen --keys <path>
      Generate a fresh validator keyset and write to <path>.

  init --data <dir> --keys <path> [--stake N]
      Initialize a brand-new chain at <dir> with the given key as the
      sole validator. Stake defaults to 1,000,000.

  start --data <dir> [--keys <path>] [--rpc-port 7799] [--rpc-token X]
        [--slot-ms 6000]
      Open an existing chain dir and start the daemon. If --keys is
      provided, runs as a validator producing blocks at the given slot
      cadence; otherwise runs as a read-only RPC node.

Examples:
  mfbn-node keygen --keys ./node1.keys.json
  mfbn-node init --data ./chain --keys ./node1.keys.json
  mfbn-node start --data ./chain --keys ./node1.keys.json --rpc-port 7799
`);
  process.exit(0);
}

function cmdKeygen(args: Args): void {
  const keysPath = flag(args, "keys");
  if (!keysPath) {
    console.error("keygen: --keys <path> required");
    process.exit(1);
  }
  if (existsSync(keysPath)) {
    console.error(`keygen: refusing to overwrite ${keysPath}`);
    process.exit(1);
  }
  const vrf = vrfKeygen();
  const bls = blsKeygen();
  saveKeyset(keysPath, vrf, bls);
  console.log(`wrote ${keysPath}`);
  console.log(`  vrf pk: ${vrf.pk.toHex()}`);
  console.log(`  bls pk: ${bytesToHex(encodeBlsPub(bls.pk))}`);
}

function cmdInit(args: Args): void {
  const dataDir = flag(args, "data");
  const keysPath = flag(args, "keys");
  const stake = BigInt(flag(args, "stake") ?? "1000000");
  if (!dataDir || !keysPath) {
    console.error("init: --data and --keys are required");
    process.exit(1);
  }
  if (!existsSync(keysPath)) {
    console.error(`init: keyset ${keysPath} does not exist (run keygen first)`);
    process.exit(1);
  }
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "chain.db");
  if (existsSync(dbPath)) {
    console.error(`init: refusing to overwrite existing chain at ${dbPath}`);
    process.exit(1);
  }
  const { vrf, bls } = loadKeyset(keysPath);
  const store = ChainStore.open(dbPath);
  const cfg = {
    timestamp: Math.floor(Date.now() / 1000),
    initialOutputs: [],
    initialStorage: [],
    validators: [
      { index: 0, vrfPk: vrf.pk, blsPk: bls.pk, stake } satisfies Validator,
    ],
  };
  store.initialize(cfg);
  const head = store.head();
  store.close();
  console.log(`initialized chain at ${dbPath}`);
  console.log(`  genesis id: ${bytesToHex(head.blockId)}`);
  console.log(`  validator stake: ${stake}`);
}

async function cmdStart(args: Args): Promise<void> {
  const dataDir = flag(args, "data");
  if (!dataDir) {
    console.error("start: --data is required");
    process.exit(1);
  }
  const dbPath = join(dataDir, "chain.db");
  if (!existsSync(dbPath)) {
    console.error(`start: no chain at ${dbPath} — run 'init' first`);
    process.exit(1);
  }

  const keysPath = flag(args, "keys");
  let secrets: ValidatorSecrets | undefined;
  if (keysPath) {
    const { vrf, bls } = loadKeyset(keysPath);
    secrets = { index: 0, vrf, bls };
  }

  const rpcPort = Number(flag(args, "rpc-port") ?? "7799");
  const rpcToken = flag(args, "rpc-token");
  const slotMs = Number(flag(args, "slot-ms") ?? "6000");

  const store = ChainStore.open(dbPath);
  store.restore();

  const verbose = process.env.MFBN_NODE_LOG === "1";
  const logFn = verbose
    ? (e: NodeLogEntry) => {
        const ts = new Date().toISOString();
        const dataStr = e.data ? ` ${JSON.stringify(e.data)}` : "";
        console.log(`${ts} [${e.nodeId}] ${e.level} ${e.event}${dataStr}`);
      }
    : undefined;

  const bus = new InProcessGossipBus();
  const node = new ConsensusNode({
    nodeId: "mfbn-node",
    store,
    bus,
    secrets,
    log: logFn,
  });
  node.start();

  const rpc = await startRpcServer(node, store, {
    port: rpcPort,
    host: "127.0.0.1",
    authToken: rpcToken,
  });
  const actualPort = rpc.port();
  console.log(
    `mfbn-node ready: rpc=http://127.0.0.1:${actualPort}  data=${dataDir}  validator=${secrets ? "yes" : "no"}`
  );
  if (rpcToken) console.log(`  rpc-token required: ${rpcToken}`);

  // Slot timer. We use a deterministic monotonic counter starting at the
  // current chain head + 1. The slot value is just an integer the
  // protocol uses for VRF seed disambiguation; the wall clock decides
  // *when* to fire.
  let slot = store.head().height;
  const timer = setInterval(() => {
    slot += 1;
    const now = Math.floor(Date.now() / 1000);
    try {
      node.beginSlot(slot, now);
    } catch (e) {
      console.error(`beginSlot error: ${(e as Error).message}`);
    }
  }, slotMs);

  const shutdown = async (signal: string) => {
    console.log(`\nreceived ${signal}, shutting down...`);
    clearInterval(timer);
    await rpc.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
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
    case "keygen":
      cmdKeygen(args);
      break;
    case "init":
      cmdInit(args);
      break;
    case "start":
      await cmdStart(args);
      break;
    default:
      console.error(`unknown command: ${args.cmd}\n`);
      usage();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
