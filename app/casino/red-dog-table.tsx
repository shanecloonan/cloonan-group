"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cardLabel,
  newSessionId,
  persistSettledSession,
  redDogGame,
  redDogRtpLabel,
  spreadReturnHint,
  type Card,
  type ChainAdapter,
  type ChainId,
  type RedDogAction,
  type RedDogState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnGhost, btnPrimary, card, inputCls, labelCls } from "./casino-ui";

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

const LAST_BET_KEY = "mf_casino_reddog_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function CardFace({ c, label, highlight }: { c: Card; label: string; highlight?: boolean }) {
  const red = c.suit === "♥" || c.suit === "♦";
  return (
    <div
      className={
        "flex flex-col items-center gap-1 rounded-xl border p-2 min-w-[4.5rem] " +
        (highlight ? "border-emerald-400/50 bg-emerald-500/10" : "border-white/10 bg-white/[0.04]")
      }
    >
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      <div
        className={
          "w-12 h-16 sm:w-14 sm:h-[4.5rem] rounded-lg border border-white/15 flex flex-col items-center justify-center font-mono " +
          (red ? "text-rose-300" : "text-white")
        }
      >
        <span className="text-lg sm:text-xl font-bold">{c.rank}</span>
        <span className="text-base">{c.suit}</span>
      </div>
    </div>
  );
}

export default function RedDogTable({ chainId, token }: Props) {
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

  const [lastSession, setLastSession] = useState<Session<RedDogAction, RedDogState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<RedDogAction, RedDogState> | null>(null);

  const deal = useCallback(async () => {
    setError(null);
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
      let s = await driver.openSession(redDogGame, {
        sessionId: newSessionId(),
        userId,
        gameId: redDogGame.id,
        chainId,
        token,
        stake,
        config: {},
      });
      s = await driver.settleSession(redDogGame, s);
      await new Promise((r) => setTimeout(r, 500));
      setLastSession(s);
      setVerifyTarget(s);
      pushHistory({
        game: "red-dog",
        stakeUnits: s.result!.totalStakedUnits,
        pnlUnits: s.result!.pnlUnits,
        multiplier:
          Number(s.result!.totalPayoutUnits) / Math.max(1, Number(s.result!.totalStakedUnits)),
        session: s as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(s as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
      await refreshBalance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, betAmount, chainId, driver, getSeedPair, pushHistory, refreshBalance, token, userId]);

  const st = lastSession?.state;
  const seedPair = getSeedPair();

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Red Dog</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              {st ? `RTP ${redDogRtpLabel(st.spread)}` : "Ace high · spread pays"}
            </span>
          </div>

          {st ? (
            <div className="flex justify-center items-end gap-2 sm:gap-4 flex-wrap">
              <CardFace c={st.card1} label="1st" />
              <CardFace c={st.card2} label="2nd" />
              {st.card3 ? (
                <CardFace
                  c={st.card3}
                  label="3rd"
                  highlight={st.won}
                />
              ) : (
                <div className="flex flex-col items-center justify-center min-w-[4.5rem] h-[5.5rem] rounded-xl border border-dashed border-white/15 text-[10px] text-white/40 px-2 text-center">
                  No 3rd
                  <br />
                  push
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-white/45 text-center py-6">
              Two cards set the spread — third card wins if it lands between (Ace high).
            </p>
          )}

          {st && !st.pushed && (
            <p className="text-center text-sm text-white/55 font-mono">
              Spread {st.spread}
              {st.spread >= 1 ? ` · pays ${spreadReturnHint(st.spread)}×` : ""}
            </p>
          )}

          {st && (
            <p
              className={
                "text-center text-sm font-mono " +
                (lastSession!.result!.pnlUnits > 0n
                  ? "text-emerald-300"
                  : lastSession!.result!.pnlUnits < 0n
                    ? "text-rose-300"
                    : "text-white/60")
              }
            >
              {st.pushed ? "Push" : st.won ? "Win" : "Loss"} ·{" "}
              {lastSession!.result!.pnlUnits > 0n ? "+" : ""}
              {fmtMoney(lastSession!.result!.pnlUnits, token)}
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
                disabled={busy}
              />
            </div>
            {!st ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void deal()}
                className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
              >
                {busy ? "Dealing…" : "Deal"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLastSession(null);
                  setVerifyTarget(null);
                }}
                className={btnGhost + " w-full sm:w-auto"}
              >
                New hand
              </button>
            )}
          </div>
          {error && <p className="text-sm text-rose-300">{error}</p>}

          {!st && (
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 text-[9px] text-white/40 text-center">
              {[1, 2, 3, 4, 5, 6, 7].map((s) => (
                <div key={s} className="rounded border border-white/10 py-1">
                  <div className="font-bold text-white/60">{s}</div>
                  <div>{spreadReturnHint(s)}×</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
          </section>
          <section className={card + " p-4"}>
            <button type="button" onClick={() => rotateSeed()} className={btnGhost + " w-full !text-xs"}>
              Rotate seed
            </button>
            {st && (
              <button
                type="button"
                onClick={() => setVerifyTarget(lastSession)}
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
          title="Red Dog · verify hand"
          description="Replay two or three card draws from the shoe."
          session={verifyTarget as Session<unknown, RedDogState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(redDogGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "red-dog",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Cards" value={`${cardLabel(verifyTarget.state.card1)} · ${cardLabel(verifyTarget.state.card2)}${verifyTarget.state.card3 ? ` · ${cardLabel(verifyTarget.state.card3)}` : ""}`} />
              <VerifyField label="Spread" value={String(verifyTarget.state.spread)} />
              <VerifyField label="Outcome" value={verifyTarget.state.pushed ? "push" : verifyTarget.state.won ? "win" : "loss"} />
            </>
          }
        />
      )}
    </div>
  );
}
