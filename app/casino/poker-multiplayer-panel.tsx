"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { HUMAN_SEAT, pokerGame, type ChainId, type PokerAction, type PokerState, type TokenSpec } from "@/lib/casino";
import {
  mySeatInRoom,
  listPokerRooms,
  createPokerRoom,
  joinPokerRoom,
  startPokerRoomHand,
  applyPokerRoomAction,
  subscribePokerRoom,
  humanCount,
  type PokerRoomRow,
} from "@/lib/casino/poker-multiplayer";
import { useCasino } from "./casino-context";
import { PokerActionBar } from "./poker-action-bar";
import { PokerOvalTable } from "./poker-table-visual";
import { btnGhost, btnPrimary, btnSecondary, card, inputCls, pillGold, pillLive } from "./casino-ui";
import { persistSettledSession } from "@/lib/casino";

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  return BigInt(Math.floor(amount * Number(denom)));
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
  const { getSeedPair, pushHistory, refreshBalance } = useCasino();
  const settledRoomRef = useRef<string | null>(null);

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
    if (!active?.id) return;
    return subscribePokerRoom(active.id, (room) => {
      setActive(room);
      if (room.status === "complete" && room.session_json) {
        const sess = room.session_json;
        if (sess.status === "settled" && sess.result && settledRoomRef.current !== room.id) {
          settledRoomRef.current = room.id;
          pushHistory({
            game: "poker",
            stakeUnits: sess.result.totalStakedUnits,
            pnlUnits: sess.result.pnlUnits,
            multiplier:
              Number(sess.result.totalPayoutUnits) / Math.max(1, Number(sess.result.totalStakedUnits)),
            session: sess,
          });
          void persistSettledSession(sess, getSeedPair());
          void refreshBalance();
        }
      }
    });
  }, [active?.id, getSeedPair, pushHistory, refreshBalance]);

  const host = async () => {
    setBusy(true);
    setMsg(null);
    const buyIn = humanToUnits(buyInHuman, token);
    const bb = buyIn / 50n;
    const sb = bb / 2n;
    const { room, error } = await createPokerRoom({ buyIn, bigBlind: bb, smallBlind: sb });
    setBusy(false);
    if (error) setMsg(error);
    else if (room) {
      setActive(room);
      refreshList();
    }
  };

  const joinById = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const { room, error } = await joinPokerRoom(id, HUMAN_SEAT);
    setBusy(false);
    if (error) setMsg(error);
    else if (room) setActive(room);
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
    setBusy(true);
    const { room, error } = await startPokerRoomHand(active, chainId, token, userId);
    setBusy(false);
    if (error) setMsg(error);
    else if (room) setActive(room);
  };

  const act = async (action: PokerAction) => {
    if (!active || !userId) return;
    const seat = mySeatInRoom(active, userId);
    if (seat === null) return;
    setBusy(true);
    const { room, error } = await applyPokerRoomAction(active, seat, action, chainId, token, userId);
    setBusy(false);
    if (error) setMsg(error);
    else if (room) setActive(room);
  };

  const mySeat = active && userId ? mySeatInRoom(active, userId) : null;
  const session = active?.session_json ?? null;
  const state = session?.state as PokerState | undefined;
  const legal = state && mySeat !== null ? pokerGame.legalActions(state) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={pillGold}>Multiplayer · beta</span>
        <p className="text-xs text-white/50">Shared tables sync via Supabase Realtime. Sign in required.</p>
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
                Seat {mySeat ?? "—"} · {humanCount(active)} humans · {active.status}
              </div>
            </div>
            <button type="button" className={btnGhost} onClick={() => setActive(null)}>
              Leave lobby
            </button>
          </div>
          {active.status === "waiting" && (
            <button type="button" className={btnPrimary + " w-full"} disabled={busy} onClick={startHand}>
              Deal hand (bots fill empty seats)
            </button>
          )}
          {state && active.status === "active" && mySeat !== null && mySeat === state.activeSeat && (
            <div className="space-y-2">
              <span className={pillLive + " w-full justify-center"}>Your turn</span>
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
