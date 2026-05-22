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
import { labelCls } from "./casino-ui";
import {
  ChoiceButton,
  DiceCube,
  ErrorBanner,
  humanToUnits,
  SettlementBanner,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const TOTAL_PAYS: Record<number, number> = {
  4: 61, 5: 31, 6: 18, 7: 13, 8: 9, 9: 7, 10: 7, 11: 7, 12: 7, 13: 9, 14: 13, 15: 18, 16: 31, 17: 61,
};

const MAIN_BETS: { type: SicBoBetType; label: string; hint: string }[] = [
  { type: "small", label: "Small", hint: "4–10 · 2×" },
  { type: "big", label: "Big", hint: "11–17 · 2×" },
  { type: "odd", label: "Odd", hint: "2×" },
  { type: "even", label: "Even", hint: "2×" },
];

const LAST_BET_KEY = "mf_casino_sicbo_bet";
const LAST_TYPE_KEY = "mf_casino_sicbo_type";
const LAST_VAL_KEY = "mf_casino_sicbo_val";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
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
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Sic Bo" rtp={sicBoRtpLabel()} />
            <div className="flex justify-center gap-3 sm:gap-4 py-2">
              {(st?.dice ?? [0, 0, 0]).map((d, i) => (
                <DiceCube key={i} value={d || 0} highlight={!!st} size="lg" />
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
                    {MAIN_BETS.map((b) => (
                      <ChoiceButton
                        key={b.type}
                        active={betType === b.type}
                        disabled={busy}
                        onClick={() => selectBet(b.type)}
                        label={b.label}
                        hint={b.hint}
                      />
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

            {st && lastSession?.result && (
              <SettlementBanner
                headline={sicBoBetLabel(st.betType, st.betValue)}
                pnl={lastSession.result.pnlUnits}
                token={token}
              />
            )}

            <StakeRow
              label={`Bet (${token.symbol})`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={busy}
              actionLabel={busy ? "Rolling…" : lastSession ? "Roll again" : "Roll"}
              onAction={() => void roll()}
              actionBusy={busy}
            />
            {error && <ErrorBanner message={error} />}
          </>
        }
        aside={
          <TableAside
            balance={balance.available}
            token={token}
            onRotateSeed={() => rotateSeed()}
            onVerify={lastSession ? () => setVerifyTarget(lastSession) : undefined}
            hint="Big, Small, Odd, and Even lose on any triple."
          />
        }
      />

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
    </TablePage>
  );
}
