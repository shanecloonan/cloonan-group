"use client";

import { useCallback, useEffect, useState } from "react";
import {
  describeScore,
  formatMississippiStudCards,
  mississippiStudGame,
  mississippiStudPayReturn,
  mississippiStudQualifies,
  mississippiStudRtpLabel,
  newSessionId,
  persistSettledSession,
  type Card,
  type ChainAdapter,
  type ChainId,
  type MississippiStudAction,
  type MississippiStudState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnDanger, btnGhost, btnPrimary, btnSecondary, card, inputCls, labelCls } from "./casino-ui";

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  return Number(`${units / denom}.${(units % denom).toString().padStart(token.decimals, "0")}`);
}

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  const whole = BigInt(Math.floor(amount));
  const frac = BigInt(Math.round((amount - Math.floor(amount)) * Number(denom)));
  return whole * denom + frac;
}

function fmtMoney(units: bigint, token: TokenSpec): string {
  return `${unitsToHuman(units, token).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${token.symbol}`;
}

const LAST_BET_KEY = "mf_casino_ms_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function MiniCard({ c, hidden }: { c?: Card; hidden?: boolean }) {
  if (hidden || !c) {
    return (
      <div className="w-10 h-14 sm:w-11 sm:h-16 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-white/30 shrink-0">
        ?
      </div>
    );
  }
  const red = c.suit === "♥" || c.suit === "♦";
  return (
    <div
      className={
        "w-10 h-14 sm:w-11 sm:h-16 rounded-lg border border-white/15 flex flex-col items-center justify-center font-mono shrink-0 " +
        (red ? "text-rose-300 bg-rose-950/25" : "text-white/90 bg-white/[0.05]")
      }
    >
      <span className="text-xs sm:text-sm font-bold">{c.rank}</span>
      <span className="text-[10px] sm:text-xs">{c.suit}</span>
    </div>
  );
}

export default function MississippiStudTable({ chainId, token }: Props) {
  const {
    driver,
    getSeedPair,
    rotateSeed,
    balance,
    refreshBalance,
    pushHistory,
    lastRevealedSeed,
    dismissRevealedSeed,
  } = useCasino();
  const userId = getSeedPair().userId;

  const [betAmount, setBetAmount] = useState(() => {
    if (typeof window === "undefined") return 10;
    const v = Number(window.localStorage.getItem(LAST_BET_KEY));
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
  }, [betAmount]);

  const [session, setSession] = useState<Session<MississippiStudAction, MississippiStudState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<MississippiStudAction, MississippiStudState> | null>(
    null,
  );

  const st = session?.state ?? null;
  const inPlay = st && st.phase !== "settled";
  const settled = session?.status === "settled" && !!session.result;
  const ante = st?.stake ?? 0n;

  const finishRound = useCallback(
    async (s: Session<MississippiStudAction, MississippiStudState>) => {
      const done = await driver.settleSession(mississippiStudGame, s);
      setSession(done);
      pushHistory({
        game: "mississippi-stud",
        stakeUnits: done.result!.totalStakedUnits,
        pnlUnits: done.result!.pnlUnits,
        multiplier:
          Number(done.result!.totalPayoutUnits) / Math.max(1, Number(done.result!.totalStakedUnits)),
        session: done as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(done as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
      await refreshBalance();
      return done;
    },
    [driver, getSeedPair, pushHistory, refreshBalance],
  );

  const deal = useCallback(async () => {
    setError(null);
    if (inPlay) {
      setError("Finish the current hand first");
      return;
    }
    if (settled) setSession(null);
    const stake = humanToUnits(betAmount, token);
    const maxLock = stake * 7n;
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < maxLock) {
      setError("Need balance for ante + all street bets (7× ante)");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(mississippiStudGame, {
        sessionId: newSessionId(),
        userId,
        gameId: mississippiStudGame.id,
        chainId,
        token,
        stake,
        config: {},
      });
      setSession(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, betAmount, chainId, driver, inPlay, settled, token, userId]);

  const act = useCallback(
    async (action: MississippiStudAction) => {
      if (!session || session.state.phase === "settled") return;
      setError(null);
      const extra =
        action.type === "bet_1"
          ? ante
          : action.type === "bet_2"
            ? ante * 2n
            : action.type === "bet_3"
              ? ante * 3n
              : 0n;
      if (extra > 0n && balance.available < extra) {
        setError("Insufficient balance for street bet");
        return;
      }
      setBusy(true);
      try {
        const s = (await driver.applyAction(mississippiStudGame, session, action, extra)) as Session<
          MississippiStudAction,
          MississippiStudState
        >;
        setSession(s);
        if (s.state.phase === "settled") await finishRound(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [ante, balance.available, driver, finishRound, session],
  );

  const seedPair = getSeedPair();
  const streetHint =
    st?.phase === "street_2"
      ? "Bet 1× ante or fold (lose ante only)"
      : st?.phase === "street_3"
        ? "Bet 2× ante or fold"
        : st?.phase === "street_4"
          ? "Bet 3× ante or fold"
          : null;

  const betLabel =
    st?.phase === "street_2" ? "1×" : st?.phase === "street_3" ? "2×" : st?.phase === "street_4" ? "3×" : null;
  const streetBetAction: MississippiStudAction | null =
    st?.phase === "street_2"
      ? { type: "bet_1" }
      : st?.phase === "street_3"
        ? { type: "bet_2" }
        : st?.phase === "street_4"
          ? { type: "bet_3" }
          : null;

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Mississippi Stud</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {mississippiStudRtpLabel()}
            </span>
          </div>

          {st && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <div className={labelCls + " !text-emerald-200/70"}>Your hand</div>
                <div className="flex flex-wrap gap-1 justify-center py-2">
                  {st.playerCards.map((c, i) => (
                    <MiniCard key={i} c={c} hidden={i >= st.visibleCount} />
                  ))}
                </div>
                {st.handScore && (
                  <p className="text-center text-xs text-emerald-200/90 font-medium">
                    {describeScore(st.handScore)}
                    {mississippiStudQualifies(st.handScore)
                      ? ` · pays up to ${mississippiStudPayReturn(st.handScore) - 1}:1`
                      : " · pair of 6s+ required"}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-2 text-[10px] uppercase tracking-wider">
                <span className="px-2 py-1 rounded-full border border-emerald-400/35 text-emerald-200/90">
                  Ante ✓
                </span>
                <span
                  className={
                    "px-2 py-1 rounded-full border " +
                    (st.streetBet1 > 0n
                      ? "border-emerald-400/35 text-emerald-200/90"
                      : "border-white/15 text-white/40")
                  }
                >
                  1× {st.streetBet1 > 0n ? "✓" : "—"}
                </span>
                <span
                  className={
                    "px-2 py-1 rounded-full border " +
                    (st.streetBet2 > 0n
                      ? "border-emerald-400/35 text-emerald-200/90"
                      : "border-white/15 text-white/40")
                  }
                >
                  2× {st.streetBet2 > 0n ? "✓" : "—"}
                </span>
                <span
                  className={
                    "px-2 py-1 rounded-full border " +
                    (st.streetBet3 > 0n
                      ? "border-emerald-400/35 text-emerald-200/90"
                      : "border-white/15 text-white/40")
                  }
                >
                  3× {st.streetBet3 > 0n ? "✓" : "—"}
                </span>
              </div>
            </div>
          )}

          {!st && (
            <p className="text-sm text-white/45 text-center py-2">
              Ante plus optional 1×, 2×, and 3× street bets. Fold keeps prior losses only.
            </p>
          )}

          {inPlay && betLabel && streetBetAction && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(streetBetAction)}
                className={btnPrimary + " w-full"}
              >
                Bet {betLabel} ante
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ type: "fold" })}
                className={btnDanger + " w-full"}
              >
                Fold
              </button>
            </div>
          )}

          {streetHint && <p className="text-center text-xs text-amber-200/80">{streetHint}</p>}

          {!inPlay && (
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1 min-w-0">
                <label className={labelCls}>Ante ({token.symbol}) · up to 7× total</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputCls}
                  value={betAmount}
                  onChange={(e) => setBetAmount(Number(e.target.value))}
                  disabled={busy || !!inPlay}
                />
              </div>
              {!st && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deal()}
                  className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
                >
                  {busy ? "Dealing…" : "Deal"}
                </button>
              )}
            </div>
          )}

          {settled && session?.result && (
            <>
              <p
                className={
                  "text-center text-sm font-mono " +
                  (session.result.pnlUnits > 0n
                    ? "text-emerald-300"
                    : session.result.pnlUnits < 0n
                      ? "text-rose-300"
                      : "text-white/60")
                }
              >
                {session.result.pnlUnits > 0n ? "+" : ""}
                {fmtMoney(session.result.pnlUnits, token)}
              </p>
              <button
                type="button"
                onClick={() => setSession(null)}
                className={btnGhost + " w-full sm:w-auto mx-auto block"}
              >
                New hand
              </button>
            </>
          )}

          {error && <p className="text-sm text-rose-300">{error}</p>}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
          </section>
          <section className={card + " p-4"}>
            <button type="button" onClick={() => rotateSeed()} className={btnSecondary + " w-full !text-xs"}>
              Rotate seed
            </button>
            {settled && session && (
              <button
                type="button"
                onClick={() => setVerifyTarget(session)}
                className="mt-2 text-xs text-emerald-300 hover:text-emerald-200 w-full text-left cursor-pointer"
              >
                Verify →
              </button>
            )}
          </section>
        </aside>
      </div>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Mississippi Stud · verify hand"
          description="Replay five card draws and fold/street bets from the revealed seed."
          session={verifyTarget as Session<unknown, MississippiStudState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(mississippiStudGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "mississippi-stud",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Hand" value={formatMississippiStudCards(verifyTarget.state.playerCards)} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome ?? "—"} />
            </>
          }
        />
      )}
    </div>
  );
}
