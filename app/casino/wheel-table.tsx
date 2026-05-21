"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WHEEL_BET_OPTIONS,
  WHEEL_SEGMENT_COUNT,
  WHEEL_SEGMENT_MULTS,
  wheelGame,
  wheelRtpLabel,
  wheelWinChancePercent,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
  type WheelAction,
  type WheelBetMult,
  type WheelState,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnGhost, btnPrimary, card, inputCls, labelCls } from "./casino-ui";

const MULT_COLOR: Record<WheelBetMult, string> = {
  1: "#64748b",
  2: "#3b82f6",
  5: "#10b981",
  10: "#a855f7",
  20: "#f97316",
  40: "#eab308",
};

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

const LAST_BET_KEY = "mf_casino_wheel_bet";
const LAST_PICK_KEY = "mf_casino_wheel_pick";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function WheelTable({ chainId, token }: Props) {
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
  const [betOn, setBetOn] = useState<WheelBetMult>(() => {
    if (typeof window === "undefined") return 2;
    const v = Number(window.localStorage.getItem(LAST_PICK_KEY));
    return WHEEL_BET_OPTIONS.includes(v as WheelBetMult) ? (v as WheelBetMult) : 2;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_PICK_KEY, String(betOn));
  }, [betAmount, betOn]);

  const [lastSession, setLastSession] = useState<Session<WheelAction, WheelState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [spinDeg, setSpinDeg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<WheelAction, WheelState> | null>(null);

  const wheelGradient = useMemo(() => {
    const step = 100 / WHEEL_SEGMENT_COUNT;
    const parts: string[] = [];
    for (let i = 0; i < WHEEL_SEGMENT_COUNT; i++) {
      const m = WHEEL_SEGMENT_MULTS[i] as WheelBetMult;
      const start = (i * step).toFixed(4);
      const end = ((i + 1) * step).toFixed(4);
      parts.push(`${MULT_COLOR[m]} ${start}% ${end}%`);
    }
    return `conic-gradient(from -90deg, ${parts.join(", ")})`;
  }, []);

  const spin = useCallback(async () => {
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
    setLastSession(null);
    try {
      let s = await driver.openSession(wheelGame, {
        sessionId: newSessionId(),
        userId,
        gameId: wheelGame.id,
        chainId,
        token,
        stake,
        config: { betOn },
      });
      s = await driver.settleSession(wheelGame, s);

      const degPer = 360 / WHEEL_SEGMENT_COUNT;
      const land = 360 * 6 + s.state.segmentIndex * degPer + degPer / 2;
      setSpinDeg(land);

      await new Promise((r) => setTimeout(r, 3200));

      setLastSession(s);
      setVerifyTarget(s);
      pushHistory({
        game: "wheel",
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
  }, [balance.available, betAmount, betOn, chainId, driver, getSeedPair, pushHistory, refreshBalance, token, userId]);

  const st = lastSession?.state;
  const seedPair = getSeedPair();

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Money Wheel</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {wheelRtpLabel()} · {WHEEL_SEGMENT_COUNT} segments
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative w-[min(100%,280px)] aspect-square shrink-0">
              <div
                className="absolute inset-2 rounded-full border-4 border-amber-500/40 shadow-[0_0_40px_rgba(245,158,11,0.15)] transition-transform duration-[3s] ease-out"
                style={{
                  background: wheelGradient,
                  transform: `rotate(${spinDeg}deg)`,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-16 h-16 rounded-full bg-[#06070c] border-2 border-white/15 flex items-center justify-center">
                  {st ? (
                    <span
                      className={
                        "text-lg font-bold font-mono " +
                        (st.won ? "text-emerald-300" : "text-white/80")
                      }
                    >
                      {st.landedMult}×
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/40 uppercase tracking-wider">Spin</span>
                  )}
                </div>
              </div>
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-0 h-0 border-l-[10px] border-r-[10px] border-b-[16px] border-l-transparent border-r-transparent border-b-amber-400 z-10"
                aria-hidden
              />
            </div>

            <div className="flex-1 w-full space-y-3">
              <div className={labelCls}>Bet on multiplier</div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {WHEEL_BET_OPTIONS.map((m) => {
                  const active = betOn === m;
                  const disabled = busy || !!st;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      onClick={() => setBetOn(m)}
                      className={
                        "touch-manipulation min-h-14 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer disabled:opacity-50 " +
                        (active
                          ? "border-amber-400 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_rgba(245,158,11,0.2)]"
                          : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/25")
                      }
                      style={{ borderColor: active ? MULT_COLOR[m] : undefined }}
                    >
                      <span className="block text-base">{m}×</span>
                      <span className="block text-[9px] font-normal text-white/45 mt-0.5">
                        {wheelWinChancePercent(m).toFixed(1)}%
                      </span>
                    </button>
                  );
                })}
              </div>
              {st && (
                <p
                  className={
                    "text-sm font-mono " +
                    (lastSession!.result!.pnlUnits > 0n
                      ? "text-emerald-300"
                      : lastSession!.result!.pnlUnits < 0n
                        ? "text-rose-300"
                        : "text-white/60")
                  }
                >
                  You bet {st.betOn}× · landed {st.landedMult}× ·{" "}
                  {lastSession!.result!.pnlUnits > 0n ? "+" : ""}
                  {fmtMoney(lastSession!.result!.pnlUnits, token)}
                </p>
              )}
            </div>
          </div>

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
                onClick={() => void spin()}
                className={btnPrimary + " w-full sm:w-auto sm:min-w-[140px]"}
              >
                {busy ? "Spinning…" : "Spin"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLastSession(null);
                  setVerifyTarget(null);
                  setSpinDeg(0);
                }}
                className={btnGhost + " w-full sm:w-auto"}
              >
                New spin
              </button>
            )}
          </div>
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
          </section>
          <section className={card + " p-4 text-[11px] text-white/50 space-y-1"}>
            <p>Win pays stake × landed multiplier (1% edge on wins).</p>
            <p>Segment layout matches live Dream Catcher wheels.</p>
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
          title="Money Wheel · verify spin"
          description="Replay segment index and landing multiplier from the revealed seed."
          session={verifyTarget as Session<unknown, WheelState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(wheelGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "wheel",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { betOn: verifyTarget.state.betOn },
            })
          }
          extraFields={
            <>
              <VerifyField label="Bet on" value={`${verifyTarget.state.betOn}×`} />
              <VerifyField label="Landed" value={`${verifyTarget.state.landedMult}×`} />
              <VerifyField label="Segment" value={`#${verifyTarget.state.segmentIndex + 1}`} />
            </>
          }
        />
      )}
    </div>
  );
}
