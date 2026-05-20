/**
 * Server-side poker room mutations (validated seat + turn).
 * Used by `/api/casino/poker/*` routes; logic mirrors `poker-multiplayer.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPokerSeatMeta,
  type PokerRoomRow,
} from "./poker-multiplayer";
import {
  legalActionsForSeat,
  pickBotAction,
  pokerGame,
  type PokerAction,
  type PokerState,
} from "./poker";
import type { Bet, ChainId, Session, TokenSpec } from "./types";
import { HmacRngStream, hashServerSeed } from "./rng";
import { newSessionId } from "./session";

async function advanceRoomBots(
  session: Session<PokerAction, PokerState>,
  pair: {
    id: string;
    userId: string;
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    status: "active";
    createdAt: string;
    retiredAt: null;
  },
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

function mySeatInRoom(room: PokerRoomRow, userId: string): number | null {
  for (const [seat, uid] of Object.entries(room.seat_users)) {
    if (uid === userId) return Number(seat);
  }
  return null;
}

export async function serverStartPokerRoomHand(
  supabase: SupabaseClient,
  userId: string,
  roomId: string,
  chainId: ChainId,
  token: TokenSpec,
  displayNames: Record<string, string> = {},
): Promise<{ room: PokerRoomRow | null; error?: string; status?: number }> {
  const { data: row, error: fetchErr } = await supabase
    .from("casino_poker_rooms")
    .select("*")
    .eq("id", roomId)
    .single();
  if (fetchErr || !row) return { room: null, error: "Room not found", status: 404 };

  const room = row as PokerRoomRow;
  if (room.created_by !== userId) {
    return { room: null, error: "Only the host can deal", status: 403 };
  }
  if (room.status !== "waiting") return { room: null, error: "Hand already in progress", status: 409 };

  const buyIn = BigInt(room.buy_in);
  const bigBlind = BigInt(room.big_blind);
  const serverSeed = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const bet: Bet = {
    sessionId: newSessionId(),
    userId,
    gameId: "poker",
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

  if (error) return { room: null, error: error.message, status: 409 };
  return { room: data as PokerRoomRow };
}

export async function serverApplyPokerRoomAction(
  supabase: SupabaseClient,
  userId: string,
  roomId: string,
  action: PokerAction,
  chainId: ChainId,
  token: TokenSpec,
): Promise<{ room: PokerRoomRow | null; error?: string; status?: number }> {
  const { data: row, error: fetchErr } = await supabase
    .from("casino_poker_rooms")
    .select("*")
    .eq("id", roomId)
    .single();
  if (fetchErr || !row) return { room: null, error: "Room not found", status: 404 };

  const room = row as PokerRoomRow;
  const humanSeat = mySeatInRoom(room, userId);
  if (humanSeat === null) return { room: null, error: "Not seated at this table", status: 403 };
  if (!room.session_json || room.status !== "active") {
    return { room: null, error: "No active hand", status: 409 };
  }

  const session = parseSession(room.session_json);
  if (session.state.activeSeat !== humanSeat) {
    return { room: null, error: "Not your turn", status: 409 };
  }

  const legalForSeat = legalActionsForSeat(session.state, humanSeat);
  const ok = legalForSeat.some(
    (a) =>
      a.type === action.type &&
      (action.type !== "raise" || a.raiseTo === action.raiseTo),
  );
  if (!ok) return { room: null, error: "Illegal action", status: 400 };

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

  if (error) return { room: null, error: error.message, status: 409 };
  return { room: data as PokerRoomRow };
}
