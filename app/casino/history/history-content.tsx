"use client";

/* ===========================================================================
 *  Casino session history — /casino/history
 *  ---------------------------------------------------------------------------
 *  A standalone audit feed of every settled session the user has played.
 *  Reads from:
 *    • localStorage (in-memory dev history, written by CasinoContext)
 *    • Supabase casino_sessions table (best-effort, when authed)
 *
 *  Features:
 *    • Filter by game, by win/loss/push, by date range.
 *    • Sort by date, PnL, multiplier, stake.
 *    • Aggregate stats above the table.
 *    • Export current view as JSON.
 *    • One-click verify link per row (pre-fills /casino/verify with the
 *      session payload).
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchPublicBetFeed, subscribePublicBetFeed, type FeedRow } from "@/lib/casino/leaderboard";
import { HistoryVerifyLink } from "../history-verify-link";
import { buildVerifyLink } from "../share-link";
import { CasinoFilterPill } from "../casino-filter-pill";
import { CasinoShell } from "../casino-shell";
import { ALL_GAMES, GAME_LABELS, card, pillGold, type CasinoGameId } from "../casino-ui";
import { fmtMoney, fmtPnl, MetricStat, tokenFromParts } from "../table-kit";

const DEV_HISTORY_TOKEN = tokenFromParts("DEV", 6);

/* ---------------------------------------------------------------------------
 *  Types
 * ------------------------------------------------------------------------- */

interface HistoryRow {
  game: string;
  at: string;
  stakeUnits: bigint;
  pnlUnits: bigint;
  multiplier: number;
  /** Token symbol for display purposes (assumes DEV when reading from localStorage). */
  tokenSymbol: string;
  tokenDecimals: number;
  /** Origin: where this row came from, for the badge column. */
  origin: "local" | "supabase";
  /** Supabase session id — used to load full audit log for verify. */
  sessionId?: string;
  /** Raw session blob, used for the share-link feature. */
  session: unknown;
}

type GameFilter = "all" | CasinoGameId;
type ResultFilter = "all" | "win" | "loss" | "push";
type SortKey = "at" | "pnl" | "multiplier" | "stake";
type SortDir = "asc" | "desc";

const HISTORY_STORAGE_KEY = "mf_casino_history_v1";

/* ---------------------------------------------------------------------------
 *  Page
 * ------------------------------------------------------------------------- */

type ActivityView = "mine" | "global";

export default function HistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: ActivityView = searchParams.get("view") === "global" ? "global" : "mine";

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [feedRows, setFeedRows] = useState<FeedRow[]>([]);
  const [feedGameFilter, setFeedGameFilter] = useState<"all" | CasinoGameId>("all");
  const [feedOutcomeFilter, setFeedOutcomeFilter] = useState<"all" | "wins" | "losses">("all");
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedLastRefresh, setFeedLastRefresh] = useState<Date | null>(null);
  const [feedRealtime, setFeedRealtime] = useState(false);

  const setView = (next: ActivityView) => {
    router.replace(next === "global" ? "/casino/history?view=global" : "/casino/history");
  };

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    const data = await fetchPublicBetFeed(120);
    setFeedRows(data);
    setFeedLastRefresh(new Date());
    setFeedLoading(false);
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (view !== "global") return;
    const t = setInterval(loadFeed, 30_000);
    return () => clearInterval(t);
  }, [view, loadFeed]);

  useEffect(() => {
    if (view !== "global") {
      setFeedRealtime(false);
      return;
    }
    const unsub = subscribePublicBetFeed({
      onInsert: (row) => {
        setFeedRows((prev) => {
          if (prev.some((r) => r.session_id === row.session_id)) return prev;
          return [row, ...prev].slice(0, 120);
        });
        setFeedLastRefresh(new Date());
      },
      onStatus: (status) => setFeedRealtime(status === "SUBSCRIBED"),
    });
    return unsub;
  }, [view]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadFeed();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadFeed]);

  // 1. Load local rows from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<{
        game: string;
        at: string;
        stakeUnits: string;
        pnlUnits: string;
        multiplier: number;
        session: unknown;
      }>;
      const mapped: HistoryRow[] = parsed.map((p) => ({
        game: p.game,
        at: p.at,
        stakeUnits: BigInt(p.stakeUnits),
        pnlUnits: BigInt(p.pnlUnits),
        multiplier: p.multiplier,
        tokenSymbol: extractTokenSymbol(p.session) ?? "DEV",
        tokenDecimals: extractTokenDecimals(p.session) ?? 6,
        origin: "local",
        session: p.session,
      }));
      setRows(mapped);
    } catch {
      // corrupted local store — ignore
    }
  }, []);

  // 2. Best-effort: also fetch from Supabase when there's an auth user.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingRemote(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoadingRemote(false);
          return;
        }
        const { data, error } = await supabase
          .from("casino_sessions")
          .select("id, game_id, token_symbol, stake, state, result, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (error) {
          if (/relation .* does not exist/i.test(error.message)) {
            // Schema not applied — silently skip.
            setLoadingRemote(false);
            return;
          }
          setRemoteError(error.message);
          setLoadingRemote(false);
          return;
        }
        const remoteRows: HistoryRow[] = (data ?? []).map((d) => {
          const result = d.result as { totalStakedUnits?: string | number; totalPayoutUnits?: string | number; pnlUnits?: string | number } | null;
          const pnlUnits = result?.pnlUnits !== undefined ? BigInt(String(result.pnlUnits)) : 0n;
          const stakeUnits = result?.totalStakedUnits !== undefined ? BigInt(String(result.totalStakedUnits)) : BigInt(String(d.stake));
          const payoutUnits = result?.totalPayoutUnits !== undefined ? BigInt(String(result.totalPayoutUnits)) : 0n;
          const multiplier = stakeUnits > 0n ? Number(payoutUnits) / Number(stakeUnits) : 0;
          return {
            game: d.game_id,
            at: d.updated_at ?? d.created_at,
            stakeUnits,
            pnlUnits,
            multiplier,
            tokenSymbol: d.token_symbol,
            tokenDecimals: 6,
            origin: "supabase",
            sessionId: d.id,
            session: { state: d.state, result, gameId: d.game_id },
          };
        });
        // Merge, dedupe by (game, at) timestamp — local takes precedence (has the full session payload).
        setRows((local) => {
          const dedupKeys = new Set(local.map(historyRowKey));
          const remoteOnly = remoteRows.filter((r) => !dedupKeys.has(historyRowKey(r)));
          return [...local, ...remoteOnly];
        });
        setLoadingRemote(false);
      } catch (err) {
        if (!cancelled) {
          setRemoteError((err as Error).message);
          setLoadingRemote(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ----- Filters / sort ----- */

  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    let r = rows.slice();
    if (gameFilter !== "all") r = r.filter((x) => x.game === gameFilter);
    if (resultFilter === "win") r = r.filter((x) => x.pnlUnits > 0n);
    else if (resultFilter === "loss") r = r.filter((x) => x.pnlUnits < 0n);
    else if (resultFilter === "push") r = r.filter((x) => x.pnlUnits === 0n);

    r.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "at":
          cmp = a.at.localeCompare(b.at);
          break;
        case "pnl":
          cmp = Number(a.pnlUnits - b.pnlUnits);
          break;
        case "multiplier":
          cmp = a.multiplier - b.multiplier;
          break;
        case "stake":
          cmp = Number(a.stakeUnits - b.stakeUnits);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [rows, gameFilter, resultFilter, sortKey, sortDir]);

  /* ----- Aggregate stats ----- */

  const stats = useMemo(() => {
    let totalWagered = 0n;
    let totalPnl = 0n;
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let biggestWin = 0n;
    let biggestLoss = 0n;
    let bestMultiplier = 0;
    for (const r of filtered) {
      totalWagered += r.stakeUnits;
      totalPnl += r.pnlUnits;
      if (r.pnlUnits > 0n) wins++;
      else if (r.pnlUnits < 0n) losses++;
      else pushes++;
      if (r.pnlUnits > biggestWin) biggestWin = r.pnlUnits;
      if (r.pnlUnits < biggestLoss) biggestLoss = r.pnlUnits;
      if (r.multiplier > bestMultiplier) bestMultiplier = r.multiplier;
    }
    return { totalWagered, totalPnl, wins, losses, pushes, biggestWin, biggestLoss, bestMultiplier, count: filtered.length };
  }, [filtered]);

  const feedFiltered = useMemo(() => {
    let list = feedRows;
    if (feedGameFilter !== "all") list = list.filter((r) => r.game_id === feedGameFilter);
    if (feedOutcomeFilter === "wins") list = list.filter((r) => Number(r.pnl) > 0);
    if (feedOutcomeFilter === "losses") list = list.filter((r) => Number(r.pnl) < 0);
    return list;
  }, [feedRows, feedGameFilter, feedOutcomeFilter]);

  const feedStats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (const r of feedFiltered) {
      if (Number(r.pnl) > 0) wins++;
      else if (Number(r.pnl) < 0) losses++;
    }
    return { wins, losses, total: feedFiltered.length };
  }, [feedFiltered]);

  /* ----- Export ----- */

  const exportJson = () => {
    const blob = new Blob([
      JSON.stringify(
        filtered.map((r) => ({ ...r, stakeUnits: r.stakeUnits.toString(), pnlUnits: r.pnlUnits.toString() })),
        null,
        2,
      ),
    ], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `casino-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = "at,game,stake,multiplier,pnl,token\n";
    const lines = filtered.map((r) => {
      const rowToken = tokenFromParts(r.tokenSymbol, r.tokenDecimals);
      const stake = fmtMoney(r.stakeUnits, rowToken, 2);
      const pnl = fmtMoney(r.pnlUnits, rowToken, 2);
      return `${r.at},${r.game},${stake},${r.multiplier.toFixed(4)},${pnl},${r.tokenSymbol}`;
    });
    const blob = new Blob([header + lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `casino-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CasinoShell
      badge="Casino log"
      title="Activity"
      subtitle="Filter your sessions, export, verify hands, or watch the global feed."
    >
      <div className="flex flex-wrap gap-2 mb-8">
        <ActivityTab active={view === "mine"} onClick={() => setView("mine")}>
          Your sessions
        </ActivityTab>
        <ActivityTab active={view === "global"} onClick={() => setView("global")}>
          Global feed
        </ActivityTab>
      </div>

      {view === "global" ? (
        <GlobalFeedPanel
          rows={feedFiltered}
          stats={feedStats}
          loading={feedLoading}
          lastRefresh={feedLastRefresh}
          realtime={feedRealtime}
          gameFilter={feedGameFilter}
          outcomeFilter={feedOutcomeFilter}
          onGameFilter={setFeedGameFilter}
          onOutcomeFilter={setFeedOutcomeFilter}
          onRefresh={loadFeed}
        />
      ) : (
      <div className="space-y-6">
        {/* Aggregate stats */}
        <section className={card + " p-5"}>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricStat label="Sessions" value={stats.count.toLocaleString()} variant="inline" />
            <MetricStat
              label="Wins"
              value={`${stats.wins} · ${stats.count > 0 ? ((stats.wins / stats.count) * 100).toFixed(1) : "0"}%`}
              accent="emerald"
              variant="inline"
            />
            <MetricStat label="Losses" value={`${stats.losses}`} accent="rose" variant="inline" />
            <MetricStat label="Wagered" value={fmtMoney(stats.totalWagered, DEV_HISTORY_TOKEN, 2)} variant="inline" />
            <MetricStat
              label="Net PnL"
              value={fmtPnl(stats.totalPnl, DEV_HISTORY_TOKEN, 2)}
              accent={stats.totalPnl >= 0n ? "emerald" : "rose"}
              variant="inline"
            />
            <MetricStat label="Best multiplier" value={stats.bestMultiplier.toFixed(2) + "×"} variant="inline" />
          </div>
        </section>

        {/* Filters bar */}
        <section className={card + " p-4 flex flex-wrap items-center gap-3"}>
          <FilterPills
            label="Game"
            value={gameFilter}
            onChange={(v) => setGameFilter(v as GameFilter)}
            options={[
              { id: "all", label: "All" },
              ...ALL_GAMES.map((g) => ({ id: g, label: GAME_LABELS[g] })),
            ]}
          />
          <FilterPills
            label="Result"
            value={resultFilter}
            onChange={(v) => setResultFilter(v as ResultFilter)}
            options={[
              { id: "all", label: "All" },
              { id: "win", label: "Wins" },
              { id: "loss", label: "Losses" },
              { id: "push", label: "Pushes" },
            ]}
          />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">Export</span>
            <button
              type="button"
              onClick={exportJson}
              disabled={filtered.length === 0}
              className="h-8 px-3 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              JSON
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="h-8 px-3 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              CSV
            </button>
          </div>
        </section>

        {/* Table */}
        <section className={card + " overflow-hidden"}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] border-b border-white/[0.06]">
                <tr className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                  <Th label="Time" sortKey="at" current={sortKey} dir={sortDir} onClick={(k) => toggle(k, sortKey, sortDir, setSortKey, setSortDir)} />
                  <Th label="Game" />
                  <Th label="Stake" sortKey="stake" current={sortKey} dir={sortDir} onClick={(k) => toggle(k, sortKey, sortDir, setSortKey, setSortDir)} align="right" />
                  <Th label="Mult" sortKey="multiplier" current={sortKey} dir={sortDir} onClick={(k) => toggle(k, sortKey, sortDir, setSortKey, setSortDir)} align="right" />
                  <Th label="PnL" sortKey="pnl" current={sortKey} dir={sortDir} onClick={(k) => toggle(k, sortKey, sortDir, setSortKey, setSortDir)} align="right" />
                  <Th label="" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-white/40">
                      {loadingRemote
                        ? "Loading sessions…"
                        : "No sessions yet — play a hand at /casino."}
                    </td>
                  </tr>
                )}
                {filtered.map((r, i) => {
                  const won = r.pnlUnits > 0n;
                  const push = r.pnlUnits === 0n;
                  return (
                    <tr
                      key={`${r.game}-${r.at}-${i}`}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-2.5 text-white/70 text-[12px] whitespace-nowrap">
                        {formatTime(r.at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] rounded-md bg-white/[0.04] border border-white/[0.06] text-white/70">
                          {GAME_LABELS[r.game as CasinoGameId] ?? r.game}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/80 text-[12px]">
                        {fmtMoney(r.stakeUnits, tokenFromParts(r.tokenSymbol, r.tokenDecimals), 2)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/70 text-[12px]">
                        {r.multiplier.toFixed(2)}×
                      </td>
                      <td
                        className={
                          "px-4 py-2.5 text-right font-mono text-[12px] " +
                          (won ? "text-emerald-300" : push ? "text-white/60" : "text-rose-300")
                        }
                      >
                        {fmtPnl(r.pnlUnits, tokenFromParts(r.tokenSymbol, r.tokenDecimals), 2)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.origin === "local" ? (
                          <a
                            href={buildVerifyLink(r.session)}
                            className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer"
                          >
                            verify →
                          </a>
                        ) : r.sessionId ? (
                          <HistoryVerifyLink sessionId={r.sessionId} />
                        ) : (
                          <span className="text-[11px] text-white/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {remoteError && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/20 text-sm text-amber-200">
            Couldn&apos;t load cloud history: {remoteError}. Showing local rows only.
          </div>
        )}
      </div>
      )}
    </CasinoShell>
  );
}

/* ---------------------------------------------------------------------------
 *  Subcomponents + helpers
 * ------------------------------------------------------------------------- */

function FilterPills({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</span>
      <div className="flex items-center gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={
              "h-7 px-2.5 rounded-md text-[11px] font-medium border transition-all cursor-pointer " +
              (value === o.id
                ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
                : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06]")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Th({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align,
}: {
  label: string;
  sortKey?: SortKey;
  current?: SortKey;
  dir?: SortDir;
  onClick?: (k: SortKey) => void;
  align?: "right";
}) {
  const isSortable = !!sortKey;
  const isActive = sortKey && current === sortKey;
  return (
    <th
      className={
        "px-4 py-2.5 font-medium " +
        (align === "right" ? "text-right " : "text-left ") +
        (isSortable ? "cursor-pointer hover:text-white/70 select-none" : "")
      }
      onClick={isSortable && onClick ? () => onClick(sortKey!) : undefined}
    >
      {label}
      {isActive && (
        <span className="ml-1 text-white/70">{dir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );
}

function toggle(
  k: SortKey,
  cur: SortKey,
  curDir: SortDir,
  setKey: (k: SortKey) => void,
  setDir: (d: SortDir) => void,
) {
  if (k === cur) {
    setDir(curDir === "asc" ? "desc" : "asc");
  } else {
    setKey(k);
    setDir(k === "at" ? "desc" : "desc");
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function historyRowKey(r: HistoryRow): string {
  if (r.sessionId) return r.sessionId;
  if (r.session && typeof r.session === "object" && "id" in r.session) {
    const id = (r.session as { id?: string }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return `${r.game}@${r.at}`;
}

function extractTokenSymbol(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = session as any;
  return s?.token?.symbol ?? null;
}

function extractTokenDecimals(session: unknown): number | null {
  if (!session || typeof session !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = session as any;
  return typeof s?.token?.decimals === "number" ? s.token.decimals : null;
}

function ActivityTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "h-9 px-4 rounded-full text-sm font-medium border transition-all cursor-pointer " +
        (active
          ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-100"
          : "bg-white/[0.03] border-white/[0.08] text-white/55 hover:text-white hover:bg-white/[0.06]")
      }
    >
      {children}
    </button>
  );
}

function GlobalFeedPanel({
  rows,
  stats,
  loading,
  lastRefresh,
  realtime,
  gameFilter,
  outcomeFilter,
  onGameFilter,
  onOutcomeFilter,
  onRefresh,
}: {
  rows: FeedRow[];
  stats: { wins: number; losses: number; total: number };
  loading: boolean;
  lastRefresh: Date | null;
  realtime: boolean;
  gameFilter: "all" | CasinoGameId;
  outcomeFilter: "all" | "wins" | "losses";
  onGameFilter: (g: "all" | CasinoGameId) => void;
  onOutcomeFilter: (o: "all" | "wins" | "losses") => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 mr-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">
            {realtime ? "Live · realtime" : "Live · polling"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 flex-1">
          <CasinoFilterPill active={gameFilter === "all"} label="All games" onClick={() => onGameFilter("all")} />
          {ALL_GAMES.map((g) => (
            <CasinoFilterPill
              key={g}
              active={gameFilter === g}
              label={GAME_LABELS[g]}
              onClick={() => onGameFilter(g)}
            />
          ))}
          <span className="w-px h-6 bg-white/10 mx-0.5 hidden sm:block" />
          <CasinoFilterPill active={outcomeFilter === "all"} label="All outcomes" onClick={() => onOutcomeFilter("all")} />
          <CasinoFilterPill active={outcomeFilter === "wins"} label="Wins" onClick={() => onOutcomeFilter("wins")} />
          <CasinoFilterPill active={outcomeFilter === "losses"} label="Losses" onClick={() => onOutcomeFilter("losses")} />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-amber-300 hover:text-amber-100 border border-amber-400/30 rounded-lg px-3 py-1.5 disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <FeedStatCard label="In view" value={String(stats.total)} />
        <FeedStatCard label="Wins" value={String(stats.wins)} accent="emerald" />
        <FeedStatCard label="Losses" value={String(stats.losses)} accent="rose" />
        <FeedStatCard label="Updated" value={lastRefresh ? lastRefresh.toLocaleTimeString() : "—"} />
      </div>

      <section className={card + " overflow-hidden"}>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-3 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/40 font-medium">
          <span>Player · game</span>
          <span className="text-right hidden sm:block">Stake</span>
          <span className="text-right">PnL</span>
          <span className="text-right hidden md:block">Time</span>
        </div>
        <div className="max-h-[min(70vh,640px)] overflow-y-auto divide-y divide-white/[0.04]">
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-white/45 text-center py-16 px-6">
              No settled bets in view yet. Sign in and play — sessions sync when hands complete.
            </p>
          ) : (
            rows.map((r) => {
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
                      <span className="sm:hidden">{fmtFeedStake(r.stake, r.token_symbol)}</span>
                    </div>
                  </div>
                  <span className="hidden sm:block text-right font-mono text-xs text-white/55">
                    {fmtFeedStake(r.stake, r.token_symbol)}
                  </span>
                  <span
                    className={
                      "text-right font-mono text-sm font-semibold " +
                      (pnl >= 0 ? "text-emerald-300" : "text-rose-300")
                    }
                  >
                    {fmtFeedPnl(r.pnl, r.token_symbol)}
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

      <p className="text-xs text-white/40">
        All cloud-settled bets appear here; display names require leaderboard opt-in.{" "}
        <Link href="/casino/leaderboard" className="text-amber-300 hover:underline">
          Leaderboard
        </Link>{" "}
        ·{" "}
        <Link href="/casino/dashboard" className="text-amber-300 hover:underline">
          Dashboard
        </Link>
      </p>
    </div>
  );
}

function FeedStatCard({
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

function fmtFeedPnl(raw: string, symbol: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return `${sign}${Math.abs(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
}

function fmtFeedStake(raw: string, symbol: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
}
