/* ================================================================== *
 *  Smoke: full CLI loop                                               *
 *                                                                      *
 *  Drives mfbn-node + mfbn-wallet via their public CLI surface as     *
 *  separate child processes, simulating exactly how an operator and   *
 *  a user would interact with a running network on real machines.    *
 *                                                                      *
 *  Steps:                                                             *
 *    1. mfbn-node keygen                                              *
 *    2. mfbn-node init                                                *
 *    3. mfbn-node start  (spawned in background; talks RPC on a       *
 *                         loopback ephemeral-ish port)                *
 *    4. wait until /health returns                                     *
 *    5. mfbn-wallet generate                                          *
 *    6. mfbn-wallet address                                            *
 *    7. mfbn-wallet balance  (expect 0 — empty chain, slot timer       *
 *                              produces blocks but wallet has no       *
 *                              outputs)                                *
 *    8. wallet scan + check height advances above 0                   *
 *    9. teardown                                                       *
 * ================================================================== */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Kill a child process AND its descendants. On Unix child.kill is fine.   *
 *  On Windows, `shell: true` puts cmd.exe in between us and the real      *
 *  npx → node tree, so SIGTERM stops the wrapper but orphans the daemon. *
 *  Use taskkill /T to nuke the whole tree.                                */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
      });
    } catch {
      // best-effort
    }
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // best-effort
    }
  }
}

function ok(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`, extra ?? "");
    process.exit(1);
  }
}

function pickPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

function runCli(
  bin: "node" | "wallet",
  args: string[]
): { stdout: string; stderr: string; code: number } {
  const script = bin === "node" ? "bin/mfbn-node.ts" : "bin/mfbn-wallet.ts";
  const r = spawnSync("npx", ["tsx", script, ...args], {
    encoding: "utf8",
    shell: true,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status ?? -1,
  };
}

async function waitFor(
  fn: () => Promise<boolean>,
  ms: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch {
      // continue
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  console.log("\n== Smoke: full CLI loop ==\n");

  const tmp = mkdtempSync(join(tmpdir(), "mfbn-cli-"));
  const keysPath = join(tmp, "node.keys.json");
  const dataDir = join(tmp, "chain");
  const walletPath = join(tmp, "alice.wallet.json");
  const port = pickPort();
  const token = "smoke-token";

  console.log(`• ephemeral dir: ${tmp}`);
  console.log(`• rpc port: ${port}`);

  /* 1. keygen */
  {
    const r = runCli("node", ["keygen", "--keys", keysPath]);
    ok("mfbn-node keygen exit 0", r.code === 0, r.stderr);
  }

  /* 2. init */
  {
    const r = runCli("node", [
      "init",
      "--data", dataDir,
      "--keys", keysPath,
    ]);
    ok("mfbn-node init exit 0", r.code === 0, r.stderr);
    ok("init printed genesis id", /genesis id:/.test(r.stdout));
  }

  /* 3. start (background) */
  const child = spawn(
    "npx",
    [
      "tsx", "bin/mfbn-node.ts",
      "start",
      "--data", dataDir,
      "--keys", keysPath,
      "--rpc-port", String(port),
      "--rpc-token", token,
      "--slot-ms", "300",
    ],
    { shell: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  let nodeOut = "";
  child.stdout.on("data", (d) => { nodeOut += d.toString(); });
  child.stderr.on("data", (d) => { nodeOut += d.toString(); });

  try {
    /* 4. wait for /health */
    await waitFor(
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`);
          return res.ok;
        } catch {
          return false;
        }
      },
      15000,
      "/health"
    );
    ok("/health is up", true);

    /* 5. wallet generate */
    {
      const r = runCli("wallet", ["generate", "--wallet", walletPath]);
      ok("mfbn-wallet generate exit 0", r.code === 0, r.stderr);
      ok(
        "generate printed 128-hex address",
        /address: [0-9a-f]{128}/.test(r.stdout),
        r.stdout
      );
    }

    /* 6. wallet address */
    {
      const r = runCli("wallet", ["address", "--wallet", walletPath]);
      ok("mfbn-wallet address exit 0", r.code === 0, r.stderr);
      ok(
        "address output is 128 hex chars",
        /^[0-9a-f]{128}$/.test(r.stdout.trim())
      );
    }

    /* 7. wallet balance against the running node */
    {
      const r = runCli("wallet", [
        "balance",
        "--wallet", walletPath,
        "--rpc", `http://127.0.0.1:${port}`,
        "--rpc-token", token,
      ]);
      ok("mfbn-wallet balance exit 0", r.code === 0, r.stderr);
      ok(
        "balance is exactly 0 (wallet has no funds)",
        r.stdout.trim() === "0",
        r.stdout
      );
    }

    /* 8. wait for at least one block to be produced, then scan */
    await waitFor(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "info",
            params: {},
          }),
        });
        const j = (await res.json()) as { result?: { height: number } };
        return (j.result?.height ?? 0) >= 2;
      },
      10000,
      "chain head ≥ 2"
    );
    ok("daemon produced ≥ 2 blocks", true);

    {
      const r = runCli("wallet", [
        "scan",
        "--wallet", walletPath,
        "--rpc", `http://127.0.0.1:${port}`,
        "--rpc-token", token,
      ]);
      ok("mfbn-wallet scan exit 0", r.code === 0, r.stderr);
      ok(
        "scan reports height advanced",
        /scanned to height \d+/.test(r.stdout),
        r.stdout
      );
      ok(
        "scan reports 0 new outputs (wallet still has no funds)",
        /0 new output/.test(r.stdout),
        r.stdout
      );
    }

    console.log("\nALL CHECKS PASSED.\n");
  } finally {
    /* 9. teardown — must kill the whole npx→tsx→node tree on Windows. */
    killTree(child.pid);
    await new Promise((r) => setTimeout(r, 300));
    if (process.env.MFBN_NODE_LOG === "1") {
      console.log("\n----- daemon stdout -----\n" + nodeOut + "\n-------------------------\n");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
