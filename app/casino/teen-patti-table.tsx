"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatTeenPattiHand,
  newSessionId,
  persistSettledSession,
  teenPattiGame,
  teenPattiRtpLabel,
  threeCardHandLabel,
  type Card,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TeenPattiAction,
  type TeenPattiState,
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

const LAST_BET_KEY = "mf_casino_tp_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function MiniCard({ c }: { c: Card }) {
  const red = c.suit === "♥" || c.suit === "♦";
  return (
    <div
      className={
        "w-11 h-15 sm:w-12 sm:h-16 rounded-lg border border-white/15 flex flex-col items-center justify-center font-mono shrink-0 " +
        (red ? "text-rose-300 bg-rose-950/30" : "text-white bg-white/[0.06]")
      }
    >
      <span className="text-sm font-bold">{c.rank}</span>
      <span className="text-xs">{c.suit}</span>
    </div>
  );
}

export default function TeenPattiTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<TeenPattiAction, TeenPattiState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<TeenPattiAction, TeenPattiState> | null>(null);

  const st = session?.state ?? null;
  const inTurn = st?.phase === "player_turn";
  const settled = session?.status === "settled" && !!session.result;
  const showDealer = st && !inTurn;

  const finishRound = useCallback(
    async (s: Session<TeenPattiAction, TeenPattiState>) => {
      const done = await driver.settleSession(teenPattiGame, s);
      setSession(done);
      pushHistory({
        game: "teen-patti",
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
    if (inTurn) {
      setError("Finish the current hand first");
      return;
    }
    if (settled) setSession(null);
    const stake = humanToUnits(betAmount, token);
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake * 2n) {
      setError("Need balance for ante + play");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(teenPattiGame, {
        sessionId: newSessionId(),
        userId,
        gameId: teenPattiGame.id,
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
  }, [balance.available, betAmount, chainId, driver, inTurn, settled, token, userId]);

  const act = useCallback(
    async (action: TeenPattiAction) => {
      if (!session || session.state.phase !== "player_turn") return;
      setError(null);
      setBusy(true);
      try {
        const extra = action.type === "play" ? session.stake : 0n;
        if (action.type === "play" && balance.available < extra) {
          setError("Insufficient balance for play");
          return;
        }
        let s = (await driver.applyAction(teenPattiGame, session, action, extra)) as Session<
          TeenPattiAction,
          TeenPattiState
        >;
        setSession(s);
        await finishRound(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [balance.available, driver, finishRound, session],
  );

  const seedPair = getSeedPair();

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Teen Patti</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {teenPattiRtpLabel()}
            </span>
          </div>

          {st && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-orange-500/25 bg-orange-500/5 p-3">
                <div className={labelCls + " !text-orange-200/70"}>Your hand</div>
                <div className="flex gap-1.5 justify-center py-2">
                  {st.playerCards.map((c, i) => (
                    <MiniCard key={i} c={c} />
                  ))}
                </div>
                {st.playerScore && (
                  <p className="text-center text-xs text-orange-200/90 font-medium">
                    {threeCardHandLabel(st.playerScore)}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className={labelCls}>Dealer</div>
                <div className="flex gap-1.5 justify-center py-2">
                  {inTurn
                    ? [0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-11 h-15 sm:w-12 sm:h-16 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-white/30"
                        >
                          ?
                        </div>
                      ))
                    : st.dealerCards.map((c, i) => (
                        <MiniCard key={i} c={c} />
                      ))}
                </div>
                {showDealer && st.dealerScore && (
                  <p className="text-center text-xs text-white/55">
                    {threeCardHandLabel(st.dealerScore)}
                  </p>
                )}
              </div>
            </div>
          )}

          {!st && (
            <p className="text-sm text-white/45 text-center py-4">
              Ante plus Play (1× ante). Trail beats sequence beats color — head-to-head vs dealer.
            </p>
          )}

          {inTurn && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ type: "play" })}
                className={btnPrimary + " w-full"}
              >
                Play (+{fmtMoney(session!.stake, token)})
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

          {!inTurn && (
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1 min-w-0">
                <label className={labelCls}>Ante ({token.symbol})</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputCls}
                  value={betAmount}
                  onChange={(e) => setBetAmount(Number(e.target.value))}
                  disabled={busy || inTurn}
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
          title="Teen Patti · verify hand"
          description="Replay six card draws and fold/play from the revealed seed."
          session={verifyTarget as Session<unknown, TeenPattiState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(teenPattiGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "teen-patti",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatTeenPattiHand(verifyTarget.state.playerCards)} />
              <VerifyField label="Dealer" value={formatTeenPattiHand(verifyTarget.state.dealerCards)} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome ?? "—"} />
            </>
          }
        />
      )}
    </div>
  );
}
