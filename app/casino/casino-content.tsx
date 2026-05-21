"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  CHAIN_ADAPTERS,
  DEV_TOKEN,
  ETH_NATIVE,
  SOL_NATIVE,
  USDC_BASE,
  USDC_ETHEREUM_MAINNET,
  USDC_SEPOLIA,
  USDC_SOLANA,
  makeEthereumAdapter,
  makeSolanaAdapter,
  type ChainAdapter,
  type ChainId,
  type TokenSpec,
} from "@/lib/casino";
import { CasinoProvider, useCasino, type CasinoHistoryEntry } from "./casino-context";
import { CasinoShell } from "./casino-shell";
import { GameNav, type GameTab } from "./game-nav";
import { pillGold } from "./casino-ui";
import { CasinoActionStrip, VaultChainLobbyBanner } from "./casino-action-strip";
import { PlayMoneyPanel } from "./play-money-bar";

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
const BaccaratTable = dynamic(() => import("./baccarat-table"), { ssr: false });
const CoinflipTable = dynamic(() => import("./coinflip-table"), { ssr: false });
const DiceTable = dynamic(() => import("./dice-table"), { ssr: false });
const RouletteTable = dynamic(() => import("./roulette-table"), { ssr: false });
const SlotsTable = dynamic(() => import("./slots-table"), { ssr: false });
const CrashTable = dynamic(() => import("./crash-table"), { ssr: false });
const PlinkoTable = dynamic(() => import("./plinko-table"), { ssr: false });
const MinesTable = dynamic(() => import("./mines-table"), { ssr: false });
const HiloTable = dynamic(() => import("./hilo-table"), { ssr: false });
const PokerTable = dynamic(() => import("./poker-table"), { ssr: false });
const VideoPokerTable = dynamic(() => import("./video-poker-table"), { ssr: false });
const KenoTable = dynamic(() => import("./keno-table"), { ssr: false });
const WheelTable = dynamic(() => import("./wheel-table"), { ssr: false });
const SicBoTable = dynamic(() => import("./sic-bo-table"), { ssr: false });
const DragonTigerTable = dynamic(() => import("./dragon-tiger-table"), { ssr: false });
const CasinoWarTable = dynamic(() => import("./casino-war-table"), { ssr: false });
const RedDogTable = dynamic(() => import("./red-dog-table"), { ssr: false });
const ThreeCardPokerTable = dynamic(() => import("./three-card-poker-table"), { ssr: false });
const AndarBaharTable = dynamic(() => import("./andar-bahar-table"), { ssr: false });
const CaribbeanStudTable = dynamic(() => import("./caribbean-stud-table"), { ssr: false });
const CasinoHoldemTable = dynamic(() => import("./casino-holdem-table"), { ssr: false });
const LetItRideTable = dynamic(() => import("./let-it-ride-table"), { ssr: false });
const MississippiStudTable = dynamic(() => import("./mississippi-stud-table"), { ssr: false });
const ChuckALuckTable = dynamic(() => import("./chuck-a-luck-table"), { ssr: false });

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
    id: "baccarat",
    title: "Baccarat",
    subtitle: "Punto banco · Player / Banker / Tie · 8-deck shoe",
    rtp: "≈98.9%",
    status: "live",
    phase: "Phase 4.0",
    emoji: "♦",
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
    subtitle: "16-row peg triangle · 3 risk tiers · up to 1000×",
    rtp: "99.00%",
    status: "live",
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
    id: "mines",
    title: "Mines",
    subtitle: "5×5 grid · 1–24 mines · flat 1% edge · cash out anytime",
    rtp: "99.00%",
    status: "live",
    phase: "Phase 4.7",
    emoji: "✸",
  },
  {
    id: "hilo",
    title: "HiLo",
    subtitle: "Higher-or-same vs lower-or-same · 13-rank deck · compounding 1% edge",
    rtp: "99.00%",
    status: "live",
    phase: "Phase 4.8",
    emoji: "♣",
  },
  {
    id: "sportsbook",
    title: "Sportsbook",
    subtitle: "Hooks into the /parlays +EV engine",
    rtp: "varies",
    status: "soon",
    phase: "Phase 4.9",
    emoji: "🜨",
  },
  {
    id: "poker",
    title: "Poker",
    subtitle: "6-max Hold'em · you vs five bots · 1% rake",
    rtp: "skill + rake",
    status: "live",
    phase: "Phase 5",
    emoji: "♥",
  },
  {
    id: "video-poker",
    title: "Video Poker",
    subtitle: "Jacks or Better · hold/draw · 800× royal",
    rtp: "≈99.5%",
    status: "live",
    phase: "Phase 4.8",
    emoji: "🂡",
  },
  {
    id: "keno",
    title: "Keno",
    subtitle: "Pick 1–10 of 80 · 20 balls drawn · classic pay table",
    rtp: "≈92%",
    status: "live",
    phase: "Phase 4.9",
    emoji: "🎱",
  },
  {
    id: "wheel",
    title: "Money Wheel",
    subtitle: "54 segments · bet 1×–40× · Dream Catcher layout",
    rtp: "≈96%",
    status: "live",
    phase: "Phase 4.9",
    emoji: "◎",
  },
  {
    id: "sic-bo",
    title: "Sic Bo",
    subtitle: "Three dice · Big/Small · triples · totals 4–17",
    rtp: "≈97%",
    status: "live",
    phase: "Phase 4.9",
    emoji: "⚄",
  },
  {
    id: "dragon-tiger",
    title: "Dragon Tiger",
    subtitle: "One card each · Ace low · tie pays 11:1 · half on tie",
    rtp: "≈96%",
    status: "live",
    phase: "Phase 4.9",
    emoji: "🐉",
  },
  {
    id: "casino-war",
    title: "Casino War",
    subtitle: "Ace high · tie = war or surrender half · 6-deck shoe",
    rtp: "≈97%",
    status: "live",
    phase: "Phase 4.9",
    emoji: "⚔",
  },
  {
    id: "red-dog",
    title: "Red Dog",
    subtitle: "Two cards set spread · third between wins · pair/consec push",
    rtp: "≈95%",
    status: "live",
    phase: "Phase 4.9",
    emoji: "🂡",
  },
  {
    id: "three-card-poker",
    title: "Three Card Poker",
    subtitle: "Ante + Play · Queen-Six qualify · fold or play",
    rtp: "≈96.6%",
    status: "live",
    phase: "Phase 5",
    emoji: "🃛",
  },
  {
    id: "andar-bahar",
    title: "Andar Bahar",
    subtitle: "Match the joker rank · Andar 0.9:1 · Bahar 1:1",
    rtp: "≈97%",
    status: "live",
    phase: "Phase 5",
    emoji: "🎴",
  },
  {
    id: "caribbean-stud",
    title: "Caribbean Stud",
    subtitle: "5-card stud · ante + raise · dealer Ace-King to qualify",
    rtp: "≈94.8%",
    status: "live",
    phase: "Phase 5",
    emoji: "🏝",
  },
  {
    id: "casino-holdem",
    title: "Casino Hold'em",
    subtitle: "Texas vs dealer · shared board · pair of 4s to qualify",
    rtp: "≈97.8%",
    status: "live",
    phase: "Phase 5",
    emoji: "♠",
  },
  {
    id: "let-it-ride",
    title: "Let It Ride",
    subtitle: "3 bets · pull 1 & 2 · pair of 10s+ pays to 25:1",
    rtp: "≈97.0%",
    status: "live",
    phase: "Phase 5",
    emoji: "🎰",
  },
  {
    id: "mississippi-stud",
    title: "Mississippi Stud",
    subtitle: "Ante + 1×/2×/3× streets · fold or bet · pair of 6s+ pays",
    rtp: "≈95.9%",
    status: "live",
    phase: "Phase 5",
    emoji: "🌊",
  },
  {
    id: "chuck-a-luck",
    title: "Chuck-a-Luck",
    subtitle: "Pick 1–6 · 3 dice · 1/2/3 hits pay 1:1, 2:1, 11:1",
    rtp: "≈94.5%",
    status: "live",
    phase: "Phase 5",
    emoji: "🎲",
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
    blurb: "Free chips, random guest name, no sign-up. Instant refills via the chip bar.",
    bestFor: "Learning the game · UI development · zero-stakes fun",
    tokens: [DEV_TOKEN],
  },
  {
    id: "ethereum-sepolia",
    display: "Sepolia (testnet)",
    tag: "TEST",
    status: "queued",
    phase: "Phase 1",
    blurb: "ETH vault on Sepolia for deposit/withdraw and settlement smoke tests before mainnet rails go live.",
    bestFor: "Vault E2E · operator QA · test ETH only",
    tokens: [USDC_SEPOLIA, ETH_NATIVE],
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

function effectiveChainStatus(tile: ChainTile, vaultLive: ReadonlySet<string>): "live" | "queued" {
  if (tile.id === "dev-mock") return "live";
  if (vaultLive.has(tile.id)) return "live";
  return tile.status;
}

/* ===========================================================================
 *  Page
 * ========================================================================= */

export default function CasinoContent() {
  const [tab, setTab] = useState<GameTab>("lobby");
  const [chainId, setChainId] = useState<ChainId>("dev-mock");
  const [token, setToken] = useState<TokenSpec>(DEV_TOKEN);
  const [vaultLiveChains, setVaultLiveChains] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    fetch("/api/casino/vault-status")
      .then((r) => r.json())
      .then((body: { chains?: { chainId: string; ready: boolean }[] }) => {
        setVaultLiveChains(
          new Set((body.chains ?? []).filter((c) => c.ready).map((c) => c.chainId)),
        );
      })
      .catch(() => setVaultLiveChains(new Set()));
  }, []);

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
      <CasinoShell>
        {tab === "lobby" && <LobbyHero />}
        <GameNav tab={tab} setTab={setTab} />
        {tab !== "lobby" && tab !== "fairness" && tab !== "roadmap" && <CasinoActionStrip />}
        <div>
          {tab === "lobby" && (
            <Lobby
              chainId={chainId}
              token={token}
              adapter={adapter}
              vaultLiveChains={vaultLiveChains}
              onSelectChain={selectChain}
              onSelectToken={setToken}
              onOpenGame={(g) => setTab(g)}
            />
          )}
          {tab === "blackjack" && (
            <BlackjackTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "baccarat" && (
            <BaccaratTable chainId={chainId} token={token} adapter={adapter} />
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
          {tab === "plinko" && (
            <PlinkoTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "mines" && (
            <MinesTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "hilo" && (
            <HiloTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "poker" && (
            <PokerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "video-poker" && (
            <VideoPokerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "keno" && (
            <KenoTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "wheel" && (
            <WheelTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "sic-bo" && (
            <SicBoTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "dragon-tiger" && (
            <DragonTigerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "casino-war" && (
            <CasinoWarTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "red-dog" && (
            <RedDogTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "three-card-poker" && (
            <ThreeCardPokerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "andar-bahar" && (
            <AndarBaharTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "caribbean-stud" && (
            <CaribbeanStudTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "casino-holdem" && (
            <CasinoHoldemTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "let-it-ride" && (
            <LetItRideTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "mississippi-stud" && (
            <MississippiStudTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "chuck-a-luck" && (
            <ChuckALuckTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "roadmap" && <RoadmapPanel />}
          {tab === "fairness" && <FairnessPanel />}
        </div>
      </CasinoShell>
    </CasinoProvider>
  );
}

function LobbyHero() {
  return (
    <div className="-mt-6 mb-2 pb-4 border-b border-white/[0.05]">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={pillGold}>Provably fair</span>
        <SyncStatusPill />
      </div>
      <p className="max-w-2xl text-white/55 text-sm leading-relaxed">
        High-stakes crypto casino — every outcome verifiable, every session auditable. Use{" "}
        <strong className="text-white/80">Dev / Play Money</strong> below (no account), or open{" "}
        <Link href="/casino/docs" className="text-amber-300 hover:underline">
          docs
        </Link>{" "}
        for rules and RTP.
      </p>
    </div>
  );
}


/* ===========================================================================
 *  Lobby
 * ========================================================================= */

interface LobbyProps {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
  vaultLiveChains: ReadonlySet<string>;
  onSelectChain: (c: ChainId) => void;
  onSelectToken: (t: TokenSpec) => void;
  onOpenGame: (g: GameTab) => void;
}

function Lobby({
  chainId,
  token,
  adapter,
  vaultLiveChains,
  onSelectChain,
  onSelectToken,
  onOpenGame,
}: LobbyProps) {
  const currentTile = CHAIN_TILES.find((c) => c.id === chainId);
  const { balance, stats, history } = useCasino();

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
    <div className="mt-6 space-y-8">
      {chainId === "dev-mock" && <PlayMoneyPanel />}

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
      </section>

      {/* Cross-game recent activity */}
      {history.length > 0 && (
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Recent activity</h2>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em]">
              <Link href="/casino/history" className="text-emerald-300 hover:text-emerald-200 cursor-pointer">
                Activity log →
              </Link>
              <Link href="/casino/history?view=global" className="text-emerald-300 hover:text-emerald-200 cursor-pointer">
                Global feed →
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
                Activity log →
              </Link>
              <Link href="/casino/history?view=global" className="text-emerald-300 hover:text-emerald-200 cursor-pointer">
                Global feed →
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
            const status = effectiveChainStatus(c, vaultLiveChains);
            const vaultDeployed = vaultLiveChains.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={status !== "live"}
                onClick={() => onSelectChain(c.id)}
                className={
                  "text-left p-4 rounded-2xl border transition-all relative " +
                  (active
                    ? "border-emerald-400/50 bg-emerald-500/10"
                    : status === "live"
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
                      (status === "live"
                        ? "border-emerald-400/40 text-emerald-300 bg-emerald-500/10"
                        : "border-amber-400/30 text-amber-300 bg-amber-500/10")
                    }
                  >
                    {vaultDeployed && c.id !== "dev-mock" ? "vault live" : status}
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
          <VaultChainLobbyBanner chainId={chainId} />
        </section>
      )}

      {/* Game catalog */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Games</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GAME_CATALOG.map((g) => {
            const route =
              g.id === "blackjack" ||
              g.id === "baccarat" ||
              g.id === "coinflip" ||
              g.id === "dice" ||
              g.id === "roulette" ||
              g.id === "slots" ||
              g.id === "crash" ||
              g.id === "plinko" ||
              g.id === "mines" ||
              g.id === "hilo" ||
              g.id === "poker" ||
              g.id === "video-poker" ||
              g.id === "keno" ||
              g.id === "wheel" ||
              g.id === "sic-bo" ||
              g.id === "dragon-tiger" ||
              g.id === "casino-war" ||
              g.id === "red-dog" ||
              g.id === "three-card-poker" ||
              g.id === "andar-bahar" ||
              g.id === "caribbean-stud" ||
              g.id === "casino-holdem" ||
              g.id === "let-it-ride" ||
              g.id === "mississippi-stud" ||
              g.id === "chuck-a-luck"
                ? (g.id as GameTab)
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
                {!(g.status === "live" && route) && (
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
                )}
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
      status: "current",
      items: [
        "CasinoVerifyModal + session replay on all 10 games",
        "Public /casino/verify page",
        "Seed rotation flow + revealed-seed archive",
        "Daily action-log hash anchored to Arweave",
      ],
    },
    {
      phase: "Phase 2",
      title: "Ethereum settlement",
      status: "next",
      items: [
        "Deploy CasinoVault.sol (Sepolia first via deploy script + env)",
        "Wallet deposit/withdraw + vault-status panel",
        "Signed-in play on vault-live chains (lobby auto-enables)",
        "Operator hot-signer + EIP-712 withdraw webhook",
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
      title: "Game catalog",
      status: "live",
      items: [
        "Blackjack · Baccarat · Video Poker · Keno · Coinflip · Dice · Crash · Roulette · Plinko · Slots · Mines · HiLo · Poker",
        "Activity page: your sessions + global feed (Supabase Realtime)",
        "Sportsbook tied to /parlays engine — upcoming",
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
