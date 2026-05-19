"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  CHAIN_ADAPTERS,
  DEV_TOKEN,
  ETH_NATIVE,
  SOL_NATIVE,
  USDC_BASE,
  USDC_ETHEREUM_MAINNET,
  USDC_SOLANA,
  makeEthereumAdapter,
  makeSolanaAdapter,
  type ChainAdapter,
  type ChainId,
  type TokenSpec,
} from "@/lib/casino";
import { CasinoProvider, useCasino, type CasinoHistoryEntry } from "./casino-context";

function StatBlock({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "rose";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">{label}</div>
      <div
        className={
          "mt-1 text-lg font-bold font-mono " +
          (accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white")
        }
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

function RecentRow({ entry, token }: { entry: CasinoHistoryEntry; token: TokenSpec }) {
  const won = entry.pnlUnits > 0n;
  const push = entry.pnlUnits === 0n;
  const fmt = (units: bigint): string => {
    const denom = 10n ** BigInt(token.decimals);
    const sign = units < 0n ? "-" : "";
    const abs = units < 0n ? -units : units;
    const w = abs / denom;
    const f = (abs % denom).toString().padStart(token.decimals, "0");
    return `${sign}${Number(`${w}.${f}`).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${token.symbol}`;
  };
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-12 h-6 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10px] uppercase tracking-[0.12em] text-white/60 flex items-center justify-center">
          {entry.game}
        </span>
        <span className="text-[10px] text-white/40 hidden sm:inline">
          {new Date(entry.at).toLocaleTimeString()}
        </span>
      </div>
      <div className="flex items-center gap-3 text-right">
        <div className="text-[11px] text-white/40 font-mono">{entry.multiplier.toFixed(2)}×</div>
        <div className={"text-[12px] font-mono " + (won ? "text-emerald-300" : push ? "text-white/60" : "text-rose-300")}>
          {won ? "+" : ""}{fmt(entry.pnlUnits)}
        </div>
      </div>
    </div>
  );
}

/**
 * Shows where the user's balance + seed pair currently live. Switches
 * automatically when Supabase auth state changes (driven by
 * `useCasino().persistent`).
 */
function SyncStatusPill() {
  const { persistent } = useCasino();
  if (persistent) {
    return (
      <span className={pill + " border-emerald-400/30 text-emerald-300 bg-emerald-500/10"}>
        ☁ Cloud-synced
      </span>
    );
  }
  return (
    <span className={pill + " border-amber-400/30 text-amber-200 bg-amber-500/10"}>
      ⚡ Local play (sign in to sync)
    </span>
  );
}

const BlackjackTable = dynamic(() => import("./blackjack-table"), { ssr: false });
const CoinflipTable = dynamic(() => import("./coinflip-table"), { ssr: false });
const DiceTable = dynamic(() => import("./dice-table"), { ssr: false });
const RouletteTable = dynamic(() => import("./roulette-table"), { ssr: false });
const SlotsTable = dynamic(() => import("./slots-table"), { ssr: false });
const CrashTable = dynamic(() => import("./crash-table"), { ssr: false });

/* ---------------------------------------------------------------------------
 *  Styling vocabulary
 * ------------------------------------------------------------------------- */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const pill =
  "inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[10px] font-medium border border-white/[0.08] text-white/60";

/* ---------------------------------------------------------------------------
 *  Game catalog — what's live, what's queued
 * ------------------------------------------------------------------------- */

interface GameTile {
  id: string;
  title: string;
  subtitle: string;
  rtp: string;
  status: "live" | "queued" | "soon";
  phase: string;
  emoji: string;
}

const GAME_CATALOG: GameTile[] = [
  {
    id: "blackjack",
    title: "Blackjack",
    subtitle: "6-deck shoe · S17 default · 3:2 BJ payouts",
    rtp: "99.58%",
    status: "live",
    phase: "Phase 0",
    emoji: "♠",
  },
  {
    id: "coinflip",
    title: "Coinflip",
    subtitle: "Heads/tails · 1.98× payout · auto-bet + martingale",
    rtp: "99.00%",
    status: "live",
    phase: "Phase 4.2",
    emoji: "◐",
  },
  {
    id: "dice",
    title: "Dice / Limbo",
    subtitle: "Set target 2-98% · 1.01×–9900× payouts · two modes",
    rtp: "99.00%",
    status: "live",
    phase: "Phase 4.1",
    emoji: "⚀",
  },
  {
    id: "crash",
    title: "Crash",
    subtitle: "Real-time curve · auto-cashout · provable bust point",
    rtp: "99.00%",
    status: "live",
    phase: "Phase 4.3",
    emoji: "↗",
  },
  {
    id: "roulette",
    title: "Roulette",
    subtitle: "Euro single-zero · all bet types · multi-placement",
    rtp: "97.30%",
    status: "live",
    phase: "Phase 4.4",
    emoji: "◉",
  },
  {
    id: "plinko",
    title: "Plinko",
    subtitle: "Visual-first · configurable risk tiers",
    rtp: "99.00%",
    status: "soon",
    phase: "Phase 4.5",
    emoji: "▼",
  },
  {
    id: "slots",
    title: "Slots",
    subtitle: "5 reels · 20 lines · wilds · scatters · free spins",
    rtp: "≈96%",
    status: "live",
    phase: "Phase 4.6",
    emoji: "𓏵",
  },
  {
    id: "sportsbook",
    title: "Sportsbook",
    subtitle: "Hooks into the /parlays +EV engine",
    rtp: "varies",
    status: "soon",
    phase: "Phase 4.7",
    emoji: "🜨",
  },
  {
    id: "poker",
    title: "Poker",
    subtitle: "Multiplayer · rake · anti-collusion",
    rtp: "house rake",
    status: "soon",
    phase: "Phase 4.9",
    emoji: "♥",
  },
];

/* ---------------------------------------------------------------------------
 *  Chain catalog — which chain is the user playing on?
 * ------------------------------------------------------------------------- */

interface ChainTile {
  id: ChainId;
  display: string;
  tag: string;
  status: "live" | "queued";
  phase: string;
  blurb: string;
  bestFor: string;
  tokens: TokenSpec[];
}

const CHAIN_TILES: ChainTile[] = [
  {
    id: "dev-mock",
    display: "Dev / Play Money",
    tag: "DEV",
    status: "live",
    phase: "Phase 0",
    blurb: "Closed in-browser ledger. Instant deposits, no RPC. Perfect for learning rules.",
    bestFor: "Learning the game · UI development · zero-stakes fun",
    tokens: [DEV_TOKEN],
  },
  {
    id: "ethereum-base",
    display: "Base (L2)",
    tag: "ETH",
    status: "queued",
    phase: "Phase 2",
    blurb: "USDC on Base — 2 sec finality, ~$0.01 fees. Withdraws settle via EIP-712 sigs from the operator.",
    bestFor: "Large bets · audit trail · trustless settlement",
    tokens: [ETH_NATIVE, USDC_BASE],
  },
  {
    id: "ethereum-mainnet",
    display: "Ethereum mainnet",
    tag: "ETH",
    status: "queued",
    phase: "Phase 2.1",
    blurb: "Same vault contract, mainnet liquidity. Higher gas → high-stakes only.",
    bestFor: "Whales · maximum security · regulated treasuries",
    tokens: [ETH_NATIVE, USDC_ETHEREUM_MAINNET],
  },
  {
    id: "solana-mainnet",
    display: "Solana",
    tag: "SOL",
    status: "queued",
    phase: "Phase 3",
    blurb: "Anchor PDA vault. ~400ms slots, sub-cent fees → every roll on-chain is viable.",
    bestFor: "Micro-bets · slot pulls · crash · fast game loops",
    tokens: [SOL_NATIVE, USDC_SOLANA],
  },
];

/* ===========================================================================
 *  Page
 * ========================================================================= */

type Tab = "lobby" | "blackjack" | "coinflip" | "dice" | "roulette" | "slots" | "crash" | "roadmap" | "fairness";

export default function CasinoContent() {
  const [tab, setTab] = useState<Tab>("lobby");
  const [chainId, setChainId] = useState<ChainId>("dev-mock");
  const [token, setToken] = useState<TokenSpec>(DEV_TOKEN);

  const adapter = useMemo<ChainAdapter>(() => {
    if (chainId === "dev-mock") return CHAIN_ADAPTERS["dev-mock"];
    if (chainId.startsWith("ethereum-"))
      return makeEthereumAdapter(chainId as "ethereum-base" | "ethereum-mainnet" | "ethereum-arbitrum" | "ethereum-sepolia");
    return makeSolanaAdapter(chainId as "solana-mainnet" | "solana-devnet");
  }, [chainId]);

  const selectChain = (id: ChainId) => {
    setChainId(id);
    const tile = CHAIN_TILES.find((c) => c.id === id);
    if (tile) setToken(tile.tokens[0]);
  };

  return (
    <CasinoProvider chainId={chainId} token={token}>
      <div className="min-h-[calc(100vh-56px)] w-full bg-[#08090e] text-white">
        <PageHeader tab={tab} setTab={setTab} />

        <div className="max-w-7xl mx-auto px-5 sm:px-8 pb-24">
          {tab === "lobby" && (
            <Lobby
              chainId={chainId}
              token={token}
              adapter={adapter}
              onSelectChain={selectChain}
              onSelectToken={setToken}
              onOpenGame={(g) => setTab(g)}
            />
          )}
          {tab === "blackjack" && (
            <BlackjackTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "coinflip" && (
            <CoinflipTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "dice" && (
            <DiceTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "roulette" && (
            <RouletteTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "slots" && (
            <SlotsTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "crash" && (
            <CrashTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "roadmap" && <RoadmapPanel />}
          {tab === "fairness" && <FairnessPanel />}
        </div>
      </div>
    </CasinoProvider>
  );
}

/* ===========================================================================
 *  Header — title + nav between modes
 * ========================================================================= */

function PageHeader({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; sub: string }[] = [
    { id: "lobby", label: "Lobby", sub: "Pick a chain + a game" },
    { id: "blackjack", label: "Blackjack", sub: "Play now" },
    { id: "coinflip", label: "Coinflip", sub: "Play now" },
    { id: "dice", label: "Dice", sub: "Play now" },
    { id: "roulette", label: "Roulette", sub: "Play now" },
    { id: "slots", label: "Slots", sub: "Play now" },
    { id: "crash", label: "Crash", sub: "Play now" },
    { id: "fairness", label: "Provable fairness", sub: "Verify any hand" },
    { id: "roadmap", label: "Roadmap", sub: "What's next" },
  ];
  // Sibling pages — not full tabs, just quick deep links from the header.
  const siblings: { href: string; label: string }[] = [
    { href: "/casino/wallet", label: "Wallet" },
    { href: "/casino/history", label: "History" },
    { href: "/casino/verify", label: "Verify" },
  ];
  return (
    <header className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-900/30 via-[#08090e] to-[#08090e]">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 pt-12 pb-8">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={pill + " border-emerald-400/30 text-emerald-300 bg-emerald-500/10"}>
            ♠ Crypto Casino
          </span>
          <span className={pill}>Provably fair</span>
          <span className={pill}>Multi-chain</span>
          <span className={pill}>House edge 0.42% (BJ)</span>
          <SyncStatusPill />
        </div>
        <h1 className="font-heading text-4xl sm:text-5xl font-semibold tracking-tight">
          Casino<span className="text-emerald-400">.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-white/60 leading-relaxed">
          A crypto-native casino built on three principles: <span className="text-emerald-300">every hand is verifiable</span>,
          every settlement lives on a chain you can audit, and the game catalog grows
          one PR at a time. Blackjack is live in dev-money mode today; Base + Solana
          settlement come online in Phase 2 and 3 of the
          {" "}<button
            type="button"
            onClick={() => setTab("roadmap")}
            className="text-emerald-300 underline-offset-2 hover:underline cursor-pointer"
          >
            roadmap
          </button>.
        </p>

        <div className="mt-7 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                "group flex flex-col items-start px-4 py-2 rounded-xl border transition-all cursor-pointer " +
                (tab === t.id
                  ? "border-emerald-400/50 bg-emerald-500/10 text-white"
                  : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:bg-white/[0.06]")
              }
            >
              <span className="text-sm font-semibold">{t.label}</span>
              <span className="text-[11px] text-white/40 group-hover:text-white/60">{t.sub}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-white/40">
          <span>Quick links:</span>
          {siblings.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="px-2 py-0.5 rounded-full border border-white/[0.08] hover:border-emerald-400/40 hover:text-emerald-300 transition-colors"
            >
              {s.label} →
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}

/* ===========================================================================
 *  Lobby
 * ========================================================================= */

interface LobbyProps {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
  onSelectChain: (c: ChainId) => void;
  onSelectToken: (t: TokenSpec) => void;
  onOpenGame: (g: Tab) => void;
}

function Lobby({
  chainId,
  token,
  adapter,
  onSelectChain,
  onSelectToken,
  onOpenGame,
}: LobbyProps) {
  const currentTile = CHAIN_TILES.find((c) => c.id === chainId);
  const { balance, stats, history, depositPlayMoney } = useCasino();

  const fmtMoney = (units: bigint, digits = 2): string => {
    const denom = 10n ** BigInt(token.decimals);
    const whole = units / denom;
    const frac = units % denom;
    const sign = units < 0n ? "-" : "";
    const abs = units < 0n ? -units : units;
    const w = abs / denom;
    const f = (abs % denom).toString().padStart(token.decimals, "0");
    void whole; void frac;
    const num = Number(`${w}.${f}`);
    return `${sign}${num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${token.symbol}`;
  };

  return (
    <div className="mt-8 space-y-8">
      {/* Live status strip */}
      <section className={card + " p-5"}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatBlock label="Balance" value={fmtMoney(balance.available)} accent="emerald" />
          <StatBlock
            label="Lifetime PnL"
            value={fmtMoney(stats.totalPnlUnits)}
            accent={stats.totalPnlUnits >= 0n ? "emerald" : "rose"}
            sub={`${stats.sessionsPlayed} sessions`}
          />
          <StatBlock
            label="Total wagered"
            value={fmtMoney(stats.totalWageredUnits)}
            sub={stats.sessionsPlayed > 0 ? `RTP ${((Number(stats.totalWageredUnits + stats.totalPnlUnits) / Math.max(1, Number(stats.totalWageredUnits))) * 100).toFixed(2)}%` : "—"}
          />
          <StatBlock
            label="Biggest win"
            value={stats.biggestWinUnits > 0n ? "+" + fmtMoney(stats.biggestWinUnits) : "—"}
            accent="emerald"
            sub={stats.biggestLossUnits < 0n ? `worst: ${fmtMoney(stats.biggestLossUnits)}` : undefined}
          />
        </div>
        {chainId === "dev-mock" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-white/[0.06]">
            <span className="text-[11px] text-white/40">
              Play money for development. Want to deposit real funds?{" "}
              <Link href="/casino/wallet" className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline">
                Open wallet →
              </Link>
            </span>
            <button
              type="button"
              onClick={() => depositPlayMoney(10_000n * 10n ** BigInt(token.decimals))}
              className="h-8 px-3 rounded-lg text-xs font-semibold bg-white/[0.06] border border-white/[0.08] text-emerald-200 hover:text-emerald-100 hover:bg-white/[0.1] cursor-pointer transition-all"
            >
              + 10,000 {token.symbol}
            </button>
          </div>
        )}
      </section>

      {/* Cross-game recent activity */}
      {history.length > 0 && (
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Recent activity</h2>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em]">
              <Link href="/casino/history" className="text-emerald-300 hover:text-emerald-200 cursor-pointer">
                Full history →
              </Link>
              <Link href="/casino/verify" className="text-emerald-300 hover:text-emerald-200 cursor-pointer">
                Verify any hand →
              </Link>
            </div>
          </div>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
            {history.slice(0, 12).map((h, i) => (
              <RecentRow key={i} entry={h} token={token} />
            ))}
          </div>
        </section>
      )}

      {history.length === 0 && (
        <section className={card + " p-5"}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold">Start playing</h2>
              <p className="text-[12px] text-white/60 mt-1">
                Pick a game below. Your hands stream into this strip in real time, and every
                settled hand gets a shareable verification link.
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em]">
              <Link href="/casino/history" className="text-emerald-300 hover:text-emerald-200 cursor-pointer">
                Full history →
              </Link>
              <Link href="/casino/verify" className="text-emerald-300 hover:text-emerald-200 cursor-pointer">
                Verify any hand →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Chain selector */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Choose a chain</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {CHAIN_TILES.map((c) => {
            const active = c.id === chainId;
            return (
              <button
                key={c.id}
                type="button"
                disabled={c.status !== "live"}
                onClick={() => onSelectChain(c.id)}
                className={
                  "text-left p-4 rounded-2xl border transition-all relative " +
                  (active
                    ? "border-emerald-400/50 bg-emerald-500/10"
                    : c.status === "live"
                      ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer"
                      : "border-white/[0.04] bg-white/[0.02] opacity-60 cursor-not-allowed")
                }
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.15em] text-white/40">
                      {c.tag}
                    </div>
                    <div className="text-base font-semibold mt-1">{c.display}</div>
                  </div>
                  <span
                    className={
                      "text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full border " +
                      (c.status === "live"
                        ? "border-emerald-400/40 text-emerald-300 bg-emerald-500/10"
                        : "border-amber-400/30 text-amber-300 bg-amber-500/10")
                    }
                  >
                    {c.status}
                  </span>
                </div>
                <p className="mt-2 text-[12px] text-white/60 leading-relaxed">{c.blurb}</p>
                <div className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/40">
                  Best for
                </div>
                <div className="text-[12px] text-white/80">{c.bestFor}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Active chain + token detail */}
      {currentTile && (
        <section className={card + " p-5"}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
                Active chain
              </div>
              <div className="text-lg font-semibold">{currentTile.display}</div>
              <div className="text-xs text-white/40 mt-0.5">
                Vault: <span className="font-mono">{adapter.getVaultAddress()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentTile.tokens.map((t) => (
                <button
                  key={t.symbol + t.address}
                  type="button"
                  onClick={() => onSelectToken(t)}
                  className={
                    "h-8 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer " +
                    (token.symbol === t.symbol && token.address === t.address
                      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                      : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:bg-white/[0.06]")
                  }
                >
                  {t.symbol}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Game catalog */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Games</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GAME_CATALOG.map((g) => {
            const route =
              g.id === "blackjack" ||
              g.id === "coinflip" ||
              g.id === "dice" ||
              g.id === "roulette" ||
              g.id === "slots" ||
              g.id === "crash"
                ? (g.id as Tab)
                : null;
            return (
            <div
              key={g.id}
              className={
                card + " p-5 flex flex-col gap-3 transition-all " +
                (g.status === "live" && route
                  ? "hover:border-emerald-400/30 cursor-pointer"
                  : "opacity-70")
              }
              onClick={g.status === "live" && route ? () => onOpenGame(route) : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center text-xl text-emerald-300">
                    {g.emoji}
                  </div>
                  <div>
                    <div className="text-base font-semibold">{g.title}</div>
                    <div className="text-[11px] text-white/40">{g.phase}</div>
                  </div>
                </div>
                <span
                  className={
                    "text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full border " +
                    (g.status === "live"
                      ? "border-emerald-400/40 text-emerald-300 bg-emerald-500/10"
                      : g.status === "queued"
                        ? "border-amber-400/30 text-amber-300 bg-amber-500/10"
                        : "border-white/[0.08] text-white/40")
                  }
                >
                  {g.status === "live" ? "play now" : g.status}
                </span>
              </div>
              <p className="text-[12px] text-white/60 leading-relaxed">{g.subtitle}</p>
              <div className="flex items-center justify-between mt-1">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                  RTP
                </div>
                <div className="text-sm font-mono text-white/80">{g.rtp}</div>
              </div>
              {g.status === "live" && route && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenGame(route);
                  }}
                  className="mt-2 h-9 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
                >
                  Open table →
                </button>
              )}
            </div>
          );
          })}
        </div>
      </section>
    </div>
  );
}

/* ===========================================================================
 *  Fairness panel
 * ========================================================================= */

function FairnessPanel() {
  return (
    <div className="mt-8 space-y-6">
      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">How the RNG works</h2>
        <p className="text-white/60 leading-relaxed text-sm">
          We use a commit-reveal HMAC-SHA256 scheme — the same protocol Stake,
          BC.Game, and Crash.com use. Before any hand is dealt the server picks
          a random <span className="text-emerald-300">server seed</span> and
          publishes its SHA-256 hash. The player supplies (or accepts a default)
          a <span className="text-emerald-300">client seed</span>. Each action
          consumes a <span className="text-emerald-300">nonce</span> that we hash
          into the byte stream that picks the next card.
        </p>
        <pre className="mt-4 p-4 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/80 overflow-x-auto">
{`stream = HMAC-SHA256(
  key  = server_seed,
  data = client_seed || ":" || nonce || ":" || block_index
)
card_index = unbiased_mod(stream, 52 - cards_drawn)`}
        </pre>
      </section>

      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">Verification flow</h2>
        <ol className="text-sm text-white/70 space-y-2 list-decimal list-inside">
          <li>Open Blackjack — note the <code className="text-emerald-300">server_seed_hash</code> in the table footer.</li>
          <li>Play any number of hands. Each settled hand stores the full action log.</li>
          <li>Rotate your client seed any time → we publish the original server seed and the verification page goes live for every past hand.</li>
          <li>Re-hash the revealed seed, compare to the originally published hash. Then replay any hand by re-deriving the byte stream.</li>
        </ol>
      </section>

      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">No-trust mode (Phase 2.2+)</h2>
        <p className="text-white/60 leading-relaxed text-sm">
          For whales who want zero trust in our server, we will support an
          <span className="text-emerald-300"> on-chain VRF</span> path: Chainlink
          VRF v2 on Ethereum, Switchboard On-Demand or Pyth Entropy on Solana.
          Every random byte for the hand comes from a verifiable on-chain
          source and the vault contract enforces the binding before paying
          out. Higher fees, slower pace, ultimate trustlessness.
        </p>
      </section>
    </div>
  );
}

/* ===========================================================================
 *  Roadmap panel
 * ========================================================================= */

function RoadmapPanel() {
  const phases: { phase: string; title: string; status: "live" | "current" | "next" | "later"; items: string[] }[] = [
    {
      phase: "Phase 0",
      title: "Foundation",
      status: "live",
      items: [
        "Architecture doc + clean L1–L5 separation",
        "lib/casino/* — types, RNG, deck, blackjack, balance, chain adapters, session",
        "Provably fair commit-reveal HMAC-SHA256",
        "Supabase schema (8 tables + atomic balance RPC)",
        "Blackjack table playable in dev-money mode",
        "Smoke tests for the engine",
      ],
    },
    {
      phase: "Phase 1",
      title: "Fairness polish",
      status: "next",
      items: [
        "Client-side hand replay worker",
        "Seed rotation flow + revealed-seed archive",
        "Public /casino/verify page",
        "Daily action-log hash anchored to Arweave",
      ],
    },
    {
      phase: "Phase 2",
      title: "Ethereum settlement",
      status: "later",
      items: [
        "Deploy CasinoVault.sol to Base Sepolia → audit → Base mainnet",
        "EthereumAdapter live (deposit + EIP-712 withdraw)",
        "Operator hot-signer service (HSM-backed)",
        "Optional Chainlink VRF v2 for on-chain mode",
      ],
    },
    {
      phase: "Phase 3",
      title: "Solana settlement",
      status: "later",
      items: [
        "Anchor casino-vault program (PDA-per-user balances)",
        "Phantom / Solflare wallet adapters",
        "SolanaAdapter live (SPL USDC first)",
        "Switchboard On-Demand for optional on-chain RNG",
      ],
    },
    {
      phase: "Phase 4",
      title: "Game catalog expansion",
      status: "later",
      items: [
        "Dice / Limbo (4.1) · Coinflip (4.2)",
        "Crash multiplayer (4.3) · Roulette (4.4)",
        "Plinko (4.5) · Slots (4.6)",
        "Sportsbook tied to /parlays engine (4.7)",
        "Video poker (4.8) · Multiplayer poker (4.9)",
      ],
    },
    {
      phase: "Phase 5",
      title: "Compliance + KYC",
      status: "later",
      items: [
        "Geo-IP gating",
        "KYC tiers (none / soft / hard)",
        "Self-exclusion + cooldown timers",
        "7-year audit retention",
      ],
    },
    {
      phase: "Phase 6",
      title: "House risk + accounting",
      status: "later",
      items: [
        "Real-time RTP dashboard per game",
        "Variance-adjusted float model per chain",
        "Hedge bot for outsized player exposure",
      ],
    },
  ];

  return (
    <div className="mt-8 space-y-4">
      {phases.map((p) => (
        <section
          key={p.phase}
          className={
            card + " p-5 " +
            (p.status === "live"
              ? "border-emerald-400/30"
              : p.status === "next"
                ? "border-amber-400/30"
                : "")
          }
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
                {p.phase}
              </div>
              <h3 className="text-base font-semibold">{p.title}</h3>
            </div>
            <span
              className={
                "text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full border " +
                (p.status === "live"
                  ? "border-emerald-400/40 text-emerald-300 bg-emerald-500/10"
                  : p.status === "next"
                    ? "border-amber-400/40 text-amber-300 bg-amber-500/10"
                    : "border-white/[0.08] text-white/40")
              }
            >
              {p.status === "live" ? "shipped" : p.status === "next" ? "next up" : "later"}
            </span>
          </div>
          <ul className="space-y-1.5">
            {p.items.map((it, i) => (
              <li key={i} className="text-[13px] text-white/70 flex items-start gap-2">
                <span className="text-white/30 select-none">·</span>
                <span>{it}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
