"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cardLabel,
  newSessionId,
  persistSettledSession,
  redDogGame,
  redDogRtpLabel,
  spreadReturnHint,
  type Card,
  type ChainAdapter,
  type ChainId,
  type RedDogAction,
  type RedDogState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import {
  ErrorBanner,
  humanToUnits,
  PlayingCard,
  RulesHint,
  SettlementBanner,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_reddog_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function CardSlot({ c, label, highlight }: { c?: Card; label: string; highlight?: boolean }) {
  return (
    <div
      className={
        "flex flex-col items-center gap-1.5 rounded-xl border p-2 min-w-[4.25rem] " +
        (highlight ? "border-emerald-400/50 bg-emerald-500/10" : "border-white/10 bg-white/[0.04]")
      }
    >
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      {c ? (
        <PlayingCard c={c} large />
      ) : (
        <div className="w-12 h-16 sm:w-14 sm:h-[4.25rem] rounded-lg border border-dashed border-white/15 flex flex-col items-center justify-center text-[10px] text-white/40 text-center px-1 leading-tight">
          No 3rd
          <span className="text-[9px]">push</span>
        </div>
      )}
    </div>
  );
}

export default function RedDogTable({ chainId, token }: Props) {
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

  const [lastSession, setLastSession] = useState<Session<RedDogAction, RedDogState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<RedDogAction, RedDogState> | null>(null);

  const deal = useCallback(async () => {
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
      let s = await driver.openSession(redDogGame, {
        sessionId: newSessionId(),
        userId,
        gameId: redDogGame.id,
        chainId,
        token,
        stake,
        config: {},
      });
      s = await driver.settleSession(redDogGame, s);
      await new Promise((r) => setTimeout(r, 500));
      setLastSession(s);
      pushHistory({
        game: "red-dog",
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

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead
              title="Red Dog"
              rtp={st ? redDogRtpLabel(st.spread) : undefined}
              badge={st ? undefined : "Ace high"}
            />
            {st ? (
              <div className="flex justify-center items-end gap-2 sm:gap-4 flex-wrap">
                <CardSlot c={st.card1} label="1st" />
                <CardSlot c={st.card2} label="2nd" />
                {st.card3 ? (
                  <CardSlot c={st.card3} label="3rd" highlight={st.won} />
                ) : (
                  <CardSlot label="3rd" />
                )}
              </div>
            ) : (
              <RulesHint>Two cards set the spread — third card wins if it lands between (Ace high).</RulesHint>
            )}
            {st && !st.pushed && (
              <p className="text-center text-sm text-white/55 font-mono">
                Spread {st.spread}
                {st.spread >= 1 ? ` · pays ${spreadReturnHint(st.spread)}×` : ""}
              </p>
            )}
            {st && lastSession?.result && (
              <SettlementBanner
                headline={st.pushed ? "Push" : st.won ? "Win" : "Loss"}
                pnl={lastSession.result.pnlUnits}
                token={token}
              />
            )}
            {!st && (
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 text-[9px] text-white/40 text-center">
                {[1, 2, 3, 4, 5, 6, 7].map((s) => (
                  <div key={s} className="rounded border border-white/10 py-1">
                    <div className="font-bold text-white/60">{s}</div>
                    <div>{spreadReturnHint(s)}×</div>
                  </div>
                ))}
              </div>
            )}
            <StakeRow
              label={`Bet (${token.symbol})`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={busy}
              actionLabel={busy ? "Dealing…" : lastSession ? "Deal again" : "Deal"}
              onAction={() => void deal()}
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
            hint="Equal ranks push. Consecutive ranks lose."
          />
        }
      />

      {verifyTarget && (
        <CasinoVerifyModal
          title="Red Dog · verify hand"
          description="Replay two or three card draws from the shoe."
          session={verifyTarget as Session<unknown, RedDogState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(redDogGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "red-dog",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField
                label="Cards"
                value={`${cardLabel(verifyTarget.state.card1)} · ${cardLabel(verifyTarget.state.card2)}${verifyTarget.state.card3 ? ` · ${cardLabel(verifyTarget.state.card3)}` : ""}`}
              />
              <VerifyField label="Spread" value={String(verifyTarget.state.spread)} />
              <VerifyField
                label="Outcome"
                value={verifyTarget.state.pushed ? "push" : verifyTarget.state.won ? "win" : "loss"}
              />
            </>
          }
        />
      )}
    </TablePage>
  );
}
