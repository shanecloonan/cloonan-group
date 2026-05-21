"use client";

import { useCallback, useEffect, useState } from "react";
import {
  chuckALuckGame,
  chuckALuckPayHint,
  chuckALuckRtpLabel,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type ChuckALuckAction,
  type ChuckALuckState,
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

const LAST_BET_KEY = "mf_casino_cal_bet";
const LAST_PICK_KEY = "mf_casino_cal_pick";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function Die({ value, hit }: { value: number; hit?: boolean }) {
  return (
    <div
      className={
        "w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 flex items-center justify-center font-mono text-2xl sm:text-3xl font-bold shrink-0 " +
        (hit
          ? "border-amber-400 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_rgba(245,158,11,0.2)]"
          : "border-white/15 bg-white/[0.06] text-white/90")
      }
    >
      {value}
    </div>
  );
}

export default function ChuckALuckTable({ chainId, token }: Props) {
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
  const [pick, setPick] = useState(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(window.localStorage.getItem(LAST_PICK_KEY));
    return Number.isInteger(v) && v >= 1 && v <= 6 ? v : 1;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_PICK_KEY, String(pick));
  }, [betAmount, pick]);

  const [lastSession, setLastSession] = useState<Session<ChuckALuckAction, ChuckALuckState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<ChuckALuckAction, ChuckALuckState> | null>(null);

  const roll = useCallback(async () => {
    setError(null);
    setLastSession(null);
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
      let s = await driver.openSession(chuckALuckGame, {
        sessionId: newSessionId(),
        userId,
        gameId: chuckALuckGame.id,
        chainId,
        token,
        stake,
        config: { pick },
      });
      s = await driver.settleSession(chuckALuckGame, s);
      setLastSession(s);
      pushHistory({
        game: "chuck-a-luck",
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
  }, [balance.available, betAmount, chainId, driver, getSeedPair, pick, pushHistory, refreshBalance, token, userId]);

  const st = lastSession?.state;
  const seedPair = getSeedPair();

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Chuck-a-Luck</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {chuckALuckRtpLabel()}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                disabled={busy || !!lastSession}
                onClick={() => setPick(n)}
                className={
                  "h-12 rounded-xl font-bold text-lg border transition-all cursor-pointer " +
                  (pick === n
                    ? "border-amber-400/60 bg-amber-500/20 text-amber-100"
                    : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/25")
                }
              >
                {n}
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-white/45">
            {"1 hit = 1:1 · 2 hits = 2:1 · 3 hits = 11:1"}
          </p>

          {st && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 justify-center py-2">
                {st.dice.map((d, i) => (
                  <Die key={i} value={d} hit={d === st.pick} />
                ))}
              </div>
              {lastSession?.result && (
                <p
                  className={
                    "text-center text-sm font-mono " +
                    (lastSession.result.pnlUnits > 0n
                      ? "text-emerald-300"
                      : lastSession.result.pnlUnits < 0n
                        ? "text-rose-300"
                        : "text-white/60")
                  }
                >
                  {st.matchCount > 0
                    ? `${st.matchCount} match${st.matchCount === 1 ? "" : "es"} · ${chuckALuckPayHint(st.matchCount)}`
                    : "No match"}
                  {" · "}
                  {lastSession.result.pnlUnits > 0n ? "+" : ""}
                  {fmtMoney(lastSession.result.pnlUnits, token)}
                </p>
              )}
            </div>
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
            <button
              type="button"
              disabled={busy}
              onClick={() => void roll()}
              className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
            >
              {busy ? "Rolling…" : lastSession ? "Roll again" : "Roll"}
            </button>
          </div>

          {lastSession && (
            <button
              type="button"
              onClick={() => {
                setLastSession(null);
                setVerifyTarget(null);
              }}
              className={btnGhost + " w-full sm:w-auto mx-auto block"}
            >
              Clear
            </button>
          )}

          {error && <p className="text-sm text-rose-300">{error}</p>}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
          </section>
          <section className={card + " p-4"}>
            <button type="button" onClick={() => rotateSeed()} className={btnGhost + " w-full !text-xs !h-9"}>
              Rotate seed
            </button>
            {lastSession && (
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
          title="Chuck-a-Luck · verify roll"
          description="Replay three dice from the revealed server seed."
          session={verifyTarget as Session<unknown, ChuckALuckState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(chuckALuckGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "chuck-a-luck",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { pick: verifyTarget.state.pick },
            })
          }
          extraFields={
            <>
              <VerifyField label="Pick" value={String(verifyTarget.state.pick)} />
              <VerifyField label="Dice" value={verifyTarget.state.dice.join(" · ")} />
            </>
          }
        />
      )}
    </div>
  );
}
