"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KENO_MAX_PICKS,
  KENO_POOL,
  kenoGame,
  kenoRtpLabel,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type KenoAction,
  type KenoState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnGhost } from "./casino-ui";
import {
  ErrorBanner,
  humanToUnits,
  KenoBoard,
  RulesHint,
  SettlementBanner,
  StakeRow,
  TableAside,
  TableGrid,
  TableHead,
  TablePage,
} from "./table-kit";

const LAST_BET_KEY = "mf_casino_keno_bet";
const LAST_PICKS_KEY = "mf_casino_keno_picks";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function KenoTable({ chainId, token }: Props) {
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
  const [picks, setPicks] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(LAST_PICKS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) ? parsed.filter((n) => n >= 1 && n <= KENO_POOL).slice(0, KENO_MAX_PICKS) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_PICKS_KEY, JSON.stringify(picks));
  }, [betAmount, picks]);

  const [lastSession, setLastSession] = useState<Session<KenoAction, KenoState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<KenoAction, KenoState> | null>(null);

  const toggle = (n: number) => {
    if (lastSession) return;
    setPicks((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= KENO_MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const quickPick = () => {
    const pool = Array.from({ length: KENO_POOL }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setPicks(pool.slice(0, KENO_MAX_PICKS).sort((a, b) => a - b));
  };

  const play = useCallback(async () => {
    setError(null);
    setLastSession(null);
    if (picks.length < 1) {
      setError(`Select 1–${KENO_MAX_PICKS} numbers.`);
      return;
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
      let s = await driver.openSession(kenoGame, {
        sessionId: newSessionId(),
        userId,
        gameId: kenoGame.id,
        chainId,
        token,
        stake,
        config: { picks },
      });
      s = await driver.settleSession(kenoGame, s);
      setLastSession(s);
      pushHistory({
        game: "keno",
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
  }, [balance.available, betAmount, chainId, driver, getSeedPair, picks, pushHistory, refreshBalance, token, userId]);

  const st = lastSession?.state;
  const seedPair = getSeedPair();
  const locked = busy || !!lastSession; // lock picks while showing result

  return (
    <TablePage>
      <TableGrid
        main={
          <>
            <TableHead
              title="Keno"
              rtp={`${kenoRtpLabel(picks.length || 1)} · 20 of ${KENO_POOL}`}
            />
            <KenoBoard
              pool={KENO_POOL}
              picks={picks}
              drawn={st?.drawn ?? []}
              disabled={locked}
              onToggle={toggle}
            />
            <div className="flex flex-wrap gap-3 text-[11px] text-white/45">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded border-2 border-amber-400/70 bg-amber-500/20" /> Pick
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-400" /> Hit
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-white/[0.08] border border-white/15" /> Drawn
              </span>
            </div>
            {st && lastSession?.result && (
              <SettlementBanner
                headline={`${st.hits} hits · ${st.payMultiplier > 0 ? `${st.payMultiplier}×` : "no pay"}`}
                pnl={lastSession.result.pnlUnits}
                token={token}
              />
            )}
            {!st && (
              <div className="flex flex-wrap gap-2 items-center text-sm text-white/60">
                <span>
                  <strong className="text-white">{picks.length}</strong> / {KENO_MAX_PICKS} selected
                </span>
                <button type="button" onClick={quickPick} disabled={busy} className={btnGhost + " !h-8 !text-xs"}>
                  Quick pick 10
                </button>
                <button
                  type="button"
                  onClick={() => setPicks([])}
                  disabled={busy || picks.length === 0}
                  className={btnGhost + " !h-8 !text-xs"}
                >
                  Clear
                </button>
              </div>
            )}
            <RulesHint>Pick up to 10 numbers. Twenty balls are drawn from 1–80.</RulesHint>
            <StakeRow
              label={`Bet (${token.symbol})`}
              betAmount={betAmount}
              onBetAmount={setBetAmount}
              token={token}
              disabled={busy}
              actionLabel={busy ? "Drawing…" : lastSession ? "Draw again" : "Play"}
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
          title="Keno · verify draw"
          description="Replay the 20-number draw and hit count from the revealed seed."
          session={verifyTarget as Session<unknown, KenoState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(kenoGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "keno",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { picks: verifyTarget.state.picks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Hits" value={`${verifyTarget.state.hits} / ${verifyTarget.state.picks.length}`} />
              <VerifyField label="Pay" value={`${verifyTarget.state.payMultiplier}×`} />
              <VerifyField label="Your picks" value={verifyTarget.state.picks.join(", ")} />
              <VerifyField label="Drawn" value={verifyTarget.state.drawn.join(", ")} />
            </>
          }
        />
      )}
    </TablePage>
  );
}
