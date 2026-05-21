"use client";

import { useCallback, useEffect, useState } from "react";
import {
  caribbeanStudGame,
  caribbeanStudRtpLabel,
  describeScore,
  formatCaribbeanStudHand,
  newSessionId,
  persistSettledSession,
  type CaribbeanStudAction,
  type CaribbeanStudState,
  type ChainAdapter,
  type ChainId,
  type Session,
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

const LAST_BET_KEY = "mf_casino_cs_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function CaribbeanStudTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<CaribbeanStudAction, CaribbeanStudState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<CaribbeanStudAction, CaribbeanStudState> | null>(null);

  const st = session?.state ?? null;
  const inTurn = st?.phase === "player_turn";
  const settled = session?.status === "settled" && !!session.result;
  const showDealer = st && !inTurn;

  const finishRound = useCallback(
    async (s: Session<CaribbeanStudAction, CaribbeanStudState>) => {
      const done = await driver.settleSession(caribbeanStudGame, s);
      setSession(done);
      pushHistory({
        game: "caribbean-stud",
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
      setError("Need balance for ante + raise");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(caribbeanStudGame, {
        sessionId: newSessionId(),
        userId,
        gameId: caribbeanStudGame.id,
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
    async (action: CaribbeanStudAction) => {
      if (!session || session.state.phase !== "player_turn") return;
      setError(null);
      setBusy(true);
      try {
        const extra = action.type === "raise" ? session.stake : 0n;
        if (action.type === "raise" && balance.available < extra) {
          setError("Insufficient balance for raise");
          return;
        }
        const s = (await driver.applyAction(caribbeanStudGame, session, action, extra)) as Session<
          CaribbeanStudAction,
          CaribbeanStudState
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
  const dealerScoreLine =
    showDealer && st.dealerScore
      ? `${describeScore(st.dealerScore)}${st.dealerQualified === false ? " · no qualify" : ""}`
      : null;

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Caribbean Stud" rtp={caribbeanStudRtpLabel()} />
            {!st && (
              <RulesHint>
                Ante plus Raise (2× ante). Dealer needs a pair or Ace-King to qualify.
              </RulesHint>
            )}
            {st && (
              <div className="space-y-3">
                <HandPanel
                  label="Your hand"
                  cards={st.playerCards}
                  score={st.playerScore ? describeScore(st.playerScore) : null}
                  tone="player"
                />
                <HandPanel
                  label="Dealer"
                  cards={st.dealerCards}
                  hiddenCount={inTurn ? 5 : 0}
                  score={dealerScoreLine}
                  tone="dealer"
                />
              </div>
            )}
            {inTurn && session && (
              <ActionStack>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ type: "raise" })}
                  className={btnPrimary + " w-full"}
                >
                  Raise (2× · {fmtMoney(session.stake * 2n, token)})
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
            hint="Raise pays 1:1 when you beat a qualifying dealer. Ante pays on pair+ even if dealer does not qualify."
          />
        }
      />
      {verifyTarget && (
        <CasinoVerifyModal
          title="Caribbean Stud · verify hand"
          description="Replay ten card draws and fold/raise from the revealed seed."
          session={verifyTarget as Session<unknown, CaribbeanStudState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(caribbeanStudGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "caribbean-stud",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatCaribbeanStudHand(verifyTarget.state.playerCards)} />
              <VerifyField label="Dealer" value={formatCaribbeanStudHand(verifyTarget.state.dealerCards)} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome ?? "—"} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
