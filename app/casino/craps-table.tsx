"use client";

import { useCallback, useEffect, useState } from "react";
import {
  crapsGame,
  crapsRtpLabel,
  formatCrapsRoll,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type CrapsAction,
  type CrapsRoll,
  type CrapsState,
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

const LAST_BET_KEY = "mf_casino_craps_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function DieFace({ value }: { value: number }) {
  const pips: Record<number, string> = {
    1: "●",
    2: "●　●",
    3: "●　●　●",
    4: "●●\n●●",
    5: "●●\n●\n●●",
    6: "●●\n●●\n●●",
  };
  return (
    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 border-white/20 bg-white/[0.08] flex items-center justify-center font-mono text-lg sm:text-xl text-white whitespace-pre leading-tight text-center shrink-0">
      {pips[value] ?? value}
    </div>
  );
}

function RollRow({ roll, active }: { roll: CrapsRoll; active?: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-2 rounded-lg px-2 py-1.5 " +
        (active ? "bg-amber-500/15 border border-amber-400/30" : "bg-white/[0.03]")
      }
    >
      <DieFace value={roll.die1} />
      <DieFace value={roll.die2} />
      <span className="text-sm font-mono text-white/80 ml-1">= {roll.sum}</span>
    </div>
  );
}

function outcomeText(st: CrapsState): string {
  switch (st.outcome) {
    case "come_out_win":
      return "Come-out win — 7 or 11";
    case "come_out_lose":
      return "Craps — 2, 3, or 12";
    case "point_win":
      return `Winner — point ${st.point} made`;
    case "point_lose":
      return `Loss — seven out (point ${st.point})`;
    default:
      return "";
  }
}

export default function CrapsTable({ chainId, token }: Props) {
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

  const [lastSession, setLastSession] = useState<Session<CrapsAction, CrapsState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<CrapsAction, CrapsState> | null>(null);

  const shoot = useCallback(async () => {
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
      let s = await driver.openSession(crapsGame, {
        sessionId: newSessionId(),
        userId,
        gameId: crapsGame.id,
        chainId,
        token,
        stake,
        config: { betType: "pass" },
      });
      s = await driver.settleSession(crapsGame, s);
      setLastSession(s);
      pushHistory({
        game: "craps",
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
  const lastRoll = st?.rolls[st.rolls.length - 1];

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Craps</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">RTP {crapsRtpLabel()}</span>
          </div>

          <p className="text-sm text-white/45 text-center">
            Pass line — 7/11 wins on come-out; 2/3/12 loses; other totals set the point.
          </p>

          {st && (
            <div className="space-y-3">
              {st.point != null && (
                <p className="text-center text-xs font-semibold uppercase tracking-wider text-amber-200/90">
                  Point: {st.point}
                </p>
              )}
              {lastRoll && (
                <div className="flex justify-center gap-3 py-2">
                  <DieFace value={lastRoll.die1} />
                  <DieFace value={lastRoll.die2} />
                  <div className="flex flex-col justify-center">
                    <span className="text-2xl font-bold text-white">{lastRoll.sum}</span>
                    <span className="text-[10px] text-white/40 uppercase">Last roll</span>
                  </div>
                </div>
              )}
              {st.rolls.length > 1 && (
                <div className="max-h-32 overflow-y-auto space-y-1 px-1">
                  {st.rolls.map((r, i) => (
                    <RollRow key={i} roll={r} active={i === st.rolls.length - 1} />
                  ))}
                </div>
              )}
              <p
                className={
                  "text-center text-sm " + (st.won ? "text-emerald-300" : "text-rose-300")
                }
              >
                {outcomeText(st)}
              </p>
              {lastSession?.result && (
                <p
                  className={
                    "text-center text-sm font-mono " +
                    (lastSession.result.pnlUnits > 0n ? "text-emerald-300" : "text-rose-300")
                  }
                >
                  {lastSession.result.pnlUnits > 0n ? "+" : ""}
                  {fmtMoney(lastSession.result.pnlUnits, token)}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0">
              <label className={labelCls}>Pass line ({token.symbol})</label>
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
              onClick={() => void shoot()}
              className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
            >
              {busy ? "Rolling…" : lastSession ? "Shoot again" : "Shoot"}
            </button>
          </div>

          {error && <p className="text-sm text-rose-300">{error}</p>}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
          </section>
          <section className={card + " p-4 text-[11px] text-white/45 leading-relaxed"}>
            {"Come-out 7 or 11 wins. 2, 3, or 12 loses. Any other number becomes the point — roll it again before a 7."}
          </section>
          <section className={card + " p-4"}>
            <button type="button" onClick={() => rotateSeed()} className={btnSecondary + " w-full !text-xs"}>
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
          title="Craps · verify roll"
          description="Replay pass-line dice sequence from the revealed seed."
          session={verifyTarget as Session<unknown, CrapsState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(crapsGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "craps",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { betType: "pass" },
            })
          }
          extraFields={
            <>
              <VerifyField
                label="Rolls"
                value={verifyTarget.state.rolls.map(formatCrapsRoll).join(" → ")}
              />
              <VerifyField label="Point" value={verifyTarget.state.point != null ? String(verifyTarget.state.point) : "—"} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome} />
            </>
          }
        />
      )}
    </div>
  );
}
