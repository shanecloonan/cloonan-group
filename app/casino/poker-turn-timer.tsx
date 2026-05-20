"use client";

import { useEffect, useState } from "react";

const TURN_MS = 45_000;

/** Countdown while it is your turn (uses room `updated_at` as turn start). */
export function PokerTurnTimer({ updatedAt, active }: { updatedAt: string; active: boolean }) {
  const [left, setLeft] = useState(TURN_MS);

  useEffect(() => {
    if (!active) return;
    const start = new Date(updatedAt).getTime();
    const tick = () => {
      const elapsed = Date.now() - start;
      setLeft(Math.max(0, TURN_MS - elapsed));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [updatedAt, active]);

  if (!active) return null;
  const sec = Math.ceil(left / 1000);
  const urgent = sec <= 10;
  return (
    <div
      className={
        "text-center text-xs font-mono tabular-nums " +
        (urgent ? "text-rose-300 animate-pulse" : "text-amber-200/70")
      }
    >
      {sec}s to act
    </div>
  );
}
