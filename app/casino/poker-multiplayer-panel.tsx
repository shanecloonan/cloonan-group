"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  applySessionSettlement,
  HUMAN_SEAT,
  legalActionsForSeat,
  settleForSeat,
  type ChainId,
  type PokerAction,
  type PokerState,
  type TokenSpec,
} from "@/lib/casino";
import {
  mySeatInRoom,
  listPokerRooms,
  subscribePokerRoom,
  humanCount,
  seatedUserIds,
  type PokerRoomRow,
} from "@/lib/casino/poker-multiplayer";
import { fetchCasinoProfilesForUsers } from "@/lib/casino/leaderboard";
import { useCasino } from "./casino-context";
import { PokerActionBar } from "./poker-action-bar";
import { PokerOvalTable } from "./poker-table-visual";
import { PokerTurnTimer } from "./poker-turn-timer";
import { btnGhost, btnPrimary, btnSecondary, card, inputCls, pillGold, pillLive } from "./casino-ui";
import { persistSettledSession } from "@/lib/casino";
import { pokerTurnElapsedMs } from "@/lib/casino/poker-turn-clock";
import { POKER_TURN_MS } from "@/lib/casino/poker-constants";

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  return BigInt(Math.floor(amount * Number(denom)));
}

async function pokerApi<T extends { room?: PokerRoomRow; error?: string }>(
  path: "action" | "start" | "join" | "create" | "timeout",
  body: unknown,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) return { error: "Sign in required" } as T;
  const res = await fetch(`/api/casino/poker/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) return { error: data.error ?? res.statusText } as T;
  return data;
}

export function PokerMultiplayerPanel({
  chainId,
  token,
  buyInHuman,
}: {
  chainId: ChainId;
  token: TokenSpec;
  buyInHuman: number;
}) {
  const [rooms, setRooms] = useState<PokerRoomRow[]>([]);
  const [active, setActive] = useState<PokerRoomRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const { getSeedPair, pushHistory, refreshBalance, ledger, userId: ctxUserId, balance } = useCasino();
  const settledRoomRef = useRef<string | null>(null);
  const lockedRoomRef = useRef<string | null>(null);
  const timeoutKeyRef = useRef<string | null>(null);
  const [seatLabels, setSeatLabels] = useState<Record<string, string>>({});

  const refreshList = useCallback(() => {
    listPokerRooms(16).then(setRooms);
  }, []);

  useEffect(() => {
    refreshList();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const t = setInterval(refreshList, 8000);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    if (!active) return;
    fetchCasinoProfilesForUsers(seatedUserIds(active)).then(setSeatLabels);
  }, [active?.id, active?.seat_users, active?.updated_at]);

  useEffect(() => {
    if (!active?.id) return;
    return subscribePokerRoom(active.id, async (room) => {
      setActive(room);
      fetchCasinoProfilesForUsers(seatedUserIds(room)).then(setSeatLabels);

      const sess = room.session_json;
      const uid = userId ?? ctxUserId;
      const mySeat = uid ? mySeatInRoom(room, uid) : null;
      if (
        room.status === "complete" &&
        sess?.status === "settled" &&
        sess.state &&
        mySeat !== null &&
        uid &&
        settledRoomRef.current !== room.id
      ) {
        settledRoomRef.current = room.id;
        const buyIn = BigInt(room.buy_in);
        const seatResult = settleForSeat(sess.state as PokerState, {
          sessionId: sess.id,
          userId: uid,
          gameId: "poker",
          chainId,
          token,
          stake: buyIn,
        }, mySeat);
        const sessionForMe = { ...sess, result: seatResult, userId: uid };
        pushHistory({
          game: "poker",
          stakeUnits: seatResult.totalStakedUnits,
          pnlUnits: seatResult.pnlUnits,
          multiplier:
            Number(seatResult.totalPayoutUnits) / Math.max(1, Number(seatResult.totalStakedUnits)),
          session: sessionForMe,
        });
        if (lockedRoomRef.current === room.id) {
          lockedRoomRef.current = null;
          await applySessionSettlement(ledger, {
            userId: uid,
            chainId,
            token,
            sessionId: `room-${room.id}`,
            result: seatResult,
          });
        }
        void persistSettledSession(sessionForMe, getSeedPair());
        void refreshBalance();
      }
    });
  }, [active?.id, chainId, token, getSeedPair, pushHistory, refreshBalance, ledger, userId, ctxUserId]);

  const host = async () => {
    setBusy(true);
    setMsg(null);
    const buyIn = humanToUnits(buyInHuman, token);
    const bb = buyIn / 50n;
    const sb = bb / 2n;
    const { room, error } = await pokerApi("create", {
      buyIn: buyIn.toString(),
      bigBlind: bb.toString(),
      smallBlind: sb.toString(),
    });
    setBusy(false);
    if (error) setMsg(error);
    else if (room) {
      setActive(room);
      refreshList();
      const ok = await lockBuyIn(room);
      if (!ok) setActive(null);
    }
  };

  const lockBuyIn = async (room: PokerRoomRow) => {
    const uid = userId ?? ctxUserId;
    if (!uid) return true;
    const buyIn = BigInt(room.buy_in);
    if (balance.available < buyIn) {
      setMsg("Insufficient balance for buy-in — deposit or use play money.");
      return false;
    }
    try {
      await ledger.lock({
        userId: uid,
        chainId,
        token,
        delta: buyIn,
        reason: "session_lock",
        sessionId: `room-${room.id}`,
      });
      lockedRoomRef.current = room.id;
      await refreshBalance();
      return true;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not lock buy-in");
      return false;
    }
  };

  const joinById = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const { room, error } = await pokerApi("join", { roomId: id, preferredSeat: HUMAN_SEAT });
    if (error) {
      setBusy(false);
      setMsg(error);
      return;
    }
    if (room) {
      setActive(room);
      const ok = await lockBuyIn(room);
      if (!ok) setActive(null);
    }
    setBusy(false);
  };

  const joinByCode = async () => {
    const code = joinCode.trim().toUpperCase();
    const hit = rooms.find((r) => r.room_code === code);
    if (!hit) {
      setMsg("Room not in list — refresh or check code");
      return;
    }
    await joinById(hit.id);
  };

  const startHand = async () => {
    if (!active || !userId) return;
    if (active.created_by !== userId) {
      setMsg("Only the host can deal");
      return;
    }
    setBusy(true);
    const { room, error } = await pokerApi("start", {
      roomId: active.id,
      chainId,
      token,
      displayNames: seatLabels,
    });
    setBusy(false);
    if (error) setMsg(error);
    else if (room) setActive(room);
  };

  const act = async (action: PokerAction) => {
    if (!active || !userId) return;
    const seat = mySeatInRoom(active, userId);
    if (seat === null) return;
    setBusy(true);
    const { room, error } = await pokerApi("action", {
      roomId: active.id,
      action,
      chainId,
      token,
    });
    setBusy(false);
    if (error) setMsg(error);
    else if (room) setActive(room);
  };

  const mySeat = active && userId ? mySeatInRoom(active, userId) : null;
  const session = active?.session_json ?? null;
  const state = session?.state as PokerState | undefined;
  const legal =
    state && mySeat !== null ? legalActionsForSeat(state, mySeat) : [];
  const labelForUid = (uid: string | null) =>
    uid ? (uid === userId ? "You" : seatLabels[uid] ?? "Player") : "open";

  const enforceTimeout = useCallback(async () => {
    if (!active?.id || !state || state.activeSeat === null) return;
    if (!state.players[state.activeSeat]?.isHuman) return;
    const key = `${active.version}-${state.activeSeat}`;
    if (timeoutKeyRef.current === key) return;
    const elapsed = pokerTurnElapsedMs(active);
    if (elapsed < POKER_TURN_MS) return;
    timeoutKeyRef.current = key;
    const { room, error } = await pokerApi("timeout", {
      roomId: active.id,
      chainId,
      token,
    });
    if (room) setActive(room);
    else if (error && !/not expired|No human/i.test(error)) setMsg(error);
  }, [active, state, chainId, token]);

  useEffect(() => {
    if (!active || active.status !== "active" || !state || state.activeSeat === null) return;
    if (!state.players[state.activeSeat]?.isHuman) return;
    const id = setInterval(() => void enforceTimeout(), 2000);
    return () => clearInterval(id);
  }, [active?.id, active?.version, active?.turn_started_at, active?.updated_at, state?.activeSeat, enforceTimeout]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-400/20 bg-gradient-to-r from-amber-500/10 via-transparent to-violet-500/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className={pillGold}>Texas Hold&apos;em · live</span>
          <p className="text-xs text-white/55 mt-1.5 max-w-md">
            Host a private 6-max table · realtime Supabase sync · 45s turn clock · server-validated actions
          </p>
        </div>
        <span className={pillLive}>Realtime</span>
      </div>

      {!userId && (
        <p className="text-sm text-amber-200/80 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3">
          Sign in to host or join a live table.
        </p>
      )}

      {msg && <p className="text-sm text-rose-300">{msg}</p>}

      {!active ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={!userId || busy} onClick={host}>
              Host new table
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={refreshList}>
              Refresh lobby
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls + " max-w-[8rem] uppercase tracking-widest"}
              placeholder="ROOM"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              maxLength={6}
            />
            <button type="button" className={btnSecondary} disabled={!userId || busy} onClick={joinByCode}>
              Join code
            </button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {rooms.length === 0 ? (
              <p className="text-sm text-white/45">No open tables — host one above.</p>
            ) : (
              rooms.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                >
                  <div>
                    <div className="font-mono text-amber-200">{r.room_code}</div>
                    <div className="text-[11px] text-white/40">
                      {humanCount(r)} seated · {r.status}
                    </div>
                  </div>
                  <button type="button" className={btnSecondary} disabled={!userId || busy} onClick={() => joinById(r.id)}>
                    Join
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className={card + " p-3 sm:p-4 overflow-hidden"}>
            {state && active.status !== "waiting" ? (
              <PokerOvalTable state={state} token={token} mySeat={mySeat} />
            ) : (
              <div className="py-16 text-center text-sm text-white/45">
                Waiting for host to deal…
              </div>
            )}
          </div>
          <div className={card + " p-4 space-y-3"}>
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-lg font-mono text-amber-200 tracking-widest">{active.room_code}</div>
                <button
                  type="button"
                  className="text-[10px] text-amber-300/80 hover:text-amber-200 uppercase tracking-wider"
                  onClick={() => {
                    void navigator.clipboard.writeText(active.room_code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
              <div className="text-xs text-white/45 mt-1">
                Seat {mySeat ?? "—"} · {humanCount(active)} / {active.max_seats} seated · {active.status}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.entries(active.seat_users).map(([seat, uid]) => (
                  <span
                    key={seat}
                    className={
                      "text-[10px] px-1.5 py-0.5 rounded border " +
                      (uid
                        ? uid === userId
                          ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
                          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200/80"
                        : "border-white/10 text-white/30")
                    }
                  >
                    {seat}:{labelForUid(uid)}
                  </span>
                ))}
              </div>
            </div>
            <button type="button" className={btnGhost} onClick={() => setActive(null)}>
              Leave lobby
            </button>
          </div>
          {active.status === "waiting" && (
            <button
              type="button"
              className={btnPrimary + " w-full"}
              disabled={busy || userId !== active.created_by}
              onClick={startHand}
            >
              {userId === active.created_by
                ? "Deal hand (bots fill empty seats)"
                : "Waiting for host to deal…"}
            </button>
          )}
          {state && active.status === "active" && mySeat !== null && mySeat === state.activeSeat && (
            <div className="space-y-2">
              <span className={pillLive + " w-full justify-center"}>Your turn</span>
              <PokerTurnTimer
                turnStartedAt={active.turn_started_at}
                updatedAt={active.updated_at}
                active
                onExpired={() => void enforceTimeout()}
              />
              <PokerActionBar state={state} seat={mySeat} token={token} legal={legal} busy={busy} onAct={act} />
            </div>
          )}
          {state && active.status === "active" && mySeat !== state.activeSeat && (
            <p className="text-xs text-center text-white/45 animate-pulse">Waiting for other players…</p>
          )}
          {state && (
            <p className="text-xs text-white/50 border-t border-white/[0.06] pt-3">
              {state.message}
            </p>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
