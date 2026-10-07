"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cardFromIndex } from "@/lib/casino/deck";
import { hashServerSeed } from "@/lib/casino/rng";
import {
  RED_POCKETS,
  salonCoupChecksOut,
  type SalonBaccaratResult,
  type SalonGame,
  type SalonPayout,
  type SalonRouletteResult,
  type SalonSicBoResult,
} from "@/lib/casino/salon-games";
import {
  betSalon,
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
  type SalonBetRow,
  type SalonTable,
} from "@/lib/casino/salon-tables";
import { useCasino } from "./casino-context";
import { btnGhost, btnGold, btnSecondary, card, felt, inputCls } from "./casino-ui";
import { DiceRow, PlayingCard } from "./table-kit";

const GAMES: { id: SalonGame; mark: string; title: string; line: string }[] = [
  { id: "roulette", mark: "RL", title: "Roulette", line: "Single zero. Outside bets and straight numbers, paid together." },
  { id: "baccarat", mark: "BA", title: "Baccarat", line: "Punto banco. Player, banker, or the tie. One shoe for the table." },
  { id: "sicbo", mark: "SB", title: "Sic Bo", line: "Three dice. Triples lose big, small, odd, and even." },
];

const CHIPS = [5, 25, 100, 500] as const;

const GAME_TITLE: Record<SalonGame, string> = {
  roulette: "Roulette",
  baccarat: "Baccarat",
  sicbo: "Sic Bo",
};

function spotStake(bets: SalonBetRow[], kind: string, n: number | null): number {
  return bets.reduce((sum, b) => (b.kind === kind && (b.n ?? null) === n ? sum + b.stake : sum), 0);
}

function playerName(table: SalonTable, playerId: string): string {
  return table.seats.find((s) => s.playerId === playerId)?.name ?? "Guest";
}

function formatSpot(kind: string, n: number | null): string {
  if (kind === "straight" && n !== null) return `Straight ${n}`;
  if (kind === "dozen1") return "1st 12";
  if (kind === "dozen2") return "2nd 12";
  if (kind === "dozen3") return "3rd 12";
  if (kind === "any_triple") return "Any triple";
  if (kind === "low") return "1–18";
  if (kind === "high") return "19–36";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export default function SalonFloor() {
  const { userId, playMoney } = useCasino();
  const ready = userId !== "guest-loading" && userId.length > 0;
  const name = playMoney.displayName || "Guest";
  const [tables, setTables] = useState<SalonTable[]>([]);
  const [active, setActive] = useState<SalonTable | null>(null);
  const [game, setGame] = useState<SalonGame>("roulette");
  const [code, setCode] = useState("");
  const [chip, setChip] = useState<(typeof CHIPS)[number]>(25);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);

  const noteError = useCallback((message: string | undefined) => {
    if (!message) return;
    if (salonMigrationMissing(message)) {
      setMissing(true);
      setError("The salon migration has not been applied to this Supabase project yet.");
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
          Apply <span className="font-mono text-[#e8d5a3]">infra/supabase/migrations/2026-10-07-casino-salon-tables.sql</span> on
          the Supabase project, then open a table. The floor will not invent a local coup.
        </div>
      )}
      {!active ? (
        <SalonLobby
          booting={booting}
          missing={missing}
          tables={tables}
          game={game}
          code={code}
          busy={busy || !ready}
          error={error}
          onGame={setGame}
          onCode={setCode}
          onCreate={() => void run(() => openSalonTable({ game, playerId: userId, name }))}
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

function SalonLobby({
  booting,
  missing,
  tables,
  game,
  code,
  busy,
  error,
  onGame,
  onCode,
  onCreate,
  onJoinCode,
  onJoin,
}: {
  booting: boolean;
  missing: boolean;
  tables: SalonTable[];
  game: SalonGame;
  code: string;
  busy: boolean;
  error: string | null;
  onGame: (g: SalonGame) => void;
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
          House chips for this table. They stay on the felt, not in the vault. Everyone bets the same coup, and any
          seat may close the betting.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {GAMES.map((g) => {
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
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" className={btnGold} disabled={busy} onClick={onCreate}>
            Open {GAME_TITLE[game]}
          </button>
          <span className="text-[11px] uppercase tracking-[0.16em] text-[#f6f1e7]/35">Six seats · 1,000 chips</span>
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
          <p className="text-sm text-[#f6f1e7]/50">Open tables show up once the salon migration is on Supabase.</p>
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
                    {t.phase === "betting" ? "Betting" : "Coup showing"} · round {t.round + 1}
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
  chip: number;
  busy: boolean;
  error: string | null;
  onChip: (c: (typeof CHIPS)[number]) => void;
  onBet: (kind: string, n: number | null) => void;
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#c6a15b]">{table.room_code}</p>
          <h2 className="font-heading text-2xl text-[#f6f1e7]">{GAME_TITLE[table.game]}</h2>
          <p className="mt-1 text-xs text-[#f6f1e7]/50">
            House chips for this table. They stay on the felt, not in the vault. Round {table.round + 1}. Any seat may
            close the betting.
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
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                {CHIPS.map((c) => (
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
            <div className="flex flex-wrap gap-2">
              {table.phase === "betting" ? (
                <button type="button" className={btnGold} disabled={busy || table.bets.length === 0} onClick={onSpin}>
                  Close the betting
                </button>
              ) : (
                <button type="button" className={btnGold} disabled={busy} onClick={onNext}>
                  Next coup
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

function fairness(table: SalonTable): "match" | "mismatch" | "hash" | null {
  const committed = table.result && "committedHash" in table.result ? table.result.committedHash : undefined;
  if (!table.revealed_seed || !committed || !table.result) return null;
  if (table.phase === "resolved" && table.payouts) {
    const ok = salonCoupChecksOut({
      revealedSeed: table.revealed_seed,
      committedHash: committed,
      clientSeed: table.room_code,
      nonce: table.round,
      game: table.game,
      bets: table.bets,
      result: table.result,
      payouts: table.payouts,
    });
    return ok ? "match" : "mismatch";
  }
  return hashServerSeed(table.revealed_seed) === committed ? "hash" : "mismatch";
}

function ResultMedallion({ table }: { table: SalonTable }) {
  if (!table.result) {
    return <p className="text-center text-sm text-[#f6f1e7]/45">Place chips. The commitment is already published.</p>;
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

function Spot({
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

function FairnessStrip({ table, check }: { table: SalonTable; check: "match" | "mismatch" | "hash" | null }) {
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
