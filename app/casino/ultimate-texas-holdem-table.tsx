"use client";

import { useCallback, useEffect, useState } from "react";
import {
  describeScore,
  formatUltimateHoldemCards,
  newSessionId,
  persistSettledSession,
  ultimateTexasHoldemGame,
  ultimateTexasHoldemRtpLabel,
  type Card,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
  type UltimateTexasHoldemAction,
  type UltimateTexasHoldemState,
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

const LAST_BET_KEY = "mf_casino_uth_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function MiniCard({ c, hidden }: { c?: Card; hidden?: boolean }) {
  if (hidden || !c) {
    return (
      <div className="w-10 h-14 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-white/30 shrink-0">
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

function extraForAction(action: UltimateTexasHoldemAction, ante: bigint): bigint {
  if (action.type === "bet_4x") return ante * 4n;
  if (action.type === "bet_2x") return ante * 2n;
  if (action.type === "bet_1x") return ante;
  return 0n;
}

export default function UltimateTexasHoldemTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<UltimateTexasHoldemAction, UltimateTexasHoldemState> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<
    UltimateTexasHoldemAction,
    UltimateTexasHoldemState
  > | null>(null);

  const st = session?.state ?? null;
  const inPlay = st && st.phase !== "settled";
  const settled = session?.status === "settled" && !!session.result;
  const ante = st?.stake ?? 0n;
  const showDealer = st && st.phase === "settled" && st.outcome !== "fold";

  const finishRound = useCallback(
    async (s: Session<UltimateTexasHoldemAction, UltimateTexasHoldemState>) => {
      const done = await driver.settleSession(ultimateTexasHoldemGame, s);
      setSession(done);
      pushHistory({
        game: "ultimate-texas-holdem",
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
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake * 5n) {
      setError("Need balance for ante + 4× play");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(ultimateTexasHoldemGame, {
        sessionId: newSessionId(),
        userId,
        gameId: ultimateTexasHoldemGame.id,
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
    async (action: UltimateTexasHoldemAction) => {
      if (!session || session.state.phase === "settled") return;
      setError(null);
      const extra = extraForAction(action, ante);
      if (extra > 0n && balance.available < extra) {
        setError("Insufficient balance for play bet");
        return;
      }
      setBusy(true);
      try {
        const s = (await driver.applyAction(ultimateTexasHoldemGame, session, action, extra)) as Session<
          UltimateTexasHoldemAction,
          UltimateTexasHoldemState
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
  const phaseLabel =
    st?.phase === "preflop"
      ? "Pre-flop — bet 4× or check"
      : st?.phase === "flop"
        ? "Flop — bet 2× or check"
        : st?.phase === "turn"
          ? "Turn — bet 1× or check"
          : st?.phase === "river"
            ? "River — bet 1× or fold"
            : null;

  const showBet4 = st?.phase === "preflop";
  const showBet2 = st?.phase === "flop";
  const showBet1 = st?.phase === "turn" || st?.phase === "river";
  const canCheck = st && ["preflop", "flop", "turn"].includes(st.phase);

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Ultimate Texas Hold&apos;em</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {ultimateTexasHoldemRtpLabel()}
            </span>
          </div>

          {st && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <div className={labelCls + " !text-amber-200/70"}>Board</div>
                <div className="flex flex-wrap gap-1 justify-center py-2">
                  {st.board.map((c, i) => (
                    <MiniCard key={i} c={c} hidden={i >= st.visibleBoard} />
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <div className={labelCls + " !text-emerald-200/70"}>Your hole</div>
                <div className="flex flex-wrap gap-1 justify-center py-2">
                  {st.playerHole.map((c, i) => (
                    <MiniCard key={i} c={c} />
                  ))}
                </div>
                {st.playerScore && (
                  <p className="text-center text-xs text-emerald-200/90 font-medium">
                    {describeScore(st.playerScore)}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className={labelCls}>Dealer</div>
                <div className="flex flex-wrap gap-1 justify-center py-2">
                  {showDealer
                    ? st.dealerHole.map((c, i) => <MiniCard key={i} c={c} />)
                    : [0, 1].map((i) => <MiniCard key={i} hidden />)}
                </div>
                {showDealer && st.dealerScore && (
                  <p className="text-center text-xs text-white/55">
                    {describeScore(st.dealerScore)}
                    {st.dealerQualified === false ? " · no qualify" : ""}
                  </p>
                )}
              </div>
              {st.playStake > 0n && inPlay === false && (
                <p className="text-center text-xs text-white/50">
                  Play bet {fmtMoney(st.playStake, token)}
                </p>
              )}
            </div>
          )}

          {!st && (
            <p className="text-sm text-white/45 text-center py-2">
              Ante plus one play bet (4×, 2×, or 1×). Dealer needs a pair to qualify.
            </p>
          )}

          {inPlay && st.playStake === 0n && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {showBet4 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "bet_4x" })}
                    className={btnPrimary + " w-full"}
                  >
                    4× Play
                  </button>
                )}
                {showBet2 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "bet_2x" })}
                    className={btnPrimary + " w-full"}
                  >
                    2× Play
                  </button>
                )}
                {showBet1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "bet_1x" })}
                    className={btnPrimary + " w-full"}
                  >
                    1× Play
                  </button>
                )}
                {canCheck && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "check" })}
                    className={btnSecondary + " w-full"}
                  >
                    Check
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ type: "fold" })}
                  className={btnDanger + " w-full"}
                >
                  Fold
                </button>
              </div>
            </div>
          )}

          {phaseLabel && inPlay && <p className="text-center text-xs text-amber-200/80">{phaseLabel}</p>}

          {!inPlay && (
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
          title="Ultimate Texas Hold'em · verify"
          description="Replay nine card draws and street actions from the revealed seed."
          session={verifyTarget as Session<unknown, UltimateTexasHoldemState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(ultimateTexasHoldemGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "ultimate-texas-holdem",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatUltimateHoldemCards(verifyTarget.state.playerHole)} />
              <VerifyField label="Board" value={formatUltimateHoldemCards(verifyTarget.state.board)} />
              <VerifyField label="Dealer" value={formatUltimateHoldemCards(verifyTarget.state.dealerHole)} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome ?? "—"} />
            </>
          }
        />
      )}
    </div>
  );
}
