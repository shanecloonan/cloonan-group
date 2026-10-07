"use client";

import type { SalonBetRow, SalonTable } from "@/lib/casino/salon-tables";

export const SALON_CHIPS = [5, 25, 100, 500] as const;
export type SalonChip = (typeof SALON_CHIPS)[number];

export function spotStake(bets: SalonBetRow[], kind: string, n: number | null): number {
  return bets.reduce((sum, b) => (b.kind === kind && (b.n ?? null) === n ? sum + b.stake : sum), 0);
}

export function playerName(table: SalonTable, playerId: string): string {
  return table.seats.find((s) => s.playerId === playerId)?.name ?? "Guest";
}

export function Spot({
  label,
  sub,
  stake,
  mine,
  tone,
  disabled,
  tall,
  block,
  onClick,
}: {
  label: string;
  sub?: string;
  stake: number;
  mine: boolean;
  tone: "red" | "black" | "green" | "ivory" | "gold";
  disabled: boolean;
  tall?: boolean;
  block?: boolean;
  onClick: () => void;
}) {
  const toneCls =
    tone === "red"
      ? "bg-[#6e2424]/80 text-[#f8e8e4] border-[#c48a80]/40"
      : tone === "black"
        ? "bg-[#141210] text-[#f6f1e7] border-white/15"
        : tone === "green"
          ? "bg-[#0f3d2a] text-[#e7f6ee] border-[#7dcea0]/30"
          : tone === "gold"
            ? "bg-[#3a2e14] text-[#f6ecd4] border-[#e8d5a3]/40"
            : "bg-black/30 text-[#f6f1e7] border-[#c6a15b]/25";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "rounded-lg border px-2 py-2 text-center cursor-pointer disabled:cursor-default disabled:opacity-80 " +
        (block ? "w-full " : "") +
        (tall ? "min-h-16 " : "min-h-11 ") +
        toneCls +
        (mine ? " ring-1 ring-[#f3e6c4]" : "")
      }
    >
      <span className="block font-heading text-sm leading-none">{label}</span>
      {sub && <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] opacity-70">{sub}</span>}
      {stake > 0 && (
        <span className="mt-1 inline-flex rounded-full bg-[#f3e6c4] px-1.5 text-[10px] font-mono leading-4 text-[#1c1508]">
          {stake}
        </span>
      )}
    </button>
  );
}

/** Small ivory-on-black roster used by the sealed games. */
export function SealedRoster({ table, verb }: { table: SalonTable; verb: string }) {
  if (table.bets.length === 0) {
    return <p className="text-center text-xs text-[#f6f1e7]/45">Nobody has {verb} yet.</p>;
  }
  return (
    <ul className="flex flex-wrap justify-center gap-1.5">
      {table.bets.map((b, i) => (
        <li
          key={i}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#c6a15b]/25 bg-black/30 px-2.5 py-1 text-xs text-[#f6f1e7]/80"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#e8d5a3]" />
          {playerName(table, b.playerId)}
          <span className="font-mono text-[#e8d5a3]/80">{b.stake}</span>
        </li>
      ))}
    </ul>
  );
}
