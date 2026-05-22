"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  coinflipGame,
  DEFAULT_COINFLIP_CONFIG,
  multiplierFor,
  newSessionId,
  persistSettledSession,
  rtpPercent,
  type ChainAdapter,
  type ChainId,
  type CoinflipAction,
  type CoinflipConfig,
  type CoinflipState,
  type CoinSide,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { ShareLinkRow } from "./share-link";
import { btnPrimary, card, inputCls, labelCls } from "./casino-ui";
import {
  ErrorBanner,
  FairnessStrip,
  fmtMoney as fmtMoneyKit,
  humanToUnits,
  AsideSection,
  DEV_PLAY_MONEY_HUMAN,
  KeyHint,
  LegacyThreeColLayout,
  NumberField,
  fmtPnl,
  RevealedSeedCard,
  TableBalanceHeader,
  unitsToHuman,
} from "./table-kit";

const fmtMoney = (units: bigint, token: TokenSpec, digits = 2) => fmtMoneyKit(units, token, digits);

const LAST_BET_KEY = "mf_casino_cf_last_bet";
const LAST_PICK_KEY = "mf_casino_cf_last_pick";

/* ===========================================================================
 *  Coinflip table
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

interface AutoBetState {
  remaining: number;
  startedAt: number;
  startBalance: bigint;
  totalWagered: bigint;
  totalWon: bigint;
  losses: number;
  wins: number;
}

interface AutoBetConfig {
  enabled: boolean;
  rounds: number;
  /** Bet multiplier on a loss (1 = flat, 2 = martingale). */
  onLossMultiplier: number;
  /** Stop if profit reaches this (token human units). 0 = no limit. */
  stopOnProfit: number;
  /** Stop if loss reaches this. 0 = no limit. */
  stopOnLoss: number;
}

const DEFAULT_AUTO: AutoBetConfig = {
  enabled: false,
  rounds: 25,
  onLossMultiplier: 1,
  stopOnProfit: 0,
  stopOnLoss: 0,
};

export default function CoinflipTable({ chainId, token }: Props) {
  const {
    driver,
    ledger,
    getSeedPair,
    rotateSeed,
    balance,
    refreshBalance,
    pushHistory,
    depositPlayMoney,
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

  const [pick, setPick] = useState<CoinSide>(() => {
    if (typeof window === "undefined") return "heads";
    return (window.localStorage.getItem(LAST_PICK_KEY) as CoinSide) || "heads";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_PICK_KEY, pick);
  }, [pick]);

  const [config] = useState<CoinflipConfig>(DEFAULT_COINFLIP_CONFIG);
  const [animating, setAnimating] = useState(false);
  const [animResult, setAnimResult] = useState<CoinSide | null>(null);
  const [lastSession, setLastSession] = useState<Session<CoinflipAction, CoinflipState> | null>(null);
  const [history, setHistory] = useState<Session<CoinflipAction, CoinflipState>[]>([]);
  const [streak, setStreak] = useState<{ side: CoinSide | null; len: number; longestWin: number }>({
    side: null,
    len: 0,
    longestWin: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<CoinflipAction, CoinflipState> | null>(null);

  const [auto, setAuto] = useState<AutoBetConfig>(DEFAULT_AUTO);
  const autoRef = useRef<AutoBetState | null>(null);
  const cancelAutoRef = useRef(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<AutoBetState | null>(null);

  /* ----- Single flip ----- */

  const singleFlip = useCallback(
    async (overrides?: { stake?: bigint; side?: CoinSide }): Promise<Session<CoinflipAction, CoinflipState> | null> => {
      setError(null);
      try {
        const stake = overrides?.stake ?? humanToUnits(betAmount, token);
        const side = overrides?.side ?? pick;
        if (stake <= 0n) throw new Error("Bet must be > 0");
        if (balance.available < stake) throw new Error("Insufficient balance");

        let s = await driver.openSession(coinflipGame, {
          sessionId: newSessionId(),
          userId,
          gameId: coinflipGame.id,
          chainId,
          token,
          stake,
          config: { ...config, prediction: side } as unknown as Record<string, unknown>,
        });
        // initialState is already terminal; settle immediately.
        s = await driver.settleSession(coinflipGame, s);

        // Animate first; the engine result is what we'll land on.
        setAnimResult(s.state.result);
        setAnimating(true);
        await new Promise((r) => setTimeout(r, 1500));
        setAnimating(false);

        setHistory((h) => [s, ...h].slice(0, 30));
        setLastSession(s);
        pushHistory({
          game: "coinflip",
          stakeUnits: s.result!.totalStakedUnits,
          pnlUnits: s.result!.pnlUnits,
          multiplier: Number(s.result!.totalPayoutUnits) / Math.max(1, Number(s.result!.totalStakedUnits)),
          session: s as unknown as Session<unknown, unknown>,
        });
        // Streak tracking — same outcome side in a row.
        setStreak((prev) => {
          const won = s.state.result === s.state.prediction;
          if (prev.side === s.state.result) {
            const next = { side: s.state.result, len: prev.len + 1, longestWin: prev.longestWin };
            if (won) next.longestWin = Math.max(next.longestWin, next.len);
            return next;
          }
          return {
            side: s.state.result,
            len: 1,
            longestWin: won ? Math.max(prev.longestWin, 1) : prev.longestWin,
          };
        });

        void persistSettledSession(s as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
        await refreshBalance();
        return s;
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    },
    [driver, userId, chainId, token, betAmount, pick, balance.available, config, getSeedPair, refreshBalance, pushHistory],
  );

  /* ----- Auto-bet loop ----- */

  const runAuto = useCallback(async () => {
    if (autoRunning) return;
    setError(null);
    cancelAutoRef.current = false;
    setAutoRunning(true);
    const startBal = (await ledger.getBalance(userId, chainId, token)).available;
    const start: AutoBetState = {
      remaining: auto.rounds,
      startedAt: Date.now(),
      startBalance: startBal,
      totalWagered: 0n,
      totalWon: 0n,
      losses: 0,
      wins: 0,
    };
    autoRef.current = start;
    setAutoProgress(start);

    let currentStake = humanToUnits(betAmount, token);
    const stopProfitUnits = humanToUnits(auto.stopOnProfit, token);
    const stopLossUnits = humanToUnits(auto.stopOnLoss, token);

    for (let i = 0; i < auto.rounds; i++) {
      if (cancelAutoRef.current) break;

      // Check stop conditions before each round.
      const liveBal = (await ledger.getBalance(userId, chainId, token)).available;
      const pnl = liveBal - startBal;
      if (auto.stopOnProfit > 0 && pnl >= stopProfitUnits) {
        break;
      }
      if (auto.stopOnLoss > 0 && -pnl >= stopLossUnits) {
        break;
      }
      if (currentStake > liveBal) break;
      if (currentStake <= 0n) break;

      const session = await singleFlip({ stake: currentStake });
      if (!session) break;

      const won = session.result!.pnlUnits > 0n;
      autoRef.current = {
        ...autoRef.current,
        remaining: autoRef.current!.remaining - 1,
        totalWagered: autoRef.current!.totalWagered + currentStake,
        totalWon: autoRef.current!.totalWon + (session.result!.totalPayoutUnits),
        wins: autoRef.current!.wins + (won ? 1 : 0),
        losses: autoRef.current!.losses + (won ? 0 : 1),
      };
      setAutoProgress(autoRef.current);

      currentStake = won
        ? humanToUnits(betAmount, token)
        : BigInt(Math.floor(Number(currentStake) * auto.onLossMultiplier));

      // Pause briefly between auto-flips for legibility.
      await new Promise((r) => setTimeout(r, 220));
    }
    setAutoRunning(false);
  }, [auto, autoRunning, betAmount, chainId, ledger, singleFlip, token, userId]);

  const stopAuto = () => {
    cancelAutoRef.current = true;
  };

  /* ----- Hot keys ----- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (verifyTarget && e.key === "Escape") {
        setVerifyTarget(null);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "h") setPick("heads");
      else if (k === "t") setPick("tails");
      else if (k === " " || k === "enter") {
        if (!animating && !autoRunning) {
          e.preventDefault();
          void singleFlip();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [animating, autoRunning, singleFlip, verifyTarget]);

  const onDepositPlay = useCallback(async () => {
    await depositPlayMoney(humanToUnits(DEV_PLAY_MONEY_HUMAN, token));
  }, [depositPlayMoney, token]);

  const seedPair = getSeedPair();
  const revealSeed = lastRevealedSeed;
  const onRotateSeed = useCallback(() => {
    rotateSeed();
  }, [rotateSeed]);

  const multiplier = multiplierFor(config);
  const lastResult = lastSession?.state;
  const lastWon = lastResult ? lastResult.result === lastResult.prediction : null;

  return (
    <LegacyThreeColLayout>
      {/* Left column: coin */}
      <section className={card + " p-6 lg:col-span-2 min-h-[560px] flex flex-col"}>
        <TableBalanceHeader
          chainId={chainId}
          token={token}
          balance={balance}
          onDeposit={onDepositPlay}
        />

        <div className="flex-1 flex flex-col items-center justify-center py-4">
          {/* Coin */}
          <Coin
            animating={animating}
            result={animResult}
            placeholderPick={pick}
          />

          {/* Last result chip */}
          <div className="h-8 mt-5 flex items-center">
            {lastResult && !animating && (
              <div
                className={
                  "px-4 py-1 rounded-full text-sm font-semibold border " +
                  (lastWon
                    ? "border-emerald-400/40 text-emerald-300 bg-emerald-500/10"
                    : "border-rose-400/40 text-rose-300 bg-rose-500/10")
                }
              >
                {fmtPnl(lastSession!.result!.pnlUnits, token)} ·
                {" "}called {lastResult.prediction}, landed {lastResult.result}
              </div>
            )}
          </div>

          {/* Pick + bet */}
          <div className="w-full max-w-sm mt-6 space-y-4">
            <div>
              <label className={labelCls}>Your call</label>
              <div className="grid grid-cols-2 gap-2">
                <PickButton side="heads" active={pick === "heads"} hotkey="H" onClick={() => setPick("heads")} disabled={autoRunning || animating} />
                <PickButton side="tails" active={pick === "tails"} hotkey="T" onClick={() => setPick("tails")} disabled={autoRunning || animating} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Stake</label>
              <div className="flex items-stretch gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  disabled={autoRunning}
                  className={inputCls}
                  value={betAmount}
                  onChange={(e) => setBetAmount(Number(e.target.value))}
                />
                <button
                  type="button"
                  disabled={animating || autoRunning}
                  onClick={() => void singleFlip()}
                  className={btnPrimary + " whitespace-nowrap"}
                >
                  Flip · ⏎
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1 flex-wrap">
                {[1, 5, 25, 100, 500].map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={autoRunning}
                    onClick={() => setBetAmount(q)}
                    className="text-[11px] px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {q} {token.symbol}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={autoRunning}
                  onClick={() => setBetAmount((v) => Math.max(1, v * 2))}
                  className="text-[11px] px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  2×
                </button>
                <button
                  type="button"
                  disabled={autoRunning}
                  onClick={() => setBetAmount((v) => Math.max(1, Math.floor(v / 2)))}
                  className="text-[11px] px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ½×
                </button>
              </div>
              <div className="mt-2 text-[11px] text-white/40 flex items-center justify-between">
                <span>Wins pay <span className="text-emerald-300 font-mono">{multiplier.toFixed(2)}×</span></span>
                <span>RTP {rtpPercent(config).toFixed(2)}%</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 max-w-sm">
              <ErrorBanner message={error} />
            </div>
          )}
        </div>

        <FairnessStrip seedPair={seedPair} onRotateSeed={onRotateSeed} />
      </section>

      {/* Right column: side panels */}
      <aside className="space-y-4">
        <AsideSection
          title="Auto-bet"
          right={
            autoRunning ? (
              <button
                type="button"
                onClick={stopAuto}
                className="text-[10px] uppercase tracking-[0.12em] text-rose-300 hover:text-rose-200 cursor-pointer"
              >
                stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuto((a) => ({ ...a, enabled: !a.enabled }))}
                className={
                  "text-[10px] uppercase tracking-[0.12em] cursor-pointer " +
                  (auto.enabled ? "text-emerald-300" : "text-white/40 hover:text-white/70")
                }
              >
                {auto.enabled ? "configured" : "configure"}
              </button>
            )
          }
        >
          {auto.enabled || autoRunning ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Rounds"
                  value={auto.rounds}
                  min={1}
                  max={10_000}
                  onChange={(v) => setAuto({ ...auto, rounds: v })}
                  disabled={autoRunning}
                />
                <NumberField
                  label="On-loss ×"
                  value={auto.onLossMultiplier}
                  step={0.5}
                  min={1}
                  max={10}
                  onChange={(v) => setAuto({ ...auto, onLossMultiplier: v })}
                  disabled={autoRunning}
                />
                <NumberField
                  label="Stop profit"
                  value={auto.stopOnProfit}
                  min={0}
                  onChange={(v) => setAuto({ ...auto, stopOnProfit: v })}
                  disabled={autoRunning}
                />
                <NumberField
                  label="Stop loss"
                  value={auto.stopOnLoss}
                  min={0}
                  onChange={(v) => setAuto({ ...auto, stopOnLoss: v })}
                  disabled={autoRunning}
                />
              </div>
              <button
                type="button"
                disabled={autoRunning || animating}
                onClick={runAuto}
                className={btnPrimary + " w-full"}
              >
                {autoRunning ? "Running…" : `Run ${auto.rounds} auto-flips`}
              </button>
              {autoProgress && (
                <div className="text-[11px] text-white/60 space-y-0.5 pt-1 border-t border-white/[0.06]">
                  <div>Played {auto.rounds - autoProgress.remaining}/{auto.rounds}</div>
                  <div>
                    Wins {autoProgress.wins} · Losses {autoProgress.losses}
                  </div>
                  <div>
                    Wagered {fmtMoney(autoProgress.totalWagered, token)}
                  </div>
                  <div className={
                    Number(autoProgress.totalWon - autoProgress.totalWagered) > 0
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }>
                    PnL {fmtMoney(autoProgress.totalWon - autoProgress.totalWagered, token)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12px] text-white/40">
              Configure martingale or flat-bet runs of 10–10,000 flips with stop-profit / stop-loss guards.
            </div>
          )}
        </AsideSection>

        <AsideSection title="Streak" subtitle="longest winning streak">
          <div className="text-[12px] text-white/70 space-y-1">
            <div>
              Current: <span className="text-white">{streak.side ?? "—"}</span>
              {" "}× <span className="font-mono">{streak.len}</span>
            </div>
            <div>
              Longest win streak: <span className="font-mono text-emerald-300">{streak.longestWin}</span>
            </div>
          </div>
        </AsideSection>

        <AsideSection title="Hot keys" subtitle="flip faster">
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-[11px]">
            <KeyHint k="H" label="Heads" />
            <KeyHint k="T" label="Tails" />
            <KeyHint k="Enter" label="Flip" />
            <KeyHint k="Esc" label="Close modal" />
          </div>
        </AsideSection>

        <AsideSection title="Recent flips" subtitle={`${history.length} settled`}>
          {history.length === 0 && (
            <div className="text-[12px] text-white/40">No flips yet. Pick a side.</div>
          )}
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
            {history.map((h) => {
              const r = h.state;
              const won = r.result === r.prediction;
              return (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={
                        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold " +
                        (r.result === "heads" ? "bg-yellow-500/20 text-yellow-300" : "bg-slate-500/20 text-slate-300")
                      }
                    >
                      {r.result === "heads" ? "H" : "T"}
                    </span>
                    <span className={"text-[11px] " + (won ? "text-emerald-300" : "text-rose-300")}>
                      {won ? "win" : "loss"}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={"text-[11px] font-mono " + (won ? "text-emerald-300" : "text-rose-300")}>
                      {fmtPnl(h.result!.pnlUnits, token)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setVerifyTarget(h)}
                      className="text-[10px] text-white/40 hover:text-emerald-300 cursor-pointer"
                    >
                      verify →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </AsideSection>

        {revealSeed && (
          <RevealedSeedCard serverSeed={revealSeed.serverSeed} onDismiss={dismissRevealedSeed} />
        )}
      </aside>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Verify flip"
          description={
            <>
              Paste the revealed <span className="text-emerald-300">server seed</span>. We re-derive the
              single RNG byte for this flip — LSB 0 → heads, 1 → tails.
            </>
          }
          session={verifyTarget}
          revealedServerSeed={pickRevealedServerSeed(seedPair, revealSeed, verifyTarget)}
          token={token}
          onClose={() => setVerifyTarget(null)}
          resultLabel="Replayed flip matches recorded outcome"
          extraFields={
            <div className="grid grid-cols-2 gap-3">
              <VerifyField label="Predicted" value={verifyTarget.state.prediction} />
              <VerifyField label="Landed" value={verifyTarget.state.result ?? "—"} />
              <VerifyField
                label="RNG byte"
                value={`${verifyTarget.state.resultByte} → byte & 1 = ${verifyTarget.state.resultByte & 1}`}
                mono
              />
              <VerifyField label="Nonce" value={String(verifyTarget.startNonce)} mono />
            </div>
          }
          runVerify={(serverSeed) =>
            runSessionVerify(coinflipGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: coinflipGame.id,
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: {
                ...verifyTarget.state.config,
                prediction: verifyTarget.state.prediction,
              } as Record<string, unknown>,
            })
          }
        />
      )}
    </LegacyThreeColLayout>
  );
}

/* ===========================================================================
 *  Subcomponents
 * ========================================================================= */

/**
 * The coin: a flat 3D-flip animation. When not animating, the visible face
 * is the placeholder (user's current pick); when animating, we keep
 * spinning for ~1.4s then settle on the actual `result` face.
 */
function Coin({
  animating,
  result,
  placeholderPick,
}: {
  animating: boolean;
  result: CoinSide | null;
  placeholderPick: CoinSide;
}) {
  // Display side: while animating we want to land on `result`. The
  // animation uses CSS to spin and we set a final rotation matching the
  // result. While idle we show the placeholder side.
  const showSide = animating ? result ?? placeholderPick : result ?? placeholderPick;
  const flipping = animating;
  return (
    <div className="relative w-48 h-48 perspective-[1000px] select-none">
      <div
        className={
          "w-full h-full transition-transform duration-[1400ms] ease-out " +
          "[transform-style:preserve-3d] "
        }
        style={{
          transform: flipping
            ? `rotateY(${showSide === "heads" ? 1800 : 1980}deg)`
            : `rotateY(${showSide === "heads" ? 0 : 180}deg)`,
        }}
      >
        <CoinFace side="heads" />
        <CoinFace side="tails" back />
      </div>
    </div>
  );
}

function CoinFace({ side, back }: { side: CoinSide; back?: boolean }) {
  const isHeads = side === "heads";
  return (
    <div
      className={
        "absolute inset-0 rounded-full flex flex-col items-center justify-center font-bold border-4 shadow-2xl " +
        (isHeads
          ? "bg-gradient-to-br from-yellow-300 via-amber-400 to-yellow-600 border-yellow-500/60 text-amber-900"
          : "bg-gradient-to-br from-slate-300 via-slate-400 to-slate-600 border-slate-500/60 text-slate-900")
      }
      style={{
        backfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : "rotateY(0deg)",
      }}
    >
      <div className="text-5xl">{isHeads ? "♔" : "♛"}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.25em] opacity-70">
        {isHeads ? "Heads" : "Tails"}
      </div>
    </div>
  );
}

function PickButton({
  side,
  active,
  hotkey,
  onClick,
  disabled,
}: {
  side: CoinSide;
  active: boolean;
  hotkey: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const isHeads = side === "heads";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "h-14 rounded-xl border font-semibold text-sm flex items-center justify-center gap-2 transition-all " +
        (active
          ? (isHeads ? "border-yellow-400/50 bg-yellow-500/15 text-yellow-200" : "border-slate-400/50 bg-slate-500/15 text-slate-200")
          : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white") +
        (disabled ? " opacity-50 cursor-not-allowed" : " cursor-pointer active:scale-[0.98]")
      }
    >
      <span className="capitalize">{side}</span>
      <kbd className="font-mono text-[9px] px-1 py-0.5 rounded border border-white/[0.15] text-white/50">
        {hotkey}
      </kbd>
    </button>
  );
}
