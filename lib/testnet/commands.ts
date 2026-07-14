import type { TestnetConfig } from "./types";

export function observerCommands(cfg: TestnetConfig) {
  const build = `git clone ${cfg.upstream_repo}.git
cd permawrite
cargo build -p mfn-node --release --bin mfnd
cargo build -p mfn-cli --release --bin mfn-cli`;

  const serve = `mfnd --data-dir ./observer-data \\
  --genesis ${cfg.genesis_path} \\
  --store fs \\
  --rpc-listen 127.0.0.1:18734 \\
  --p2p-listen 127.0.0.1:0 \\
  serve`;

  const dialHint = cfg.boot_peers
    .map((p) => `# optional: --p2p-dial ${p}`)
    .join("\n");

  const verify = `mfn-cli --rpc 127.0.0.1:18734 status
mfn-cli --rpc 127.0.0.1:18734 tip`;

  return { build, serve, dialHint, verify };
}

export function walletCommands() {
  return {
    newWallet: `mfn-cli --rpc 127.0.0.1:18734 --wallet ./alice.json wallet new
mfn-cli --rpc 127.0.0.1:18734 --wallet ./alice.json wallet address`,
    balance: `mfn-cli --rpc 127.0.0.1:18734 --wallet ./alice.json wallet scan
mfn-cli --rpc 127.0.0.1:18734 --wallet ./alice.json wallet balance`,
    upload: `mfn-cli --rpc 127.0.0.1:18734 --wallet ./alice.json wallet upload ./sample.txt --json`,
  };
}
