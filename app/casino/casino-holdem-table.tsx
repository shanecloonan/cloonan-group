"use client";

import { useCallback, useEffect, useState } from "react";
import {
  casinoHoldemGame,
  casinoHoldemRtpLabel,
  describeScore,
  formatCasinoHoldemCards,
  newSessionId,
  persistSettledSession,
  type CasinoHoldemAction,
  type CasinoHoldemState,
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

const LAST_BET_KEY = "mf_casino_holdem_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function CasinoHoldemTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<CasinoHoldemAction, CasinoHoldemState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<CasinoHoldemAction, CasinoHoldemState> | null>(null);

  const st = session?.state ?? null;
  const inTurn = st?.phase === "player_turn";
  const settled = session?.status === "settled" && !!session.result;
  const showDealer = st && !inTurn;

  const finishRound = useCallback(
    async (s: Session<CasinoHoldemAction, CasinoHoldemState>) => {
      const done = await driver.settleSession(casinoHoldemGame, s);
      setSession(done);
      pushHistory({
        game: "casino-holdem",
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
    if (balance.available < stake * 3n) {
      setError("Need balance for ante + call (2× ante)");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(casinoHoldemGame, {
        sessionId: newSessionId(),
        userId,
        gameId: casinoHoldemGame.id,
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
    async (action: CasinoHoldemAction) => {
      if (!session || session.state.phase !== "player_turn") return;
      setError(null);
      setBusy(true);
      try {
        const extra = action.type === "call" ? session.stake * 2n : 0n;
        if (action.type === "call" && balance.available < extra) {
          setError("Insufficient balance for call");
          return;
        }
        const s = (await driver.applyAction(casinoHoldemGame, session, action, extra)) as Session<
          CasinoHoldemAction,
          CasinoHoldemState
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
            <TableHead title="Casino Hold'em" rtp={casinoHoldemRtpLabel()} />
            {!st && (
              <RulesHint>
                Ante plus Call (2× ante). Dealer needs a pair of 4s or better to qualify.
              </RulesHint>
            )}
            {st && (
              <div className="space-y-3">
                <HandPanel label="Board" cards={st.board} tone="board" />
                <HandPanel
                  label="Your hole"
                  cards={st.playerHole}
                  score={st.playerScore ? describeScore(st.playerScore) : null}
                  tone="player"
                />
                <HandPanel
                  label="Dealer hole"
                  cards={st.dealerHole}
                  hiddenCount={inTurn ? 2 : 0}
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
                  onClick={() => void act({ type: "call" })}
                  className={btnPrimary + " w-full"}
                >
                  Call (2× · {fmtMoney(session.stake * 2n, token)})
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
            hint="Ante pays on a pair of 4s or better. Call pays when you beat a qualifying dealer hand."
          />
        }
      />
      {verifyTarget && (
        <CasinoVerifyModal
          title="Casino Hold'em · verify hand"
          description="Replay nine card draws and fold/call from the revealed seed."
          session={verifyTarget as Session<unknown, CasinoHoldemState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(casinoHoldemGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "casino-holdem",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatCasinoHoldemCards(verifyTarget.state.playerHole)} />
              <VerifyField label="Board" value={formatCasinoHoldemCards(verifyTarget.state.board)} />
              <VerifyField label="Dealer" value={formatCasinoHoldemCards(verifyTarget.state.dealerHole)} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome ?? "—"} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
