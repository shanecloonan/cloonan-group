"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { CasinoShell } from "../casino-shell";
import { CasinoFilterPill } from "../casino-filter-pill";
import {
  ALL_GAMES,
  card,
  btnPrimary,
  GAME_LABELS,
  inputCls,
  labelCls,
  sectionTitle,
  type CasinoGameId,
} from "../casino-ui";
import {
  fetchOwnDashboardSessions,
  fetchOwnProfile,
  fetchPublicBetFeed,
  subscribePublicBetFeed,
  upsertCasinoProfile,
  type DashboardSessionRow,
  type FeedRow,
} from "@/lib/casino/leaderboard";
import { HistoryVerifyLink } from "../history-verify-link";
import { buildVerifyLink } from "../share-link";
import { fmtMoney, fmtPnl, MetricStat, tokenFromParts } from "../table-kit";

const DASHBOARD_TOKEN = tokenFromParts("DEV", 6);

const HISTORY_KEY = "mf_casino_history_v1";

type LocalRow = {
  game: string;
  at: string;
  stakeUnits: string;
  pnlUnits: string;
  multiplier: number;
  session: unknown;
};

export default function DashboardContent() {
  const [localRows, setLocalRows] = useState<LocalRow[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [gameFilter, setGameFilter] = useState<"all" | CasinoGameId>("all");
  const [displayName, setDisplayName] = useState("");
  const [showLb, setShowLb] = useState(true);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [cloudRows, setCloudRows] = useState<DashboardSessionRow[]>([]);
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "wins" | "losses">("all");
  const [period, setPeriod] = useState<"all" | "7d" | "30d">("all");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setLocalRows(JSON.parse(raw) as LocalRow[]);
    } catch {
      /* ignore */
    }
    fetchPublicBetFeed(40).then(setFeed);
    const unsubFeed = subscribePublicBetFeed({
      onInsert: (row) => {
        setFeed((prev) => {
          if (prev.some((r) => r.session_id === row.session_id)) return prev;
          return [row, ...prev].slice(0, 40);
        });
      },
    });
    fetchOwnProfile().then((p) => {
      if (p) {
        setDisplayName(p.displayName);
        setShowLb(p.showOnLeaderboard);
      }
    });
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user);
      if (data.user) fetchOwnDashboardSessions(100).then(setCloudRows);
    });
    return () => unsubFeed();
  }, []);

  const mergedRows = useMemo(() => {
    type Row = {
      game: string;
      at: string;
      stakeUnits: string;
      pnlUnits: string;
      session: unknown;
      origin: string;
      sessionId?: string;
    };
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const r of localRows.slice().reverse()) {
      const sid =
        r.session && typeof r.session === "object" && "id" in r.session
          ? String((r.session as { id?: string }).id ?? "")
          : "";
      const key = sid || `${r.game}@${r.at}`;
      seen.add(key);
      out.push({
        game: r.game,
        at: r.at,
        stakeUnits: r.stakeUnits,
        pnlUnits: r.pnlUnits,
        session: r.session,
        origin: "local",
        sessionId: sid || undefined,
      });
    }
    for (const c of cloudRows) {
      const key = c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        game: c.game_id,
        at: c.updated_at,
        stakeUnits: c.stake,
        pnlUnits: c.pnl,
        session: { gameId: c.game_id, state: c.state, result: c.result },
        origin: "cloud",
        sessionId: c.id,
      });
    }
    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [localRows, cloudRows]);

  const myFiltered = useMemo(() => {
    let r = mergedRows;
    if (gameFilter !== "all") r = r.filter((x) => x.game === gameFilter);
    if (period !== "all") {
      const ms = period === "7d" ? 7 * 864e5 : 30 * 864e5;
      const cutoff = Date.now() - ms;
      r = r.filter((x) => new Date(x.at).getTime() >= cutoff);
    }
    if (outcomeFilter === "wins") r = r.filter((x) => BigInt(x.pnlUnits) > 0n);
    if (outcomeFilter === "losses") r = r.filter((x) => BigInt(x.pnlUnits) < 0n);
    return r.slice(0, 80);
  }, [mergedRows, gameFilter, period, outcomeFilter]);

  const stats = useMemo(() => {
    let wagered = 0n;
    let pnl = 0n;
    let wins = 0;
    for (const r of myFiltered) {
      wagered += BigInt(r.stakeUnits);
      const p = BigInt(r.pnlUnits);
      pnl += p;
      if (p > 0n) wins++;
    }
    return { wagered, pnl, wins, count: myFiltered.length };
  }, [myFiltered]);

  const saveProfile = async () => {
    const res = await upsertCasinoProfile({
      displayName: displayName.trim(),
      showOnLeaderboard: showLb,
    });
    setProfileMsg(res.ok ? "Profile saved." : res.error ?? "Could not save.");
  };

  return (
    <CasinoShell
      badge="Private suite"
      title="Player dashboard"
      subtitle="Your sessions, filters, and the live bet feed."
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className={card + " p-5 lg:col-span-2 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={sectionTitle}>Your recent play</h2>
            <div className="flex flex-wrap gap-1.5 items-center">
              <CasinoFilterPill active={period === "all"} label="All time" onClick={() => setPeriod("all")} />
              <CasinoFilterPill active={period === "7d"} label="7 days" onClick={() => setPeriod("7d")} />
              <CasinoFilterPill active={period === "30d"} label="30 days" onClick={() => setPeriod("30d")} />
              <span className="w-px h-6 bg-white/10 mx-0.5 hidden sm:block" />
              <CasinoFilterPill active={outcomeFilter === "all"} label="All outcomes" onClick={() => setOutcomeFilter("all")} />
              <CasinoFilterPill active={outcomeFilter === "wins"} label="Wins" onClick={() => setOutcomeFilter("wins")} />
              <CasinoFilterPill active={outcomeFilter === "losses"} label="Losses" onClick={() => setOutcomeFilter("losses")} />
              <span className="w-px h-6 bg-white/10 mx-0.5 hidden sm:block" />
              <CasinoFilterPill active={gameFilter === "all"} label="All games" onClick={() => setGameFilter("all")} />
              {ALL_GAMES.map((g) => (
                <CasinoFilterPill
                  key={g}
                  active={gameFilter === g}
                  label={GAME_LABELS[g]}
                  onClick={() => setGameFilter(g)}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricStat label="Sessions" value={String(stats.count)} variant="panel" />
            <MetricStat
              label="Win rate"
              value={stats.count ? `${((stats.wins / stats.count) * 100).toFixed(0)}%` : "—"}
              variant="panel"
            />
            <MetricStat label="Wagered" value={fmtMoney(stats.wagered, DASHBOARD_TOKEN, 2)} variant="panel" />
            <MetricStat
              label="Net PnL"
              value={fmtPnl(stats.pnl, DASHBOARD_TOKEN, 2)}
              accent={stats.pnl >= 0n ? "emerald" : "rose"}
              variant="panel"
            />
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {myFiltered.length === 0 ? (
              <p className="text-sm text-white/45 py-6 text-center">
                No sessions yet — play on the lobby{authed ? " (cloud sync fills when hands settle)" : ""}.
              </p>
            ) : (
              myFiltered.map((r) => {
                const pnl = BigInt(r.pnlUnits);
                return (
                  <div
                    key={`${r.game}-${r.at}-${r.origin}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                  >
                    <div>
                      <div className="text-sm font-medium text-white/90">
                        {GAME_LABELS[r.game as CasinoGameId] ?? r.game}
                      </div>
                      <div className="text-[11px] text-white/40">
                        {new Date(r.at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={"text-sm font-mono " + (pnl >= 0n ? "text-emerald-300" : "text-rose-300")}>
                        {fmtPnl(pnl, DASHBOARD_TOKEN, 2)}
                      </div>
                      {r.origin === "cloud" && r.sessionId ? (
                        <HistoryVerifyLink sessionId={r.sessionId} />
                      ) : (
                        <Link
                          href={buildVerifyLink(r.session)}
                          className="text-[10px] text-amber-300/80 hover:text-amber-200"
                        >
                          Verify →
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/casino/history" className="text-amber-300 hover:text-amber-200">
              Full activity log →
            </Link>
            <Link href="/casino/history?view=global" className="text-amber-300 hover:text-amber-200">
              Global feed →
            </Link>
          </div>
        </section>

        <aside className="space-y-6">
          <section className={card + " p-5 space-y-4"}>
            <h2 className="text-lg font-semibold text-white">Profile</h2>
            {!authed && (
              <p className="text-xs text-white/45">Sign in to sync profile and appear on leaderboards.</p>
            )}
            <div>
              <label className={labelCls}>Display name</label>
              <input
                className={inputCls}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="High roller"
                maxLength={24}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={showLb}
                onChange={(e) => setShowLb(e.target.checked)}
                className="rounded border-white/20"
              />
              Show me on public leaderboards
            </label>
            <button type="button" className={btnPrimary + " w-full"} onClick={saveProfile}>
              Save profile
            </button>
            {profileMsg && <p className="text-xs text-white/50">{profileMsg}</p>}
          </section>

          <section className={card + " p-5"}>
            <h2 className="text-lg font-semibold text-white mb-3">Live house feed</h2>
            <p className="text-xs text-white/45 mb-3">Latest settled bets across the house (all games).</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {feed.length === 0 ? (
                <p className="text-xs text-white/40">Feed empty — play with cloud sync to populate.</p>
              ) : (
                feed.map((f) => (
                  <div key={f.session_id} className="flex justify-between gap-2 text-xs border-b border-white/[0.05] pb-2">
                    <span className="text-white/70 truncate">
                      {f.display_label} · {GAME_LABELS[f.game_id as CasinoGameId] ?? f.game_id}
                    </span>
                    <span className={Number(f.pnl) >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {(Number(f.pnl) / 1e6).toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </CasinoShell>
  );
}
