"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatTeenPattiHand,
  newSessionId,
  persistSettledSession,
  teenPattiGame,
  teenPattiRtpLabel,
  threeCardHandLabel,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TeenPattiAction,
  type TeenPattiState,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnDanger, btnPrimary } from "./casino-ui";
import {
  ActionStack,
  ErrorBanner,
  fmtMoney,
  HandPanel,
  humanToUnits,
  NewHandButton,
  PnlBanner,
  RulesHint,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_tp_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function TeenPattiTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<TeenPattiAction, TeenPattiState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<TeenPattiAction, TeenPattiState> | null>(null);

  const st = session?.state ?? null;
  const inTurn = st?.phase === "player_turn";
  const settled = session?.status === "settled" && !!session.result;
  const showDealer = st && !inTurn;

  const finishRound = useCallback(
    async (s: Session<TeenPattiAction, TeenPattiState>) => {
      const done = await driver.settleSession(teenPattiGame, s);
      setSession(done);
      pushHistory({
        game: "teen-patti",
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
    if (inTurn) {
      setError("Finish the current hand first");
      return;
    }
    if (settled) setSession(null);
    const stake = humanToUnits(betAmount, token);
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake * 2n) {
      setError("Need balance for ante + play");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(teenPattiGame, {
        sessionId: newSessionId(),
        userId,
        gameId: teenPattiGame.id,
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
  }, [balance.available, betAmount, chainId, driver, inTurn, settled, token, userId]);

  const act = useCallback(
    async (action: TeenPattiAction) => {
      if (!session || session.state.phase !== "player_turn") return;
      setError(null);
      setBusy(true);
      try {
        const extra = action.type === "play" ? session.stake : 0n;
        if (action.type === "play" && balance.available < extra) {
          setError("Insufficient balance for play");
          return;
        }
        const s = (await driver.applyAction(teenPattiGame, session, action, extra)) as Session<
          TeenPattiAction,
          TeenPattiState
        >;
        setSession(s);
        await finishRound(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [balance.available, driver, finishRound, session],
  );

  const seedPair = getSeedPair();

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Teen Patti" rtp={teenPattiRtpLabel()} />
            {!st && (
              <RulesHint>
                Ante plus Play (1× ante). Trail beats sequence beats color — head-to-head vs dealer.
              </RulesHint>
            )}
            {st && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <HandPanel
                  label="Your hand"
                  cards={st.playerCards}
                  score={st.playerScore ? threeCardHandLabel(st.playerScore) : null}
                  tone="accent"
                />
                <HandPanel
                  label="Dealer"
                  cards={st.dealerCards}
                  hiddenCount={inTurn ? 3 : 0}
                  score={showDealer && st.dealerScore ? threeCardHandLabel(st.dealerScore) : null}
                  tone="dealer"
                />
              </div>
            )}
            {inTurn && session && (
              <ActionStack>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ type: "play" })}
                  className={btnPrimary + " w-full"}
                >
                  Play (+{fmtMoney(session.stake, token)})
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
            )}
            <StakeRow
              label={`Ante (${token.symbol})`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={busy || !!inTurn}
              actionLabel={busy ? "Dealing…" : "Deal"}
              onAction={() => void deal()}
              actionBusy={busy}
              hideAction={!!st}
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
            hint="No dealer qualify rule — best 3-card hand wins. Ante and play both pay 1:1 on a win."
          />
        }
      />
      {verifyTarget && (
        <CasinoVerifyModal
          title="Teen Patti · verify hand"
          description="Replay six card draws and fold/play from the revealed seed."
          session={verifyTarget as Session<unknown, TeenPattiState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(teenPattiGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "teen-patti",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatTeenPattiHand(verifyTarget.state.playerCards)} />
              <VerifyField label="Dealer" value={formatTeenPattiHand(verifyTarget.state.dealerCards)} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome ?? "—"} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
