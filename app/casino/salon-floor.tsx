"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cardFromIndex } from "@/lib/casino/deck";
import { hashServerSeed } from "@/lib/casino/rng";
import {
  oddOneChecksOut,
  RED_POCKETS,
  salonCoupChecksOut,
  type SalonBaccaratResult,
  type SalonDerbyResult,
  type SalonGame,
  type SalonNerveResult,
  type SalonOddOneResult,
  type SalonPayout,
  type SalonRouletteResult,
  type SalonSicBoResult,
  type SalonTickerResult,
} from "@/lib/casino/salon-games";
import {
  betSalon,
  commitSalon,
  fetchSalon,
  fetchSalonByCode,
  joinSalon,
  leaveSalon,
  listSalonTables,
  nextSalon,
  openSalonTable,
  rebuySalon,
  salonMigrationMissing,
  spinSalon,
  subscribeSalonTable,
  type SalonTable,
} from "@/lib/casino/salon-tables";
import { useCasino } from "./casino-context";
import { btnGhost, btnGold, btnSecondary, card, felt, inputCls } from "./casino-ui";
import {
  DerbyCloth,
  DerbyRace,
  formatMultiplier,
  horseName,
  NerveCloth,
  NerveReveal,
  OddOneCloth,
  OddOneReveal,
  TickerCloth,
  TickerLocked,
  TickerReveal,
  useTickerCountdown,
} from "./salon-arcade";
import { playerName, SALON_CHIPS, Spot, spotStake, type SalonChip } from "./salon-kit";
import { DiceRow, PlayingCard } from "./table-kit";

type Plaque = { id: SalonGame; mark: string; title: string; line: string };

const CLASSICS: Plaque[] = [
  { id: "roulette", mark: "RL", title: "Roulette", line: "Single zero. Outside bets and straight numbers, paid together." },
  { id: "baccarat", mark: "BA", title: "Baccarat", line: "Punto banco. Player, banker, or the tie. One shoe for the table." },
  { id: "sicbo", mark: "SB", title: "Sic Bo", line: "Three dice. Triples lose big, small, odd, and even." },
];

const ORIGINALS: Plaque[] = [
  { id: "derby", mark: "DB", title: "The Derby", line: "Six horses, twelve furlongs, one race drawn from the seed. Back a winner." },
  { id: "nerve", mark: "NV", title: "Nerve", line: "Seal the multiplier you will cash out at. One bust for the whole table." },
  { id: "oddone", mark: "OO", title: "Odd One Out", line: "Pick one to ten in secret. The lowest number nobody else chose takes the pot." },
  { id: "ticker", mark: "TK", title: "Ticker", line: "Bitcoin up or down over sixty seconds, settled on the Coinbase print." },
];

const GAME_TITLE: Record<SalonGame, string> = {
  roulette: "Roulette",
  baccarat: "Baccarat",
  sicbo: "Sic Bo",
  derby: "The Derby",
  nerve: "Nerve",
  oddone: "Odd One Out",
  ticker: "Ticker",
};

const SEAT_OPTIONS = [4, 6, 8] as const;

function formatSpot(kind: string, n: number | null): string {
  if (kind === "straight" && n !== null) return `Straight ${n}`;
  if (kind === "dozen1") return "1st 12";
  if (kind === "dozen2") return "2nd 12";
  if (kind === "dozen3") return "3rd 12";
  if (kind === "any_triple") return "Any triple";
  if (kind === "low") return "1–18";
  if (kind === "high") return "19–36";
  if (kind === "win") return horseName(n);
  if (kind === "nerve") return n === null ? "Sealed" : `Cash out ${formatMultiplier(n)}`;
  if (kind === "pick") return n === null ? "Sealed" : `Pick ${n}`;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function phaseLabel(table: SalonTable): string {
  if (table.phase === "locked") return "Window open";
  if (table.phase === "resolved") return table.game === "derby" ? "Race run" : "Coup showing";
  return table.game === "nerve" || table.game === "oddone" ? "Sealing" : "Betting";
}

export default function SalonFloor({ initialGame }: { initialGame?: SalonGame }) {
  const { userId, playMoney } = useCasino();
  const ready = userId !== "guest-loading" && userId.length > 0;
  const name = playMoney.displayName || "Guest";
  const [tables, setTables] = useState<SalonTable[]>([]);
  const [active, setActive] = useState<SalonTable | null>(null);
  const [game, setGame] = useState<SalonGame>(initialGame ?? "roulette");
  const [seatsWanted, setSeatsWanted] = useState<(typeof SEAT_OPTIONS)[number]>(6);
  const [code, setCode] = useState("");
  const [chip, setChip] = useState<SalonChip>(25);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (initialGame) setGame(initialGame);
  }, [initialGame]);

  const noteError = useCallback((message: string | undefined) => {
    if (!message) return;
    if (salonMigrationMissing(message)) {
      setMissing(true);
      setError("The salon migrations have not been applied to this Supabase project yet.");
      return;
    }
    setError(message.replace(/^ERROR:\s*/i, ""));
  }, []);

  const refreshList = useCallback(async () => {
    const res = await listSalonTables();
    if (res.error) {
      noteError(res.error);
      return;
    }
    setTables(res.tables);
  }, [noteError]);

  const tableId = active?.id ?? null;

  useEffect(() => {
    let stop = false;
    void (async () => {
      await refreshList();
      if (!stop) setBooting(false);
    })();
    return () => {
      stop = true;
    };
  }, [refreshList]);

  useEffect(() => {
    if (tableId) return;
    const timer = window.setInterval(() => {
      void refreshList();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [tableId, refreshList]);

  useEffect(() => {
    if (!tableId) return;
    const unsub = subscribeSalonTable(tableId, (row) => setActive(row));
    const timer = window.setInterval(() => {
      void fetchSalon(tableId).then((res) => {
        if (res.error) noteError(res.error);
        else if (res.table) setActive(res.table);
      });
    }, 2000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [tableId, noteError]);

  async function run(work: () => Promise<{ table: SalonTable | null; error?: string }>, leave = false) {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await work();
      if (res.error) {
        noteError(res.error);
        return;
      }
      if (leave) {
        setActive(null);
        await refreshList();
        return;
      }
      if (res.table) setActive(res.table);
    } finally {
      setBusy(false);
    }
  }

  const me = active?.seats.find((s) => s.playerId === userId) ?? null;
  const seated = !!me;


  return (
    <div className="space-y-4">
      {missing && (
        <div className={card + " p-4 text-sm text-[#f6ecd4]/80 leading-relaxed"}>
          Apply <span className="font-mono text-[#e8d5a3]">infra/supabase/migrations/2026-10-07-casino-salon-tables.sql</span>{" "}
          and then <span className="font-mono text-[#e8d5a3]">2026-10-07-casino-salon-arcade.sql</span> on the Supabase
          project, then open a table. The floor will not invent a local coup.
        </div>
      )}
      {!active ? (
        <SalonLobby
          booting={booting}
          missing={missing}
          tables={tables}
          game={game}
          seats={seatsWanted}
          code={code}
          busy={busy || !ready}
          error={error}
          onGame={setGame}
          onSeats={setSeatsWanted}
          onCode={setCode}
          onCreate={() => void run(() => openSalonTable({ game, playerId: userId, name, maxSeats: seatsWanted }))}
          onJoinCode={() =>
            void (async () => {
              if (!ready) return;
              setBusy(true);
              setError(null);
              const found = await fetchSalonByCode(code);
              if (found.error || !found.table) {
                noteError(found.error ?? "No table with that code.");
                setBusy(false);
                return;
              }
              setBusy(false);
              await run(() => joinSalon(found.table!.id, userId, name));
            })()
          }
          onJoin={(table) => {
            setActive(table);
            setError(null);
            if (table.seats.some((s) => s.playerId === userId)) return;
            if (table.seats.length >= table.max_seats) {
              setError("This table is full. You may watch the coup.");
              return;
            }
            void run(() => joinSalon(table.id, userId, name));
          }}
        />
      ) : (
        <SalonTableView
          table={active}
          playerId={userId}
          seated={seated}
          stack={me?.stack ?? 0}
          chip={chip}
          busy={busy || !ready}
          error={error}
          onChip={setChip}
          onBet={(kind, n) => void run(() => betSalon(active.id, userId, kind, chip, n))}
          onCommit={(kind, n) => void run(() => commitSalon(active.id, userId, kind, chip, n))}
          onSpin={() => void run(() => spinSalon(active.id, userId))}
          onNext={() => void run(() => nextSalon(active.id, userId))}
          onRebuy={() => void run(() => rebuySalon(active.id, userId))}
          onLeave={() => {
            if (!seated) {
              setActive(null);
              setError(null);
              return;
            }
            void run(() => leaveSalon(active.id, userId), true);
          }}
          onSit={() => void run(() => joinSalon(active.id, userId, name))}
        />
      )}
    </div>
  );
}

function PlaqueGrid({ items, game, cols, onGame }: { items: Plaque[]; game: SalonGame; cols: string; onGame: (g: SalonGame) => void }) {
  return (
    <div className={"grid gap-3 " + cols}>
      {items.map((g) => {
        const on = g.id === game;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onGame(g.id)}
            className={
              "rounded-xl border p-4 text-left transition-all cursor-pointer " +
              (on
                ? "border-[#e8d5a3]/70 bg-[#c6a15b]/15 shadow-[inset_0_1px_0_rgba(255,236,196,0.25)]"
                : "border-[#c6a15b]/20 bg-black/20 hover:border-[#c6a15b]/45")
            }
          >
            <span className="text-[10px] tracking-[0.28em] text-[#c6a15b]">{g.mark}</span>
            <span className="mt-2 block font-heading text-lg text-[#f6f1e7]">{g.title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-[#f6f1e7]/55">{g.line}</span>
          </button>
        );
      })}
    </div>
  );
}

function SalonLobby({
  booting,
  missing,
  tables,
  game,
  seats,
  code,
  busy,
  error,
  onGame,
  onSeats,
  onCode,
  onCreate,
  onJoinCode,
  onJoin,
}: {
  booting: boolean;
  missing: boolean;
  tables: SalonTable[];
  game: SalonGame;
  seats: (typeof SEAT_OPTIONS)[number];
  code: string;
  busy: boolean;
  error: string | null;
  onGame: (g: SalonGame) => void;
  onSeats: (s: (typeof SEAT_OPTIONS)[number]) => void;
  onCode: (c: string) => void;
  onCreate: () => void;
  onJoinCode: () => void;
  onJoin: (t: SalonTable) => void;
}) {
  return (
    <div className="space-y-4">
      <div className={felt + " p-5 sm:p-7"}>
        <p className="text-[10px] uppercase tracking-[0.28em] text-[#e8d5a3]/70">Shared felt</p>
        <h2 className="font-heading mt-1 text-2xl sm:text-3xl text-[#f6f1e7]">Salon tables</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#f6f1e7]/60">
          House chips for this table. They stay on the felt, not in the vault. Everyone plays the same coup, and any
          seat may call it.
        </p>
        <p className="mt-5 text-[10px] uppercase tracking-[0.22em] text-[#f6f1e7]/40">Salon originals</p>
        <div className="mt-2">
          <PlaqueGrid items={ORIGINALS} game={game} cols="sm:grid-cols-2 lg:grid-cols-4" onGame={onGame} />
        </div>
        <p className="mt-5 text-[10px] uppercase tracking-[0.22em] text-[#f6f1e7]/40">Classics</p>
        <div className="mt-2">
          <PlaqueGrid items={CLASSICS} game={game} cols="sm:grid-cols-3" onGame={onGame} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" className={btnGold} disabled={busy} onClick={onCreate}>
            Open {GAME_TITLE[game]}
          </button>
          <div className="flex items-center gap-1.5">
            {SEAT_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSeats(s)}
                className={
                  "h-9 min-w-10 rounded-lg border px-2 font-mono text-xs cursor-pointer " +
                  (seats === s
                    ? "border-[#e8d5a3]/70 bg-[#c6a15b]/15 text-[#f6ecd4]"
                    : "border-[#c6a15b]/20 bg-black/20 text-[#f6f1e7]/60 hover:border-[#c6a15b]/45")
                }
              >
                {s}
              </button>
            ))}
          </div>
          <span className="text-[11px] uppercase tracking-[0.16em] text-[#f6f1e7]/35">seats · 1,000 chips each</span>
        </div>
      </div>

      <div className={card + " p-4 sm:p-5"}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 min-w-[10rem]">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Join by code
            </span>
            <input
              className={inputCls + " uppercase tracking-[0.22em]"}
              value={code}
              maxLength={6}
              placeholder="ABCDEF"
              onChange={(e) => onCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          </label>
          <button type="button" className={btnSecondary} disabled={busy || code.length !== 6} onClick={onJoinCode}>
            Take a seat
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-[#e7b2aa]">{error}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Open tables</p>
        {booting ? (
          <p className="text-sm text-white/40">Opening the floor…</p>
        ) : missing ? (
          <p className="text-sm text-[#f6f1e7]/50">Open tables show up once the salon migrations are on Supabase.</p>
        ) : tables.length === 0 ? (
          <p className="text-sm text-[#f6f1e7]/50">No one is seated. Open a table and send the code.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {tables.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onJoin(t)}
                  className={card + " w-full p-4 text-left cursor-pointer hover:border-[#e8d5a3]/40 transition-colors"}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span>
                      <span className="text-[10px] tracking-[0.22em] text-[#c6a15b]">{t.room_code}</span>
                      <span className="mt-1 block font-heading text-[#f6f1e7]">{GAME_TITLE[t.game]}</span>
                    </span>
                    <span className="text-xs text-[#f6f1e7]/50">
                      {t.seats.length}/{t.max_seats} seated
                    </span>
                  </span>
                  <span className="mt-2 block text-[11px] uppercase tracking-[0.14em] text-[#f6f1e7]/35">
                    {phaseLabel(t)} · round {t.round + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function callLabel(table: SalonTable): string {
  if (table.phase === "resolved") return table.game === "derby" ? "Next race" : table.game === "ticker" ? "Next window" : "Next coup";
  if (table.phase === "locked") return "Settle";
  switch (table.game) {
    case "derby":
      return "Run the race";
    case "nerve":
    case "oddone":
      return "Reveal";
    case "ticker":
      return "Lock the window";
    default:
      return "Close the betting";
  }
}

function tableBlurb(table: SalonTable): string {
  switch (table.game) {
    case "derby":
      return "Back a horse to win. Any seat may run the race.";
    case "nerve":
      return "Seal the multiplier you will cash out at. Any seat may call the reveal.";
    case "oddone":
      return "Pick in secret. Two or more picks and any seat may reveal.";
    case "ticker":
      return "Bet the sixty-second move on BTC-USD. Any seat may lock and settle.";
    default:
      return "Any seat may close the betting.";
  }
}

function SalonTableView({
  table,
  playerId,
  seated,
  stack,
  chip,
  busy,
  error,
  onChip,
  onBet,
  onCommit,
  onSpin,
  onNext,
  onRebuy,
  onLeave,
  onSit,
}: {
  table: SalonTable;
  playerId: string;
  seated: boolean;
  stack: number;
  chip: SalonChip;
  busy: boolean;
  error: string | null;
  onChip: (c: SalonChip) => void;
  onBet: (kind: string, n: number | null) => void;
  onCommit: (kind: string, n: number) => void;
  onSpin: () => void;
  onNext: () => void;
  onRebuy: () => void;
  onLeave: () => void;
  onSit: () => void;
}) {
  const full = table.seats.length >= table.max_seats;
  const myBets = table.bets.filter((b) => b.playerId === playerId);
  const canBet = seated && table.phase === "betting" && !busy;
  const check = useMemo(() => fairness(table), [table]);
  const countdown = useTickerCountdown(table);
  const needTwo = table.game === "oddone" && table.bets.length < 2;
  const callDisabled =
    busy ||
    table.bets.length === 0 ||
    needTwo ||
    (table.phase === "locked" && countdown !== null && countdown > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#c6a15b]">{table.room_code}</p>
          <h2 className="font-heading text-2xl text-[#f6f1e7]">{GAME_TITLE[table.game]}</h2>
          <p className="mt-1 text-xs text-[#f6f1e7]/50">
            House chips for this table. They stay on the felt, not in the vault. Round {table.round + 1}. {tableBlurb(table)}
          </p>
        </div>
        <button type="button" className={btnGhost} onClick={onLeave} disabled={busy && seated}>
          {seated ? "Leave" : "Floor"}
        </button>
      </div>

      <div className={felt + " p-4 sm:p-6 space-y-4"}>
        <ResultMedallion table={table} />
        <div className="mx-auto w-full max-w-lg">
          {table.game === "roulette" && <RouletteCloth table={table} playerId={playerId} disabled={!canBet} onBet={onBet} />}
          {table.game === "baccarat" && <BaccaratCloth table={table} playerId={playerId} disabled={!canBet} onBet={onBet} />}
          {table.game === "sicbo" && <SicBoCloth table={table} playerId={playerId} disabled={!canBet} onBet={onBet} />}
          {table.game === "derby" && <DerbyCloth table={table} playerId={playerId} disabled={!canBet} onBet={onBet} />}
          {table.game === "nerve" && (
            <NerveCloth table={table} playerId={playerId} disabled={!canBet} chip={chip} onCommit={onCommit} />
          )}
          {table.game === "oddone" && (
            <OddOneCloth table={table} playerId={playerId} disabled={!canBet} chip={chip} onCommit={onCommit} />
          )}
          {table.game === "ticker" && table.phase === "betting" && (
            <TickerCloth table={table} playerId={playerId} disabled={!canBet} onBet={onBet} />
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Array.from({ length: table.max_seats }, (_, i) => {
            const seat = table.seats.find((s) => s.seat === i);
            const mine = seat?.playerId === playerId;
            return (
              <div
                key={i}
                className={
                  "rounded-xl border px-3 py-2 " +
                  (mine ? "border-[#e8d5a3]/60 bg-[#c6a15b]/10" : "border-white/10 bg-black/25")
                }
              >
                <p className="text-[10px] uppercase tracking-[0.16em] text-[#f6f1e7]/40">Seat {i + 1}</p>
                <p className="font-heading text-sm text-[#f6f1e7] truncate">{seat ? seat.name : "Open"}</p>
                <p className="font-mono text-xs text-[#e8d5a3]/80">{seat ? seat.stack.toLocaleString() : "—"}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className={card + " p-4 space-y-3"}>
        {seated ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#f6f1e7]/45">
                Your stack <span className="font-mono text-[#e8d5a3]">{stack.toLocaleString()}</span>
              </p>
              <div className="flex gap-1.5">
                {SALON_CHIPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onChip(c)}
                    className={
                      "h-10 min-w-12 rounded-full border font-mono text-sm cursor-pointer " +
                      (chip === c
                        ? "border-[#e8d5a3] bg-gradient-to-b from-[#f3e6c4] to-[#a7843c] text-[#1c1508]"
                        : "border-[#c6a15b]/30 bg-black/30 text-[#f6ecd4]")
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {table.phase === "resolved" ? (
                <button type="button" className={btnGold} disabled={busy} onClick={onNext}>
                  {callLabel(table)}
                </button>
              ) : (
                <button type="button" className={btnGold} disabled={callDisabled} onClick={onSpin}>
                  {callLabel(table)}
                  {table.phase === "locked" && countdown !== null && countdown > 0 ? ` · ${countdown}s` : ""}
                </button>
              )}
              <button
                type="button"
                className={btnSecondary}
                disabled={busy || table.phase !== "betting" || myBets.length > 0 || stack >= 1000}
                onClick={onRebuy}
              >
                Fill to 1,000
              </button>
              {needTwo && table.phase === "betting" && (
                <span className="text-[11px] text-[#f6f1e7]/45">Needs two picks before the reveal.</span>
              )}
            </div>
          </>
        ) : (
          <button type="button" className={btnGold} disabled={busy || full} onClick={onSit}>
            {full ? "Table is full" : "Take a seat"}
          </button>
        )}
        {error && <p className="text-sm text-[#e7b2aa]">{error}</p>}
        <BetLedger table={table} />
      </div>

      <FairnessStrip table={table} check={check} />
    </div>
  );
}

type Check = "match" | "mismatch" | "hash" | null;

function fairness(table: SalonTable): Check {
  if (table.game === "ticker") return null;
  if (table.game === "oddone") {
    if (table.phase === "resolved" && table.result && "picks" in table.result && table.payouts) {
      return oddOneChecksOut(table.result as SalonOddOneResult, table.payouts) ? "match" : "mismatch";
    }
    return null;
  }
  const committed = table.result && "committedHash" in table.result ? table.result.committedHash : undefined;
  if (!table.revealed_seed || !committed || !table.result) return null;
  if (table.phase === "resolved" && table.payouts) {
    const ok = salonCoupChecksOut({
      revealedSeed: table.revealed_seed,
      committedHash: committed,
      clientSeed: table.room_code,
      nonce: table.round,
      game: table.game,
      result: table.result,
      payouts: table.payouts,
    });
    if (ok === null) return null;
    return ok ? "match" : "mismatch";
  }
  return hashServerSeed(table.revealed_seed) === committed ? "hash" : "mismatch";
}

function waitingLine(table: SalonTable): string {
  switch (table.game) {
    case "derby":
      return "Back a horse. The race is already committed.";
    case "nerve":
      return "Seal a number. The bust is already committed.";
    case "oddone":
      return "Pick in secret. Nobody sees a number until the reveal.";
    case "ticker":
      return "Call up or down. The window opens when a seat locks it.";
    default:
      return "Place chips. The commitment is already published.";
  }
}

function ResultMedallion({ table }: { table: SalonTable }) {
  if (!table.result) {
    if (table.game === "ticker" && table.phase === "locked") return <TickerLocked table={table} />;
    return <p className="text-center text-sm text-[#f6f1e7]/45">{waitingLine(table)}</p>;
  }
  if (table.game === "derby" && "ticks" in table.result) {
    return <DerbyRace result={table.result as SalonDerbyResult} round={table.round} />;
  }
  if (table.game === "nerve" && "bust" in table.result) {
    return <NerveReveal result={table.result as SalonNerveResult} table={table} />;
  }
  if (table.game === "oddone" && "picks" in table.result) {
    return <OddOneReveal result={table.result as SalonOddOneResult} table={table} />;
  }
  if (table.game === "ticker" && "close" in table.result) {
    return <TickerReveal result={table.result as SalonTickerResult} />;
  }
  if (table.game === "roulette" && "pocket" in table.result) {
    const r = table.result as SalonRouletteResult;
    const tone =
      r.color === "red"
        ? "from-[#7a2a2a] to-[#3a1212] text-[#f6e6dc]"
        : r.color === "black"
          ? "from-[#2a2a28] to-[#0e0e0c] text-[#f6f1e7]"
          : "from-[#1d6b45] to-[#0c3a24] text-[#e7f6ee]";
    return (
      <div className="flex flex-col items-center gap-1">
        <div className={"flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b font-heading text-2xl " + tone}>
          {r.pocket}
        </div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#f6f1e7]/45">{r.color}</p>
      </div>
    );
  }
  if (table.game === "sicbo" && "dice" in table.result) {
    const r = table.result as SalonSicBoResult;
    return (
      <div className="text-center">
        <DiceRow dice={[...r.dice]} />
        <p className="text-xs text-[#f6f1e7]/55">
          {r.sum}
          {r.triple ? " · triple" : ""}
        </p>
      </div>
    );
  }
  if (table.game === "baccarat" && "player" in table.result) {
    const r = table.result as SalonBaccaratResult;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Hand title="Player" total={r.playerTotal} cards={r.player} win={r.winner === "player"} />
        <Hand title="Banker" total={r.bankerTotal} cards={r.banker} win={r.winner === "banker"} />
        <p className="sm:col-span-2 text-center text-[11px] uppercase tracking-[0.18em] text-[#e8d5a3]/80">
          {r.winner === "tie" ? "Tie" : r.winner === "player" ? "Player wins" : "Banker wins"}
          {r.natural ? " · natural" : ""}
        </p>
      </div>
    );
  }
  return null;
}

function Hand({ title, total, cards, win }: { title: string; total: number; cards: number[]; win: boolean }) {
  return (
    <div className={"rounded-xl border p-3 " + (win ? "border-[#e8d5a3]/50 bg-[#c6a15b]/10" : "border-white/10 bg-black/20")}>
      <p className="text-[10px] uppercase tracking-[0.16em] text-[#f6f1e7]/45">
        {title} · {total}
      </p>
      <div className="mt-2 flex justify-center gap-1.5">
        {cards.map((index, i) => (
          <PlayingCard key={i} c={cardFromIndex(index)} />
        ))}
      </div>
    </div>
  );
}

function RouletteCloth({
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
  const rows = Array.from({ length: 12 }, (_, row) => [row * 3 + 1, row * 3 + 2, row * 3 + 3]);
  return (
    <div className="space-y-2">
      <Spot
        label="0"
        tone="green"
        block
        stake={spotStake(table.bets, "straight", 0)}
        mine={table.bets.some((b) => b.playerId === playerId && b.kind === "straight" && b.n === 0)}
        disabled={disabled}
        onClick={() => onBet("straight", 0)}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {rows.flat().map((n) => (
          <Spot
            key={n}
            label={String(n)}
            tone={RED_POCKETS.has(n) ? "red" : "black"}
            stake={spotStake(table.bets, "straight", n)}
            mine={table.bets.some((b) => b.playerId === playerId && b.kind === "straight" && b.n === n)}
            disabled={disabled}
            onClick={() => onBet("straight", n)}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {(
          [
            ["low", "1–18"],
            ["even", "Even"],
            ["red", "Red"],
            ["black", "Black"],
            ["odd", "Odd"],
            ["high", "19–36"],
          ] as const
        ).map(([kind, label]) => (
          <Spot
            key={kind}
            label={label}
            tone={kind === "red" ? "red" : kind === "black" ? "black" : "ivory"}
            stake={spotStake(table.bets, kind, null)}
            mine={table.bets.some((b) => b.playerId === playerId && b.kind === kind)}
            disabled={disabled}
            onClick={() => onBet(kind, null)}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["dozen1", "1st 12"],
            ["dozen2", "2nd 12"],
            ["dozen3", "3rd 12"],
          ] as const
        ).map(([kind, label]) => (
          <Spot
            key={kind}
            label={label}
            sub="2 to 1"
            tone="ivory"
            stake={spotStake(table.bets, kind, null)}
            mine={table.bets.some((b) => b.playerId === playerId && b.kind === kind)}
            disabled={disabled}
            onClick={() => onBet(kind, null)}
          />
        ))}
      </div>
    </div>
  );
}

function BaccaratCloth({
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
  const spots = [
    ["player", "Player", "1 to 1"],
    ["banker", "Banker", "0.95 to 1"],
    ["tie", "Tie", "8 to 1"],
  ] as const;
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {spots.map(([kind, label, sub]) => (
        <Spot
          key={kind}
          label={label}
          sub={sub}
          tall
          tone={kind === "tie" ? "green" : "ivory"}
          stake={spotStake(table.bets, kind, null)}
          mine={table.bets.some((b) => b.playerId === playerId && b.kind === kind)}
          disabled={disabled}
          onClick={() => onBet(kind, null)}
        />
      ))}
    </div>
  );
}

function SicBoCloth({
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
  const spots = [
    ["small", "Small", "4–10"],
    ["odd", "Odd", "1 to 1"],
    ["any_triple", "Any triple", "30 to 1"],
    ["even", "Even", "1 to 1"],
    ["big", "Big", "11–17"],
  ] as const;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        {spots.map(([kind, label, sub]) => (
          <Spot
            key={kind}
            label={label}
            sub={sub}
            tall
            tone={kind === "any_triple" ? "gold" : "ivory"}
            stake={spotStake(table.bets, kind, null)}
            mine={table.bets.some((b) => b.playerId === playerId && b.kind === kind)}
            disabled={disabled}
            onClick={() => onBet(kind, null)}
          />
        ))}
      </div>
      <p className="text-center text-xs text-[#f6f1e7]/45">Triples lose big, small, odd, and even.</p>
    </div>
  );
}

function BetLedger({ table }: { table: SalonTable }) {
  if (table.bets.length === 0 && !(table.payouts && table.payouts.length)) {
    return <p className="text-xs text-white/40">No chips on the layout.</p>;
  }
  const rows: SalonPayout[] =
    table.phase === "resolved" && table.payouts
      ? table.payouts
      : table.bets.map((b) => ({ ...b, n: b.n ?? null, payout: 0 }));
  return (
    <ul className="divide-y divide-white/5 text-sm">
      {rows.map((row, i) => (
        <li key={i} className="flex items-center justify-between gap-3 py-1.5">
          <span className="truncate text-[#f6f1e7]/80">
            {playerName(table, row.playerId)}
            <span className="text-[#f6f1e7]/40"> · {formatSpot(row.kind, row.n)}</span>
          </span>
          <span className="font-mono text-xs text-[#e8d5a3]">
            {row.stake}
            {table.phase === "resolved" ? ` → ${row.payout}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FairnessStrip({ table, check }: { table: SalonTable; check: Check }) {
  if (table.game === "ticker") {
    return (
      <div className={card + " p-4 space-y-1"}>
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Settlement</p>
        <p className="text-xs text-[#f6f1e7]/50">
          No seed is drawn. The window settles on the Coinbase BTC-USD spot price, fetched by the database at lock and
          again at settle. Both prints are published with the result.
        </p>
      </div>
    );
  }
  if (table.game === "oddone") {
    const line =
      check === "match"
        ? "The pot replays from the published picks."
        : check === "mismatch"
          ? "The published pot does not replay."
          : "No house randomness. Sealed picks are revealed together, and the lowest unique one wins.";
    return (
      <div className={card + " p-4 space-y-1"}>
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Settlement</p>
        <p className="text-xs text-[#f6f1e7]/50">{line}</p>
      </div>
    );
  }
  const line =
    check === "match"
      ? "This coup replays from the revealed seed."
      : check === "hash"
        ? "The previous seed matches the commitment published before that coup."
        : check === "mismatch"
          ? "The published coup does not replay."
          : "The hash below is the commitment for the open coup.";
  return (
    <div className={card + " p-4 space-y-1"}>
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Commitment</p>
      <p className="break-all font-mono text-[11px] text-[#e8d5a3]/80">{table.server_seed_hash}</p>
      {table.revealed_seed && (
        <>
          <p className="pt-2 text-[10px] uppercase tracking-[0.18em] text-white/40">Revealed seed</p>
          <p className="break-all font-mono text-[11px] text-[#f6f1e7]/70">{table.revealed_seed}</p>
        </>
      )}
      <p className="pt-1 text-xs text-[#f6f1e7]/50">{line}</p>
    </div>
  );
}
