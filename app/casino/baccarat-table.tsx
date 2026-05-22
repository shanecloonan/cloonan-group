"use client";

import { useCallback, useEffect, useState } from "react";
import {
  baccaratGame,
  baccaratRtpLabel,
  cardLabel,
  formatBaccaratCards,
  newSessionId,
  persistSettledSession,
  type BaccaratAction,
  type BaccaratSpot,
  type BaccaratState,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { card, labelCls } from "./casino-ui";
import {
  ChoiceButton,
  ErrorBanner,
  fmtMoney,
  HandPanel,
  humanToUnits,
  RulesHint,
  SettlementBanner,
  shortSeedHash,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_bac_last_bet";
const LAST_SPOT_KEY = "mf_casino_bac_last_spot";

const SPOTS: { id: BaccaratSpot; label: string; hint: string }[] = [
  { id: "player", label: "Player", hint: "1:1 · push on tie" },
  { id: "banker", label: "Banker", hint: "0.95:1 · 5% commission" },
  { id: "tie", label: "Tie", hint: "8:1" },
];

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function BaccaratTable({ chainId, token }: Props) {
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
  const [spot, setSpot] = useState<BaccaratSpot>(() => {
    if (typeof window === "undefined") return "player";
    const s = window.localStorage.getItem(LAST_SPOT_KEY);
    return s === "banker" || s === "tie" ? s : "player";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_SPOT_KEY, spot);
  }, [betAmount, spot]);

  const [dealing, setDealing] = useState(false);
  const [lastSession, setLastSession] = useState<Session<BaccaratAction, BaccaratState> | null>(null);
  const [history, setHistory] = useState<Session<BaccaratAction, BaccaratState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<BaccaratAction, BaccaratState> | null>(null);

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
      let s = await driver.openSession(baccaratGame, {
        sessionId: newSessionId(),
        userId,
        gameId: baccaratGame.id,
        chainId,
        token,
        stake,
        config: { betSpot: spot },
      });
      s = await driver.settleSession(baccaratGame, s);
      await new Promise((r) => setTimeout(r, 600));
      setLastSession(s);
      setHistory((h) => [s, ...h].slice(0, 24));
      pushHistory({
        game: "baccarat",
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
            <TableHead title="Punto Banco" rtp={baccaratRtpLabel(spot)} />
            {st ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <HandPanel
                  label="Player"
                  cards={st.playerCards}
                  score={String(st.playerTotal)}
                  tone={st.winner === "player" ? "player" : "dealer"}
                />
                <HandPanel
                  label="Banker"
                  cards={st.bankerCards}
                  score={String(st.bankerTotal)}
                  tone={st.winner === "banker" ? "player" : "dealer"}
                />
              </div>
            ) : (
              <RulesHint>Pick a spot and deal — standard 8-deck shoe with third-card rules.</RulesHint>
            )}
            {st?.winner === "tie" && (
              <p className="text-center text-sm text-amber-200/90 font-medium">Tie — {st.playerTotal}</p>
            )}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {SPOTS.map((s) => (
                <ChoiceButton
                  key={s.id}
                  active={spot === s.id}
                  disabled={dealing}
                  onClick={() => setSpot(s.id)}
                  label={s.label}
                  hint={s.hint}
                />
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
          <>
            <TableAside
              balance={balance.available}
              token={token}
              onRotateSeed={() => rotateSeed()}
              onVerify={lastSession ? () => setVerifyTarget(lastSession) : undefined}
              hint={`Seed ${shortSeedHash(seedPair.serverSeedHash, 12)}`}
            />
            {history.length > 0 && (
              <section className={card + " p-4 max-h-48 overflow-y-auto"}>
                <div className={labelCls}>Recent</div>
                <ul className="space-y-1.5">
                  {history.slice(0, 8).map((h) => (
                    <li key={h.id} className="flex justify-between gap-2 text-[11px]">
                      <span className="text-white/50 truncate">
                        {h.state.betSpot} · {h.state.winner}
                      </span>
                      <button
                        type="button"
                        onClick={() => setVerifyTarget(h)}
                        className={
                          "font-mono shrink-0 cursor-pointer " +
                          (h.result!.pnlUnits >= 0n ? "text-emerald-300/90" : "text-rose-300/90")
                        }
                      >
                        {fmtMoney(h.result!.pnlUnits, token)}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        }
      />

      {verifyTarget && (
        <CasinoVerifyModal
          title="Baccarat · verify hand"
          description="Replay the shoe deal and third-card tableau from the revealed server seed."
          session={verifyTarget as Session<unknown, BaccaratState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(baccaratGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "baccarat",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { betSpot: verifyTarget.state.betSpot, numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Your bet" value={verifyTarget.state.betSpot} />
              <VerifyField label="Outcome" value={verifyTarget.state.winner} />
              <VerifyField
                label="Player"
                value={`${verifyTarget.state.playerTotal} — ${formatBaccaratCards(verifyTarget.state.playerCards)}`}
              />
              <VerifyField
                label="Banker"
                value={`${verifyTarget.state.bankerTotal} — ${formatBaccaratCards(verifyTarget.state.bankerCards)}`}
              />
            </>
          }
        />
      )}
    </TablePage>
  );
}
