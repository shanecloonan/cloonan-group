"use client";

import { useCallback, useEffect, useState } from "react";
import {
  describeScore,
  formatLetItRideCards,
  letItRideGame,
  letItRidePayReturn,
  letItRideQualifies,
  letItRideRtpLabel,
  newSessionId,
  persistSettledSession,
  type Card,
  type ChainAdapter,
  type ChainId,
  type LetItRideAction,
  type LetItRideState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnGhost, btnPrimary, btnSecondary, card, inputCls, labelCls } from "./casino-ui";

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

const LAST_BET_KEY = "mf_casino_lir_bet";

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

function BetPill({ n, active }: { n: 1 | 2 | 3; active: boolean }) {
  return (
    <span
      className={
        "text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full border " +
        (active
          ? "border-emerald-400/40 text-emerald-200 bg-emerald-500/15"
          : "border-white/15 text-white/40 bg-white/[0.03] line-through")
      }
    >
      Bet {n}
    </span>
  );
}

export default function LetItRideTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<LetItRideAction, LetItRideState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<LetItRideAction, LetItRideState> | null>(null);

  const st = session?.state ?? null;
  const inPlay = st && st.phase !== "settled";
  const settled = session?.status === "settled" && !!session.result;
  const showComm0 = st && st.phase !== "decision_1";
  const showComm1 = st && st.phase === "settled";

  const finishRound = useCallback(
    async (s: Session<LetItRideAction, LetItRideState>) => {
      const done = await driver.settleSession(letItRideGame, s);
      setSession(done);
      pushHistory({
        game: "let-it-ride",
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
    const unit = humanToUnits(betAmount, token);
    const stake = unit * 3n;
    if (unit <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake) {
      setError("Need balance for 3 equal bets");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(letItRideGame, {
        sessionId: newSessionId(),
        userId,
        gameId: letItRideGame.id,
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
    async (action: LetItRideAction) => {
      if (!session || session.state.phase === "settled") return;
      setError(null);
      setBusy(true);
      try {
        const s = (await driver.applyAction(letItRideGame, session, action)) as Session<
          LetItRideAction,
          LetItRideState
        >;
        setSession(s);
        if (s.state.phase === "settled") await finishRound(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [driver, finishRound, session],
  );

  const seedPair = getSeedPair();
  const phaseLabel =
    st?.phase === "decision_1"
      ? "Pull bet 1 or let it ride"
      : st?.phase === "decision_2"
        ? "Pull bet 2 or let it ride (bet 3 rides)"
        : null;

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Let It Ride</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {letItRideRtpLabel()}
            </span>
          </div>

          {st && (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-center gap-2">
                <BetPill n={1} active={st.bet1Active} />
                <BetPill n={2} active={st.bet2Active} />
                <BetPill n={3} active={st.bet3Active} />
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <div className={labelCls + " !text-emerald-200/70"}>Your cards</div>
                <div className="flex flex-wrap gap-1 justify-center py-2">
                  {st.playerCards.map((c, i) => (
                    <MiniCard key={i} c={c} />
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <div className={labelCls + " !text-amber-200/70"}>Community</div>
                <div className="flex flex-wrap gap-1 justify-center py-2">
                  <MiniCard c={st.community[0]} hidden={!showComm0} />
                  <MiniCard c={st.community[1]} hidden={!showComm1} />
                </div>
              </div>
              {st.handScore && (
                <p className="text-center text-sm text-white/70">
                  {describeScore(st.handScore)}
                  {letItRideQualifies(st.handScore)
                    ? ` · pays ${letItRidePayReturn(st.handScore) - 1}:1 per riding bet`
                    : " · pair of 10s or better required"}
                </p>
              )}
            </div>
          )}

          {!st && (
            <p className="text-sm text-white/45 text-center py-2">
              Three equal bets. Pull bet 1 after your cards, bet 2 after the first community card.
            </p>
          )}

          {st?.phase === "decision_1" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ type: "pull_bet1" })}
                className={btnSecondary + " w-full"}
              >
                Pull bet 1
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ type: "ride_bet1" })}
                className={btnPrimary + " w-full"}
              >
                Let bet 1 ride
              </button>
            </div>
          )}

          {st?.phase === "decision_2" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ type: "pull_bet2" })}
                className={btnSecondary + " w-full"}
              >
                Pull bet 2
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ type: "ride_bet2" })}
                className={btnPrimary + " w-full"}
              >
                Let bet 2 ride
              </button>
            </div>
          )}

          {phaseLabel && <p className="text-center text-xs text-amber-200/80">{phaseLabel}</p>}

          {!inPlay && (
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1 min-w-0">
                <label className={labelCls}>Per bet ({token.symbol}) · 3× total</label>
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
          <section className={card + " p-4 text-[11px] text-white/45 leading-relaxed"}>
            {"Pair of 10s+ pays even money up to 25:1 on a royal. Pulled bets return with no win/loss."}
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
          title="Let It Ride · verify hand"
          description="Replay five card draws and pull/ride decisions from the revealed seed."
          session={verifyTarget as Session<unknown, LetItRideState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(letItRideGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "let-it-ride",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatLetItRideCards(verifyTarget.state.playerCards)} />
              <VerifyField label="Board" value={formatLetItRideCards(verifyTarget.state.community)} />
              <VerifyField
                label="Bets"
                value={`${verifyTarget.state.bet1Active ? "1" : "—"} / ${verifyTarget.state.bet2Active ? "2" : "—"} / ${verifyTarget.state.bet3Active ? "3" : "—"}`}
              />
            </>
          }
        />
      )}
    </div>
  );
}
