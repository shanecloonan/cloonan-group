"use client";

import { useCallback, useEffect, useState } from "react";
import {
  andarBaharGame,
  andarBaharPayReturn,
  andarBaharRtpLabel,
  cardLabel,
  newSessionId,
  persistSettledSession,
  type AndarBaharAction,
  type AndarBaharSide,
  type AndarBaharState,
  type Card,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { labelCls } from "./casino-ui";
import {
  ChoiceButton,
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

const LAST_BET_KEY = "mf_casino_ab_bet";
const LAST_SIDE_KEY = "mf_casino_ab_side";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function MiniCard({ c, highlight }: { c: Card; highlight?: boolean }) {
  const red = c.suit === "♥" || c.suit === "♦";
  return (
    <span
      className={
        "inline-flex flex-col items-center justify-center w-8 h-11 sm:w-9 sm:h-12 rounded border text-[10px] sm:text-xs font-mono shrink-0 " +
        (highlight
          ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
          : "border-white/15 bg-white/[0.06] " + (red ? "text-rose-300" : "text-white/85"))
      }
    >
      <span className="font-bold leading-none">{c.rank}</span>
      <span className="leading-none">{c.suit}</span>
    </span>
  );
}

function CardStack({
  cards,
  winner,
  side,
}: {
  cards: Card[];
  winner: AndarBaharSide;
  side: AndarBaharSide;
}) {
  return (
    <div className="flex flex-wrap gap-1 justify-center min-h-[3rem]">
      {cards.map((c, i) => (
        <MiniCard key={i} c={c} highlight={winner === side && i === cards.length - 1} />
      ))}
    </div>
  );
}

export default function AndarBaharTable({ chainId, token }: Props) {
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
  const [side, setSide] = useState<AndarBaharSide>(() => {
    if (typeof window === "undefined") return "andar";
    return window.localStorage.getItem(LAST_SIDE_KEY) === "bahar" ? "bahar" : "andar";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_SIDE_KEY, side);
  }, [betAmount, side]);

  const [lastSession, setLastSession] = useState<Session<AndarBaharAction, AndarBaharState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<AndarBaharAction, AndarBaharState> | null>(null);

  const play = useCallback(async () => {
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
      let s = await driver.openSession(andarBaharGame, {
        sessionId: newSessionId(),
        userId,
        gameId: andarBaharGame.id,
        chainId,
        token,
        stake,
        config: { betSide: side },
      });
      s = await driver.settleSession(andarBaharGame, s);
      await new Promise((r) => setTimeout(r, 600));
      setLastSession(s);
      pushHistory({
        game: "andar-bahar",
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
  }, [balance.available, betAmount, chainId, driver, getSeedPair, pushHistory, refreshBalance, side, token, userId]);

  const st = lastSession?.state;
  const seedPair = getSeedPair();

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Andar Bahar" rtp={andarBaharRtpLabel(side)} />

          {st ? (
            <>
              <div className="flex justify-center">
                <div className="rounded-xl border-2 border-amber-400/40 bg-amber-500/10 px-4 py-3 flex flex-col items-center gap-2">
                  <div className={labelCls + " !mb-0"}>Joker</div>
                  <PlayingCard c={st.jokerCard} large />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={
                    "rounded-xl border p-3 " +
                    (st.winner === "andar" ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10")
                  }
                >
                  <div className="text-xs font-semibold text-center text-white/80 mb-2">Andar (inside)</div>
                  <CardStack cards={st.andarCards} winner={st.winner} side="andar" />
                  <div className="text-[10px] text-center text-white/45 mt-2">0.9:1</div>
                </div>
                <div
                  className={
                    "rounded-xl border p-3 " +
                    (st.winner === "bahar" ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10")
                  }
                >
                  <div className="text-xs font-semibold text-center text-white/80 mb-2">Bahar (outside)</div>
                  <CardStack cards={st.baharCards} winner={st.winner} side="bahar" />
                  <div className="text-[10px] text-center text-white/45 mt-2">1:1 · deals first</div>
                </div>
              </div>
            </>
          ) : (
            <RulesHint>Pick a side. Cards alternate from Bahar until a card matches the joker rank.</RulesHint>
          )}

          <div className="grid grid-cols-2 gap-2">
            {(["andar", "bahar"] as const).map((s) => (
              <ChoiceButton
                key={s}
                active={side === s}
                disabled={busy}
                onClick={() => setSide(s)}
                label={s.charAt(0).toUpperCase() + s.slice(1)}
                hint={s === "andar" ? `${andarBaharPayReturn("andar")}×` : `${andarBaharPayReturn("bahar")}×`}
              />
            ))}
          </div>

          {st && lastSession?.result && (
            <SettlementBanner
              headline={`${st.winner} wins · you bet ${st.betSide}`}
              pnl={lastSession.result.pnlUnits}
              token={token}
            />
          )}

          <StakeRow
            label={`Bet (${token.symbol})`}
            betAmount={betAmount}
            onBetAmount={setBetAmount}
            token={token}
            disabled={busy}
            actionLabel={busy ? "Dealing…" : lastSession ? "Deal again" : "Deal"}
            onAction={() => void play()}
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
          />
        }
      />

      {verifyTarget && (
        <CasinoVerifyModal
          title="Andar Bahar · verify round"
          description="Replay joker draw and alternating piles from the revealed seed."
          session={verifyTarget as Session<unknown, AndarBaharState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(andarBaharGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "andar-bahar",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { betSide: verifyTarget.state.betSide },
            })
          }
          extraFields={
            <>
              <VerifyField label="Joker" value={cardLabel(verifyTarget.state.jokerCard)} />
              <VerifyField label="Your bet" value={verifyTarget.state.betSide} />
              <VerifyField label="Winner" value={verifyTarget.state.winner} />
              <VerifyField label="Match" value={cardLabel(verifyTarget.state.winningCard)} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
