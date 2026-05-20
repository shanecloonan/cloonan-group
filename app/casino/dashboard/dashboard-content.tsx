"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { CasinoShell } from "../casino-shell";
import {
  ALL_GAMES,
  card,
  btnPrimary,
  btnGhost,
  GAME_LABELS,
  inputCls,
  labelCls,
  tableHeader,
  type CasinoGameId,
} from "../casino-ui";
import {
  fetchOwnProfile,
  fetchPublicBetFeed,
  upsertCasinoProfile,
  type FeedRow,
} from "@/lib/casino/leaderboard";
import { buildVerifyLink } from "../share-link";

const HISTORY_KEY = "mf_casino_history_v1";

type LocalRow = {
  game: string;
  at: string;
  stakeUnits: string;
  pnlUnits: string;
  multiplier: number;
  session: unknown;
};

function fmt(units: bigint, decimals = 6, symbol = "DEV"): string {
  const denom = 10n ** BigInt(decimals);
  const sign = units < 0n ? "-" : units > 0n ? "+" : "";
  const abs = units < 0n ? -units : units;
  const w = abs / denom;
  const f = (abs % denom).toString().padStart(decimals, "0");
  return `${sign}${Number(`${w}.${f}`).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
}

export default function DashboardContent() {
  const [localRows, setLocalRows] = useState<LocalRow[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [gameFilter, setGameFilter] = useState<"all" | CasinoGameId>("all");
  const [displayName, setDisplayName] = useState("");
  const [showLb, setShowLb] = useState(true);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setLocalRows(JSON.parse(raw) as LocalRow[]);
    } catch {
      /* ignore */
    }
    fetchPublicBetFeed(40).then(setFeed);
    fetchOwnProfile().then((p) => {
      if (p) {
        setDisplayName(p.displayName);
        setShowLb(p.showOnLeaderboard);
      }
    });
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  const myFiltered = useMemo(() => {
    let r = localRows.slice().reverse();
    if (gameFilter !== "all") r = r.filter((x) => x.game === gameFilter);
    return r.slice(0, 50);
  }, [localRows, gameFilter]);

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
      subtitle="Filter your session log, tune leaderboard visibility, and watch the house feed in real time."
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className={card + " p-5 lg:col-span-2 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Your recent play</h2>
            <div className="flex flex-wrap gap-1">
              <FilterChip active={gameFilter === "all"} label="All" onClick={() => setGameFilter("all")} />
              {ALL_GAMES.map((g) => (
                <FilterChip
                  key={g}
                  active={gameFilter === g}
                  label={GAME_LABELS[g]}
                  onClick={() => setGameFilter(g)}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniStat label="Sessions" value={String(stats.count)} />
            <MiniStat label="Win rate" value={stats.count ? `${((stats.wins / stats.count) * 100).toFixed(0)}%` : "—"} />
            <MiniStat label="Wagered" value={fmt(stats.wagered)} />
            <MiniStat
              label="Net PnL"
              value={fmt(stats.pnl)}
              accent={stats.pnl >= 0n ? "emerald" : "rose"}
            />
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {myFiltered.length === 0 ? (
              <p className="text-sm text-white/45 py-6 text-center">No local sessions yet — play a hand on the lobby.</p>
            ) : (
              myFiltered.map((r) => {
                const pnl = BigInt(r.pnlUnits);
                return (
                  <div
                    key={`${r.game}-${r.at}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                  >
                    <div>
                      <div className="text-sm font-medium text-white/90">
                        {GAME_LABELS[r.game as CasinoGameId] ?? r.game}
                      </div>
                      <div className="text-[11px] text-white/40">{new Date(r.at).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className={"text-sm font-mono " + (pnl >= 0n ? "text-emerald-300" : "text-rose-300")}>
                        {fmt(pnl)}
                      </div>
                      <Link
                        href={buildVerifyLink(r.session)}
                        className="text-[10px] text-amber-300/80 hover:text-amber-200"
                      >
                        Verify →
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <Link href="/casino/history" className="inline-block text-sm text-amber-300 hover:text-amber-200">
            Full history & export →
          </Link>
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
            <p className="text-xs text-white/45 mb-3">Latest settled bets from players who opted in.</p>
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

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "h-7 px-2.5 rounded-lg text-[11px] font-medium border cursor-pointer " +
        (active
          ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
          : "border-white/[0.08] text-white/50 hover:text-white/80")
      }
    >
      {label}
    </button>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "rose";
}) {
  return (
    <div className="rounded-xl bg-black/30 border border-white/[0.06] p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div
        className={
          "mt-1 font-mono text-sm font-semibold " +
          (accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white")
        }
      >
        {value}
      </div>
    </div>
  );
}
