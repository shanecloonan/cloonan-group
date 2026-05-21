"use client";

import { useCallback, useEffect, useState } from "react";
import {
  describeScore,
  formatLetItRideCards,
  letItRideGame,
  letItRidePayReturn,
  letItRideQualifies,
  letItRideRtpLabel,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type LetItRideAction,
  type LetItRideState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnPrimary, btnSecondary } from "./casino-ui";
import {
  ActionStack,
  BetStatusPills,
  ErrorBanner,
  HandPanel,
  humanToUnits,
  NewHandButton,
  PhaseChip,
  PnlBanner,
  RulesHint,
  StakeRow,
  StreetSteps,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_lir_bet";
const STEPS = ["Your cards", "1st board", "2nd board", "Result"];

function stepIndex(phase: LetItRideState["phase"]): number {
  if (phase === "decision_1") return 0;
  if (phase === "decision_2") return 1;
  if (phase === "settled") return 3;
  return 0;
}

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function LetItRideTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<LetItRideAction, LetItRideState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<LetItRideAction, LetItRideState> | null>(null);

  const st = session?.state ?? null;
  const inPlay = st && st.phase !== "settled";
  const settled = session?.status === "settled" && !!session.result;
  const showComm0 = st && st.phase !== "decision_1";
  const showComm1 = st && st.phase === "settled";

  const finishRound = useCallback(
    async (s: Session<LetItRideAction, LetItRideState>) => {
      const done = await driver.settleSession(letItRideGame, s);
      setSession(done);
      pushHistory({
        game: "let-it-ride",
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
    const unit = humanToUnits(betAmount, token);
    const stake = unit * 3n;
    if (unit <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake) {
      setError("Need balance for 3 equal bets");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(letItRideGame, {
        sessionId: newSessionId(),
        userId,
        gameId: letItRideGame.id,
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
    async (action: LetItRideAction) => {
      if (!session || session.state.phase === "settled") return;
      setError(null);
      setBusy(true);
      try {
        const s = (await driver.applyAction(letItRideGame, session, action)) as Session<
          LetItRideAction,
          LetItRideState
        >;
        setSession(s);
        if (s.state.phase === "settled") await finishRound(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [driver, finishRound, session],
  );

  const seedPair = getSeedPair();
  const scoreLine =
    st?.handScore &&
    (letItRideQualifies(st.handScore)
      ? `${describeScore(st.handScore)} · ${letItRidePayReturn(st.handScore) - 1}:1 per riding bet`
      : `${describeScore(st.handScore)} · pair of 10s+ required`);

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Let It Ride" rtp={letItRideRtpLabel()} />
            {inPlay && st && (
              <StreetSteps steps={STEPS} activeIndex={stepIndex(st.phase)} doneThrough={stepIndex(st.phase)} />
            )}
            {!st && (
              <RulesHint>
                Three equal bets. Pull bet 1 after your cards, bet 2 after the first community card.
              </RulesHint>
            )}
            {st && (
              <>
                <BetStatusPills
                  items={[
                    { label: "Bet 1", active: st.bet1Active },
                    { label: "Bet 2", active: st.bet2Active },
                    { label: "Bet 3", active: st.bet3Active },
                  ]}
                />
                <HandPanel label="Your cards" cards={st.playerCards} tone="player" />
                <HandPanel
                  label="Community"
                  cards={st.community}
                  hiddenCount={2 - (showComm0 ? 1 : 0) - (showComm1 ? 1 : 0)}
                  tone="board"
                  score={scoreLine}
                />
              </>
            )}
            {st?.phase === "decision_1" && (
              <>
                <PhaseChip>Pull bet 1 or let it ride</PhaseChip>
                <ActionStack>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "pull_bet1" })}
                    className={btnSecondary + " w-full"}
                  >
                    Pull bet 1
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "ride_bet1" })}
                    className={btnPrimary + " w-full"}
                  >
                    Let bet 1 ride
                  </button>
                </ActionStack>
              </>
            )}
            {st?.phase === "decision_2" && (
              <>
                <PhaseChip>Pull bet 2 or let it ride (bet 3 always rides)</PhaseChip>
                <ActionStack>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "pull_bet2" })}
                    className={btnSecondary + " w-full"}
                  >
                    Pull bet 2
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "ride_bet2" })}
                    className={btnPrimary + " w-full"}
                  >
                    Let bet 2 ride
                  </button>
                </ActionStack>
              </>
            )}
            <StakeRow
              label={`Per bet (${token.symbol}) · 3× total`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={busy || !!inPlay}
              actionLabel={busy ? "Dealing…" : "Deal"}
              onAction={() => void deal()}
              actionBusy={busy}
              hideAction={!!inPlay}
            />
            {settled && session?.result && (
              <>
                <PnlBanner pnl={session.result.pnlUnits} token={token} />
                <NewHandButton onClick={() => setSession(null)} />
              </>
            )}
            {error && <ErrorBanner message={error} />}
          </>
        }
        aside={
          <TableAside
            balance={balance.available}
            token={token}
            onRotateSeed={() => rotateSeed()}
            onVerify={settled && session ? () => setVerifyTarget(session) : undefined}
            hint="Pair of 10s+ pays even money up to 25:1 on a royal. Pulled bets return with no win/loss."
          />
        }
      />
      {verifyTarget && (
        <CasinoVerifyModal
          title="Let It Ride · verify hand"
          description="Replay five card draws and pull/ride decisions from the revealed seed."
          session={verifyTarget as Session<unknown, LetItRideState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(letItRideGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "let-it-ride",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatLetItRideCards(verifyTarget.state.playerCards)} />
              <VerifyField label="Board" value={formatLetItRideCards(verifyTarget.state.community)} />
              <VerifyField
                label="Bets"
                value={`${verifyTarget.state.bet1Active ? "1" : "—"} / ${verifyTarget.state.bet2Active ? "2" : "—"} / ${verifyTarget.state.bet3Active ? "3" : "—"}`}
              />
            </>
          }
        />
      )}
    </TablePage>
  );
}
