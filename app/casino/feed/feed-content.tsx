"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CasinoShell } from "../casino-shell";
import { CasinoFilterPill } from "../casino-filter-pill";
import { ALL_GAMES, card, GAME_LABELS, pillGold, type CasinoGameId } from "../casino-ui";
import { fetchPublicBetFeed, type FeedRow } from "@/lib/casino/leaderboard";

type OutcomeFilter = "all" | "wins" | "losses";

function fmtPnl(raw: string, symbol: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return `${sign}${Math.abs(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
}

function fmtStake(raw: string, symbol: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
}

export default function FeedContent() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [gameFilter, setGameFilter] = useState<"all" | CasinoGameId>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchPublicBetFeed(120);
    setRows(data);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    let list = rows;
    if (gameFilter !== "all") list = list.filter((r) => r.game_id === gameFilter);
    if (outcomeFilter === "wins") list = list.filter((r) => Number(r.pnl) > 0);
    if (outcomeFilter === "losses") list = list.filter((r) => Number(r.pnl) < 0);
    return list;
  }, [rows, gameFilter, outcomeFilter]);

  const stats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (const r of filtered) {
      if (Number(r.pnl) > 0) wins++;
      else if (Number(r.pnl) < 0) losses++;
    }
    return { wins, losses, total: filtered.length };
  }, [filtered]);

  return (
    <CasinoShell
      badge="House pulse"
      title="Global bet log"
      subtitle="Every settled hand across all games — live from the cloud. Named players opted in; others appear as Private table."
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 mr-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">Live</span>
        </div>
        <div className="flex flex-wrap gap-1.5 flex-1">
          <CasinoFilterPill active={gameFilter === "all"} label="All games" onClick={() => setGameFilter("all")} />
          {ALL_GAMES.map((g) => (
            <CasinoFilterPill
              key={g}
              active={gameFilter === g}
              label={GAME_LABELS[g]}
              onClick={() => setGameFilter(g)}
            />
          ))}
          <span className="w-px h-6 bg-white/10 mx-0.5 hidden sm:block" />
          <CasinoFilterPill active={outcomeFilter === "all"} label="All outcomes" onClick={() => setOutcomeFilter("all")} />
          <CasinoFilterPill active={outcomeFilter === "wins"} label="Wins" onClick={() => setOutcomeFilter("wins")} />
          <CasinoFilterPill active={outcomeFilter === "losses"} label="Losses" onClick={() => setOutcomeFilter("losses")} />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs text-amber-300 hover:text-amber-100 border border-amber-400/30 rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="In view" value={String(stats.total)} />
        <StatCard label="Wins" value={String(stats.wins)} accent="emerald" />
        <StatCard label="Losses" value={String(stats.losses)} accent="rose" />
        <StatCard
          label="Updated"
          value={lastRefresh ? lastRefresh.toLocaleTimeString() : "—"}
        />
      </div>

      <section className={card + " overflow-hidden"}>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-3 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/40 font-medium">
          <span>Player · game</span>
          <span className="text-right hidden sm:block">Stake</span>
          <span className="text-right">PnL</span>
          <span className="text-right hidden md:block">Time</span>
        </div>
        <div className="max-h-[min(70vh,640px)] overflow-y-auto divide-y divide-white/[0.04]">
          {filtered.length === 0 && !loading ? (
            <p className="text-sm text-white/45 text-center py-16 px-6">
              No settled bets in view yet. Sign in and play — sessions sync to the cloud when hands complete.
            </p>
          ) : (
            filtered.map((r) => {
              const pnl = Number(r.pnl);
              return (
                <div
                  key={r.session_id}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-3 items-center hover:bg-white/[0.02] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white/90 truncate flex items-center gap-2">
                      {r.display_label}
                      {r.is_public === false && (
                        <span className="text-[9px] uppercase tracking-wider text-white/35 border border-white/10 rounded px-1">
                          anon
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-white/45 flex items-center gap-2 mt-0.5">
                      <span className={pillGold + " !text-[9px] !py-0 !px-1.5"}>
                        {GAME_LABELS[r.game_id as CasinoGameId] ?? r.game_id}
                      </span>
                      <span className="sm:hidden">{fmtStake(r.stake, r.token_symbol)}</span>
                    </div>
                  </div>
                  <span className="hidden sm:block text-right font-mono text-xs text-white/55">
                    {fmtStake(r.stake, r.token_symbol)}
                  </span>
                  <span
                    className={
                      "text-right font-mono text-sm font-semibold " +
                      (pnl >= 0 ? "text-emerald-300" : "text-rose-300")
                    }
                  >
                    {fmtPnl(r.pnl, r.token_symbol)}
                  </span>
                  <span className="hidden md:block text-right text-[11px] text-white/40">
                    {new Date(r.settled_at).toLocaleString()}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>

      <p className="mt-6 text-xs text-white/40">
        All cloud-settled bets appear here; display names require leaderboard opt-in.{" "}
        <Link href="/casino/leaderboard" className="text-amber-300 hover:underline">
          Leaderboard
        </Link>{" "}
        ·{" "}
        <Link href="/casino/dashboard" className="text-amber-300 hover:underline">
          Your dashboard
        </Link>
      </p>
    </CasinoShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "rose";
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent p-4">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div
        className={
          "mt-1 font-mono text-lg font-semibold " +
          (accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white")
        }
      >
        {value}
      </div>
    </div>
  );
}
