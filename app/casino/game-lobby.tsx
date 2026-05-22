"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ChainAdapter, ChainId, TokenSpec } from "@/lib/casino";
import { useCasino } from "./casino-context";
import { VaultChainLobbyBanner } from "./casino-action-strip";
import { GAME_LABELS, card, cardHover, inputCls, pillGold } from "./casino-ui";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  GAME_CATALOG,
  isPlayableGame,
  type GameCategory,
} from "./game-catalog";
import type { GameTab } from "./game-types";
import { PlayMoneyPanel } from "./play-money-bar";
import { fmtMoney } from "./table-kit";

const CHAIN_TILES = [
  { id: "dev-mock" as ChainId, display: "Play money", tag: "Free" },
  { id: "ethereum-sepolia" as ChainId, display: "Sepolia", tag: "Test" },
  { id: "ethereum-base" as ChainId, display: "Base", tag: "L2" },
  { id: "ethereum-mainnet" as ChainId, display: "Ethereum", tag: "ETH" },
  { id: "solana-mainnet" as ChainId, display: "Solana", tag: "SOL" },
] as const;

const PRIMARY_LINKS = [
  { href: "/casino/dashboard", label: "Dashboard" },
  { href: "/casino/history", label: "Activity" },
  { href: "/casino/wallet", label: "Vault" },
] as const;

function gameLabel(id: string): string {
  return id in GAME_LABELS ? GAME_LABELS[id as keyof typeof GAME_LABELS] : id;
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

function GameTileButton({ g, onOpen }: { g: (typeof GAME_CATALOG)[0]; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        card +
        cardHover +
        " p-3 sm:p-4 flex flex-col items-center text-center gap-2 min-h-[6.25rem] sm:min-h-[7rem] cursor-pointer active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
      }
    >
      <span
        className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-b from-amber-500/20 to-emerald-500/10 border border-amber-400/20 flex items-center justify-center text-2xl sm:text-3xl"
        aria-hidden
      >
        {g.emoji}
      </span>
      <span className="text-[11px] sm:text-xs font-semibold text-white leading-tight line-clamp-2">{g.title}</span>
      <span className="text-[9px] font-mono text-white/40">{g.rtp}</span>
    </button>
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");

  const liveGames = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GAME_CATALOG.filter((g) => {
      if (g.status !== "live" || !isPlayableGame(g.id)) return false;
      if (!q) return true;
      return g.title.toLowerCase().includes(q) || g.id.includes(q);
    });
  }, [query]);

  const byCategory = useMemo(() => {
    const map = new Map<GameCategory, typeof liveGames>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const g of liveGames) {
      const list = map.get(g.category) ?? [];
      list.push(g);
      map.set(g.category, list);
    }
    return CATEGORY_ORDER.map((cat) => ({ cat, games: map.get(cat) ?? [] })).filter((x) => x.games.length > 0);
  }, [liveGames]);

  const showSections = !query.trim();

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className={card + " p-4 sm:p-5"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-semibold">Balance</p>
            <p className="mt-1 text-2xl sm:text-3xl font-mono font-bold text-emerald-300 tabular-nums">
              {fmtMoney(balance.available, token, 2)}
            </p>
            <p className="mt-1 text-xs text-white/45">
              Lifetime {stats.totalPnlUnits >= 0n ? "+" : ""}
              {fmtMoney(stats.totalPnlUnits, token, 2)}
              {stats.sessionsPlayed > 0 ? ` · ${stats.sessionsPlayed} hands` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={pillGold}>Provably fair</span>
            <SyncPill persistent={persistent} />
          </div>
        </div>
        <nav className="mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap items-center gap-2" aria-label="Casino tools">
          {PRIMARY_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs font-medium px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/65 hover:text-white hover:border-amber-400/30 transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="text-xs font-medium px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/65 hover:text-white cursor-pointer"
          >
            More{moreOpen ? " ▲" : " ▼"}
          </button>
        </nav>
        {moreOpen && (
          <nav className="mt-2 flex flex-wrap gap-2">
            <Link href="/casino/leaderboard" className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-white/55 hover:text-white">
              Rankings
            </Link>
            <Link href="/casino/verify" className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-white/55 hover:text-white">
              Verify
            </Link>
            <Link href="/casino/docs" className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-white/55 hover:text-white">
              Docs
            </Link>
            <button
              type="button"
              onClick={onOpenFairness}
              className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-white/55 hover:text-white cursor-pointer"
            >
              Fairness
            </button>
          </nav>
        )}
      </section>

      {chainId === "dev-mock" && <PlayMoneyPanel />}

      <section>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold text-white/80 shrink-0">Choose a game</h2>
          <input
            type="search"
            placeholder="Search games…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputCls + " !h-10 sm:max-w-xs sm:ml-auto"}
            aria-label="Search games"
          />
        </div>

        {liveGames.length === 0 && (
          <p className="text-sm text-white/45 text-center py-8">No games match &ldquo;{query}&rdquo;</p>
        )}

        {showSections
          ? byCategory.map(({ cat, games }) => (
              <div key={cat} className="mb-5 last:mb-0">
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-semibold mb-2">
                  {CATEGORY_LABELS[cat]}
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {games.map((g) => (
                    <GameTileButton key={g.id} g={g} onOpen={() => onOpenGame(g.id as GameTab)} />
                  ))}
                </div>
              </div>
            ))
          : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {liveGames.map((g) => (
                <GameTileButton key={g.id} g={g} onOpen={() => onOpenGame(g.id as GameTab)} />
              ))}
            </div>
          )}

        {GAME_CATALOG.some((g) => g.status === "soon") && !query && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-white/35 font-semibold mb-2">Coming soon</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 opacity-40">
              {GAME_CATALOG.filter((g) => g.status === "soon").map((g) => (
                <div key={g.id} className={card + " p-3 flex flex-col items-center gap-1 min-h-[5.5rem]"} aria-disabled>
                  <span className="text-2xl">{g.emoji}</span>
                  <span className="text-[10px] font-semibold text-white/70">{g.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className={card + " p-4"}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-white/80">Recent</h3>
            <Link href="/casino/history" className="text-xs text-amber-300/90 hover:text-amber-200">
              See all →
            </Link>
          </div>
          <ul className="space-y-1.5 text-xs font-mono">
            {history.slice(0, 4).map((h, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate text-white/55">{gameLabel(h.game)}</span>
                <span className={h.pnlUnits >= 0n ? "text-emerald-300" : "text-rose-300"}>
                  {h.pnlUnits >= 0n ? "+" : ""}
                  {fmtMoney(h.pnlUnits, token)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
          <span className="text-white/40 text-sm" aria-hidden>
            {walletOpen ? "▲" : "▼"}
          </span>
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
            <p className="text-[11px] text-white/40 font-mono truncate">Vault {adapter.getVaultAddress()}</p>
            <VaultChainLobbyBanner chainId={chainId} />
          </div>
        )}
      </section>
    </div>
  );
}
