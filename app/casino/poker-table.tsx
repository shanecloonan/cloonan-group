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
import { CasinoVerifyModal } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { ShareLinkRow } from "./share-link";
import { PokerActionBar } from "./poker-action-bar";
import { PokerMultiplayerPanel } from "./poker-multiplayer-panel";
import { PokerOvalTable } from "./poker-table-visual";
import { btnGhost, btnPrimary, btnSecondary, card, inputCls, labelCls, pillGold } from "./casino-ui";
import { persistSettledSession } from "@/lib/casino";
import { fmtMoney, humanToUnits } from "./table-kit";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
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
  const [verifyTarget, setVerifyTarget] = useState<Session<PokerAction, PokerState> | null>(null);
  const [buyIn, setBuyIn] = useState(100);
  const [mode, setMode] = useState<"solo" | "multi">("solo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seedPair = getSeedPair();
  const runningBots = useRef(false);

  const legal = session ? pokerGame.legalActions(session.state) : [];

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
          <div className="font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
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
                Pot {fmtMoney(st.pot, token)}
                {st.phase !== "complete" && ` · ${st.phase}`}
                {toCall > 0n && human && !human.folded && ` · Call ${fmtMoney(toCall, token)}`}
              </p>
            </div>
          </div>
        )}
      </section>
      )}

      {mode === "solo" && session && !terminal && st && human && (
        <section className={card + " p-4"}>
          <PokerActionBar
            state={st}
            seat={HUMAN_SEAT}
            token={token}
            legal={legal}
            busy={busy}
            onAct={apply}
          />
        </section>
      )}

      {mode === "solo" && terminal && session?.result && (
        <section className={card + " p-5 space-y-3"}>
          <h3 className="text-lg font-semibold text-white">Hand complete</h3>
          <p className={"font-mono text-lg " + (session.result.pnlUnits >= 0n ? "text-emerald-300" : "text-rose-300")}>
            {(session.result.pnlUnits >= 0n ? "+" : "") + fmtMoney(session.result.pnlUnits, token)}
          </p>
          {st?.winners.map((w, i) => (
            <p key={i} className="text-sm text-white/60">
              {st.players[w.seat].name}: {w.hand} · {fmtMoney(w.amount, token)}
            </p>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className={btnPrimary} onClick={clearTable}>
              New hand
            </button>
            <button type="button" className={btnSecondary} onClick={() => setVerifyTarget(session)}>
              Verify hand
            </button>
            <ShareLinkRow session={session} serverSeed={lastRevealedSeed?.serverSeed ?? null} />
          </div>
        </section>
      )}

      {verifyTarget && (
        <CasinoVerifyModal
          title="Verify poker hand"
          description={
            <>
              Paste the revealed <span className="text-emerald-300">server seed</span>. We replay the shuffle and
              every action with the same HMAC stream used at deal time.
            </>
          }
          session={verifyTarget}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => setVerifyTarget(null)}
          resultLabel="Replayed final state matches recorded outcome"
          runVerify={(serverSeed) =>
            runSessionVerify(pokerGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: pokerGame.id,
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { bigBlind: verifyTarget.state.config.bigBlind },
            })
          }
        />
      )}

      {error && (
        <p className="text-sm text-rose-300 border border-rose-500/30 rounded-lg px-4 py-2 bg-rose-500/10">{error}</p>
      )}
    </div>
  );
}

