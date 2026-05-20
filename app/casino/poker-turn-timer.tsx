"use client";

import { useEffect, useRef, useState } from "react";
import { POKER_TURN_MS } from "@/lib/casino/poker-constants";

/** Countdown while it is your turn (uses room `updated_at` as turn start). */
export function PokerTurnTimer({
  updatedAt,
  active,
  onExpired,
}: {
  updatedAt: string;
  active: boolean;
  onExpired?: () => void;
}) {
  const [left, setLeft] = useState(POKER_TURN_MS);
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
  }, [updatedAt, active]);

  useEffect(() => {
    if (!active) return;
    const start = new Date(updatedAt).getTime();
    const tick = () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, POKER_TURN_MS - elapsed);
      setLeft(remaining);
      if (remaining === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpired?.();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [updatedAt, active, onExpired]);

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
