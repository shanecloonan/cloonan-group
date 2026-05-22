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
import { btnPrimary } from "./casino-ui";
import {
  DiceRow,
  ErrorBanner,
  humanToUnits,
  PickGrid,
  RulesHint,
  SettlementBanner,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_cal_bet";
const LAST_PICK_KEY = "mf_casino_cal_pick";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
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
  const locked = busy || !!lastSession;

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Chuck-a-Luck" rtp={chuckALuckRtpLabel()} />
            <PickGrid values={[1, 2, 3, 4, 5, 6]} selected={pick} onSelect={setPick} disabled={locked} />
            <RulesHint>Pick a face, then roll three dice. Payouts: 1 hit even money, 2 hits 2:1, 3 hits 11:1.</RulesHint>

            {st && (
              <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <p className="text-center text-xs text-white/50">
                  Your pick: <span className="text-amber-200 font-semibold">{st.pick}</span>
                </p>
                <DiceRow dice={st.dice} highlightValue={st.pick} />
                <p className="text-center text-sm text-white/70">
                  {st.matchCount > 0
                    ? `${st.matchCount} match${st.matchCount === 1 ? "" : "es"} · pays ${chuckALuckPayHint(st.matchCount)}`
                    : "No matches"}
                </p>
                {lastSession?.result && st && (
                  <SettlementBanner
                    headline={
                      st.matchCount > 0
                        ? `${st.matchCount} match${st.matchCount === 1 ? "" : "es"} · ${chuckALuckPayHint(st.matchCount)}`
                        : "No matches"
                    }
                    pnl={lastSession.result.pnlUnits}
                    token={token}
                  />
                )}
              </div>
            )}

            <StakeRow
              label={`Bet on ${pick} (${token.symbol})`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={busy}
              actionLabel={busy ? "Rolling…" : lastSession ? "Roll again" : "Roll dice"}
              onAction={() => void roll()}
              actionBusy={busy}
            />
            {lastSession && !busy && (
              <button
                type="button"
                onClick={() => {
                  setLastSession(null);
                  setVerifyTarget(null);
                }}
                className={btnPrimary + " w-full !bg-white/10 !text-white/80 !shadow-none border border-white/15"}
              >
                Change pick
              </button>
            )}
            {error && <ErrorBanner message={error} />}
          </>
        }
        aside={
          <TableAside
            balance={balance.available}
            token={token}
            onRotateSeed={() => rotateSeed()}
            onVerify={lastSession ? () => setVerifyTarget(lastSession) : undefined}
          />
        }
      />

      {verifyTarget && (
        <CasinoVerifyModal
          title="Chuck-a-Luck · verify"
          description="Replay the three-dice roll and payout from the revealed seed."
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
    </TablePage>
  );
}
