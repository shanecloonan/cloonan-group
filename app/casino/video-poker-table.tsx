"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cardLabel,
  newSessionId,
  persistSettledSession,
  rtpLabel,
  suggestHold,
  videoPokerGame,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
  type VideoPokerAction,
  type VideoPokerState,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnPrimary, btnSecondary, card, inputCls, labelCls } from "./casino-ui";

const PAY_TABLE: { hand: string; pay: string }[] = [
  { hand: "Royal flush", pay: "800×" },
  { hand: "Straight flush", pay: "50×" },
  { hand: "Four of a kind", pay: "25×" },
  { hand: "Full house", pay: "9×" },
  { hand: "Flush", pay: "6×" },
  { hand: "Straight", pay: "4×" },
  { hand: "Three of a kind", pay: "3×" },
  { hand: "Two pair", pay: "2×" },
  { hand: "Jacks or better", pay: "2×" },
];

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

const LAST_BET_KEY = "mf_casino_vp_last_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function VideoPokerTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<VideoPokerAction, VideoPokerState> | null>(null);
  const [hold, setHold] = useState<boolean[]>([false, false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<VideoPokerAction, VideoPokerState> | null>(
    null,
  );

  const dealing = session?.state.phase === "holding";
  const settled = session?.state.phase === "settled";

  const deal = useCallback(async () => {
    setError(null);
    setSession(null);
    const stake = humanToUnits(betAmount, token);
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake) {
      setError("Insufficient balance");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(videoPokerGame, {
        sessionId: newSessionId(),
        userId,
        gameId: videoPokerGame.id,
        chainId,
        token,
        stake,
        config: {},
      });
      setSession(s);
      setHold([false, false, false, false, false]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, betAmount, chainId, driver, token, userId]);

  const draw = useCallback(async () => {
    if (!session || session.state.phase !== "holding") return;
    setError(null);
    setBusy(true);
    try {
      const h = hold as [boolean, boolean, boolean, boolean, boolean];
      let next = await driver.applyAction(videoPokerGame, session, {
        type: "draw",
        hold: h,
      } as VideoPokerAction);
      next = await driver.settleSession(videoPokerGame, next);
      setSession(next);
      pushHistory({
        game: "video-poker",
        stakeUnits: next.result!.totalStakedUnits,
        pnlUnits: next.result!.pnlUnits,
        multiplier:
          Number(next.result!.totalPayoutUnits) / Math.max(1, Number(next.result!.totalStakedUnits)),
        session: next as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(
        next as unknown as Parameters<typeof persistSettledSession>[0],
        getSeedPair(),
      );
      await refreshBalance();
      setTimeout(() => {
        setSession(null);
        setVerifyTarget(null);
      }, 2200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [driver, getSeedPair, hold, pushHistory, refreshBalance, session]);

  const toggleHold = (i: number) => {
    if (!dealing) return;
    setHold((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };

  const seedPair = getSeedPair();
  const cards = session?.state.cards ?? [];

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Jacks or Better</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">RTP {rtpLabel()}</span>
          </div>

          <div className="flex flex-wrap justify-center gap-2 sm:gap-3 min-h-[100px]">
            {(dealing || settled) && cards.length === 5
              ? cards.map((c, i) => (
                  <button
                    key={`${c.index}-${i}`}
                    type="button"
                    disabled={!dealing || busy}
                    onClick={() => toggleHold(i)}
                    className={
                      "min-w-[3.25rem] sm:min-w-[3.75rem] min-h-[4.5rem] touch-manipulation rounded-xl border-2 text-lg sm:text-xl font-mono transition-all cursor-pointer disabled:cursor-default " +
                      (hold[i]
                        ? "border-amber-400/70 bg-amber-500/15 text-amber-50 shadow-[0_0_16px_rgba(245,158,11,0.15)]"
                        : "border-white/[0.12] bg-white/[0.04] text-white/90 hover:border-white/25")
                    }
                  >
                    {cardLabel(c)}
                    {hold[i] && dealing && (
                      <span className="block text-[8px] uppercase tracking-wider text-amber-300/80 mt-0.5">
                        Hold
                      </span>
                    )}
                  </button>
                ))
              : (
                <p className="text-sm text-white/45 py-6">Deal to receive five cards.</p>
              )}
          </div>

          {settled && session?.result && (
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
              {session.state.handLabel} ·{" "}
              {session.result.pnlUnits > 0n ? "+" : ""}
              {fmtMoney(session.result.pnlUnits, token)}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0">
              <label className={labelCls}>Bet ({token.symbol})</label>
              <input
                type="number"
                min="0"
                step="any"
                className={inputCls}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                disabled={busy || dealing}
              />
            </div>
            {!session && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void deal()}
                className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
              >
                Deal
              </button>
            )}
            {dealing && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setHold(suggestHold(cards))}
                  className={btnSecondary + " w-full sm:w-auto"}
                >
                  Suggest hold
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void draw()}
                  className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
                >
                  Draw
                </button>
              </>
            )}
          </div>

          {error && <p className="text-sm text-rose-300">{error}</p>}
          {dealing && (
            <p className="text-[11px] text-white/40 text-center">Tap cards to hold, then Draw.</p>
          )}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Pay table (per 1× stake)</div>
            <ul className="mt-2 space-y-1 text-[11px] text-white/55">
              {PAY_TABLE.map((row) => (
                <li key={row.hand} className="flex justify-between gap-2">
                  <span>{row.hand}</span>
                  <span className="font-mono text-white/75">{row.pay}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
            <button
              type="button"
              onClick={() => rotateSeed()}
              className={btnSecondary + " mt-3 w-full !text-[10px]"}
            >
              Rotate seed
            </button>
          </section>
        </aside>
      </div>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Video Poker · verify hand"
          description="Replay the deal and draw from the revealed server seed."
          session={verifyTarget as Session<unknown, VideoPokerState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(videoPokerGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "video-poker",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Final hand" value={verifyTarget.state.handLabel ?? "—"} />
              <VerifyField label="Pay" value={`${verifyTarget.state.payMultiplier}×`} />
            </>
          }
        />
      )}
    </div>
  );
}
