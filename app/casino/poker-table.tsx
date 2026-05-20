"use client";

import { useCallback, useRef, useState } from "react";
import {
  HUMAN_SEAT,
  newSessionId,
  pickBotAction,
  pokerGame,
  type ChainAdapter,
  type ChainId,
  type PokerAction,
  type PokerActionType,
  type PokerState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { ShareLinkRow } from "./share-link";
import { PokerMultiplayerPanel } from "./poker-multiplayer-panel";
import { PokerOvalTable } from "./poker-table-visual";
import { btnGhost, btnPrimary, btnSecondary, card, inputCls, labelCls, pillGold } from "./casino-ui";
import { persistSettledSession } from "@/lib/casino";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  return Number(units) / Number(denom);
}

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  return BigInt(Math.floor(amount * Number(denom)));
}

function fmt(units: bigint, token: TokenSpec): string {
  return `${unitsToHuman(units, token).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token.symbol}`;
}

export default function PokerTable({ chainId, token }: Props) {
  const {
    driver,
    getSeedPair,
    balance,
    refreshBalance,
    pushHistory,
    depositPlayMoney,
    lastRevealedSeed,
    dismissRevealedSeed,
  } = useCasino();

  const [session, setSession] = useState<Session<PokerAction, PokerState> | null>(null);
  const [buyIn, setBuyIn] = useState(100);
  const [mode, setMode] = useState<"solo" | "multi">("solo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningBots = useRef(false);

  const legal = session ? pokerGame.legalActions(session.state) : [];
  const legalTypes = new Set(legal.map((a) => a.type + (a.raiseTo ? `:${a.raiseTo}` : "")));

  const advanceBots = useCallback(
    async (sess: Session<PokerAction, PokerState>): Promise<Session<PokerAction, PokerState>> => {
      let s = sess;
      let guard = 0;
      while (!pokerGame.isTerminal(s.state) && guard < 120) {
        guard++;
        if (s.state.activeSeat === null) {
          try {
            s = await driver.applyAction(pokerGame, s, { type: "advance_street" });
          } catch {
            break;
          }
          continue;
        }
        if (s.state.activeSeat === HUMAN_SEAT) break;
        const action = pickBotAction(s.state);
        try {
          s = await driver.applyAction(pokerGame, s, action);
        } catch {
          break;
        }
      }
      return s;
    },
    [driver, getSeedPair],
  );

  const settleIfDone = useCallback(
    async (sess: Session<PokerAction, PokerState>) => {
      if (!pokerGame.isTerminal(sess.state)) return sess;
      const settled = await driver.settleSession(pokerGame, sess);
      const result = settled.result!;
      pushHistory({
        game: "poker",
        stakeUnits: result.totalStakedUnits,
        pnlUnits: result.pnlUnits,
        multiplier: Number(result.totalPayoutUnits) / Math.max(1, Number(result.totalStakedUnits)),
        session: settled,
      });
      void persistSettledSession(settled, getSeedPair());
      await refreshBalance();
      return settled;
    },
    [driver, getSeedPair, pushHistory, refreshBalance],
  );

  const syncTable = useCallback(
    async (sess: Session<PokerAction, PokerState>): Promise<Session<PokerAction, PokerState>> => {
      let s = await advanceBots(sess);
      if (pokerGame.isTerminal(s.state)) {
        return await settleIfDone(s);
      }
      return s;
    },
    [advanceBots, settleIfDone],
  );

  const joinTable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const stake = humanToUnits(buyIn, token);
      if (stake <= 0n) throw new Error("Invalid buy-in");
      if (balance.available < stake) throw new Error("Insufficient balance");

      const bet = {
        sessionId: newSessionId(),
        userId: getSeedPair().userId,
        gameId: "poker" as const,
        chainId,
        token,
        stake,
        config: { bigBlind: stake / 50n },
      };
      let s = await driver.openSession(pokerGame, bet);
      await refreshBalance();
      s = await syncTable(s);
      setSession(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, buyIn, chainId, driver, getSeedPair, refreshBalance, syncTable, token]);

  const apply = useCallback(
    async (action: PokerAction) => {
      if (!session) return;
      setError(null);
      setBusy(true);
      try {
        let s = await driver.applyAction(pokerGame, session, action);
        s = await syncTable(s);
        setSession(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [driver, session, syncTable],
  );

  const clearTable = () => {
    setSession(null);
    setError(null);
  };

  const st = session?.state;
  const terminal = st ? pokerGame.isTerminal(st) : false;
  const human = st?.players[HUMAN_SEAT];
  const toCall = st && human ? st.currentBet - human.betThisRound : 0n;

  return (
    <div className="mt-6 space-y-6">
      <section className={card + " p-5 flex flex-wrap items-center justify-between gap-4"}>
        <div>
          <h2 className="text-xl font-semibold text-white font-heading">Texas Hold&apos;em · 6-Max</h2>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className={
                "h-8 px-3 rounded-lg text-xs font-medium border cursor-pointer " +
                (mode === "solo"
                  ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                  : "border-white/10 text-white/50")
              }
              onClick={() => setMode("solo")}
            >
              Solo vs bots
            </button>
            <button
              type="button"
              className={
                "h-8 px-3 rounded-lg text-xs font-medium border cursor-pointer " +
                (mode === "multi"
                  ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                  : "border-white/10 text-white/50")
              }
              onClick={() => setMode("multi")}
            >
              Multiplayer lobby
            </button>
          </div>
          <p className="text-sm text-white/50 mt-2">
            {mode === "solo"
              ? "Private table vs five AI opponents · 1% rake · provably fair shuffle"
              : "Host or join a shared table — realtime sync for signed-in players"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Balance</div>
          <div className="font-mono text-emerald-300">{fmt(balance.available, token)}</div>
        </div>
      </section>

      {mode === "multi" ? (
        <section className={card + " p-5"}>
          <PokerMultiplayerPanel chainId={chainId} token={token} buyInHuman={buyIn} />
        </section>
      ) : (
      <section className={card + " relative p-3 sm:p-4 overflow-hidden"}>
        {st ? (
          <PokerOvalTable state={st} token={token} mySeat={HUMAN_SEAT} />
        ) : null}

        {!session && (
          <div className="relative z-20 flex flex-col items-center justify-center min-h-[480px] gap-4">
            <span className={pillGold}>Private table</span>
            <p className="text-white/50 text-sm max-w-sm text-center">
              Buy in to sit seat 1. Blinds scale with your buy-in. Beat the table and cash out your stack.
            </p>
            <div className="w-48">
              <label className={labelCls}>Buy-in ({token.symbol})</label>
              <input
                type="number"
                className={inputCls}
                value={buyIn}
                min={10}
                step={10}
                onChange={(e) => setBuyIn(Number(e.target.value))}
              />
            </div>
            <button type="button" className={btnPrimary} disabled={busy} onClick={joinTable}>
              Take a seat
            </button>
            {chainId === "dev-mock" && (
              <button type="button" className={btnGhost} onClick={() => depositPlayMoney(humanToUnits(10000, token))}>
                +10k play money
              </button>
            )}
          </div>
        )}

        {st && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-lg px-4">
            <div className="rounded-xl bg-black/70 border border-white/10 backdrop-blur-md p-3 text-center">
              <p className="text-sm text-amber-100/90">{st.message}</p>
              <p className="text-xs text-white/40 mt-1">
                Pot {fmt(st.pot, token)}
                {st.phase !== "complete" && ` · ${st.phase}`}
                {toCall > 0n && human && !human.folded && ` · Call ${fmt(toCall, token)}`}
              </p>
            </div>
          </div>
        )}
      </section>
      )}

      {mode === "solo" && session && !terminal && (
        <section className={card + " p-4 flex flex-wrap gap-2 justify-center"}>
          <ActionBtn label="Fold" disabled={busy || !legalTypes.has("fold")} onClick={() => apply({ type: "fold" })} danger />
          <ActionBtn
            label={toCall === 0n ? "Check" : "Call"}
            disabled={busy || (!legalTypes.has("check") && !legalTypes.has("call"))}
            onClick={() => apply({ type: toCall === 0n ? "check" : "call" })}
          />
          {legal
            .filter((a) => a.type === "raise" && a.raiseTo)
            .map((a, i) => (
              <ActionBtn
                key={i}
                label={a.raiseTo === human!.betThisRound + human!.stack ? "All-in" : `Raise ${fmt(a.raiseTo!, token)}`}
                disabled={busy}
                onClick={() => apply(a)}
                accent
              />
            ))}
        </section>
      )}

      {mode === "solo" && terminal && session?.result && (
        <section className={card + " p-5 space-y-3"}>
          <h3 className="text-lg font-semibold text-white">Hand complete</h3>
          <p className={"font-mono text-lg " + (session.result.pnlUnits >= 0n ? "text-emerald-300" : "text-rose-300")}>
            {(session.result.pnlUnits >= 0n ? "+" : "") + fmt(session.result.pnlUnits, token)}
          </p>
          {st?.winners.map((w, i) => (
            <p key={i} className="text-sm text-white/60">
              {st.players[w.seat].name}: {w.hand} · {fmt(w.amount, token)}
            </p>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="button" className={btnPrimary} onClick={clearTable}>
              New hand
            </button>
            <ShareLinkRow session={session} serverSeed={lastRevealedSeed?.serverSeed ?? null} />
          </div>
        </section>
      )}

      {error && (
        <p className="text-sm text-rose-300 border border-rose-500/30 rounded-lg px-4 py-2 bg-rose-500/10">{error}</p>
      )}
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  danger,
  accent,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
}) {
  const cls = danger ? btnGhost + " !border-rose-400/40 !text-rose-200" : accent ? btnPrimary : btnSecondary;
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
