"use client";

import Link from "next/link";
import { GAME_LABELS, type CasinoGameId } from "./casino-ui";
import { btnGhost } from "./casino-ui";

export function GamePlayHeader({
  gameId,
  onBack,
}: {
  gameId: CasinoGameId;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 py-3 mb-4 border-b border-white/[0.06]">
      <button
        type="button"
        onClick={onBack}
        className={btnGhost + " shrink-0 !h-10 !min-h-10 !px-3 text-sm"}
      >
        ← Games
      </button>
      <h2 className="flex-1 min-w-0 text-lg sm:text-xl font-semibold text-white truncate">
        {GAME_LABELS[gameId]}
      </h2>
      <Link
        href="/casino/docs"
        className="hidden sm:inline text-[11px] text-white/45 hover:text-amber-200/90 shrink-0"
      >
        Rules
      </Link>
    </div>
  );
}
