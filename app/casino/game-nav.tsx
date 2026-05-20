"use client";

import { ALL_GAMES, GAME_LABELS, type CasinoGameId } from "./casino-ui";

export type GameTab = "lobby" | CasinoGameId | "fairness" | "roadmap";

const EXTRA: { id: GameTab; label: string }[] = [
  { id: "lobby", label: "Lobby" },
  { id: "fairness", label: "Fairness" },
  { id: "roadmap", label: "Roadmap" },
];

export function GameNav({ tab, setTab }: { tab: GameTab; setTab: (t: GameTab) => void }) {
  return (
    <div className="sticky top-14 sm:top-16 z-30 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 border-b border-white/[0.06] bg-[#06070c]/95 backdrop-blur-xl">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/10">
        {EXTRA.map((t) => (
          <NavPill key={t.id} active={tab === t.id} label={t.label} onClick={() => setTab(t.id)} />
        ))}
        <span className="w-px h-8 bg-white/10 shrink-0 self-center mx-1" />
        {ALL_GAMES.map((g) => (
          <NavPill
            key={g}
            active={tab === g}
            label={GAME_LABELS[g]}
            onClick={() => setTab(g)}
            live
          />
        ))}
      </div>
    </div>
  );
}

function NavPill({
  label,
  active,
  onClick,
  live,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  live?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "shrink-0 h-9 px-4 rounded-xl text-sm font-medium border transition-all cursor-pointer " +
        (active
          ? "border-amber-400/50 bg-amber-500/15 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.12)]"
          : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:border-white/20")
      }
    >
      {live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2 animate-pulse" />}
      {label}
    </button>
  );
}
