"use client";

import { cardLabel, type PokerState, type TokenSpec } from "@/lib/casino";
import { pillGold } from "./casino-ui";
import { fmtMoney } from "./table-kit";

const SEAT_POS = [
  "bottom-2 left-1/2 -translate-x-1/2",
  "bottom-[22%] right-2 sm:right-4",
  "top-1/2 right-1 -translate-y-1/2",
  "top-6 right-[18%] sm:right-[22%]",
  "top-6 left-[18%] sm:left-[22%]",
  "bottom-[22%] left-2 sm:left-4",
];

export function PokerOvalTable({
  state,
  token,
  mySeat,
  potLabel,
  phaseLabel,
}: {
  state: PokerState;
  token: TokenSpec;
  mySeat?: number | null;
  potLabel?: string;
  phaseLabel?: string;
}) {
  return (
    <div className="relative min-h-[min(72vw,420px)] sm:min-h-[480px] w-full">
      <div className="absolute inset-2 sm:inset-4 rounded-[50%] border-2 border-emerald-800/50 bg-gradient-to-b from-emerald-950/90 via-[#07110e] to-[#06070c] shadow-[inset_0_0_100px_rgba(16,185,129,0.18)]" />

      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
        <span className={pillGold + " text-[9px]"}>{phaseLabel ?? state.phase}</span>
        <span className="font-mono text-sm text-amber-200/90">
          Pot {potLabel ?? fmtMoney(state.pot, token, 1)}
        </span>
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap justify-center gap-1.5 sm:gap-2 z-10 max-w-[90%]">
        {state.community.length > 0 ? (
          state.community.map((c, i) => <CardFace key={i} card={c} small />)
        ) : (
          <span className="text-white/20 text-[10px] uppercase tracking-[0.2em]">Community</span>
        )}
      </div>

      {state.players.map((p, i) => {
        const isMe = mySeat !== undefined && mySeat !== null && p.seat === mySeat;
        const reveal = isMe || state.phase === "complete" || state.phase === "showdown";
        return (
          <div key={p.seat} className={"absolute z-10 " + SEAT_POS[i]}>
            <SeatChip
              player={p}
              token={token}
              active={state.activeSeat === p.seat}
              reveal={reveal}
            />
          </div>
        );
      })}
    </div>
  );
}

function CardFace({ card, small }: { card: { rank: string; suit: string }; small?: boolean }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      className={
        (small ? "w-9 h-12 sm:w-11 sm:h-16 text-xs" : "w-11 h-16 sm:w-14 sm:h-20") +
        " rounded-lg border flex flex-col items-center justify-center font-bold shadow-lg " +
        (red ? "bg-rose-950/80 border-rose-500/40 text-rose-100" : "bg-slate-900/90 border-white/20 text-white")
      }
    >
      <span>{card.rank}</span>
      <span className="text-base sm:text-xl">{card.suit}</span>
    </div>
  );
}

function SeatChip({
  player,
  token,
  active,
  reveal,
}: {
  player: PokerState["players"][0];
  token: TokenSpec;
  active: boolean;
  reveal: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 min-w-[88px] sm:min-w-[100px] border text-center transition-all " +
        (active
          ? "border-amber-400/70 bg-amber-500/20 shadow-[0_0_28px_rgba(245,158,11,0.25)] scale-105"
          : "border-white/10 bg-black/60 backdrop-blur-sm")
      }
    >
      <div className="text-[10px] sm:text-[11px] font-semibold text-white/95 truncate max-w-[90px]">
        {player.name}
        {player.isHuman ? " · you" : ""}
      </div>
      <div className="text-[10px] font-mono text-emerald-300/95">
        {fmtMoney(player.stack, token, 1)}
      </div>
      {player.folded && <div className="text-[9px] text-rose-300/90">Folded</div>}
      {reveal && player.hole.length === 2 && (
        <div className="flex gap-0.5 justify-center mt-1">
          {player.hole.map((c, i) => (
            <span key={i} className="text-[9px] font-mono bg-white/10 px-1 rounded">
              {cardLabel(c)}
            </span>
          ))}
        </div>
      )}
      {!reveal && !player.folded && (
        <div className="flex gap-0.5 justify-center mt-1">
          <span className="w-5 h-7 sm:w-6 sm:h-8 rounded bg-amber-900/50 border border-amber-600/40" />
          <span className="w-5 h-7 sm:w-6 sm:h-8 rounded bg-amber-900/50 border border-amber-600/40" />
        </div>
      )}
    </div>
  );
}
