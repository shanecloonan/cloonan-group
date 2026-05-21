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
  type CrapsState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import {
  DiceCube,
  ErrorBanner,
  fmtMoney,
  humanToUnits,
  NewHandButton,
  PhaseChip,
  PnlBanner,
  RulesHint,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_craps_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function phaseLabel(st: CrapsState): { text: string; variant: "amber" | "emerald" | "rose" } {
  switch (st.outcome) {
    case "come_out_win":
      return { text: "Come-out · 7 or 11", variant: "emerald" };
    case "come_out_lose":
      return { text: "Craps · 2, 3, or 12", variant: "rose" };
    case "point_win":
      return { text: `Point ${st.point} made`, variant: "emerald" };
    case "point_lose":
      return { text: `Seven out · point was ${st.point}`, variant: "rose" };
    default:
      return { text: "Pass line", variant: "amber" };
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
  const last = st?.rolls[st.rolls.length - 1];
  const phase = st ? phaseLabel(st) : null;

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Craps" rtp={crapsRtpLabel()} badge="Pass line" />
            <RulesHint>
              Win on come-out 7 or 11. Lose on 2, 3, or 12. Any other total sets the point — roll it again before a 7.
            </RulesHint>

            {st && last && (
              <div className="space-y-4">
                {st.point != null && st.rolls.length > 1 && (
                  <PhaseChip variant="amber">Point {st.point}</PhaseChip>
                )}
                <div className="flex justify-center items-center gap-3 py-2">
                  <DiceCube value={last.die1} highlight size="lg" />
                  <span className="text-white/30 text-xl font-light">+</span>
                  <DiceCube value={last.die2} highlight size="lg" />
                  <div className="ml-1 text-center">
                    <div className="text-3xl font-bold text-white tabular-nums">{last.sum}</div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40">Total</div>
                  </div>
                </div>
                {phase && <PhaseChip variant={phase.variant}>{phase.text}</PhaseChip>}
                {st.rolls.length > 1 && (
                  <div className="max-h-28 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 space-y-1">
                    {st.rolls.map((r, i) => (
                      <p
                        key={i}
                        className={
                          "text-xs font-mono " +
                          (i === st.rolls.length - 1 ? "text-amber-200/90" : "text-white/45")
                        }
                      >
                        Roll {i + 1}: {formatCrapsRoll(r)}
                      </p>
                    ))}
                  </div>
                )}
                {lastSession?.result && <PnlBanner pnl={lastSession.result.pnlUnits} token={token} />}
              </div>
            )}

            <StakeRow
              label={`Pass line (${token.symbol})`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={busy}
              actionLabel={busy ? "Rolling…" : lastSession ? "Shoot again" : "Shoot"}
              onAction={() => void shoot()}
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
            hint="Pass line pays even money minus 1% edge on wins. Odds are fixed by the dice — every roll is verifiable."
          />
        }
      />

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
              <VerifyField label="Rolls" value={verifyTarget.state.rolls.map(formatCrapsRoll).join(" → ")} />
              <VerifyField label="Point" value={verifyTarget.state.point != null ? String(verifyTarget.state.point) : "—"} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
