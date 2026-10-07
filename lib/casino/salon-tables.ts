/**
 * Shared salon tables. Chips live on the row. The server seed lives in
 * casino_salon_secrets, which is not replicated. Mutations go through
 * SECURITY DEFINER RPCs.
 */

import { supabase } from "../supabase";
import type { SalonGame, SalonPayout, SalonResult } from "./salon-games";

export type SalonSeat = {
  seat: number;
  playerId: string;
  name: string;
  stack: number;
};

export type SalonBetRow = {
  playerId: string;
  kind: string;
  stake: number;
  n: number | null;
};

export type SalonTable = {
  id: string;
  room_code: string;
  game: SalonGame;
  status: "open" | "closed";
  phase: "betting" | "resolved";
  max_seats: number;
  seats: SalonSeat[];
  bets: SalonBetRow[];
  round: number;
  result: (SalonResult & { committedHash?: string }) | null;
  payouts: SalonPayout[] | null;
  server_seed_hash: string;
  revealed_seed: string | null;
  version: number;
  created_by: string;
  updated_at: string;
};

const PUBLIC_COLUMNS =
  "id,room_code,game,status,phase,max_seats,seats,bets,round,result,payouts,server_seed_hash,revealed_seed,version,created_by,updated_at";

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePayouts(raw: unknown): SalonPayout[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((row) => {
    const p = row as Record<string, unknown>;
    return {
      playerId: String(p.playerId ?? ""),
      kind: String(p.kind ?? ""),
      stake: num(p.stake),
      payout: num(p.payout),
      n: p.n === null || p.n === undefined ? null : num(p.n),
    };
  });
}

export function normalizeSalonTable(raw: unknown): SalonTable | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.room_code !== "string") return null;
  const game = r.game === "baccarat" || r.game === "sicbo" || r.game === "roulette" ? r.game : null;
  if (!game) return null;
  const seats = Array.isArray(r.seats)
    ? r.seats.map((s) => {
        const seat = s as Record<string, unknown>;
        return {
          seat: num(seat.seat),
          playerId: String(seat.playerId ?? ""),
          name: String(seat.name ?? "Guest"),
          stack: num(seat.stack),
        };
      })
    : [];
  const bets = Array.isArray(r.bets)
    ? r.bets.map((b) => {
        const bet = b as Record<string, unknown>;
        const n = bet.n === null || bet.n === undefined ? null : num(bet.n);
        return {
          playerId: String(bet.playerId ?? ""),
          kind: String(bet.kind ?? ""),
          stake: num(bet.stake),
          n,
        };
      })
    : [];
  return {
    id: r.id,
    room_code: r.room_code,
    game,
    status: r.status === "closed" ? "closed" : "open",
    phase: r.phase === "resolved" ? "resolved" : "betting",
    max_seats: num(r.max_seats, 6),
    seats,
    bets,
    round: num(r.round),
    result: (r.result as SalonTable["result"]) ?? null,
    payouts: normalizePayouts(r.payouts),
    server_seed_hash: String(r.server_seed_hash ?? ""),
    revealed_seed: r.revealed_seed ? String(r.revealed_seed) : null,
    version: num(r.version),
    created_by: String(r.created_by ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

function one(data: unknown): SalonTable | null {
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeSalonTable(row);
}

export function salonMigrationMissing(message: string): boolean {
  return /does not exist|schema cache|PGRST202|PGRST205|could not find the function|casino_salon/i.test(message);
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function listSalonTables(): Promise<{ tables: SalonTable[]; error?: string }> {
  const { data, error } = await supabase
    .from("casino_salon_tables")
    .select(PUBLIC_COLUMNS)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(24);
  if (error) return { tables: [], error: error.message };
  return { tables: (data ?? []).map((row) => normalizeSalonTable(row)).filter((t): t is SalonTable => !!t) };
}

export async function openSalonTable(input: {
  game: SalonGame;
  playerId: string;
  name: string;
  maxSeats?: number;
}): Promise<{ table: SalonTable | null; error?: string }> {
  let last = "Could not open a table";
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase.rpc("salon_open", {
      p_game: input.game,
      p_player: input.playerId,
      p_name: input.name,
      p_code: randomCode(),
      p_max_seats: input.maxSeats ?? 6,
    });
    if (!error && data) return { table: one(data) };
    last = error?.message ?? last;
    if (!/duplicate|room code|unique/i.test(last)) return { table: null, error: last };
  }
  return { table: null, error: last };
}

async function call(fn: string, args: Record<string, unknown>): Promise<{ table: SalonTable | null; error?: string }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { table: null, error: error.message };
  return { table: one(data) };
}

export function joinSalon(id: string, playerId: string, name: string) {
  return call("salon_join", { p_id: id, p_player: playerId, p_name: name });
}

export function betSalon(id: string, playerId: string, kind: string, stake: number, n: number | null) {
  return call("salon_bet", { p_id: id, p_player: playerId, p_kind: kind, p_stake: stake, p_n: n });
}

export function spinSalon(id: string, playerId: string) {
  return call("salon_spin", { p_id: id, p_player: playerId });
}

export function nextSalon(id: string, playerId: string) {
  return call("salon_next", { p_id: id, p_player: playerId });
}

export function leaveSalon(id: string, playerId: string) {
  return call("salon_leave", { p_id: id, p_player: playerId });
}

export function rebuySalon(id: string, playerId: string) {
  return call("salon_rebuy", { p_id: id, p_player: playerId });
}

export async function fetchSalon(id: string): Promise<{ table: SalonTable | null; error?: string }> {
  const { data, error } = await supabase.from("casino_salon_tables").select(PUBLIC_COLUMNS).eq("id", id).maybeSingle();
  if (error) return { table: null, error: error.message };
  return { table: normalizeSalonTable(data) };
}

export async function fetchSalonByCode(code: string): Promise<{ table: SalonTable | null; error?: string }> {
  const { data, error } = await supabase
    .from("casino_salon_tables")
    .select(PUBLIC_COLUMNS)
    .eq("room_code", code.trim().toUpperCase())
    .maybeSingle();
  if (error) return { table: null, error: error.message };
  return { table: normalizeSalonTable(data) };
}

export function subscribeSalonTable(id: string, onRow: (table: SalonTable) => void): () => void {
  const channel = supabase
    .channel(`salon-table-${id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "casino_salon_tables", filter: `id=eq.${id}` },
      (payload) => {
        const next = normalizeSalonTable(payload.new);
        if (next) onRow(next);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
