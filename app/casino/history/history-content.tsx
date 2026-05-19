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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { buildVerifyLink } from "../share-link";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

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
  /** Raw session blob, used for the share-link feature. */
  session: unknown;
}

type GameFilter = "all" | "blackjack" | "coinflip" | "dice";
type ResultFilter = "all" | "win" | "loss" | "push";
type SortKey = "at" | "pnl" | "multiplier" | "stake";
type SortDir = "asc" | "desc";

const HISTORY_STORAGE_KEY = "mf_casino_history_v1";

/* ---------------------------------------------------------------------------
 *  Page
 * ------------------------------------------------------------------------- */

export default function HistoryContent() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

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
            session: { state: d.state, result, gameId: d.game_id }, // partial — share-link won't work for supabase rows without full session
          };
        });
        // Merge, dedupe by (game, at) timestamp — local takes precedence (has the full session payload).
        setRows((local) => {
          const dedupKeys = new Set(local.map((l) => `${l.game}@${l.at}`));
          const remoteOnly = remoteRows.filter((r) => !dedupKeys.has(`${r.game}@${r.at}`));
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
      const stake = fmt(r.stakeUnits, r.tokenDecimals, false);
      const pnl = fmt(r.pnlUnits, r.tokenDecimals, true);
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
    <div className="min-h-[calc(100vh-56px)] w-full bg-[#08090e] text-white">
      <header className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-900/30 via-[#08090e] to-[#08090e]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-12 pb-8">
          <div className="text-[10px] uppercase tracking-[0.15em] text-emerald-300/60 mb-2">
            Casino · Session history
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl font-semibold tracking-tight">
            Every hand, audited<span className="text-emerald-400">.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-white/60 leading-relaxed">
            Every settled session you&apos;ve played. Filter by game, by result, by date.
            Every row has a one-click verify link. Export to JSON or CSV for your records.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm">
            <Link href="/casino" className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline">
              ← back to casino
            </Link>
            <Link href="/casino/verify" className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline">
              verify a hand →
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-6">
        {/* Aggregate stats */}
        <section className={card + " p-5"}>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            <Stat label="Sessions" value={stats.count.toLocaleString()} />
            <Stat label="Wins" value={`${stats.wins} · ${stats.count > 0 ? ((stats.wins / stats.count) * 100).toFixed(1) : "0"}%`} accent="emerald" />
            <Stat label="Losses" value={`${stats.losses}`} accent="rose" />
            <Stat label="Wagered" value={fmt(stats.totalWagered, 6, false)} sub="DEV" />
            <Stat label="Net PnL" value={(stats.totalPnl >= 0n ? "+" : "") + fmt(stats.totalPnl, 6, false)} accent={stats.totalPnl >= 0n ? "emerald" : "rose"} sub="DEV" />
            <Stat label="Best multiplier" value={stats.bestMultiplier.toFixed(2) + "×"} />
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
              { id: "blackjack", label: "Blackjack" },
              { id: "coinflip", label: "Coinflip" },
              { id: "dice", label: "Dice" },
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
                  <Th label="Source" />
                  <Th label="" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-white/40">
                      {loadingRemote
                        ? "Loading from Supabase…"
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
                          {r.game}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/80 text-[12px]">
                        {fmt(r.stakeUnits, r.tokenDecimals, false)} {r.tokenSymbol}
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
                        {won ? "+" : ""}
                        {fmt(r.pnlUnits, r.tokenDecimals, true)} {r.tokenSymbol}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={
                          "text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border " +
                          (r.origin === "local"
                            ? "border-white/[0.08] text-white/40"
                            : "border-emerald-400/30 text-emerald-300 bg-emerald-500/5")
                        }>
                          {r.origin}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.origin === "local" ? (
                          <a
                            href={buildVerifyLink(r.session)}
                            className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer"
                          >
                            verify →
                          </a>
                        ) : (
                          <span className="text-[11px] text-white/30">remote-only</span>
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
            Couldn&apos;t reach Supabase for cloud history: {remoteError}. Showing local rows only.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Subcomponents + helpers
 * ------------------------------------------------------------------------- */

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "emerald" | "rose" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</div>
      <div
        className={
          "text-base font-bold font-mono mt-0.5 " +
          (accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white")
        }
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

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

function fmt(units: bigint, decimals: number, signed: boolean): string {
  const denom = 10n ** BigInt(decimals);
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const w = abs / denom;
  const f = (abs % denom).toString().padStart(decimals, "0");
  const num = Number(`${w}.${f}`);
  void signed;
  return `${sign}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
