"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cardLabel,
  casinoWarGame,
  casinoWarRtpLabel,
  newSessionId,
  persistSettledSession,
  type CasinoWarAction,
  type CasinoWarState,
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
  RulesHint,
  SettlementBanner,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_war_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function CasinoWarTable({ chainId, token }: Props) {
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

  const [session, setSession] = useState<Session<CasinoWarAction, CasinoWarState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<CasinoWarAction, CasinoWarState> | null>(null);

  const st = session?.state ?? null;
  const inRound = st !== null && !casinoWarGame.isTerminal(st);
  const needsTieChoice = st?.phase === "tie_choice";

  const finishRound = useCallback(
    async (s: Session<CasinoWarAction, CasinoWarState>) => {
      const settled = await driver.settleSession(casinoWarGame, s);
      setSession(settled);
      pushHistory({
        game: "casino-war",
        stakeUnits: settled.result!.totalStakedUnits,
        pnlUnits: settled.result!.pnlUnits,
        multiplier:
          Number(settled.result!.totalPayoutUnits) / Math.max(1, Number(settled.result!.totalStakedUnits)),
        session: settled as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(settled as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
      await refreshBalance();
      return settled;
    },
    [driver, getSeedPair, pushHistory, refreshBalance],
  );

  const deal = useCallback(async () => {
    setError(null);
    if (inRound) {
      setError("Finish the current hand first");
      return;
    }
    if (session?.status === "settled") {
      setSession(null);
    }
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
      let s = await driver.openSession(casinoWarGame, {
        sessionId: newSessionId(),
        userId,
        gameId: casinoWarGame.id,
        chainId,
        token,
        stake,
        config: {},
      });
      setSession(s);
      if (casinoWarGame.isTerminal(s.state)) {
        await finishRound(s);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, betAmount, chainId, driver, finishRound, inRound, session?.status, token, userId]);

  const onWar = useCallback(async () => {
    if (!session || session.state.phase !== "tie_choice") return;
    setError(null);
    setBusy(true);
    try {
      const extra = session.stake;
      if (balance.available < extra) {
        setError("Insufficient balance for war bet");
        return;
      }
      let s = (await driver.applyAction(casinoWarGame, session, { type: "war" }, extra)) as Session<
        CasinoWarAction,
        CasinoWarState
      >;
      setSession(s);
      await finishRound(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, driver, finishRound, session]);

  const onSurrender = useCallback(async () => {
    if (!session || session.state.phase !== "tie_choice") return;
    setError(null);
    setBusy(true);
    try {
      let s = (await driver.applyAction(casinoWarGame, session, {
        type: "surrender",
      })) as Session<CasinoWarAction, CasinoWarState>;
      setSession(s);
      await finishRound(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [driver, finishRound, session]);

  const seedPair = getSeedPair();
  const settled = session?.status === "settled" && !!session.result;

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Casino War" rtp={casinoWarRtpLabel()} />
            {st ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 max-w-md mx-auto w-full">
                  <HandPanel label="You" cards={[st.playerCard]} tone="player" />
                  <HandPanel label="Dealer" cards={[st.dealerCard]} tone="dealer" />
                </div>
                {st.warPlayerCard && st.warDealerCard && (
                  <div className="space-y-2">
                    <p className="text-center text-[10px] uppercase tracking-wider text-white/40">War cards</p>
                    <div className="grid grid-cols-2 gap-3 max-w-md mx-auto w-full">
                      <HandPanel label="You" cards={[st.warPlayerCard]} tone="player" score="war" />
                      <HandPanel label="Dealer" cards={[st.warDealerCard]} tone="dealer" score="war" />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <RulesHint>Ace high · tie = war (match bet) or surrender half.</RulesHint>
            )}
            {needsTieChoice && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 space-y-3">
                <p className="text-sm text-amber-100 text-center font-medium">
                  Tie on {cardLabel(st.playerCard)} — go to war or surrender?
                </p>
                <ActionStack>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onWar()}
                    className={btnPrimary + " w-full"}
                  >
                    War (+{fmtMoney(session!.stake, token)})
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onSurrender()}
                    className={btnDanger + " w-full"}
                  >
                    Surrender (half back)
                  </button>
                </ActionStack>
              </div>
            )}
            {!needsTieChoice && (
              <StakeRow
                label={`Bet (${token.symbol})`}
                betAmount={betAmount}
                onBetAmount={setBetAmount}
                token={token}
                disabled={busy || (inRound && !settled)}
                actionLabel={busy ? "Dealing…" : settled ? "Deal again" : "Deal"}
                onAction={() => void deal()}
                actionBusy={busy}
                hideAction={inRound && !settled}
              />
            )}
            {settled && session?.result && (
              <SettlementBanner
                headline={st?.resolution ?? "Hand complete"}
                pnl={session.result.pnlUnits}
                token={token}
              />
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
          />
        }
      />

      {verifyTarget && (
        <CasinoVerifyModal
          title="Casino War · verify hand"
          description="Replay the deal, optional war burn and re-deal from the revealed seed."
          session={verifyTarget as Session<unknown, CasinoWarState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(casinoWarGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "casino-war",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={cardLabel(verifyTarget.state.playerCard)} />
              <VerifyField label="Dealer" value={cardLabel(verifyTarget.state.dealerCard)} />
              <VerifyField label="Outcome" value={verifyTarget.state.resolution ?? "—"} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
