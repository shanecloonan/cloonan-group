"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DICE_CONFIG,
  diceGame,
  diceMultiplier,
  diceWinChancePercent,
  limboTargetForMultiplier,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type DiceAction,
  type DiceDirection,
  type DiceState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { ShareLinkRow } from "./share-link";
import { btnPrimary, card, inputCls, labelCls } from "./casino-ui";
import {
  fmtMoney as fmtMoneyKit,
  humanToUnits,
  LegacyThreeColLayout,
  TableBalanceHeader,
  unitsToHuman,
} from "./table-kit";

const fmtMoney = (units: bigint, token: TokenSpec, digits = 2) => fmtMoneyKit(units, token, digits);

const LAST_BET = "mf_casino_dice_bet";
const LAST_TARGET = "mf_casino_dice_target";
const LAST_DIR = "mf_casino_dice_dir";
const LAST_MODE = "mf_casino_dice_mode";

type DiceMode = "classic" | "limbo";

/* ===========================================================================
 *  Dice table
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

interface AutoState {
  remaining: number;
  totalWagered: bigint;
  totalWon: bigint;
  wins: number;
  losses: number;
  startBalance: bigint;
}

interface AutoConfig {
  rounds: number;
  onLossMultiplier: number;
  stopOnProfit: number;
  stopOnLoss: number;
}

const DEFAULT_AUTO: AutoConfig = {
  rounds: 25,
  onLossMultiplier: 1,
  stopOnProfit: 0,
  stopOnLoss: 0,
};

export default function DiceTable({ chainId, token }: Props) {
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

  /* ----- Persisted controls ----- */

  const [betAmount, setBetAmount] = useState(() => {
    if (typeof window === "undefined") return 10;
    const v = Number(window.localStorage.getItem(LAST_BET));
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_BET, String(betAmount));
  }, [betAmount]);

  const [mode, setMode] = useState<DiceMode>(() => {
    if (typeof window === "undefined") return "classic";
    return (window.localStorage.getItem(LAST_MODE) as DiceMode) || "classic";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_MODE, mode);
  }, [mode]);

  const [direction, setDirection] = useState<DiceDirection>(() => {
    if (typeof window === "undefined") return "under";
    return (window.localStorage.getItem(LAST_DIR) as DiceDirection) || "under";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_DIR, direction);
  }, [direction]);

  // Classic mode: 0.01..99.98 with 0.01 resolution → store as targetBps 1..9998.
  const [targetBps, setTargetBps] = useState(() => {
    if (typeof window === "undefined") return 5000;
    const v = Number(window.localStorage.getItem(LAST_TARGET));
    return Number.isInteger(v) && v >= 1 && v <= 9998 ? v : 5000;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_TARGET, String(targetBps));
  }, [targetBps]);

  // Limbo mode: store as target multiplier 1.01..9900.
  const [limboTarget, setLimboTarget] = useState(2.0);

  /* ----- Engine state ----- */

  const [lastSession, setLastSession] = useState<Session<DiceAction, DiceState> | null>(null);
  const [history, setHistory] = useState<Session<DiceAction, DiceState>[]>([]);
  const [animating, setAnimating] = useState(false);
  const [animRoll, setAnimRoll] = useState<number | null>(null); // shown rollBps during animation
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<DiceAction, DiceState> | null>(null);

  /* ----- Computed: live win chance + multiplier ----- */

  const live = useMemo(() => {
    if (mode === "limbo") {
      const derived = limboTargetForMultiplier(limboTarget, DEFAULT_DICE_CONFIG);
      if (!derived) {
        return { reachable: false, winChance: 0, multiplier: 0, targetBps: 0, direction: "over" as DiceDirection };
      }
      return {
        reachable: true,
        winChance: diceWinChancePercent(derived.direction, derived.targetBps),
        multiplier: diceMultiplier(derived.direction, derived.targetBps),
        targetBps: derived.targetBps,
        direction: derived.direction,
      };
    }
    return {
      reachable: true,
      winChance: diceWinChancePercent(direction, targetBps),
      multiplier: diceMultiplier(direction, targetBps),
      targetBps,
      direction,
    };
  }, [mode, direction, targetBps, limboTarget]);

  /* ----- Single roll ----- */

  const rollOnce = useCallback(
    async (override?: { stake?: bigint }): Promise<Session<DiceAction, DiceState> | null> => {
      setError(null);
      try {
        const stake = override?.stake ?? humanToUnits(betAmount, token);
        if (stake <= 0n) throw new Error("Bet must be > 0");
        if (balance.available < stake) throw new Error("Insufficient balance");
        if (!live.reachable) throw new Error("Target multiplier out of range");

        const config =
          mode === "limbo"
            ? { ...DEFAULT_DICE_CONFIG, limboMultiplier: limboTarget }
            : { ...DEFAULT_DICE_CONFIG, targetBps, direction };

        let s = await driver.openSession(diceGame, {
          sessionId: newSessionId(),
          userId,
          gameId: diceGame.id,
          chainId,
          token,
          stake,
          config: config as unknown as Record<string, unknown>,
        });
        s = await driver.settleSession(diceGame, s);

        // Number-line animation: ramp from a random anchor toward the actual roll.
        const finalRoll = s.state.rollBps;
        setAnimating(true);
        const frames = 18;
        const startRoll = Math.floor(Math.random() * 10000);
        for (let i = 1; i <= frames; i++) {
          const t = i / frames;
          // ease-out
          const eased = 1 - Math.pow(1 - t, 3);
          const interp = Math.round(startRoll + (finalRoll - startRoll) * eased);
          setAnimRoll(interp);
          await new Promise((r) => setTimeout(r, 22));
        }
        setAnimRoll(finalRoll);
        await new Promise((r) => setTimeout(r, 120));
        setAnimating(false);

        setHistory((h) => [s, ...h].slice(0, 30));
        setLastSession(s);
        pushHistory({
          game: "dice",
          stakeUnits: s.result!.totalStakedUnits,
          pnlUnits: s.result!.pnlUnits,
          multiplier: Number(s.result!.totalPayoutUnits) / Math.max(1, Number(s.result!.totalStakedUnits)),
          session: s as unknown as Session<unknown, unknown>,
        });
        void persistSettledSession(s as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
        await refreshBalance();
        return s;
      } catch (err) {
        setError((err as Error).message);
        setAnimating(false);
        return null;
      }
    },
    [balance.available, betAmount, chainId, direction, driver, getSeedPair, limboTarget, live.reachable, mode, pushHistory, refreshBalance, targetBps, token, userId],
  );

  /* ----- Auto-bet ----- */

  const [auto, setAuto] = useState<AutoConfig>(DEFAULT_AUTO);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<AutoState | null>(null);
  const cancelAutoRef = useRef(false);

  const runAuto = useCallback(async () => {
    if (autoRunning) return;
    setError(null);
    cancelAutoRef.current = false;
    setAutoRunning(true);
    const startBal = (await ledger.getBalance(userId, chainId, token)).available;
    const progress: AutoState = {
      remaining: auto.rounds,
      totalWagered: 0n,
      totalWon: 0n,
      wins: 0,
      losses: 0,
      startBalance: startBal,
    };
    setAutoProgress(progress);

    let stake = humanToUnits(betAmount, token);
    const stopProfit = humanToUnits(auto.stopOnProfit, token);
    const stopLoss = humanToUnits(auto.stopOnLoss, token);

    for (let i = 0; i < auto.rounds; i++) {
      if (cancelAutoRef.current) break;
      const bal = (await ledger.getBalance(userId, chainId, token)).available;
      const pnl = bal - startBal;
      if (auto.stopOnProfit > 0 && pnl >= stopProfit) break;
      if (auto.stopOnLoss > 0 && -pnl >= stopLoss) break;
      if (stake > bal || stake <= 0n) break;

      const s = await rollOnce({ stake });
      if (!s) break;
      const won = s.result!.pnlUnits > 0n;
      progress.remaining -= 1;
      progress.totalWagered += stake;
      progress.totalWon += s.result!.totalPayoutUnits;
      progress.wins += won ? 1 : 0;
      progress.losses += won ? 0 : 1;
      setAutoProgress({ ...progress });

      stake = won
        ? humanToUnits(betAmount, token)
        : BigInt(Math.floor(Number(stake) * auto.onLossMultiplier));

      await new Promise((r) => setTimeout(r, 60));
    }
    setAutoRunning(false);
  }, [auto, autoRunning, betAmount, chainId, ledger, rollOnce, token, userId]);

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
      if (k === " " || k === "enter") {
        if (!animating && !autoRunning) {
          e.preventDefault();
          void rollOnce();
        }
      } else if (k === "u" && mode === "classic") {
        setDirection("under");
      } else if (k === "o" && mode === "classic") {
        setDirection("over");
      } else if (k === "m") {
        setMode((m) => (m === "classic" ? "limbo" : "classic"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [animating, autoRunning, mode, rollOnce, verifyTarget]);

  /* ----- Deposit play money ----- */

  const onDepositPlay = useCallback(async () => {
    await depositPlayMoney(humanToUnits(10_000, token));
  }, [depositPlayMoney, token]);

  const seedPair = getSeedPair();
  const revealSeed = lastRevealedSeed;
  const onRotateSeed = useCallback(() => {
    rotateSeed();
  }, [rotateSeed]);

  /* ----- Visual roll position ----- */

  const displayedRollBps = animating
    ? animRoll
    : lastSession?.state.rollBps ?? null;
  const won = lastSession ? lastSession.state.won : null;

  return (
    <LegacyThreeColLayout>
      {/* Left column: dice table */}
      <section className={card + " p-6 lg:col-span-2 min-h-[560px] flex flex-col"}>
        <TableBalanceHeader
          chainId={chainId}
          token={token}
          balance={balance}
          onDeposit={onDepositPlay}
        />

        {/* Mode toggle */}
        <div className="flex items-center gap-2 mb-5">
          <ModePill label="Classic" active={mode === "classic"} onClick={() => setMode("classic")} />
          <ModePill label="Limbo" active={mode === "limbo"} onClick={() => setMode("limbo")} />
          <span className="text-[10px] text-white/40 ml-1 uppercase tracking-[0.12em]">M = toggle</span>
        </div>

        {/* Number line */}
        <NumberLine
          mode={mode}
          targetBps={live.targetBps}
          direction={live.direction}
          rollBps={displayedRollBps}
          rolling={animating}
          won={won}
        />

        {/* Big result */}
        <div className="mt-3 text-center h-10 flex items-center justify-center">
          {displayedRollBps !== null && (
            <div
              className={
                "px-4 py-1 rounded-full text-2xl font-bold font-mono " +
                (animating
                  ? "text-white/80"
                  : won
                    ? "text-emerald-300"
                    : "text-rose-300")
              }
            >
              {(displayedRollBps / 100).toFixed(2)}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 space-y-3">
            {mode === "classic" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <DirectionPill label="Roll Under" hotkey="U" active={direction === "under"} onClick={() => setDirection("under")} disabled={animating || autoRunning} />
                  <DirectionPill label="Roll Over" hotkey="O" active={direction === "over"} onClick={() => setDirection("over")} disabled={animating || autoRunning} />
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-white/60 mb-1.5">
                    <span>Target: <span className="text-white font-mono">{(targetBps / 100).toFixed(2)}</span></span>
                    <span>Win chance: <span className="text-emerald-300 font-mono">{live.winChance.toFixed(2)}%</span></span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={9998}
                    step={1}
                    value={targetBps}
                    onChange={(e) => setTargetBps(Number(e.target.value))}
                    disabled={animating || autoRunning}
                    className="w-full accent-emerald-400"
                  />
                  <div className="flex items-center justify-between text-[10px] text-white/30 mt-1">
                    <span>0.02</span>
                    <span>99.98</span>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className={labelCls}>Target multiplier (Limbo)</label>
                <input
                  type="number"
                  step={0.01}
                  min={1.01}
                  max={9900}
                  value={limboTarget}
                  onChange={(e) => setLimboTarget(Number(e.target.value))}
                  disabled={animating || autoRunning}
                  className={inputCls + " font-mono"}
                />
                <div className="mt-2 text-[11px] text-white/60 flex items-center justify-between">
                  <span>Win chance: <span className="text-emerald-300 font-mono">{live.winChance.toFixed(2)}%</span></span>
                  <span>Roll must be &gt; {(live.targetBps / 100).toFixed(2)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1 flex-wrap">
                  {[1.5, 2, 5, 10, 50, 100, 1000].map((m) => (
                    <button key={m} type="button" disabled={autoRunning} onClick={() => setLimboTarget(m)}
                      className="text-[11px] px-2 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {m}×
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className={labelCls}>Stake</label>
              <input
                type="number"
                min={1}
                step={1}
                disabled={autoRunning}
                className={inputCls + " font-mono"}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
              />
              <div className="mt-2 flex items-center gap-1 flex-wrap">
                {[1, 10, 100, 1000].map((q) => (
                  <button key={q} type="button" disabled={autoRunning} onClick={() => setBetAmount(q)}
                    className="text-[11px] px-2 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-400/20 text-center">
              <div className="text-[10px] text-emerald-300/70 uppercase tracking-[0.12em]">Payout</div>
              <div className="text-2xl font-bold font-mono text-emerald-300">
                {live.multiplier.toFixed(4)}×
              </div>
              <div className="text-[11px] text-white/50 mt-1">
                {fmtMoney(BigInt(Math.floor(betAmount * live.multiplier * 10 ** token.decimals)), token)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            disabled={animating || autoRunning || !live.reachable}
            onClick={() => void rollOnce()}
            className={btnPrimary + " w-full"}
          >
            {animating ? "Rolling…" : "Roll · Enter"}
          </button>
          {!live.reachable && (
            <p className="mt-2 text-[11px] text-amber-300">
              That multiplier is out of range. Try something between 1.01× and 9900×.
            </p>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* Provable fairness footer */}
        <div className="mt-auto pt-5 border-t border-white/[0.06] flex items-center justify-between gap-3 flex-wrap text-[11px]">
          <div className="text-white/40 min-w-0">
            <span className="uppercase tracking-[0.12em]">seed hash:</span>{" "}
            <span className="font-mono text-white/60 break-all">
              {seedPair.serverSeedHash.slice(0, 18)}…{seedPair.serverSeedHash.slice(-6)}
            </span>
          </div>
          <div className="text-white/40">
            <span className="uppercase tracking-[0.12em]">nonce:</span>{" "}
            <span className="font-mono text-white/80">{seedPair.nonce}</span>
          </div>
          <button
            type="button"
            onClick={onRotateSeed}
            className="text-[11px] px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
          >
            Rotate seed →
          </button>
        </div>
      </section>

      {/* Right column */}
      <aside className="space-y-4">
        <SidePanel
          title="Auto-bet"
          right={
            autoRunning ? (
              <button type="button" onClick={() => { cancelAutoRef.current = true; }}
                className="text-[10px] uppercase tracking-[0.12em] text-rose-300 hover:text-rose-200 cursor-pointer"
              >stop</button>
            ) : (
              <button type="button" onClick={() => setAutoOpen((v) => !v)}
                className={"text-[10px] uppercase tracking-[0.12em] cursor-pointer " + (autoOpen ? "text-emerald-300" : "text-white/40 hover:text-white/70")}
              >{autoOpen ? "configured" : "configure"}</button>
            )
          }
        >
          {autoOpen || autoRunning ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Rounds" value={auto.rounds} min={1} max={10000}
                  onChange={(v) => setAuto({ ...auto, rounds: v })} disabled={autoRunning} />
                <NumberField label="On-loss ×" value={auto.onLossMultiplier} step={0.5} min={1} max={10}
                  onChange={(v) => setAuto({ ...auto, onLossMultiplier: v })} disabled={autoRunning} />
                <NumberField label="Stop profit" value={auto.stopOnProfit} min={0}
                  onChange={(v) => setAuto({ ...auto, stopOnProfit: v })} disabled={autoRunning} />
                <NumberField label="Stop loss" value={auto.stopOnLoss} min={0}
                  onChange={(v) => setAuto({ ...auto, stopOnLoss: v })} disabled={autoRunning} />
              </div>
              <button type="button" disabled={autoRunning || animating || !live.reachable} onClick={runAuto}
                className={btnPrimary + " w-full"}>
                {autoRunning ? "Running…" : `Run ${auto.rounds} auto-rolls`}
              </button>
              {autoProgress && (
                <div className="text-[11px] text-white/60 space-y-0.5 pt-1 border-t border-white/[0.06]">
                  <div>Played {auto.rounds - autoProgress.remaining}/{auto.rounds}</div>
                  <div>Wins {autoProgress.wins} · Losses {autoProgress.losses}</div>
                  <div>Wagered {fmtMoney(autoProgress.totalWagered, token)}</div>
                  <div className={Number(autoProgress.totalWon - autoProgress.totalWagered) > 0 ? "text-emerald-300" : "text-rose-300"}>
                    PnL {fmtMoney(autoProgress.totalWon - autoProgress.totalWagered, token)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12px] text-white/40">
              Configure flat-bet, martingale, or any custom loss-multiplier with stop-loss / stop-profit guards.
            </div>
          )}
        </SidePanel>

        <SidePanel title="Hot keys" subtitle="roll faster">
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-[11px]">
            <KeyHint k="Enter" label="Roll" />
            <KeyHint k="U / O" label="Under / Over" />
            <KeyHint k="M" label="Classic ↔ Limbo" />
            <KeyHint k="Esc" label="Close modal" />
          </div>
        </SidePanel>

        <SidePanel title="Recent rolls" subtitle={`${history.length}`}>
          {history.length === 0 && (
            <div className="text-[12px] text-white/40">No rolls yet.</div>
          )}
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
            {history.map((h) => {
              const r = h.state;
              return (
                <div key={h.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={
                      "w-12 h-7 rounded-md flex items-center justify-center text-[11px] font-mono font-bold " +
                      (r.won ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")
                    }>
                      {(r.rollBps / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-white/40 truncate">
                      {r.direction} {(r.targetBps / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={"text-[11px] font-mono " + (r.won ? "text-emerald-300" : "text-rose-300")}>
                      {r.won ? "+" : ""}{fmtMoney(h.result!.pnlUnits, token)}
                    </div>
                    <button type="button" onClick={() => setVerifyTarget(h)}
                      className="text-[10px] text-white/40 hover:text-emerald-300 cursor-pointer"
                    >verify →</button>
                  </div>
                </div>
              );
            })}
          </div>
        </SidePanel>

        {revealSeed && (
          <SidePanel title="Revealed server seed" subtitle="verify it">
            <div className="text-[11px] text-white/50">Server seed:</div>
            <div className="font-mono text-[11px] text-white/80 break-all">{revealSeed.serverSeed}</div>
            <button type="button" onClick={dismissRevealedSeed} className="mt-3 text-[11px] text-white/40 hover:text-white cursor-pointer">
              Dismiss →
            </button>
          </SidePanel>
        )}
      </aside>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Verify roll"
          description={
            <>
              Paste the revealed <span className="text-emerald-300">server seed</span>. We re-derive this roll
              with <span className="font-mono">HMAC-SHA256(seed, clientSeed:nonce)</span> and rejection-sample a
              uniform integer in [0, 10000).
            </>
          }
          session={verifyTarget}
          revealedServerSeed={pickRevealedServerSeed(seedPair, revealSeed, verifyTarget)}
          token={token}
          onClose={() => setVerifyTarget(null)}
          resultLabel="Replayed roll matches recorded outcome"
          extraFields={
            <div className="grid grid-cols-2 gap-3">
              <VerifyField label="Roll" value={(verifyTarget.state.rollBps / 100).toFixed(2)} mono />
              <VerifyField
                label="Target"
                value={`${(verifyTarget.state.targetBps / 100).toFixed(2)} (${verifyTarget.state.direction})`}
              />
              <VerifyField label="Win count / 10000" value={String(verifyTarget.state.winCount)} mono />
              <VerifyField
                label="Multiplier"
                value={`${(Number(verifyTarget.state.multiplierNum) / Number(verifyTarget.state.multiplierDen)).toFixed(4)}×`}
                mono
              />
            </div>
          }
          runVerify={(serverSeed) =>
            runSessionVerify(diceGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: diceGame.id,
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: {
                ...verifyTarget.state.config,
                targetBps: verifyTarget.state.targetBps,
                direction: verifyTarget.state.direction,
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

function ModePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={
        "h-7 px-3 rounded-md text-[12px] font-semibold border transition-all cursor-pointer " +
        (active
          ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
          : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06]")
      }
    >{label}</button>
  );
}

function DirectionPill({ label, hotkey, active, onClick, disabled }: { label: string; hotkey: string; active: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={
        "h-10 rounded-lg border font-semibold text-sm transition-all flex items-center justify-center gap-2 " +
        (active
          ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
          : "bg-white/[0.03] border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.06]") +
        (disabled ? " opacity-50 cursor-not-allowed" : " cursor-pointer")
      }
    >
      <span>{label}</span>
      <kbd className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-white/[0.12] text-white/50">{hotkey}</kbd>
    </button>
  );
}

function NumberLine({
  mode,
  targetBps,
  direction,
  rollBps,
  rolling,
  won,
}: {
  mode: DiceMode;
  targetBps: number;
  direction: DiceDirection;
  rollBps: number | null;
  rolling: boolean;
  won: boolean | null;
}) {
  const targetPct = (targetBps / 9999) * 100;
  const rollPct = rollBps !== null ? (rollBps / 9999) * 100 : null;

  // Winning zone shading.
  const winZoneLeft = direction === "under" ? 0 : targetPct;
  const winZoneWidth = direction === "under" ? targetPct : 100 - targetPct;

  return (
    <div className="relative h-20 rounded-xl bg-gradient-to-r from-rose-500/[0.08] via-white/[0.02] to-emerald-500/[0.08] border border-white/[0.06] overflow-hidden">
      {/* Winning zone */}
      <div
        className="absolute inset-y-0 bg-emerald-500/15 border-x border-emerald-400/30 transition-all duration-200"
        style={{ left: `${winZoneLeft}%`, width: `${winZoneWidth}%` }}
      />
      {/* Target line */}
      <div
        className="absolute inset-y-2 w-px bg-emerald-300/80 transition-all duration-200"
        style={{ left: `${targetPct}%` }}
      >
        <div className="absolute top-0 -translate-x-1/2 px-1 py-0.5 rounded bg-emerald-500/30 text-[9px] font-mono text-emerald-100 whitespace-nowrap">
          {(targetBps / 100).toFixed(2)}
        </div>
      </div>
      {/* Roll marker */}
      {rollPct !== null && (
        <div
          className={
            "absolute inset-y-0 flex items-center transition-all duration-100 " +
            (rolling ? "" : won ? "drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]")
          }
          style={{ left: `${rollPct}%`, transform: "translateX(-50%)" }}
        >
          <div className={
            "w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] border-2 " +
            (rolling
              ? "bg-white/80 border-white/40 text-stone-900"
              : won
                ? "bg-emerald-400 border-emerald-200 text-emerald-950"
                : "bg-rose-400 border-rose-200 text-rose-950")
          }>
            ▼
          </div>
        </div>
      )}
      {/* Ticks */}
      <div className="absolute inset-x-0 bottom-0 h-3 flex items-end justify-between px-1 text-[9px] text-white/30 font-mono">
        {[0, 25, 50, 75, 100].map((p) => (
          <span key={p} style={{ marginLeft: p === 0 ? 0 : undefined, marginRight: p === 100 ? 0 : undefined }}>
            {p}
          </span>
        ))}
      </div>
      {/* Mode indicator */}
      <div className="absolute top-1 right-2 text-[9px] uppercase tracking-[0.12em] text-white/40">
        {mode === "limbo" ? "limbo (roll over)" : `roll ${direction}`}
      </div>
    </div>
  );
}

function SidePanel({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={card + " p-5"}>
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-sm font-semibold truncate">{title}</h3>
          {subtitle && <span className="text-[10px] uppercase tracking-[0.12em] text-white/40 shrink-0">{subtitle}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function KeyHint({ k, label }: { k: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/[0.12] text-white/60 bg-white/[0.04]">{k}</kbd>
      <span className="text-white/60">{label}</span>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step, disabled }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input type="number" min={min} max={max} step={step} disabled={disabled}
        className={inputCls + " disabled:opacity-50"}
        value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

