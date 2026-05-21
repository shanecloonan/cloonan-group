"use client";

import { useCallback, useEffect, useState } from "react";
import {
  sicBoGame,
  sicBoBetLabel,
  sicBoRtpLabel,
  sicBoPayReturnHint,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type Session,
  type SicBoAction,
  type SicBoBetType,
  type SicBoState,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnGhost, btnPrimary, card, inputCls, labelCls } from "./casino-ui";

const TOTAL_PAYS: Record<number, number> = {
  4: 61, 5: 31, 6: 18, 7: 13, 8: 9, 9: 7, 10: 7, 11: 7, 12: 7, 13: 9, 14: 13, 15: 18, 16: 31, 17: 61,
};

const MAIN_BETS: { type: SicBoBetType; label: string; hint: string }[] = [
  { type: "small", label: "Small", hint: "4–10 · 2×" },
  { type: "big", label: "Big", hint: "11–17 · 2×" },
  { type: "odd", label: "Odd", hint: "2×" },
  { type: "even", label: "Even", hint: "2×" },
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

const LAST_BET_KEY = "mf_casino_sicbo_bet";
const LAST_TYPE_KEY = "mf_casino_sicbo_type";
const LAST_VAL_KEY = "mf_casino_sicbo_val";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function Die({ value, highlight }: { value: number; highlight?: boolean }) {
  return (
    <div
      className={
        "w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 flex items-center justify-center font-mono text-2xl sm:text-3xl font-bold transition-all " +
        (highlight
          ? "border-emerald-400 bg-emerald-500/20 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
          : "border-white/15 bg-white/[0.06] text-white/90")
      }
    >
      {value > 0 ? value : "?"}
    </div>
  );
}

export default function SicBoTable({ chainId, token }: Props) {
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
  const [betType, setBetType] = useState<SicBoBetType>(() => {
    if (typeof window === "undefined") return "big";
    const t = window.localStorage.getItem(LAST_TYPE_KEY) as SicBoBetType;
    return t && ["big", "small", "odd", "even", "any_triple", "triple", "total"].includes(t) ? t : "big";
  });
  const [betValue, setBetValue] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = Number(window.localStorage.getItem(LAST_VAL_KEY));
    return Number.isFinite(v) ? v : null;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_TYPE_KEY, betType);
    if (betValue != null) window.localStorage.setItem(LAST_VAL_KEY, String(betValue));
  }, [betAmount, betType, betValue]);

  const selectBet = (type: SicBoBetType, value: number | null = null) => {
    if (lastSession) return;
    setBetType(type);
    setBetValue(value);
  };

  const [lastSession, setLastSession] = useState<Session<SicBoAction, SicBoState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<SicBoAction, SicBoState> | null>(null);

  const roll = useCallback(async () => {
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
    if (betType === "triple" && (betValue == null || betValue < 1 || betValue > 6)) {
      setError("Pick a triple face 1–6");
      return;
    }
    if (betType === "total" && (betValue == null || betValue < 4 || betValue > 17)) {
      setError("Pick a total 4–17");
      return;
    }
    setBusy(true);
    try {
      let s = await driver.openSession(sicBoGame, {
        sessionId: newSessionId(),
        userId,
        gameId: sicBoGame.id,
        chainId,
        token,
        stake,
        config: { betType, betValue },
      });
      s = await driver.settleSession(sicBoGame, s);
      await new Promise((r) => setTimeout(r, 700));
      setLastSession(s);
      setVerifyTarget(s);
      pushHistory({
        game: "sic-bo",
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
  }, [balance.available, betAmount, betType, betValue, chainId, driver, getSeedPair, pushHistory, refreshBalance, token, userId]);

  const st = lastSession?.state;
  const seedPair = getSeedPair();
  const payHint = sicBoPayReturnHint(betType, betValue);

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Sic Bo</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">RTP {sicBoRtpLabel()}</span>
          </div>

          <div className="flex justify-center gap-3 sm:gap-4 py-2">
            {(st?.dice ?? [0, 0, 0]).map((d, i) => (
              <Die key={i} value={d || 1} highlight={!!st} />
            ))}
          </div>
          {st && (
            <p className="text-center text-sm text-white/55 font-mono">
              Sum {st.sum}
              {st.isTriple ? " · triple" : ""}
            </p>
          )}

          {!st && (
            <>
              <div>
                <div className={labelCls}>Main bets</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MAIN_BETS.map((b) => (
                    <button
                      key={b.type}
                      type="button"
                      disabled={busy}
                      onClick={() => selectBet(b.type)}
                      className={
                        "touch-manipulation min-h-12 rounded-xl border-2 px-2 py-2 text-left transition-all cursor-pointer " +
                        (betType === b.type
                          ? "border-amber-400 bg-amber-500/15 text-amber-50"
                          : "border-white/10 bg-white/[0.04] text-white/75 hover:border-white/25")
                      }
                    >
                      <span className="block text-sm font-semibold">{b.label}</span>
                      <span className="block text-[10px] text-white/45">{b.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className={labelCls}>Triples</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selectBet("any_triple")}
                    className={
                      "touch-manipulation min-h-10 px-3 rounded-lg border-2 text-sm font-medium cursor-pointer " +
                      (betType === "any_triple"
                        ? "border-amber-400 bg-amber-500/15 text-amber-50"
                        : "border-white/10 text-white/70")
                    }
                  >
                    Any 31×
                  </button>
                  {[1, 2, 3, 4, 5, 6].map((f) => (
                    <button
                      key={f}
                      type="button"
                      disabled={busy}
                      onClick={() => selectBet("triple", f)}
                      className={
                        "touch-manipulation w-10 h-10 rounded-lg border-2 text-sm font-bold cursor-pointer " +
                        (betType === "triple" && betValue === f
                          ? "border-amber-400 bg-amber-500/15 text-amber-50"
                          : "border-white/10 text-white/70")
                      }
                    >
                      {f}
                    </button>
                  ))}
                  <span className="text-[10px] text-white/40 self-center">Specific 181×</span>
                </div>
              </div>

              <div>
                <div className={labelCls}>Total (sum of three dice)</div>
                <div className="grid grid-cols-7 sm:grid-cols-7 gap-1.5">
                  {Array.from({ length: 14 }, (_, i) => i + 4).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={busy}
                      onClick={() => selectBet("total", t)}
                      className={
                        "touch-manipulation min-h-11 rounded-lg border text-center transition-all cursor-pointer " +
                        (betType === "total" && betValue === t
                          ? "border-amber-400 bg-amber-500/15 text-amber-50"
                          : "border-white/10 bg-white/[0.03] text-white/70 hover:border-white/20")
                      }
                    >
                      <span className="block text-xs font-bold">{t}</span>
                      <span className="block text-[9px] text-white/40">{TOTAL_PAYS[t]}×</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {!st && (
            <p className="text-xs text-white/45">
              Selected: <strong className="text-white/80">{sicBoBetLabel(betType, betValue)}</strong>
              {payHint > 0 && ` · pays ${payHint}×`}
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
              {sicBoBetLabel(st.betType, st.betValue)} ·{" "}
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
                onClick={() => void roll()}
                className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
              >
                {busy ? "Rolling…" : "Roll"}
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
                New roll
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
          <section className={card + " p-4 text-[11px] text-white/50"}>
            {`Big, Small, Odd, and Even lose on any triple. Wins include a 1 percent house edge.`}
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
          title="Sic Bo · verify roll"
          description="Replay three dice from the revealed server seed."
          session={verifyTarget as Session<unknown, SicBoState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(sicBoGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "sic-bo",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { betType: verifyTarget.state.betType, betValue: verifyTarget.state.betValue },
            })
          }
          extraFields={
            <>
              <VerifyField label="Bet" value={sicBoBetLabel(verifyTarget.state.betType, verifyTarget.state.betValue)} />
              <VerifyField label="Dice" value={verifyTarget.state.dice.join(" · ")} />
              <VerifyField label="Sum" value={String(verifyTarget.state.sum)} />
            </>
          }
        />
      )}
    </div>
  );
}
