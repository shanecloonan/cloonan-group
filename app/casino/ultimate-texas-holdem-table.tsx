"use client";

import { useCallback, useEffect, useState } from "react";
import {
  describeScore,
  formatUltimateHoldemCards,
  newSessionId,
  persistSettledSession,
  ultimateTexasHoldemGame,
  ultimateTexasHoldemRtpLabel,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
  type UltimateTexasHoldemAction,
  type UltimateTexasHoldemState,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnDanger, btnPrimary, btnSecondary } from "./casino-ui";
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
  StreetSteps,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_uth_bet";
const STREETS = ["Pre-flop", "Flop", "Turn", "River"];

function streetIndex(phase: UltimateTexasHoldemState["phase"]): number {
  if (phase === "preflop") return 0;
  if (phase === "flop") return 1;
  if (phase === "turn") return 2;
  if (phase === "river") return 3;
  return 4;
}

function extraForAction(action: UltimateTexasHoldemAction, ante: bigint): bigint {
  if (action.type === "bet_4x") return ante * 4n;
  if (action.type === "bet_2x") return ante * 2n;
  if (action.type === "bet_1x") return ante;
  return 0n;
}

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function UltimateTexasHoldemTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<UltimateTexasHoldemAction, UltimateTexasHoldemState> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<
    UltimateTexasHoldemAction,
    UltimateTexasHoldemState
  > | null>(null);

  const st = session?.state ?? null;
  const inPlay = st && st.phase !== "settled";
  const settled = session?.status === "settled" && !!session.result;
  const ante = st?.stake ?? 0n;
  const showDealer = st && st.phase === "settled" && st.outcome !== "fold";

  const finishRound = useCallback(
    async (s: Session<UltimateTexasHoldemAction, UltimateTexasHoldemState>) => {
      const done = await driver.settleSession(ultimateTexasHoldemGame, s);
      setSession(done);
      pushHistory({
        game: "ultimate-texas-holdem",
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
    if (balance.available < stake * 5n) {
      setError("Need balance for ante + 4× play");
      return;
    }
    setBusy(true);
    try {
      const s = await driver.openSession(ultimateTexasHoldemGame, {
        sessionId: newSessionId(),
        userId,
        gameId: ultimateTexasHoldemGame.id,
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
    async (action: UltimateTexasHoldemAction) => {
      if (!session || session.state.phase === "settled") return;
      setError(null);
      const extra = extraForAction(action, ante);
      if (extra > 0n && balance.available < extra) {
        setError("Insufficient balance for play bet");
        return;
      }
      setBusy(true);
      try {
        const s = (await driver.applyAction(ultimateTexasHoldemGame, session, action, extra)) as Session<
          UltimateTexasHoldemAction,
          UltimateTexasHoldemState
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
  const phase = st?.phase;

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Ultimate Texas Hold'em" rtp={ultimateTexasHoldemRtpLabel()} />
            {inPlay && st && (
              <StreetSteps steps={STREETS} activeIndex={streetIndex(st.phase)} doneThrough={streetIndex(st.phase)} />
            )}
            {!st && (
              <RulesHint>
                Bet 4× pre-flop, 2× on the flop, or 1× on turn/river — or check through and play 1× on the river.
              </RulesHint>
            )}
            {st && (
              <div className="space-y-3">
                <HandPanel
                  label="Board"
                  cards={st.board}
                  hiddenCount={5 - st.visibleBoard}
                  tone="board"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <HandPanel
                    label="Your hole"
                    cards={st.playerHole}
                    score={st.playerScore ? describeScore(st.playerScore) : null}
                    tone="player"
                  />
                  <HandPanel
                    label="Dealer"
                    cards={st.dealerHole}
                    hiddenCount={showDealer ? 0 : 2}
                    score={showDealer && st.dealerScore ? describeScore(st.dealerScore) : null}
                    tone="dealer"
                  />
                </div>
              </div>
            )}
            {inPlay && st.playStake === 0n && phase && (
              <ActionStack>
                {phase === "preflop" && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void act({ type: "bet_4x" })} className={btnPrimary + " w-full"}>
                      Play 4× ({fmtMoney(ante * 4n, token)})
                    </button>
                    <button type="button" disabled={busy} onClick={() => void act({ type: "check" })} className={btnSecondary + " w-full"}>
                      Check
                    </button>
                  </>
                )}
                {phase === "flop" && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void act({ type: "bet_2x" })} className={btnPrimary + " w-full"}>
                      Play 2× ({fmtMoney(ante * 2n, token)})
                    </button>
                    <button type="button" disabled={busy} onClick={() => void act({ type: "check" })} className={btnSecondary + " w-full"}>
                      Check
                    </button>
                  </>
                )}
                {phase === "turn" && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void act({ type: "bet_1x" })} className={btnPrimary + " w-full"}>
                      Play 1× ({fmtMoney(ante, token)})
                    </button>
                    <button type="button" disabled={busy} onClick={() => void act({ type: "check" })} className={btnSecondary + " w-full"}>
                      Check
                    </button>
                  </>
                )}
                {phase === "river" && (
                  <button type="button" disabled={busy} onClick={() => void act({ type: "bet_1x" })} className={btnPrimary + " w-full"}>
                    Play 1× ({fmtMoney(ante, token)})
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => void act({ type: "fold" })} className={btnDanger + " w-full sm:col-span-2"}>
                  Fold
                </button>
              </ActionStack>
            )}
            <StakeRow
              label={`Ante (${token.symbol})`}
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
            hint="Dealer qualifies with any pair. Ante and play pay 1:1 when you beat a qualifying dealer."
          />
        }
      />
      {verifyTarget && (
        <CasinoVerifyModal
          title="Ultimate Texas Hold'em · verify"
          description="Replay hole cards, board, and street bets from the revealed seed."
          session={verifyTarget as Session<unknown, UltimateTexasHoldemState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(ultimateTexasHoldemGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "ultimate-texas-holdem",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={formatUltimateHoldemCards(verifyTarget.state.playerHole)} />
              <VerifyField label="Board" value={formatUltimateHoldemCards(verifyTarget.state.board)} />
              <VerifyField label="Dealer" value={formatUltimateHoldemCards(verifyTarget.state.dealerHole)} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
