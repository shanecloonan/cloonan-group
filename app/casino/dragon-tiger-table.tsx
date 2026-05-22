"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cardLabel,
  dragonTigerGame,
  dragonTigerRtpLabel,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type DragonTigerAction,
  type DragonTigerSpot,
  type DragonTigerState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import {
  ErrorBanner,
  humanToUnits,
  HandPanel,
  RulesHint,
  SettlementBanner,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_dt_bet";
const LAST_SPOT_KEY = "mf_casino_dt_spot";

const SPOTS: { id: DragonTigerSpot; label: string; hint: string; accent: string }[] = [
  { id: "dragon", label: "Dragon", hint: "1:1 · half on tie", accent: "from-rose-600/30 to-rose-900/20 border-rose-400/40" },
  { id: "tiger", label: "Tiger", hint: "1:1 · half on tie", accent: "from-amber-600/30 to-amber-900/20 border-amber-400/40" },
  { id: "tie", label: "Tie", hint: "11:1", accent: "from-violet-600/25 to-violet-900/15 border-violet-400/35" },
];

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function DragonTigerTable({ chainId, token }: Props) {
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
  const [spot, setSpot] = useState<DragonTigerSpot>(() => {
    if (typeof window === "undefined") return "dragon";
    const s = window.localStorage.getItem(LAST_SPOT_KEY);
    return s === "tiger" || s === "tie" ? s : "dragon";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_SPOT_KEY, spot);
  }, [betAmount, spot]);

  const [dealing, setDealing] = useState(false);
  const [lastSession, setLastSession] = useState<Session<DragonTigerAction, DragonTigerState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<DragonTigerAction, DragonTigerState> | null>(null);

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
    setDealing(true);
    try {
      let s = await driver.openSession(dragonTigerGame, {
        sessionId: newSessionId(),
        userId,
        gameId: dragonTigerGame.id,
        chainId,
        token,
        stake,
        config: { betSpot: spot },
      });
      s = await driver.settleSession(dragonTigerGame, s);
      await new Promise((r) => setTimeout(r, 500));
      setLastSession(s);
      pushHistory({
        game: "dragon-tiger",
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
      setDealing(false);
    }
  }, [balance.available, betAmount, chainId, driver, getSeedPair, pushHistory, refreshBalance, spot, token, userId]);

  const seedPair = getSeedPair();
  const st = lastSession?.state;

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Dragon Tiger" rtp={dragonTigerRtpLabel(spot)} />
            {st ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 max-w-md mx-auto w-full">
                <HandPanel
                  label="Dragon"
                  cards={[st.dragonCard]}
                  score={cardLabel(st.dragonCard)}
                  tone={st.winner === "dragon" ? "player" : "dealer"}
                />
                <HandPanel
                  label="Tiger"
                  cards={[st.tigerCard]}
                  score={cardLabel(st.tigerCard)}
                  tone={st.winner === "tiger" ? "player" : "dealer"}
                />
              </div>
            ) : (
              <RulesHint>Highest card wins — Ace low, King high. Tie returns half on Dragon/Tiger bets.</RulesHint>
            )}
            {st?.winner === "tie" && (
              <p className="text-center text-sm text-violet-200/90 font-medium">
                Tie — both {st.dragonRank}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {SPOTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={dealing}
                  onClick={() => setSpot(s.id)}
                  className={
                    "min-h-[72px] touch-manipulation rounded-xl border p-3 text-left transition-all cursor-pointer disabled:opacity-50 bg-gradient-to-br " +
                    s.accent +
                    " " +
                    (spot === s.id ? "ring-2 ring-amber-400/50" : "opacity-90 hover:opacity-100")
                  }
                >
                  <div className="text-sm font-semibold text-white">{s.label}</div>
                  <div className="text-[10px] text-white/55 mt-0.5">{s.hint}</div>
                </button>
              ))}
            </div>
            {lastSession?.result && st && (
              <SettlementBanner
                headline={`${st.winner} · you bet ${st.betSpot}`}
                pnl={lastSession.result.pnlUnits}
                token={token}
              />
            )}
            <StakeRow
              label={`Bet (${token.symbol})`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={dealing}
              actionLabel={dealing ? "Dealing…" : lastSession ? "Deal again" : "Deal"}
              onAction={() => void deal()}
              actionBusy={dealing}
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
          title="Dragon Tiger · verify hand"
          description="Replay two card draws from the 8-deck shoe."
          session={verifyTarget as Session<unknown, DragonTigerState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(dragonTigerGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "dragon-tiger",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: {
                betSpot: verifyTarget.state.betSpot,
                numDecks: verifyTarget.state.config.numDecks,
              },
            })
          }
          extraFields={
            <>
              <VerifyField label="Your bet" value={verifyTarget.state.betSpot} />
              <VerifyField label="Winner" value={verifyTarget.state.winner} />
              <VerifyField
                label="Dragon"
                value={`${verifyTarget.state.dragonRank} — ${cardLabel(verifyTarget.state.dragonCard)}`}
              />
              <VerifyField
                label="Tiger"
                value={`${verifyTarget.state.tigerRank} — ${cardLabel(verifyTarget.state.tigerCard)}`}
              />
            </>
          }
        />
      )}
    </TablePage>
  );
}
