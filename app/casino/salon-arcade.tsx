"use client";

import { useEffect, useState } from "react";
import {
  DERBY_RETURN_TENTHS,
  DERBY_TICKS,
  NERVE_MAX_TARGET,
  NERVE_MIN_TARGET,
  type SalonDerbyResult,
  type SalonNerveResult,
  type SalonOddOneResult,
  type SalonTickerResult,
} from "@/lib/casino/salon-games";
import type { SalonTable } from "@/lib/casino/salon-tables";
import { btnGhost, btnGold, inputCls } from "./casino-ui";
import { playerName, SealedRoster, Spot, spotStake } from "./salon-kit";

/* ---------------------------------------------------------------------------
 *  The Derby
 * ------------------------------------------------------------------------- */

export const DERBY_HORSES = [
  { name: "Gilded Marquis", silk: "bg-[#e0c27a]" },
  { name: "Midnight Reserve", silk: "bg-[#2f3a6b]" },
  { name: "Velvet Ledger", silk: "bg-[#7a2a3a]" },
  { name: "Champagne Atelier", silk: "bg-[#f3e6c4]" },
  { name: "Quiet Croupier", silk: "bg-[#2d6b4a]" },
  { name: "Lacquer Box", silk: "bg-[#1a1512] ring-1 ring-[#c6a15b]/50" },
] as const;

export function horseName(n: number | null): string {
  if (n === null || n < 1 || n > DERBY_HORSES.length) return "Horse";
  return DERBY_HORSES[n - 1].name;
}

export function derbyOdds(n: number): string {
  return `${(DERBY_RETURN_TENTHS[n - 1] / 10).toFixed(1)}×`;
}

export function DerbyCloth({
  table,
  playerId,
  disabled,
  onBet,
}: {
  table: SalonTable;
  playerId: string;
  disabled: boolean;
  onBet: (kind: string, n: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      {DERBY_HORSES.map((h, i) => {
        const n = i + 1;
        const stake = spotStake(table.bets, "win", n);
        const mine = table.bets.some((b) => b.playerId === playerId && b.kind === "win" && b.n === n);
        return (
          <button
            key={h.name}
            type="button"
            disabled={disabled}
            onClick={() => onBet("win", n)}
            className={
              "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left cursor-pointer disabled:cursor-default disabled:opacity-80 " +
              "bg-black/30 border-[#c6a15b]/25 hover:border-[#e8d5a3]/50 transition-colors" +
              (mine ? " ring-1 ring-[#f3e6c4]" : "")
            }
          >
            <span className="font-mono text-[10px] text-[#c6a15b]">{n}</span>
            <span className={"h-3.5 w-3.5 shrink-0 rounded-full " + h.silk} />
            <span className="flex-1 font-heading text-sm text-[#f6f1e7]">{h.name}</span>
            {stake > 0 && (
              <span className="rounded-full bg-[#f3e6c4] px-1.5 text-[10px] font-mono leading-4 text-[#1c1508]">{stake}</span>
            )}
            <span className="w-12 text-right font-mono text-xs text-[#e8d5a3]">{derbyOdds(n)}</span>
          </button>
        );
      })}
      <p className="pt-1 text-center text-xs text-[#f6f1e7]/45">Win only. Odds are what the house pays, stake included.</p>
    </div>
  );
}

const TICK_MS = 320;

export function DerbyRace({ result, round }: { result: SalonDerbyResult; round: number }) {
  const [runKey, setRunKey] = useState(0);
  return <RaceAnimation key={`${round}:${runKey}`} result={result} onReplay={() => setRunKey((k) => k + 1)} />;
}

function RaceAnimation({ result, onReplay }: { result: SalonDerbyResult; onReplay: () => void }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((t) => {
        if (t >= DERBY_TICKS) {
          window.clearInterval(timer);
          return t;
        }
        return t + 1;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const finish = Math.max(...result.totals, 1);
  const done = tick >= DERBY_TICKS;
  const progress = DERBY_HORSES.map((_, h) => {
    let sum = 0;
    for (let t = 0; t < tick; t++) sum += result.ticks[t]?.[h] ?? 0;
    return sum;
  });
  const leader = progress.indexOf(Math.max(...progress));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#e8d5a3]/70">
          {done ? "Result" : `Furlong ${Math.min(tick + 1, DERBY_TICKS)} of ${DERBY_TICKS}`}
        </p>
        <button type="button" className={btnGhost + " !h-8 !px-3 !text-[10px]"} onClick={onReplay}>
          Watch again
        </button>
      </div>
      <div className="relative space-y-1.5 rounded-xl border border-[#c6a15b]/20 bg-black/25 p-3">
        <span className="pointer-events-none absolute inset-y-3 right-3 w-px bg-[repeating-linear-gradient(to_bottom,#f3e6c4_0_4px,transparent_4px_8px)] opacity-60" />
        {DERBY_HORSES.map((h, i) => {
          const pct = Math.min(100, (progress[i] / finish) * 100);
          const winner = done && result.winner === i + 1;
          return (
            <div key={h.name} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[11px] text-[#f6f1e7]/70 sm:w-32">{h.name}</span>
              <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className={
                    "absolute inset-y-0 left-0 rounded-full transition-[width] ease-linear " +
                    (winner ? "bg-gradient-to-r from-[#a7843c] to-[#f3e6c4]" : "bg-white/10")
                  }
                  style={{ width: `${pct}%`, transitionDuration: `${TICK_MS}ms` }}
                />
                <span
                  className={"absolute top-0.5 h-3 w-3 rounded-full transition-[left] ease-linear " + h.silk}
                  style={{ left: `calc(${pct}% - ${pct > 2 ? 12 : 0}px)`, transitionDuration: `${TICK_MS}ms` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[10px] text-[#e8d5a3]/70">
                {winner ? "WIN" : !done && leader === i && tick > 0 ? "lead" : ""}
              </span>
            </div>
          );
        })}
      </div>
      {done && (
        <p className="text-center text-[11px] uppercase tracking-[0.18em] text-[#e8d5a3]/85">
          {horseName(result.winner)} · pays {derbyOdds(result.winner)}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Nerve
 * ------------------------------------------------------------------------- */

export function formatMultiplier(cents: number | null): string {
  if (cents === null) return "Sealed";
  return `${(cents / 100).toFixed(2).replace(/\.?0+$/, "")}×`;
}

const NERVE_PRESETS = [150, 200, 300, 500, 1000, 2500, 5000];

export function NerveCloth({
  table,
  playerId,
  disabled,
  chip,
  onCommit,
}: {
  table: SalonTable;
  playerId: string;
  disabled: boolean;
  chip: number;
  onCommit: (kind: string, n: number) => void;
}) {
  const [custom, setCustom] = useState("");
  const mine = table.bets.find((b) => b.playerId === playerId);
  const parsed = Math.round(parseFloat(custom) * 100);
  const customOk = Number.isFinite(parsed) && parsed >= NERVE_MIN_TARGET && parsed <= NERVE_MAX_TARGET;

  return (
    <div className="space-y-3">
      <p className="text-center text-xs text-[#f6f1e7]/55">
        Name the multiplier you will cash out at. The bust is already committed. Hold under it and you are paid; name
        too much and the stake is gone.
      </p>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {NERVE_PRESETS.map((cents) => (
          <Spot
            key={cents}
            label={formatMultiplier(cents)}
            tone={cents >= 1000 ? "gold" : "ivory"}
            stake={0}
            mine={false}
            disabled={disabled}
            onClick={() => onCommit("nerve", cents)}
          />
        ))}
      </div>
      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
            Your own number · 1.10× to 50×
          </span>
          <input
            className={inputCls + " font-mono"}
            inputMode="decimal"
            placeholder="2.37"
            value={custom}
            disabled={disabled}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </label>
        <button
          type="button"
          className={btnGold}
          disabled={disabled || !customOk}
          onClick={() => onCommit("nerve", parsed)}
        >
          Seal {chip}
        </button>
      </div>
      <p className="text-center text-[11px] text-[#f6f1e7]/45">
        {mine
          ? `You sealed ${mine.stake} chips. Pick again to replace it before the reveal.`
          : `Each seal stakes the chip in hand (${chip}).`}
      </p>
      <SealedRoster table={table} verb="sealed a number" />
    </div>
  );
}

export function NerveReveal({ result, table }: { result: SalonNerveResult; table: SalonTable }) {
  return <NerveClimb key={`${table.round}:${result.bust}`} result={result} table={table} />;
}

function NerveClimb({ result, table }: { result: SalonNerveResult; table: SalonTable }) {
  const [shown, setShown] = useState(100);
  useEffect(() => {
    const start = performance.now();
    const span = Math.min(2600, 500 + result.bust / 2);
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / span);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(100 + (result.bust - 100) * eased));
      if (k < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [result.bust]);
  const done = shown >= result.bust;
  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[#e8d5a3]/70">{done ? "Bust at" : "Climbing"}</p>
        <p
          className={
            "font-heading text-5xl tabular-nums " + (done ? "text-[#e7b2aa]" : "text-[#f6f1e7]")
          }
        >
          {formatMultiplier(shown)}
        </p>
      </div>
      {done && (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {result.commits.map((c, i) => {
            const held = c.target !== null && c.target <= result.bust;
            return (
              <li
                key={i}
                className={
                  "flex items-center justify-between rounded-lg border px-3 py-2 text-sm " +
                  (held ? "border-[#e8d5a3]/50 bg-[#c6a15b]/10" : "border-white/10 bg-black/25")
                }
              >
                <span className="truncate text-[#f6f1e7]/85">{playerName(table, c.playerId)}</span>
                <span className="font-mono text-xs text-[#e8d5a3]">
                  {formatMultiplier(c.target)} · {held ? "held" : "too far"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Odd One Out
 * ------------------------------------------------------------------------- */

export function oddOneCarry(table: SalonTable): number {
  const c = table.meta.carry;
  const n = typeof c === "number" ? c : Number(c);
  return Number.isFinite(n) ? n : 0;
}

export function OddOneCloth({
  table,
  playerId,
  disabled,
  chip,
  onCommit,
}: {
  table: SalonTable;
  playerId: string;
  disabled: boolean;
  chip: number;
  onCommit: (kind: string, n: number) => void;
}) {
  const carry = oddOneCarry(table);
  const pot = carry + table.bets.reduce((s, b) => s + b.stake, 0);
  const mine = table.bets.find((b) => b.playerId === playerId);
  return (
    <div className="space-y-3">
      <p className="text-center text-xs text-[#f6f1e7]/55">
        Pick a number from one to ten. The lowest number that only one person chose takes the whole pot. If every
        number clashes, the pot carries to the next round.
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <Spot
            key={n}
            label={String(n)}
            tall
            tone="ivory"
            stake={0}
            mine={false}
            disabled={disabled}
            onClick={() => onCommit("pick", n)}
          />
        ))}
      </div>
      <div className="flex items-center justify-between rounded-lg border border-[#c6a15b]/20 bg-black/25 px-3 py-2 text-xs">
        <span className="text-[#f6f1e7]/60">
          Pot on the felt{carry > 0 ? ` · ${carry} carried in` : ""}
        </span>
        <span className="font-mono text-[#e8d5a3]">{pot}</span>
      </div>
      <p className="text-center text-[11px] text-[#f6f1e7]/45">
        {mine ? `You are in for ${mine.stake}. Pick again to change your number.` : `Each pick stakes the chip in hand (${chip}).`}
      </p>
      <SealedRoster table={table} verb="picked" />
    </div>
  );
}

export function OddOneReveal({ result, table }: { result: SalonOddOneResult; table: SalonTable }) {
  const byNumber = new Map<number, string[]>();
  for (const p of result.picks) {
    if (p.n === null) continue;
    const list = byNumber.get(p.n) ?? [];
    list.push(playerName(table, p.playerId));
    byNumber.set(p.n, list);
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const names = byNumber.get(n) ?? [];
          const win = result.number === n;
          const clash = names.length > 1;
          return (
            <div
              key={n}
              className={
                "min-h-16 rounded-lg border px-1.5 py-1.5 text-center " +
                (win
                  ? "border-[#e8d5a3] bg-gradient-to-b from-[#f3e6c4] to-[#a7843c] text-[#1c1508]"
                  : clash
                    ? "border-[#c48a80]/40 bg-[#6e2424]/40 text-[#f8e8e4]"
                    : names.length === 1
                      ? "border-[#c6a15b]/40 bg-black/30 text-[#f6f1e7]"
                      : "border-white/10 bg-black/20 text-[#f6f1e7]/35")
              }
            >
              <span className="block font-heading text-sm leading-none">{n}</span>
              <span className="mt-1 block text-[9px] leading-tight">
                {names.length === 0 ? "—" : names.map((nm) => nm.split(" ")[0]).join(", ")}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[11px] uppercase tracking-[0.18em] text-[#e8d5a3]/85">
        {result.winner
          ? `${playerName(table, result.winner)} takes ${result.pot} with the ${result.number}`
          : `No unique number. ${result.carry} carries to the next round.`}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Ticker
 * ------------------------------------------------------------------------- */

export const TICKER_WINDOW_MS = 60_000;

export function formatPrice(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function tickerClosesAt(table: SalonTable): number | null {
  if (table.phase !== "locked") return null;
  const raw = table.meta.lockedAt;
  const t = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t + TICKER_WINDOW_MS : null;
}

/** Seconds left on the Ticker window, or null when the table is not locked. */
export function useTickerCountdown(table: SalonTable): number | null {
  const closesAt = tickerClosesAt(table);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (closesAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [closesAt]);
  if (closesAt === null) return null;
  return Math.max(0, Math.ceil((closesAt - now) / 1000));
}

function pools(table: SalonTable): { up: number; down: number } {
  return {
    up: spotStake(table.bets, "up", null),
    down: spotStake(table.bets, "down", null),
  };
}

function impliedReturn(win: number, lose: number): string {
  if (win === 0) return "—";
  return `${(1 + lose / win).toFixed(2)}×`;
}

export function TickerCloth({
  table,
  playerId,
  disabled,
  onBet,
}: {
  table: SalonTable;
  playerId: string;
  disabled: boolean;
  onBet: (kind: string, n: number | null) => void;
}) {
  const { up, down } = pools(table);
  const mineUp = table.bets.some((b) => b.playerId === playerId && b.kind === "up");
  const mineDown = table.bets.some((b) => b.playerId === playerId && b.kind === "down");
  return (
    <div className="space-y-3">
      <p className="text-center text-xs text-[#f6f1e7]/55">
        Bitcoin against the dollar, Coinbase spot. Lock the window, wait sixty seconds, settle. The losing side pays
        the winning side in proportion. A flat print pushes.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Spot
          label="Up"
          sub={`pool ${up} · ${impliedReturn(up, down)}`}
          tall
          tone="green"
          stake={up}
          mine={mineUp}
          disabled={disabled || mineDown}
          onClick={() => onBet("up", null)}
        />
        <Spot
          label="Down"
          sub={`pool ${down} · ${impliedReturn(down, up)}`}
          tall
          tone="red"
          stake={down}
          mine={mineDown}
          disabled={disabled || mineUp}
          onClick={() => onBet("down", null)}
        />
      </div>
      <p className="text-center text-[11px] text-[#f6f1e7]/45">One side per seat. Add to it as often as you like.</p>
    </div>
  );
}

export function TickerLocked({ table }: { table: SalonTable }) {
  const left = useTickerCountdown(table);
  const open = table.meta.open;
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-[0.28em] text-[#e8d5a3]/70">Opened at</p>
      <p className="font-heading text-3xl tabular-nums text-[#f6f1e7]">
        ${typeof open === "string" || typeof open === "number" ? formatPrice(open) : "—"}
      </p>
      <p className="mt-1 font-mono text-xs text-[#e8d5a3]/80">
        {left === null ? "" : left > 0 ? `window closes in ${left}s` : "window closed · settle when ready"}
      </p>
    </div>
  );
}

export function TickerReveal({ result }: { result: SalonTickerResult }) {
  const tone =
    result.direction === "up"
      ? "text-[#9fe0b8]"
      : result.direction === "down"
        ? "text-[#e7b2aa]"
        : "text-[#f6f1e7]";
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#f6f1e7]/45">Open</p>
        <p className="font-heading text-xl tabular-nums text-[#f6f1e7]">${formatPrice(result.open)}</p>
      </div>
      <p className={"font-heading text-3xl " + tone}>
        {result.direction === "up" ? "↗" : result.direction === "down" ? "↘" : "→"}
      </p>
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#f6f1e7]/45">Close</p>
        <p className={"font-heading text-xl tabular-nums " + tone}>${formatPrice(result.close)}</p>
      </div>
      <p className="col-span-3 text-[11px] uppercase tracking-[0.18em] text-[#e8d5a3]/85">
        {result.direction === "flat" ? "Flat · all stakes returned" : `${result.direction} · ${diffLabel(result)}`}
      </p>
    </div>
  );
}

function diffLabel(r: SalonTickerResult): string {
  const d = Number(r.close) - Number(r.open);
  if (!Number.isFinite(d)) return "";
  return `${d > 0 ? "+" : ""}${d.toFixed(2)}`;
}
