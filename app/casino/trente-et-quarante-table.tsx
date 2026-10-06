"use client";

import { useCallback, useEffect, useState } from "react";
import {
  newSessionId,
  persistSettledSession,
  trenteEtQuaranteGame,
  trenteRtpLabel,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
  type TrenteEtQuaranteAction,
  type TrenteEtQuaranteState,
  type TrenteSpot,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import {
  ErrorBanner,
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

const LAST_BET_KEY = "mf_casino_tq_bet";
const LAST_SPOT_KEY = "mf_casino_tq_spot";

const SPOTS: { id: TrenteSpot; label: string; hint: string }[] = [
  { id: "rouge", label: "Rouge", hint: "Closer row · 1:1" },
  { id: "noir", label: "Noir", hint: "Closer row · 1:1" },
  { id: "couleur", label: "Couleur", hint: "First-card color · 1:1" },
  { id: "inverse", label: "Inverse", hint: "Opposite color · 1:1" },
];

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function TrenteEtQuaranteTable({ chainId, token }: Props) {
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
    if (typeof window === "undefined") return 25;
    const v = Number(window.localStorage.getItem(LAST_BET_KEY));
    return Number.isFinite(v) && v > 0 ? v : 25;
  });
  const [spot, setSpot] = useState<TrenteSpot>(() => {
    if (typeof window === "undefined") return "rouge";
    const s = window.localStorage.getItem(LAST_SPOT_KEY);
    return s === "noir" || s === "couleur" || s === "inverse" ? s : "rouge";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_SPOT_KEY, spot);
  }, [betAmount, spot]);

  const [dealing, setDealing] = useState(false);
  const [lastSession, setLastSession] = useState<Session<TrenteEtQuaranteAction, TrenteEtQuaranteState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<TrenteEtQuaranteAction, TrenteEtQuaranteState> | null>(null);

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
      let s = await driver.openSession(trenteEtQuaranteGame, {
        sessionId: newSessionId(),
        userId,
        gameId: trenteEtQuaranteGame.id,
        chainId,
        token,
        stake,
        config: { betSpot: spot, numDecks: 6 },
      });
      s = await driver.settleSession(trenteEtQuaranteGame, s);
      await new Promise((r) => setTimeout(r, 420));
      setLastSession(s);
      pushHistory({
        game: "trente-et-quarante",
        stakeUnits: s.result!.totalStakedUnits,
        pnlUnits: s.result!.pnlUnits,
        multiplier: Number(s.result!.totalPayoutUnits) / Math.max(1, Number(s.result!.totalStakedUnits)),
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
  const headline = st
    ? st.outcome === "refait"
      ? "Refait · both rows 31"
      : st.outcome === "tie"
        ? `Égalité · ${st.rougeTotal}`
        : `${st.outcome === "rouge" ? "Rouge" : "Noir"} · ${st.rougeTotal}–${st.noirTotal}`
    : "";

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead title="Trente et Quarante" rtp={trenteRtpLabel()} badge="Salon" />
            {st ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <HandPanel
                  label={`Rouge · ${st.rougeTotal}`}
                  cards={st.rouge}
                  tone={st.outcome === "rouge" ? "accent" : "dealer"}
                  center={false}
                />
                <HandPanel
                  label={`Noir · ${st.noirTotal}`}
                  cards={st.noir}
                  tone={st.outcome === "noir" ? "player" : "dealer"}
                  center={false}
                />
              </div>
            ) : (
              <RulesHint>
                Six decks. Each row is dealt until it reaches 31. The total closer to 31 wins. A double 31 returns half.
              </RulesHint>
            )}
            {lastSession?.result && st && (
              <SettlementBanner headline={`${headline} · ${st.betSpot}`} pnl={lastSession.result.pnlUnits} token={token} />
            )}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {SPOTS.map((s) => {
                const on = spot === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={dealing}
                    onClick={() => setSpot(s.id)}
                    className={
                      "min-h-[68px] touch-manipulation rounded-lg border px-3 py-2.5 text-left transition-all cursor-pointer disabled:opacity-50 " +
                      (on
                        ? "border-[#e8d5a3]/70 bg-gradient-to-b from-[#f3e6c4]/18 to-[#a7843c]/10 shadow-[inset_0_1px_0_rgba(255,236,196,0.25)]"
                        : "border-[#c6a15b]/15 bg-black/25 hover:border-[#c6a15b]/40")
                    }
                  >
                    <div className="text-[11px] tracking-[0.18em] uppercase font-semibold text-[#f6f1e7]">{s.label}</div>
                    <div className="text-[10px] text-[#f6f1e7]/45 mt-1">{s.hint}</div>
                  </button>
                );
              })}
            </div>
            <StakeRow
              label={`Mise (${token.symbol})`}
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
          title="Trente et Quarante · verify coup"
          description="Replay both rows from the six-deck shoe."
          session={verifyTarget as Session<unknown, TrenteEtQuaranteState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(trenteEtQuaranteGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "trente-et-quarante",
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
              <VerifyField label="Mise" value={verifyTarget.state.betSpot} />
              <VerifyField label="Outcome" value={verifyTarget.state.outcome} />
              <VerifyField label="Rouge" value={String(verifyTarget.state.rougeTotal)} />
              <VerifyField label="Noir" value={String(verifyTarget.state.noirTotal)} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
