"use client";

import { useEffect, useState } from "react";
import { CasinoShell } from "../casino-shell";
import { CasinoFilterPill } from "../casino-filter-pill";
import { card, GAME_LABELS, tableHeader, pillGold } from "../casino-ui";
import {
  fetchLeaderboardLosers,
  fetchLeaderboardWinners,
  fetchRecordBets,
  type LeaderboardRow,
  type RecordRow,
} from "@/lib/casino/leaderboard";

type Tab = "winners" | "losers" | "big_wins" | "big_losses";

function fmtUnits(raw: string, symbol: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return `${sign}${Math.abs(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
}

export default function LeaderboardContent() {
  const [tab, setTab] = useState<Tab>("winners");
  const [overall, setOverall] = useState<LeaderboardRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNote(null);
      if (tab === "winners") {
        const rows = await fetchLeaderboardWinners(30);
        if (!cancelled) {
          setOverall(rows);
          if (rows.length === 0) setNote("No cloud leaderboard data yet — sign in and play with Supabase sync enabled.");
        }
      } else if (tab === "losers") {
        const rows = await fetchLeaderboardLosers(30);
        if (!cancelled) {
          setOverall(rows);
          if (rows.length === 0) setNote("No loserboard entries yet.");
        }
      } else {
        const rows = await fetchRecordBets(tab === "big_wins" ? "biggest_win" : "biggest_loss", 30);
        if (!cancelled) {
          setRecords(rows);
          if (rows.length === 0) setNote("No record bets in the feed yet.");
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "winners", label: "Top winners" },
    { id: "losers", label: "Top losers" },
    { id: "big_wins", label: "Biggest wins" },
    { id: "big_losses", label: "Biggest losses" },
  ];

  return (
    <CasinoShell
      badge="Hall of fortune"
      title="Leaderboard & loserboard"
      subtitle="Top overall winners and losers, plus the biggest single-hand wins and losses. Named rankings require opt-in — Dashboard → Profile."
    >
      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <CasinoFilterPill
            key={t.id}
            label={t.label}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          />
        ))}
      </div>

      {!loading && (tab === "winners" || tab === "losers") && overall.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {overall.slice(0, 3).map((row, i) => (
            <PodiumCard
              key={row.user_id}
              rank={i + 1}
              label={row.display_label}
              pnl={fmtUnits(row.total_pnl, row.token_symbol)}
              sessions={row.session_count}
              variant={tab === "losers" ? "loss" : "win"}
            />
          ))}
        </div>
      )}

      {note && (
        <p className="mb-4 text-sm text-white/50 border border-white/[0.08] rounded-xl px-4 py-3 bg-white/[0.02]">
          {note}
        </p>
      )}

      <section className={card + " overflow-hidden"}>
        {loading ? (
          <p className="p-8 text-center text-white/45 text-sm">Loading rankings…</p>
        ) : tab === "winners" || tab === "losers" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className={"text-left p-4 " + tableHeader}>#</th>
                <th className={"text-left p-4 " + tableHeader}>Player</th>
                <th className={"text-right p-4 " + tableHeader}>Sessions</th>
                <th className={"text-right p-4 " + tableHeader}>Net PnL</th>
              </tr>
            </thead>
            <tbody>
              {overall.map((row, i) => (
                <tr key={row.user_id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="p-4 text-white/40 font-mono">{i + 1}</td>
                  <td className="p-4">
                    <span className="font-medium text-white/90">{row.display_label}</span>
                    {i < 3 && <span className={pillGold + " ml-2"}>Elite</span>}
                  </td>
                  <td className="p-4 text-right text-white/55 font-mono">{row.session_count}</td>
                  <td
                    className={
                      "p-4 text-right font-mono font-semibold " +
                      (Number(row.total_pnl) >= 0 ? "text-emerald-300" : "text-rose-300")
                    }
                  >
                    {fmtUnits(row.total_pnl, row.token_symbol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className={"text-left p-4 " + tableHeader}>Player</th>
                <th className={"text-left p-4 " + tableHeader}>Game</th>
                <th className={"text-right p-4 " + tableHeader}>Stake</th>
                <th className={"text-right p-4 " + tableHeader}>PnL</th>
                <th className={"text-right p-4 " + tableHeader}>When</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.session_id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="p-4 text-white/90">{row.display_label}</td>
                  <td className="p-4 text-white/60">
                    {GAME_LABELS[row.game_id as keyof typeof GAME_LABELS] ?? row.game_id}
                  </td>
                  <td className="p-4 text-right font-mono text-white/55">
                    {fmtUnits(row.stake, row.token_symbol)}
                  </td>
                  <td
                    className={
                      "p-4 text-right font-mono font-semibold " +
                      (Number(row.pnl) >= 0 ? "text-emerald-300" : "text-rose-300")
                    }
                  >
                    {fmtUnits(row.pnl, row.token_symbol)}
                  </td>
                  <td className="p-4 text-right text-white/40 text-xs">
                    {new Date(row.settled_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </CasinoShell>
  );
}

function PodiumCard({
  rank,
  label,
  pnl,
  sessions,
  variant,
}: {
  rank: number;
  label: string;
  pnl: string;
  sessions: number;
  variant: "win" | "loss";
}) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div
      className={
        "rounded-2xl border p-5 text-center bg-gradient-to-b " +
        (variant === "win"
          ? "from-amber-500/15 to-transparent border-amber-400/25"
          : "from-rose-500/12 to-transparent border-rose-400/20")
      }
    >
      <div className="text-2xl mb-2">{medals[rank - 1] ?? rank}</div>
      <div className="text-sm font-semibold text-white truncate">{label}</div>
      <div
        className={
          "mt-2 font-mono text-lg font-bold " +
          (variant === "win" ? "text-emerald-300" : "text-rose-300")
        }
      >
        {pnl}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-white/40">{sessions} sessions</div>
    </div>
  );
}
