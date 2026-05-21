"use client";

import { useCallback, useEffect, useState } from "react";
import {
  describeScore,
  formatMississippiStudCards,
  mississippiStudGame,
  mississippiStudPayReturn,
  mississippiStudQualifies,
  mississippiStudRtpLabel,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type MississippiStudAction,
  type MississippiStudState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnDanger, btnPrimary } from "./casino-ui";
import {
  ActionStack,
  BetStatusPills,
  ErrorBanner,
  fmtMoney,
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

const LAST_BET_KEY = "mf_casino_ms_bet";
const STREETS = ["Ante", "1× street", "2× street", "3× street"];

function streetIndex(phase: MississippiStudState["phase"]): number {
  if (phase === "street_2") return 1;
  if (phase === "street_3") return 2;
  if (phase === "street_4") return 3;
  if (phase === "settled") return 4;
  return 0;
}

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function MississippiStudTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<MississippiStudAction, MississippiStudState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<MississippiStudAction, MississippiStudState> | null>(
    null,
  );

  const st = session?.state ?? null;
  const inPlay = st && st.phase !== "settled";
  const settled = session?.status === "settled" && !!session.result;
  const ante = st?.stake ?? 0n;

  const finishRound = useCallback(
    async (s: Session<MississippiStudAction, MississippiStudState>) => {
      const done = await driver.settleSession(mississippiStudGame, s);
      setSession(done);
      pushHistory({
        game: "mississippi-stud",
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
    const stake = humanToUnits(betAmount, token);
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake * 7n) {
      setError("Need balance for ante + all street bets (7× ante)");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(mississippiStudGame, {
        sessionId: newSessionId(),
        userId,
        gameId: mississippiStudGame.id,
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
    async (action: MississippiStudAction) => {
      if (!session || session.state.phase === "settled") return;
      setError(null);
      const extra =
        action.type === "bet_1"
          ? ante
          : action.type === "bet_2"
            ? ante * 2n
            : action.type === "bet_3"
              ? ante * 3n
              : 0n;
      if (extra > 0n && balance.available < extra) {
        setError("Insufficient balance for street bet");
        return;
      }
      setBusy(true);
      try {
        const s = (await driver.applyAction(mississippiStudGame, session, action, extra)) as Session<
          MississippiStudAction,
          MississippiStudState
        >;
        setSession(s);
        if (s.state.phase === "settled") await finishRound(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [ante, balance.available, driver, finishRound, session],
  );

  const seedPair = getSeedPair();
  const streetBetAction: MississippiStudAction | null =
    st?.phase === "street_2"
      ? { type: "bet_1" }
      : st?.phase === "street_3"
        ? { type: "bet_2" }
        : st?.phase === "street_4"
          ? { type: "bet_3" }
          : null;
  const streetMult = st?.phase === "street_2" ? 1 : st?.phase === "street_3" ? 2 : st?.phase === "street_4" ? 3 : 0;
  const handScoreLine =
    st?.handScore &&
    (mississippiStudQualifies(st.handScore)
      ? `${describeScore(st.handScore)} · pays up to ${mississippiStudPayReturn(st.handScore) - 1}:1`
      : `${describeScore(st.handScore)} · pair of 6s+ required`);

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Mississippi Stud" rtp={mississippiStudRtpLabel()} />
            {inPlay && st && (
              <StreetSteps
                steps={STREETS}
                activeIndex={streetIndex(st.phase)}
                doneThrough={streetIndex(st.phase)}
              />
            )}
            {!st && (
              <RulesHint>
                Ante plus optional 1×, 2×, and 3× street bets. Fold keeps prior losses only.
              </RulesHint>
            )}
            {st && (
              <>
                <HandPanel
                  label="Your hand"
                  cards={st.playerCards}
                  hiddenCount={5 - st.visibleCount}
                  score={handScoreLine}
                  tone="player"
                />
                <BetStatusPills
                  items={[
                    { label: "Ante ✓", active: true },
                    { label: "1×", active: st.streetBet1 > 0n },
                    { label: "2×", active: st.streetBet2 > 0n },
                    { label: "3×", active: st.streetBet3 > 0n },
                  ]}
                />
              </>
            )}
            {inPlay && streetBetAction && streetMult > 0 && (
              <>
                <PhaseChip>
                  Bet {streetMult}× ante ({fmtMoney(ante * BigInt(streetMult), token)}) or fold
                </PhaseChip>
                <ActionStack>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(streetBetAction)}
                    className={btnPrimary + " w-full"}
                  >
                    Bet {streetMult}× ({fmtMoney(ante * BigInt(streetMult), token)})
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ type: "fold" })}
                    className={btnDanger + " w-full"}
                  >
                    Fold
                  </button>
                </ActionStack>
              </>
            )}
            <StakeRow
              label={`Ante (${token.symbol}) · up to 7× total`}
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
            hint="Pair of 6s through a royal flush pays on all active bets. No dealer — you vs the paytable."
          />
        }
      />
      {verifyTarget && (
        <CasinoVerifyModal
          title="Mississippi Stud · verify hand"
          description="Replay five card draws and fold/street bets from the revealed seed."
          session={verifyTarget as Session<unknown, MississippiStudState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(mississippiStudGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "mississippi-stud",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Hand" value={formatMississippiStudCards(verifyTarget.state.playerCards)} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome ?? "—"} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
