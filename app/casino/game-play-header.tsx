"use client";

import Link from "next/link";
import { useCasino } from "./casino-context";
import { GAME_LABELS, btnGhost, type CasinoGameId } from "./casino-ui";
import { fmtMoney } from "./table-kit";

export function GamePlayHeader({
  gameId,
  onBack,
}: {
  gameId: CasinoGameId;
  onBack: () => void;
}) {
  const { balance, token, playMoney } = useCasino();

  return (
    <div className="flex items-center gap-2 sm:gap-3 py-2 sm:py-3 mb-2 sm:mb-4 border-b border-white/[0.06]">
      <button
        type="button"
        onClick={onBack}
        className={btnGhost + " shrink-0 !h-10 !min-h-10 !px-3 text-sm"}
      >
        ← Games
      </button>
      <h2 className="flex-1 min-w-0 text-base sm:text-xl font-semibold text-white truncate">
        {GAME_LABELS[gameId]}
      </h2>
      {!playMoney.enabled && (
        <span className="text-[10px] sm:text-xs font-mono text-emerald-300/90 tabular-nums shrink-0 max-w-[6rem] sm:max-w-none truncate text-right">
          {fmtMoney(balance.available, token, 2)}
        </span>
      )}
      <Link
        href="/casino/docs"
        className="text-[11px] text-white/45 hover:text-amber-200/90 shrink-0 px-2 py-1"
      >
        Rules
      </Link>
    </div>
  );
}
