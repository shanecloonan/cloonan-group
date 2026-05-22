"use client";

import Link from "next/link";
import { useState } from "react";
import type { ChainAdapter, ChainId, TokenSpec } from "@/lib/casino";
import { useCasino } from "./casino-context";
import { VaultChainLobbyBanner } from "./casino-action-strip";
import { card, cardHover, pillGold } from "./casino-ui";
import { GAME_CATALOG, isPlayableGame } from "./game-catalog";
import type { GameTab } from "./game-types";
import { PlayMoneyPanel } from "./play-money-bar";

const CHAIN_TILES = [
  { id: "dev-mock" as ChainId, display: "Play money", tag: "Free" },
  { id: "ethereum-sepolia" as ChainId, display: "Sepolia", tag: "Test" },
  { id: "ethereum-base" as ChainId, display: "Base", tag: "L2" },
  { id: "ethereum-mainnet" as ChainId, display: "Ethereum", tag: "ETH" },
  { id: "solana-mainnet" as ChainId, display: "Solana", tag: "SOL" },
] as const;

const UTIL_LINKS = [
  { href: "/casino/dashboard", label: "Dashboard" },
  { href: "/casino/history", label: "Activity" },
  { href: "/casino/leaderboard", label: "Rankings" },
  { href: "/casino/wallet", label: "Vault" },
  { href: "/casino/verify", label: "Verify" },
  { href: "/casino/docs", label: "Docs" },
] as const;

function fmtMoney(units: bigint, token: TokenSpec): string {
  const denom = 10n ** BigInt(token.decimals);
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const w = abs / denom;
  const f = (abs % denom).toString().padStart(token.decimals, "0");
  return `${sign}${Number(`${w}.${f}`).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token.symbol}`;
}

function SyncPill({ persistent }: { persistent: boolean }) {
  return (
    <span
      className={
        "text-[10px] font-medium px-2 py-0.5 rounded-full border " +
        (persistent
          ? "border-emerald-400/30 text-emerald-300 bg-emerald-500/10"
          : "border-amber-400/30 text-amber-200 bg-amber-500/10")
      }
    >
      {persistent ? "Cloud sync" : "Local play"}
    </span>
  );
}

export function GameLobby({
  chainId,
  token,
  tokens,
  adapter,
  vaultLiveChains,
  onSelectChain,
  onSelectToken,
  onOpenGame,
  onOpenFairness,
}: {
  chainId: ChainId;
  token: TokenSpec;
  tokens: TokenSpec[];
  adapter: ChainAdapter;
  vaultLiveChains: ReadonlySet<string>;
  onSelectChain: (c: ChainId) => void;
  onSelectToken: (t: TokenSpec) => void;
  onOpenGame: (g: GameTab) => void;
  onOpenFairness: () => void;
}) {
  const { balance, stats, history, persistent } = useCasino();
  const [walletOpen, setWalletOpen] = useState(false);
  const liveGames = GAME_CATALOG.filter((g) => g.status === "live" && isPlayableGame(g.id));

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Balance + quick links */}
      <section className={card + " p-4 sm:p-5"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-semibold">Balance</p>
            <p className="mt-1 text-2xl sm:text-3xl font-mono font-bold text-emerald-300 tabular-nums">
              {fmtMoney(balance.available, token)}
            </p>
            <p className="mt-1 text-xs text-white/45">
              Lifetime {stats.totalPnlUnits >= 0n ? "+" : ""}
              {fmtMoney(stats.totalPnlUnits, token)}
              {stats.sessionsPlayed > 0 ? ` · ${stats.sessionsPlayed} hands` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={pillGold}>Provably fair</span>
            <SyncPill persistent={persistent} />
          </div>
        </div>
        <nav
          className="mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap gap-2"
          aria-label="Casino tools"
        >
          {UTIL_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs font-medium px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/65 hover:text-white hover:border-amber-400/30 hover:bg-amber-500/10 transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={onOpenFairness}
            className="text-xs font-medium px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/65 hover:text-white hover:border-amber-400/30 transition-colors cursor-pointer"
          >
            Fairness
          </button>
        </nav>
      </section>

      {chainId === "dev-mock" && <PlayMoneyPanel />}

      {/* Game grid — app-style tiles */}
      <section>
        <h2 className="text-sm font-semibold text-white/80 mb-3">Choose a game</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
          {liveGames.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onOpenGame(g.id as GameTab)}
              className={
                card +
                cardHover +
                " p-3 sm:p-4 flex flex-col items-center text-center gap-2 min-h-[6.5rem] sm:min-h-[7.5rem] cursor-pointer active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
              }
            >
              <span
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-b from-amber-500/20 to-emerald-500/10 border border-amber-400/20 flex items-center justify-center text-2xl sm:text-3xl shadow-inner"
                aria-hidden
              >
                {g.emoji}
              </span>
              <span className="text-[11px] sm:text-xs font-semibold text-white leading-tight line-clamp-2">
                {g.title}
              </span>
              <span className="text-[9px] font-mono text-white/40">{g.rtp}</span>
            </button>
          ))}
          {GAME_CATALOG.filter((g) => g.status === "soon").map((g) => (
            <div
              key={g.id}
              className={card + " p-3 sm:p-4 flex flex-col items-center text-center gap-2 opacity-45 min-h-[6.5rem]"}
              aria-disabled
            >
              <span className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-2xl">
                {g.emoji}
              </span>
              <span className="text-[11px] font-semibold text-white/70">{g.title}</span>
              <span className="text-[9px] uppercase tracking-wider text-white/35">Soon</span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent hands — compact */}
      {history.length > 0 && (
        <section className={card + " p-4"}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-white/80">Recent</h3>
            <Link href="/casino/history" className="text-xs text-amber-300/90 hover:text-amber-200">
              See all →
            </Link>
          </div>
          <ul className="space-y-1.5 text-xs font-mono text-white/55">
            {history.slice(0, 4).map((h, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate uppercase tracking-wide">{h.game}</span>
                <span className={h.pnlUnits >= 0n ? "text-emerald-300" : "text-rose-300"}>
                  {h.pnlUnits >= 0n ? "+" : ""}
                  {fmtMoney(h.pnlUnits, token)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Wallet — collapsed by default */}
      <section className={card + " overflow-hidden"}>
        <button
          type="button"
          onClick={() => setWalletOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-3 p-4 text-left cursor-pointer hover:bg-white/[0.02]"
        >
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-semibold">Wallet</p>
            <p className="text-sm font-medium text-white mt-0.5">
              {CHAIN_TILES.find((c) => c.id === chainId)?.display ?? chainId} · {token.symbol}
            </p>
          </div>
          <span className="text-white/40 text-sm">{walletOpen ? "▲" : "▼"}</span>
        </button>
        {walletOpen && (
          <div className="px-4 pb-4 pt-0 border-t border-white/[0.06] space-y-3">
            <div className="flex flex-wrap gap-2">
              {CHAIN_TILES.map((c) => {
                const live = c.id === "dev-mock" || vaultLiveChains.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!live}
                    onClick={() => onSelectChain(c.id)}
                    className={
                      "px-3 py-2 rounded-xl text-xs font-semibold border transition-all " +
                      (chainId === c.id
                        ? "border-amber-400/45 bg-amber-500/15 text-amber-100"
                        : live
                          ? "border-white/[0.1] bg-white/[0.03] text-white/70 hover:border-white/20 cursor-pointer"
                          : "border-white/[0.05] text-white/30 cursor-not-allowed opacity-60")
                    }
                  >
                    {c.display}
                  </button>
                );
              })}
            </div>
            {tokens.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {tokens.map((t) => (
                  <button
                    key={t.symbol + t.address}
                    type="button"
                    onClick={() => onSelectToken(t)}
                    className={
                      "px-3 py-1.5 rounded-lg text-xs font-semibold border " +
                      (token.symbol === t.symbol && token.address === t.address
                        ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                        : "border-white/[0.1] text-white/60 hover:bg-white/[0.05] cursor-pointer")
                    }
                  >
                    {t.symbol}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-white/40 font-mono truncate">
              Vault {adapter.getVaultAddress()}
            </p>
            <VaultChainLobbyBanner chainId={chainId} />
          </div>
        )}
      </section>

      <p className="text-center text-[11px] text-white/35 pb-2">
        Every game uses commit-reveal seeds.{" "}
        <Link href="/casino/docs" className="text-amber-300/80 hover:underline">
          Rules &amp; RTP
        </Link>
      </p>
    </div>
  );
}
