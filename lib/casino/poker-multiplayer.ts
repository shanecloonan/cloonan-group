/**
 * Shared poker tables — Supabase-backed room state with optimistic versioning.
 */

import { supabase } from "../supabase";
import {
  HUMAN_SEAT,
  pickBotAction,
  pokerGame,
  type PokerAction,
  type PokerSeatMeta,
  type PokerState,
} from "./poker";
import type { Bet, Session } from "./types";
import { HmacRngStream, hashServerSeed } from "./rng";
import { newSessionId } from "./session";
import type { ChainId, GameId, TokenSpec } from "./types";

export type PokerRoomRow = {
  id: string;
  room_code: string;
  status: "waiting" | "active" | "complete";
  max_seats: number;
  big_blind: string;
  small_blind: string;
  buy_in: string;
  seat_users: Record<string, string | null>;
  session_json: Session<PokerAction, PokerState> | null;
  version: number;
  created_by: string | null;
  updated_at: string;
};

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function listPokerRooms(limit = 12): Promise<PokerRoomRow[]> {
  const { data, error } = await supabase
    .from("casino_poker_rooms")
    .select("*")
    .in("status", ["waiting", "active"])
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as PokerRoomRow[];
}

export async function createPokerRoom(input: {
  buyIn: bigint;
  bigBlind: bigint;
  smallBlind: bigint;
  maxSeats?: number;
}): Promise<{ room: PokerRoomRow | null; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { room: null, error: "Sign in to host a table." };

  const seatUsers: Record<string, string | null> = {};
  for (let i = 0; i < (input.maxSeats ?? 6); i++) seatUsers[String(i)] = null;
  seatUsers[String(HUMAN_SEAT)] = user.id;

  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("casino_poker_rooms")
      .insert({
        room_code: code,
        status: "waiting",
        max_seats: input.maxSeats ?? 6,
        big_blind: input.bigBlind.toString(),
        small_blind: input.smallBlind.toString(),
        buy_in: input.buyIn.toString(),
        seat_users: seatUsers,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (!error && data) return { room: data as PokerRoomRow };
    if (!/duplicate/i.test(error?.message ?? "")) {
      return { room: null, error: error?.message ?? "Could not create room" };
    }
    code = randomCode();
  }
  return { room: null, error: "Could not allocate room code" };
}

export async function joinPokerRoom(
  roomId: string,
  preferredSeat?: number,
): Promise<{ room: PokerRoomRow | null; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { room: null, error: "Sign in to join." };

  const { data: row, error: fetchErr } = await supabase
    .from("casino_poker_rooms")
    .select("*")
    .eq("id", roomId)
    .single();
  if (fetchErr || !row) return { room: null, error: fetchErr?.message ?? "Room not found" };

  const seats = { ...(row.seat_users as Record<string, string | null>) };
  if (Object.values(seats).includes(user.id)) {
    return { room: row as PokerRoomRow };
  }

  const order =
    preferredSeat !== undefined
      ? [preferredSeat, ...Array.from({ length: row.max_seats }, (_, i) => i).filter((s) => s !== preferredSeat)]
      : Array.from({ length: row.max_seats }, (_, i) => i);

  let picked: number | null = null;
  for (const s of order) {
    if (!seats[String(s)]) {
      picked = s;
      break;
    }
  }
  if (picked === null) return { room: null, error: "Table is full" };

  seats[String(picked)] = user.id;
  const { data, error } = await supabase
    .from("casino_poker_rooms")
    .update({ seat_users: seats, updated_at: new Date().toISOString() })
    .eq("id", roomId)
    .eq("version", row.version)
    .select("*")
    .single();

  if (error) return { room: null, error: error.message };
  return { room: data as PokerRoomRow };
}

export function mySeatInRoom(room: PokerRoomRow, userId: string): number | null {
  for (const [seat, uid] of Object.entries(room.seat_users)) {
    if (uid === userId) return Number(seat);
  }
  return null;
}

export function humanCount(room: PokerRoomRow): number {
  return Object.values(room.seat_users).filter(Boolean).length;
}

export function seatedUserIds(room: PokerRoomRow): string[] {
  return Object.values(room.seat_users).filter((u): u is string => Boolean(u));
}

/** Build engine seat labels from room seats + optional profile display names. */
export function buildPokerSeatMeta(
  room: PokerRoomRow,
  displayNames: Record<string, string>,
): Record<string, PokerSeatMeta> {
  const meta: Record<string, PokerSeatMeta> = {};
  for (let seat = 0; seat < room.max_seats; seat++) {
    const uid = room.seat_users[String(seat)];
    if (uid) {
      const label = displayNames[uid]?.trim();
      meta[String(seat)] = {
        name: label || `Player ${seat + 1}`,
        isHuman: true,
      };
    } else {
      meta[String(seat)] = {
        name: `Bot ${seat + 1}`,
        isHuman: false,
      };
    }
  }
  return meta;
}

/** Start hand when 2+ humans seated (fills empty with bots in engine). */
export async function startPokerRoomHand(
  room: PokerRoomRow,
  chainId: ChainId,
  token: TokenSpec,
  userId: string,
  displayNames: Record<string, string> = {},
): Promise<{ room: PokerRoomRow | null; error?: string }> {
  if (room.status !== "waiting") return { room, error: "Hand already in progress" };
  if (humanCount(room) < 1) return { room: null, error: "Need at least one player" };

  const buyIn = BigInt(room.buy_in);
  const bigBlind = BigInt(room.big_blind);
  const serverSeed = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const bet: Bet = {
    sessionId: newSessionId(),
    userId,
    gameId: "poker" as GameId,
    chainId,
    token,
    stake: buyIn,
    config: {
      bigBlind,
      smallBlind: BigInt(room.small_blind),
      numSeats: room.max_seats,
      seatMeta: buildPokerSeatMeta(room, displayNames),
    },
  };

  const pair = {
    id: `room-${room.id}`,
    userId,
    serverSeed,
    serverSeedHash: hashServerSeed(serverSeed),
    clientSeed: room.room_code,
    nonce: 0,
    status: "active" as const,
    createdAt: new Date().toISOString(),
    retiredAt: null,
  };

  let state = pokerGame.initialState(bet, new HmacRngStream(pair, 1));
  const session: Session<PokerAction, PokerState> = {
    id: bet.sessionId,
    userId,
    gameId: "poker",
    chainId,
    token,
    stake: buyIn,
    seedPairId: pair.id,
    serverSeedHash: pair.serverSeedHash,
    clientSeed: pair.clientSeed,
    startNonce: 1,
    endNonce: 1,
    status: "open",
    state,
    actions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state = await advanceRoomBots(session, pair);
  session.state = state;
  session.endNonce = state.phase === "complete" ? session.endNonce + 50 : session.endNonce + 20;

  const { data, error } = await supabase
    .from("casino_poker_rooms")
    .update({
      status: state.phase === "complete" ? "complete" : "active",
      session_json: jsonSession(session),
      version: room.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .eq("version", room.version)
    .select("*")
    .single();

  if (error) return { room: null, error: error.message };
  return { room: data as PokerRoomRow };
}

export async function applyPokerRoomAction(
  room: PokerRoomRow,
  humanSeat: number,
  action: PokerAction,
  chainId: ChainId,
  token: TokenSpec,
  userId: string,
): Promise<{ room: PokerRoomRow | null; error?: string }> {
  if (!room.session_json || room.status !== "active") {
    return { room: null, error: "No active hand" };
  }

  const session = parseSession(room.session_json);
  if (session.state.activeSeat !== humanSeat) {
    return { room: null, error: "Not your turn" };
  }

  const pair = {
    id: `room-${room.id}`,
    userId,
    serverSeed: "00".repeat(32),
    serverSeedHash: session.serverSeedHash,
    clientSeed: session.clientSeed,
    nonce: session.endNonce,
    status: "active" as const,
    createdAt: session.createdAt,
    retiredAt: null,
  };

  let next = pokerGame.step(session.state, action, new HmacRngStream(pair, session.endNonce + 1));
  session.state = next;
  session.endNonce += 1;
  session.actions.push({
    ordinal: session.actions.length,
    actor: "player",
    action,
    nonceAfter: session.endNonce,
    at: new Date().toISOString(),
  });

  const advanced = await advanceRoomBots(session, pair);
  session.state = advanced;
  if (pokerGame.isTerminal(session.state)) {
    session.status = "settled";
    session.result = pokerGame.settle(session.state, {
      sessionId: session.id,
      userId: session.userId,
      gameId: "poker",
      chainId,
      token,
      stake: session.stake,
      config: session.state.config as unknown as Record<string, unknown>,
    });
  }

  const { data, error } = await supabase
    .from("casino_poker_rooms")
    .update({
      status: session.status === "settled" ? "complete" : "active",
      session_json: jsonSession(session),
      version: room.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .eq("version", room.version)
    .select("*")
    .single();

  if (error) return { room: null, error: error.message };
  return { room: data as PokerRoomRow };
}

async function advanceRoomBots(
  session: Session<PokerAction, PokerState>,
  pair: { id: string; userId: string; serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number; status: "active"; createdAt: string; retiredAt: null },
): Promise<PokerState> {
  let state = session.state;
  let nonce = session.endNonce;
  let guard = 0;
  while (!pokerGame.isTerminal(state) && guard < 120) {
    guard++;
    if (state.activeSeat === null) {
      state = pokerGame.step(state, { type: "advance_street" }, new HmacRngStream(pair, ++nonce));
      continue;
    }
    const actor = state.activeSeat;
    if (actor !== null && state.players[actor]?.isHuman) break;
    const action = pickBotAction(state);
    state = pokerGame.step(state, action, new HmacRngStream(pair, ++nonce));
  }
  session.endNonce = nonce;
  return state;
}

function jsonSession(session: Session<PokerAction, PokerState>): unknown {
  return JSON.parse(
    JSON.stringify(session, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

function parseSession(raw: unknown): Session<PokerAction, PokerState> {
  return raw as Session<PokerAction, PokerState>;
}

export function subscribePokerRoom(
  roomId: string,
  onChange: (room: PokerRoomRow) => void,
): () => void {
  const channel = supabase
    .channel(`poker-room-${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "casino_poker_rooms", filter: `id=eq.${roomId}` },
      (payload) => {
        if (payload.new) onChange(payload.new as PokerRoomRow);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
