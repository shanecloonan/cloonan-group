"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Literata, IBM_Plex_Mono, Source_Sans_3 } from "next/font/google";
import type { TestnetConfig } from "@/lib/testnet/types";
import { observerCommands, walletCommands } from "@/lib/testnet/commands";
import LiveStats from "./live-stats";
import { useLiveSnapshot } from "./use-live-snapshot";
import WalletGenerator from "./wallet-generator";
import { CodeBlock, CopyButton, useCopyFeedback } from "./ui";

const display = Literata({
  subsets: ["latin"],
  variable: "--font-pw-display",
  weight: ["400", "600", "700"],
});

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-pw-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-pw-mono",
  weight: ["400", "500"],
});

const FALLBACK: TestnetConfig = {
  product: "Permawrite",
  network_id: "public-devnet-v1",
  genesis_id:
    "454fa5d4a9bd6f59e35cf9ea7e68c096c9a271a92b2ec5931184e7f34a42a005",
  /** VPS internet soak go-live 2026-07-14T03:01:02Z (not genesis JSON epoch). */
  launch_timestamp: 1783998062,
  upstream_repo: "https://github.com/shanecloonan/permawrite",
  genesis_path: "mfn-node/testdata/public_devnet_v1.json",
  manifest_path: "mfn-node/testdata/public_devnet_v1.manifest.json",
  checkpoint_log_path: "mfn-node/testdata/public_devnet_v1.checkpoints.jsonl",
  slot_duration_ms: 30000,
  validator_committee_size: 3,
  boot_peers: [
    "5.161.201.73:19001",
    "5.161.201.73:19002",
    "5.161.201.73:19003",
  ],
  rpc_proxy_url: "/api/testnet/rpc",
  links: {
    invite:
      "https://github.com/shanecloonan/permawrite/blob/main/docs/TESTNET_INVITE.md",
    join: "https://github.com/shanecloonan/permawrite/blob/main/docs/JOIN_TESTNET.md",
    checkpoints:
      "https://github.com/shanecloonan/permawrite/blob/main/docs/CHECKPOINT_LOG.md",
    issues: "https://github.com/shanecloonan/permawrite/issues",
    operators:
      "https://github.com/shanecloonan/permawrite/blob/main/scripts/public-devnet-v1/OPERATORS.md",
    rpc_proxy:
      "https://github.com/shanecloonan/permawrite/blob/main/scripts/public-devnet-v1/observer-rpc-proxy.mjs",
  },
};

export default function TestnetApp() {
  const [config, setConfig] = useState<TestnetConfig>(FALLBACK);
  const { copiedKey, copy } = useCopyFeedback();
  const live = useLiveSnapshot(config);

  useEffect(() => {
    let cancelled = false;
    fetch("/testnet/config.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data === "object" && data.genesis_id) {
          setConfig({ ...FALLBACK, ...data, links: { ...FALLBACK.links, ...data.links } });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const obs = observerCommands(config);
  const wallet = walletCommands();

  return (
    <div
      className={`${display.variable} ${sans.variable} ${mono.variable} pw-testnet relative min-h-screen overflow-hidden`}
    >
      <style jsx global>{`
        .pw-testnet {
          --pw-bg: #0a1210;
          --pw-ink: #e8efe6;
          --pw-muted: #9aada3;
          --pw-faint: #6d8076;
          --pw-accent: #c4a35a;
          --pw-accent-soft: rgba(196, 163, 90, 0.14);
          --pw-line: rgba(232, 239, 230, 0.1);
          --pw-surface: rgba(16, 28, 24, 0.72);
          --pw-code: #07100d;
          --pw-code-ink: #c5d4cb;
          font-family: var(--font-pw-sans), ui-sans-serif, system-ui, sans-serif;
          color: var(--pw-ink);
          background: var(--pw-bg);
        }
        @keyframes pwRise {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pwPulse {
          0%,
          100% {
            opacity: 0.45;
          }
          50% {
            opacity: 0.85;
          }
        }
        @keyframes pwTipSheen {
          0%,
          100% {
            opacity: 0.35;
          }
          50% {
            opacity: 0.7;
          }
        }
        .pw-tip-sheen {
          animation: pwTipSheen 3.2s ease-in-out infinite;
        }
        @keyframes pwDrift {
          0% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(1.5%, -1%, 0);
          }
          100% {
            transform: translate3d(0, 0, 0);
          }
        }
        .pw-fade {
          animation: pwRise 0.7s ease-out both;
        }
        .pw-fade-delay {
          animation: pwRise 0.8s ease-out 0.12s both;
        }
        .pw-fade-delay-2 {
          animation: pwRise 0.85s ease-out 0.22s both;
        }
      `}</style>

      {/* Atmosphere — archival ink + warm lamp glow, not flat / not purple */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% -10%, #1a332a 0%, #0a1210 55%, #060b09 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 70% 20%, rgba(196,163,90,0.12), transparent 70%)",
          animation: "pwDrift 18s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px",
          mixBlendMode: "overlay",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-4xl overflow-x-clip px-4 sm:px-8 pb-20 sm:pb-24">
        {/* A) Hero — content-sized on mobile; desktop still fills first viewport */}
        <header className="flex flex-col pt-10 pb-8 sm:min-h-[100dvh] sm:pt-14 sm:pb-10">
          <div className="shrink-0">
            <p className="pw-fade text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--pw-accent)]">
              Experimental public testnet
            </p>
            <h1 className="pw-fade-delay mt-3 font-[family-name:var(--font-pw-display)] text-[clamp(2.5rem,9vw,4.25rem)] font-semibold leading-[0.95] tracking-tight text-[var(--pw-ink)]">
              Permawrite
            </h1>
            <div className="pw-fade-delay-2 mt-6 sm:mt-7">
              <a
                href="#wallet"
                className="inline-flex h-12 w-full items-center justify-center rounded-md bg-[var(--pw-accent)] px-7 text-sm font-semibold tracking-wide text-[#0a1210] transition-opacity hover:opacity-90 sm:w-auto"
              >
                Generate wallet
              </a>
            </div>
            <p className="pw-fade-delay-2 mt-5 text-[11px] tracking-wide text-[var(--pw-faint)]">
              {config.network_id} · committee {config.validator_committee_size} ·
              slot {config.slot_duration_ms / 1000}s
            </p>
          </div>

          <div className="pw-fade-delay-2 mt-4 flex flex-col sm:mt-8 sm:min-h-0 sm:flex-1 sm:justify-end">
            <LiveStats config={config} live={live} variant="hero" />
          </div>
        </header>

        <div className="space-y-16 sm:space-y-20">
          <section id="wallet" className="scroll-mt-8 space-y-4">
            <div className="space-y-1.5">
              <h2 className="font-[family-name:var(--font-pw-display)] text-2xl sm:text-3xl tracking-tight">
                Testnet wallet
              </h2>
              <p className="text-sm text-[var(--pw-muted)] max-w-2xl">
                Generate a keypair in your browser, fund it from the faucet, then
                scan and send. Seed stays on this device.
              </p>
            </div>
            <WalletGenerator rpcProxyUrl={config.rpc_proxy_url} />
          </section>

          {/* B) Live stats detail (shared poll with hero chain) */}
          <LiveStats config={config} live={live} variant="section" />

          {/* Network pins */}
          <section className="space-y-4">
            <h2 className="font-[family-name:var(--font-pw-display)] text-2xl sm:text-3xl tracking-tight">
              Network identity
            </h2>
            <p className="text-sm text-[var(--pw-muted)] max-w-2xl">
              Pin these values. Genesis JSON must be byte-identical to upstream{" "}
              <code className="text-[12px] text-[var(--pw-accent)]">
                {config.genesis_path}
              </code>
              .
            </p>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Pin label="network_id" value={config.network_id} copyKey="nid" copiedKey={copiedKey} onCopy={copy} />
              <Pin
                label="genesis_id"
                value={config.genesis_id}
                copyKey="gid"
                copiedKey={copiedKey}
                onCopy={copy}
                mono
              />
            </dl>
          </section>

          {/* Boot peers */}
          <section className="space-y-4">
            <h2 className="font-[family-name:var(--font-pw-display)] text-2xl sm:text-3xl tracking-tight">
              Public boot peers
            </h2>
            <p className="text-sm text-[var(--pw-muted)] max-w-2xl">
              Validator mesh P2P listen addresses only. Do not open HTTP to these
              ports. There is no published community read-RPC by default.
            </p>
            <ul className="space-y-2">
              {config.boot_peers.map((peer) => (
                <li
                  key={peer}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-4 py-3"
                >
                  <code className="font-mono text-sm text-[var(--pw-ink)]">
                    {peer}
                  </code>
                  <CopyButton
                    text={peer}
                    copyKey={`peer-${peer}`}
                    copiedKey={copiedKey}
                    onCopy={copy}
                  />
                </li>
              ))}
            </ul>
          </section>

          {/* C) How to participate */}
          <section id="join" className="scroll-mt-8 space-y-10">
            <div className="space-y-1.5">
              <h2 className="font-[family-name:var(--font-pw-display)] text-2xl sm:text-3xl tracking-tight">
                How to participate
              </h2>
              <p className="text-sm text-[var(--pw-muted)] max-w-2xl">
                Static join path — works with zero backend.{" "}
                <code className="text-[12px]">mfnd</code> JSON-RPC is newline-delimited
                TCP; browsers need an HTTP proxy for live stats only.
              </p>
            </div>

            <Role title="Role 1 — Observer" subtitle="Minimum join">
              <p className="text-sm text-[var(--pw-muted)] mb-3">
                Build and sync an observer. Seed nodes auto-dial from the
                manifest beside genesis; optional explicit dials below.
              </p>
              <CodeBlock
                code={obs.build}
                copyKey="obs-build"
                copiedKey={copiedKey}
                onCopy={copy}
              />
              <div className="mt-3">
                <CodeBlock
                  code={obs.serve}
                  copyKey="obs-serve"
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--pw-faint)] whitespace-pre-wrap font-mono">
                {obs.dialHint}
              </p>
              <div className="mt-3">
                <CodeBlock
                  code={obs.verify}
                  copyKey="obs-verify"
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
              </div>
              <p className="mt-3 text-sm text-[var(--pw-muted)]">
                Expect matching <code className="text-[12px]">genesis_id</code> and
                rising <code className="text-[12px]">tip_height</code>.
              </p>
            </Role>

            <Role title="Role 2 — Wallet user" subtitle="Browser or CLI">
              <p className="text-sm text-[var(--pw-muted)] mb-3">
                Prefer the{" "}
                <a
                  href="#wallet"
                  className="text-[var(--pw-accent)] underline-offset-2 hover:underline"
                >
                  testnet wallet
                </a>{" "}
                at the top for faucet / balance / send. Or use the CLI against a
                local observer — keep the seed / wallet JSON private forever.
              </p>
              <CodeBlock
                code={wallet.newWallet}
                copyKey="wal-new"
                copiedKey={copiedKey}
                onCopy={copy}
              />
              <div className="mt-3 space-y-3">
                <CodeBlock
                  code={wallet.balance}
                  copyKey="wal-bal"
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
                <CodeBlock
                  code={wallet.upload}
                  copyKey="wal-up"
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
              </div>
            </Role>

            <Role title="Role 3 — Storage operator" subtitle="Optional">
              <p className="text-sm text-[var(--pw-muted)]">
                Build <code className="text-[12px]">mfn-storage-operator</code>;
                point it at a synced local observer RPC. No validator keys
                required. Details in upstream{" "}
                <a
                  href={config.links.operators}
                  className="text-[var(--pw-accent)] underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  OPERATORS.md
                </a>
                .
              </p>
            </Role>
          </section>

          {/* D) Never share */}
          <section className="space-y-4">
            <h2 className="font-[family-name:var(--font-pw-display)] text-2xl sm:text-3xl tracking-tight">
              Never share
            </h2>
            <ul className="space-y-2 text-sm text-[var(--pw-muted)]">
              {[
                "Validator VRF/BLS seeds",
                "Wallet JSON / restore seeds",
                "Public RPC URLs on validators",
                "Operator API keys",
              ].map((item) => (
                <li
                  key={item}
                  className="flex gap-3 border-b border-[var(--pw-line)] py-2.5 last:border-0"
                >
                  <span className="text-red-400/80" aria-hidden>
                    ×
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Privacy note */}
          <section className="space-y-3 rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/40 px-5 py-6">
            <h2 className="font-[family-name:var(--font-pw-display)] text-xl tracking-tight">
              Privacy absolutism — lite explorer
            </h2>
            <p className="text-sm leading-relaxed text-[var(--pw-muted)]">
              Ring signatures, stealth outputs, and encrypted amounts mean this is
              not a transparent ledger. This page shows chain-wide pulse only:
              tip cadence, aggregate tx shapes, treasury, permanence anchors, and
              checkpoint digests. It never surfaces balances by address, ring
              indices, or decrypted amounts.
            </p>
            <ul className="grid gap-2 text-[12px] text-[var(--pw-faint)] sm:grid-cols-2">
              <li className="flex gap-2">
                <span className="shrink-0 text-emerald-400/80">✓</span>
                Ring-size histograms from tx wire shape
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-emerald-400/80">✓</span>
                MFER / MFEO policy flags from chain params
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-emerald-400/80">✓</span>
                Storage commitment hashes &amp; bucket sizes
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-red-400/80">✗</span>
                No account graph · no amount transparency
              </li>
            </ul>
          </section>

          {/* E) Links */}
          <section className="space-y-4">
            <h2 className="font-[family-name:var(--font-pw-display)] text-2xl sm:text-3xl tracking-tight">
              Docs & help
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["Invite / operator packet", config.links.invite],
                  ["Join guide", config.links.join],
                  ["Checkpoint log", config.links.checkpoints],
                  ["Faucet help (issues)", config.links.issues],
                  ["Upstream repo", config.upstream_repo],
                  ["RPC proxy reference", config.links.rpc_proxy],
                ] as const
              ).map(([label, href]) => (
                <li key={href}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border border-[var(--pw-line)] bg-[var(--pw-surface)]/40 px-4 py-3 text-sm text-[var(--pw-ink)] transition-colors hover:border-[var(--pw-accent)]/35"
                  >
                    {label}
                    <span className="ml-2 text-[var(--pw-faint)]">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <footer className="border-t border-[var(--pw-line)] pt-8 text-[11px] leading-relaxed text-[var(--pw-faint)]">
            Live stats (when enabled) require a dedicated observer + hardened
            HTTP→TCP proxy — not the P2P mesh ports. Posture: public P2P, private
            RPC by default.
          </footer>
        </div>
      </div>
    </div>
  );
}

function Pin({
  label,
  value,
  copyKey,
  copiedKey,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
          {label}
        </dt>
        <CopyButton
          text={value}
          copyKey={copyKey}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
      </div>
      <dd
        className={`mt-2 break-all text-sm text-[var(--pw-ink)] ${mono ? "font-mono text-[12px] leading-relaxed" : "font-medium"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Role({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-[var(--pw-ink)]">{title}</h3>
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--pw-accent)]">
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  );
}
