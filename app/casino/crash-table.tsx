"use client";

/* ===========================================================================
 *  /casino — Crash table
 *  ---------------------------------------------------------------------------
 *  Single-player live curve. Click "Place bet" to commit a stake + an
 *  auto-cashout multiplier; watch the curve climb in real-time. Cash out
 *  manually before the bust (or let auto-cashout fire).
 *
 *  Wiring contract:
 *    • `crashGame.initialState(bet, rng)` pre-computes `bustAt` from the
 *      session's RNG stream. We hold that value in state and use it ONLY
 *      to detect the bust during animation — it isn't shown to the player
 *      until the round resolves. (In a real multiplayer setup the bust
 *      point would never leave the server, but for offline single-player
 *      it has to live in memory.)
 *    • A `requestAnimationFrame` loop drives the multiplier upward using
 *      `curveMultiplierAt(elapsedMs)`. On every frame we check:
 *        - multiplier >= bustAt → fire `{type:"bust"}` and settle.
 *        - multiplier >= autoCashout → fire `{type:"cashout", multiplier: autoCashout}` and settle.
 *        - user clicked Cash Out → fire `{type:"cashout", multiplier: currentMult}` and settle.
 *
 *  Multiplayer (live shared rounds across players) is a separate phase —
 *  a Realtime channel + a server-side coordinator that broadcasts ticks.
 *  This table is the foundation it'll wrap.
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bustFromDraw,
  crashGame,
  curveMultiplierAt,
  DEFAULT_CRASH_CONFIG,
  expectedRtpAtCashout,
  HmacRngStream,
  hashServerSeed,
  newSessionId,
  persistSettledSession,
  probabilityBustAbove,
  timeToReachMultiplier,
  verifySession,
  type ChainAdapter,
  type ChainId,
  type CrashAction,
  type CrashState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { ShareLinkRow } from "./share-link";

/* ---------------------------------------------------------------------------
 *  Style vocab
 * ------------------------------------------------------------------------- */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls = "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls =
  "w-full h-10 px-3 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
const btnPrimary =
  "h-11 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnDanger =
  "h-11 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-rose-500 to-orange-500 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnGhost =
  "h-10 px-4 rounded-lg font-medium text-sm bg-white/[0.06] border border-white/[0.08] text-white/80 hover:bg-white/[0.10] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

/* ---------------------------------------------------------------------------
 *  Money helpers
 * ------------------------------------------------------------------------- */

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  const whole = units / denom;
  const frac = units % denom;
  return Number(`${whole}.${frac.toString().padStart(token.decimals, "0")}`);
}
function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  const whole = BigInt(Math.floor(amount));
  const frac = BigInt(Math.round((amount - Math.floor(amount)) * Number(denom)));
  return whole * denom + frac;
}
function fmtMoney(units: bigint, token: TokenSpec, digits = 2): string {
  return `${unitsToHuman(units, token).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${token.symbol}`;
}

/* ---------------------------------------------------------------------------
 *  Local-storage keys
 * ------------------------------------------------------------------------- */

const LS_BET = "mf_casino_crash_bet";
const LS_AUTO_CASHOUT = "mf_casino_crash_auto";

/* ===========================================================================
 *  Table component
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

interface RoundLog {
  session: Session<CrashAction, CrashState>;
  bustAt: number;
  exitMultiplier: number | null;
  won: boolean;
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

export default function CrashTable({ chainId, token }: Props) {
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
    persistent,
  } = useCasino();
  const userId = getSeedPair().userId;

  /* ----- Persisted controls ----- */

  const [betAmount, setBetAmount] = useState(() => {
    if (typeof window === "undefined") return 10;
    const v = Number(window.localStorage.getItem(LS_BET));
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_BET, String(betAmount));
  }, [betAmount]);

  const [autoCashout, setAutoCashout] = useState(() => {
    if (typeof window === "undefined") return 2.0;
    const v = Number(window.localStorage.getItem(LS_AUTO_CASHOUT));
    return Number.isFinite(v) && v > 1.0 ? v : 2.0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_AUTO_CASHOUT, String(autoCashout));
  }, [autoCashout]);

  /* ----- Active round state ----- */

  type RoundPhase = "idle" | "running" | "settling" | "settled";
  const [phase, setPhase] = useState<RoundPhase>("idle");
  const [activeSession, setActiveSession] = useState<Session<CrashAction, CrashState> | null>(null);
  const activeRef = useRef<Session<CrashAction, CrashState> | null>(null);
  const phaseRef = useRef<RoundPhase>("idle");
  const startTsRef = useRef<number>(0);
  const [currentMult, setCurrentMult] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    won: boolean;
    bustAt: number;
    exit: number;
    pnlUnits: bigint;
  } | null>(null);

  /* ----- History + verify ----- */

  const [history, setHistory] = useState<RoundLog[]>([]);
  const [verifyTarget, setVerifyTarget] = useState<Session<CrashAction, CrashState> | null>(null);

  /* ----- Settlement helper ------------------------------------------------ */

  /**
   * `applyAction` + `settleSession` + bookkeeping. Called from either the
   * tick loop (auto-cashout / bust) or the manual cashout button. Idempotent
   * wrt phase — second invocations are a no-op.
   */
  const finishRound = useCallback(
    async (
      session: Session<CrashAction, CrashState>,
      action: CrashAction,
    ): Promise<Session<CrashAction, CrashState> | null> => {
      if (phaseRef.current === "settling" || phaseRef.current === "settled") return null;
      phaseRef.current = "settling";
      setPhase("settling");
      try {
        const stepped = await driver.applyAction(crashGame, session, action);
        const settled = await driver.settleSession(crashGame, stepped);
        const fs = settled.state as CrashState;
        const won = fs.phase === "cashed_out";
        const exit = fs.exitMultiplier ?? fs.bustAt;
        setLastResult({
          won,
          bustAt: fs.bustAt,
          exit,
          pnlUnits: settled.result!.pnlUnits,
        });
        setHistory((h) => [
          { session: settled, bustAt: fs.bustAt, exitMultiplier: exit, won },
          ...h,
        ].slice(0, 30));
        pushHistory({
          game: "crash",
          stakeUnits: settled.result!.totalStakedUnits,
          pnlUnits: settled.result!.pnlUnits,
          multiplier:
            Number(settled.result!.totalPayoutUnits) /
            Math.max(1, Number(settled.result!.totalStakedUnits)),
          session: settled as unknown as Session<unknown, unknown>,
        });
        void persistSettledSession(
          settled as unknown as Parameters<typeof persistSettledSession>[0],
          getSeedPair(),
        );
        await refreshBalance();
        activeRef.current = null;
        setActiveSession(null);
        phaseRef.current = "settled";
        setPhase("settled");
        return settled;
      } catch (e) {
        setError((e as Error).message);
        phaseRef.current = "idle";
        setPhase("idle");
        activeRef.current = null;
        setActiveSession(null);
        return null;
      }
    },
    [driver, getSeedPair, pushHistory, refreshBalance],
  );

  /* ----- Place bet + start round ----------------------------------------- */

  const placeBet = useCallback(async (): Promise<Session<CrashAction, CrashState> | null> => {
    setError(null);
    setLastResult(null);
    try {
      const stake = humanToUnits(betAmount, token);
      if (stake <= 0n) throw new Error("Bet must be > 0");
      if (balance.available < stake) throw new Error("Insufficient balance");
      if (autoCashout <= 1.0) throw new Error("Auto-cashout must be > 1.0×");

      const session = await driver.openSession(crashGame, {
        sessionId: newSessionId(),
        userId,
        gameId: crashGame.id,
        chainId,
        token,
        stake,
        config: { autoCashoutMultiplier: autoCashout },
      });
      activeRef.current = session;
      setActiveSession(session);
      startTsRef.current = performance.now();
      setCurrentMult(1.0);
      phaseRef.current = "running";
      setPhase("running");
      return session;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [autoCashout, balance.available, betAmount, chainId, driver, token, userId]);

  /* ----- Manual cashout -------------------------------------------------- */

  const manualCashout = useCallback(async () => {
    const session = activeRef.current;
    if (!session || phaseRef.current !== "running") return;
    const m = Math.max(1.01, currentMult);
    await finishRound(session, { type: "cashout", multiplier: m });
  }, [currentMult, finishRound]);

  /* ----- Tick loop (animation + state machine resolution) ---------------- */

  useEffect(() => {
    if (phase !== "running") return;
    let raf = 0;
    const tick = () => {
      if (phaseRef.current !== "running") return;
      const elapsed = performance.now() - startTsRef.current;
      const m = curveMultiplierAt(elapsed, DEFAULT_CRASH_CONFIG.curveK);
      setCurrentMult(m);

      const session = activeRef.current;
      if (!session) return;
      const bust = (session.state as CrashState).bustAt;
      const autoCap = (session.state as CrashState).autoCashoutMultiplier;

      if (m >= bust) {
        // Curve reached the bust point — settle as bust.
        void finishRound(session, { type: "bust" });
        return;
      }
      if (autoCap !== null && m >= autoCap) {
        // Auto-cashout fired.
        void finishRound(session, { type: "cashout", multiplier: autoCap });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [phase, finishRound]);

  /* ----- Auto-bet --------------------------------------------------------- */

  const [auto, setAuto] = useState<AutoConfig>(DEFAULT_AUTO);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{
    remaining: number;
    wins: number;
    losses: number;
    pnlUnits: bigint;
  } | null>(null);
  const cancelAutoRef = useRef(false);
  const [autoStake, setAutoStake] = useState(0); // visible "current stake" for martingale

  const runAuto = useCallback(async () => {
    if (autoRunning) return;
    setError(null);
    cancelAutoRef.current = false;
    setAutoRunning(true);
    const startBal = (await ledger.getBalance(userId, chainId, token)).available;
    const stopProfit = humanToUnits(auto.stopOnProfit, token);
    const stopLoss = humanToUnits(auto.stopOnLoss, token);
    let stake = humanToUnits(betAmount, token);
    const progress = { remaining: auto.rounds, wins: 0, losses: 0, pnlUnits: 0n };
    setAutoProgress(progress);

    for (let i = 0; i < auto.rounds; i++) {
      if (cancelAutoRef.current) break;
      const bal = (await ledger.getBalance(userId, chainId, token)).available;
      const pnl = bal - startBal;
      if (auto.stopOnProfit > 0 && pnl >= stopProfit) break;
      if (auto.stopOnLoss > 0 && -pnl >= stopLoss) break;
      if (stake > bal || stake <= 0n) break;

      setAutoStake(Number(stake));

      // Open + animate one round.
      try {
        const session = await driver.openSession(crashGame, {
          sessionId: newSessionId(),
          userId,
          gameId: crashGame.id,
          chainId,
          token,
          stake,
          config: { autoCashoutMultiplier: autoCashout },
        });
        activeRef.current = session;
        setActiveSession(session);
        startTsRef.current = performance.now();
        setCurrentMult(1.0);
        phaseRef.current = "running";
        setPhase("running");

        // Wait for the round to settle.
        const bustAt = (session.state as CrashState).bustAt;
        const settleAt = Math.min(bustAt, autoCashout);
        const ms = Math.max(150, timeToReachMultiplier(settleAt, DEFAULT_CRASH_CONFIG.curveK));
        await new Promise((r) => setTimeout(r, ms + 250));
      } catch (e) {
        setError((e as Error).message);
        break;
      }

      progress.remaining = auto.rounds - i - 1;
      const lastWon = (history[0]?.session.state as CrashState | undefined)?.phase === "cashed_out";
      const lastSession = history[0]?.session;
      const lastPnl = lastSession?.result?.pnlUnits ?? 0n;
      progress.wins += lastWon ? 1 : 0;
      progress.losses += lastWon ? 0 : 1;
      progress.pnlUnits += lastPnl;
      setAutoProgress({ ...progress });

      stake = lastWon
        ? humanToUnits(betAmount, token)
        : BigInt(Math.floor(Number(stake) * auto.onLossMultiplier));

      await new Promise((r) => setTimeout(r, 200));
    }
    setAutoRunning(false);
  }, [
    auto,
    autoCashout,
    autoRunning,
    betAmount,
    chainId,
    driver,
    history,
    ledger,
    token,
    userId,
  ]);

  /* ----- Hot keys -------------------------------------------------------- */

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
        e.preventDefault();
        if (phase === "running") {
          void manualCashout();
        } else if (phase !== "settling" && !autoRunning) {
          void placeBet();
        }
      } else if (k === "escape" && autoRunning) {
        cancelAutoRef.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualCashout, placeBet, phase, autoRunning, verifyTarget]);

  /* ----- Derived display values ------------------------------------------ */

  const seedPair = getSeedPair();
  const hashShort = seedPair.serverSeedHash.slice(0, 14) + "…";
  const probAtAuto = probabilityBustAbove(autoCashout);
  const rtpAtAuto = expectedRtpAtCashout(autoCashout);
  const liveMultDisplay = phase === "running" ? currentMult : (lastResult?.exit ?? 1.0);
  const liveColor =
    phase === "running"
      ? "text-emerald-300"
      : lastResult?.won
        ? "text-emerald-300"
        : "text-rose-300";

  const stakeUnits = humanToUnits(betAmount, token);
  const projectedPayout = stakeUnits > 0n ? (stakeUnits * BigInt(Math.floor(autoCashout * 1_000_000))) / 1_000_000n : 0n;

  /* ===========================================================================
   *  Render
   * =========================================================================== */

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
      {/* ───── Main column ───── */}
      <div className="space-y-5">
        {/* Curve canvas */}
        <CurveCanvas
          phase={phase}
          currentMult={currentMult}
          bustAt={(activeSession?.state as CrashState | undefined)?.bustAt ?? null}
          autoCashout={autoCashout}
          lastResult={lastResult}
        />

        {/* Bet panel */}
        <section className={card + " p-5"}>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className={labelCls}>Stake ({token.symbol})</label>
              <input
                type="number"
                className={inputCls}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                min={0}
                step={0.1}
                disabled={phase === "running" || phase === "settling" || autoRunning}
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className={labelCls}>Auto cash out (×)</label>
              <input
                type="number"
                className={inputCls}
                value={autoCashout}
                onChange={(e) => setAutoCashout(Number(e.target.value))}
                min={1.01}
                step={0.01}
                disabled={phase === "running" || phase === "settling" || autoRunning}
              />
            </div>

            <div className="flex gap-2 items-end">
              {phase !== "running" && (
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void placeBet()}
                  disabled={phase === "settling" || autoRunning || stakeUnits <= 0n || stakeUnits > balance.available}
                >
                  Place bet · {fmtMoney(stakeUnits, token)}
                </button>
              )}
              {phase === "running" && (
                <button
                  type="button"
                  className={btnDanger}
                  onClick={() => void manualCashout()}
                >
                  Cash out {currentMult.toFixed(2)}×
                </button>
              )}
              <button
                type="button"
                className={btnGhost}
                onClick={() => setAutoOpen((o) => !o)}
                disabled={phase === "running" || phase === "settling"}
              >
                {autoOpen ? "Hide auto" : "Auto bet"}
              </button>
            </div>
          </div>

          {/* Live stats row */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            <Stat label="Available" value={fmtMoney(balance.available, token)} />
            <Stat
              label="If autocashed"
              value={fmtMoney(projectedPayout, token)}
              sub={`+${fmtMoney(projectedPayout - stakeUnits, token)} pnl`}
              accent="emerald"
            />
            <Stat
              label="P(bust > auto)"
              value={`${(probAtAuto * 100).toFixed(1)}%`}
              sub={`RTP ${(rtpAtAuto * 100).toFixed(2)}%`}
            />
            <Stat label="House edge" value="≈1%" sub={`floor formula`} />
          </div>

          {error && (
            <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-200">
              {error}
            </div>
          )}

          {/* Auto-bet drawer */}
          {autoOpen && (
            <AutoPanel
              cfg={auto}
              setCfg={setAuto}
              running={autoRunning}
              progress={autoProgress}
              currentStake={autoStake}
              run={() => void runAuto()}
              cancel={() => {
                cancelAutoRef.current = true;
              }}
              token={token}
              autoCashout={autoCashout}
            />
          )}
        </section>

        {/* Bankroll quick-credit (dev mode only) */}
        {!persistent && (
          <section className={card + " p-4 flex items-center justify-between gap-3 flex-wrap"}>
            <div className="text-[12px] text-white/60">
              Play-money mode. Need chips? Quick-credit your bankroll:
            </div>
            <div className="flex gap-2">
              {[100, 1000, 10_000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={btnGhost}
                  onClick={async () => {
                    await depositPlayMoney(BigInt(amt) * 10n ** BigInt(token.decimals));
                  }}
                >
                  + {amt.toLocaleString()} {token.symbol}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ───── Side column ───── */}
      <div className="space-y-5">
        {/* Recent rounds */}
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-white">Recent rounds</h3>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">{history.length}/30</span>
          </div>
          {history.length === 0 ? (
            <div className="text-[12px] text-white/40 text-center py-6">
              No rounds yet — place a bet to get started.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {history.map((h, i) => (
                <RecentRoundRow
                  key={h.session.id + i}
                  row={h}
                  token={token}
                  onVerify={() => setVerifyTarget(h.session)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Provable fairness card */}
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-semibold text-white">Provable fairness</h3>
            <button
              type="button"
              className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer"
              onClick={() => {
                rotateSeed();
              }}
            >
              Rotate seed →
            </button>
          </div>
          <div className="text-[11px] text-white/60 space-y-1.5 leading-relaxed">
            <div>
              <span className="text-white/40">Server seed hash:</span>{" "}
              <span className="font-mono text-white/80">{hashShort}</span>
            </div>
            <div>
              <span className="text-white/40">Client seed:</span>{" "}
              <span className="font-mono text-white/80">{seedPair.clientSeed.slice(0, 14)}…</span>
            </div>
            <div>
              <span className="text-white/40">Next nonce:</span>{" "}
              <span className="font-mono text-white/80">{seedPair.nonce + 1}</span>
            </div>
            <div className="mt-2 pt-2 border-t border-white/[0.06]">
              Each round&apos;s bust point is derived from
              {" "}<code className="text-emerald-300">HMAC-SHA256(server_seed, client_seed:nonce)</code>{" "}
              and the formula{" "}
              <code className="text-emerald-300">floor((100·E − h)/(E − h))/100</code>.
              Rotate to reveal the current server seed and verify past rounds.
            </div>
          </div>
        </section>

        {lastRevealedSeed && (
          <section className={card + " p-4 border-emerald-400/30 bg-emerald-500/[0.04]"}>
            <div className="flex items-baseline justify-between mb-1.5">
              <h3 className="font-semibold text-emerald-200 text-[13px]">Server seed revealed</h3>
              <button
                type="button"
                className="text-[11px] text-white/40 hover:text-white/70 cursor-pointer"
                onClick={dismissRevealedSeed}
              >
                Dismiss
              </button>
            </div>
            <div className="text-[10px] text-white/60 font-mono break-all">
              {lastRevealedSeed.serverSeed}
            </div>
            <div className="mt-1.5 text-[10px] text-white/40">
              <code>sha256(seed) == {lastRevealedSeed.hash.slice(0, 18)}…</code>
            </div>
          </section>
        )}
      </div>

      {/* Verify modal */}
      {verifyTarget && (
        <CrashVerifyModal
          session={verifyTarget}
          onClose={() => setVerifyTarget(null)}
          revealedSeed={lastRevealedSeed?.serverSeed ?? null}
        />
      )}
    </div>
  );
}

/* ===========================================================================
 *  Curve canvas
 * ========================================================================= */

function CurveCanvas({
  phase,
  currentMult,
  bustAt,
  autoCashout,
  lastResult,
}: {
  phase: "idle" | "running" | "settling" | "settled";
  currentMult: number;
  bustAt: number | null;
  autoCashout: number;
  lastResult: { won: boolean; bustAt: number; exit: number; pnlUnits: bigint } | null;
}) {
  const width = 800;
  const height = 320;
  const padding = 40;

  // Build the polyline path from t=0 to current.
  const samples = 64;
  // Use a stable "horizon" for the X axis so the curve scales gracefully.
  // Map y-axis from 1.0× (bottom) to a dynamic top (max(currentMult * 1.2, autoCashout * 1.2, 3)).
  const yTop = Math.max(currentMult * 1.2, autoCashout * 1.2, 3);
  const xMax = Math.max(0.5, Math.log(yTop) / DEFAULT_CRASH_CONFIG.curveK); // seconds
  const yToPx = (y: number) => height - padding - ((y - 1) / (yTop - 1)) * (height - padding * 2);
  const xToPx = (t: number) => padding + (t / xMax) * (width - padding * 2);

  const tNow = Math.log(currentMult) / DEFAULT_CRASH_CONFIG.curveK;
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const tSec = (i / samples) * tNow;
    const m = curveMultiplierAt(tSec * 1000, DEFAULT_CRASH_CONFIG.curveK);
    points.push(`${xToPx(tSec).toFixed(1)},${yToPx(m).toFixed(1)}`);
  }
  const polyline = points.join(" ");

  const busted = phase === "settled" && lastResult && !lastResult.won;
  const cashed = phase === "settled" && lastResult && lastResult.won;

  return (
    <section className={card + " p-5 relative overflow-hidden"}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-semibold text-white">Live round</h3>
        <span className="text-[11px] text-white/40">
          {phase === "idle" ? "ready to bet" : phase === "running" ? "in flight" : phase === "settling" ? "settling…" : "settled"}
        </span>
      </div>

      <div className="relative" style={{ aspectRatio: `${width}/${height}` }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={busted ? "#f43f5e" : "#10b981"} stopOpacity="0.35" />
              <stop offset="100%" stopColor={busted ? "#f43f5e" : "#10b981"} stopOpacity="0.0" />
            </linearGradient>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            </pattern>
          </defs>
          {/* Grid */}
          <rect width={width} height={height} fill="url(#grid)" />

          {/* Horizontal target line: auto-cashout */}
          {autoCashout > 1 && autoCashout < yTop && (
            <line
              x1={padding}
              x2={width - padding}
              y1={yToPx(autoCashout)}
              y2={yToPx(autoCashout)}
              stroke="rgba(16,185,129,0.45)"
              strokeWidth="1"
              strokeDasharray="6 4"
            />
          )}
          {autoCashout > 1 && autoCashout < yTop && (
            <text
              x={width - padding - 4}
              y={yToPx(autoCashout) - 4}
              fill="rgba(16,185,129,0.7)"
              fontSize="10"
              textAnchor="end"
              fontFamily="monospace"
            >
              auto {autoCashout.toFixed(2)}×
            </text>
          )}

          {/* Bust line (only after the round settled) */}
          {phase === "settled" && bustAt && (
            <line
              x1={padding}
              x2={width - padding}
              y1={yToPx(bustAt)}
              y2={yToPx(bustAt)}
              stroke="rgba(244,63,94,0.55)"
              strokeWidth="1"
              strokeDasharray="6 4"
            />
          )}

          {/* Curve area + stroke */}
          {points.length > 0 && (
            <>
              <polygon
                points={`${padding},${height - padding} ${polyline} ${xToPx(tNow).toFixed(1)},${height - padding}`}
                fill="url(#curveFill)"
              />
              <polyline
                points={polyline}
                fill="none"
                stroke={busted ? "#f43f5e" : "#10b981"}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Leading point dot */}
              {phase === "running" && (
                <circle
                  cx={xToPx(tNow)}
                  cy={yToPx(currentMult)}
                  r="5"
                  fill="#10b981"
                  className="drop-shadow"
                />
              )}
            </>
          )}

          {/* Y-axis multiplier labels */}
          {[1, 2, 5, 10].map((tick) => {
            if (tick > yTop) return null;
            return (
              <g key={tick}>
                <line
                  x1={padding - 4}
                  x2={padding}
                  y1={yToPx(tick)}
                  y2={yToPx(tick)}
                  stroke="rgba(255,255,255,0.2)"
                />
                <text
                  x={padding - 8}
                  y={yToPx(tick) + 3}
                  fill="rgba(255,255,255,0.4)"
                  fontSize="10"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {tick}×
                </text>
              </g>
            );
          })}
        </svg>

        {/* Big multiplier overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div
              className={
                "font-mono font-bold tabular-nums " +
                (phase === "running"
                  ? "text-7xl text-white"
                  : busted
                    ? "text-7xl text-rose-300"
                    : cashed
                      ? "text-7xl text-emerald-300"
                      : "text-6xl text-white/30")
              }
            >
              {phase === "running"
                ? `${currentMult.toFixed(2)}×`
                : phase === "settled" && lastResult
                  ? `${lastResult.exit.toFixed(2)}×`
                  : "1.00×"}
            </div>
            {phase === "settled" && lastResult && (
              <div className={"mt-1 text-[12px] " + (lastResult.won ? "text-emerald-200" : "text-rose-200")}>
                {lastResult.won
                  ? `Cashed out before bust at ${lastResult.bustAt.toFixed(2)}×`
                  : `Busted at ${lastResult.bustAt.toFixed(2)}×`}
              </div>
            )}
            {phase === "idle" && (
              <div className="mt-2 text-[12px] text-white/40">Place a bet to start the next round</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===========================================================================
 *  Small UI primitives
 * ========================================================================= */

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "rose";
}) {
  return (
    <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">{label}</div>
      <div
        className={
          "mt-1 font-mono text-[14px] " +
          (accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white")
        }
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

function RecentRoundRow({
  row,
  token,
  onVerify,
}: {
  row: RoundLog;
  token: TokenSpec;
  onVerify: () => void;
}) {
  const pnl = row.session.result?.pnlUnits ?? 0n;
  const won = row.won;
  return (
    <button
      type="button"
      className="w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-emerald-400/30 hover:bg-emerald-500/[0.04] transition-colors text-left cursor-pointer"
      onClick={onVerify}
    >
      <div className="flex items-center gap-2">
        <span
          className={
            "w-12 h-6 rounded-md text-[10px] font-mono font-semibold flex items-center justify-center " +
            (won
              ? "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30"
              : "bg-rose-500/15 text-rose-200 border border-rose-400/30")
          }
        >
          {row.bustAt.toFixed(2)}×
        </span>
        <span className="text-[10px] text-white/40">
          {won ? `cashed @ ${row.exitMultiplier?.toFixed(2)}×` : "bust"}
        </span>
      </div>
      <div className={"text-[12px] font-mono " + (won ? "text-emerald-300" : "text-rose-300")}>
        {won ? "+" : ""}{fmtMoney(pnl, token)}
      </div>
    </button>
  );
}

function AutoPanel({
  cfg,
  setCfg,
  running,
  progress,
  currentStake,
  run,
  cancel,
  token,
  autoCashout,
}: {
  cfg: AutoConfig;
  setCfg: (c: AutoConfig) => void;
  running: boolean;
  progress: { remaining: number; wins: number; losses: number; pnlUnits: bigint } | null;
  currentStake: number;
  run: () => void;
  cancel: () => void;
  token: TokenSpec;
  autoCashout: number;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Rounds</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.rounds}
            onChange={(e) => setCfg({ ...cfg, rounds: Math.max(1, Number(e.target.value)) })}
            disabled={running}
            min={1}
            max={1000}
          />
        </div>
        <div>
          <label className={labelCls}>On loss ×</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.onLossMultiplier}
            onChange={(e) => setCfg({ ...cfg, onLossMultiplier: Math.max(0.1, Number(e.target.value)) })}
            disabled={running}
            min={0.1}
            step={0.1}
          />
        </div>
        <div>
          <label className={labelCls}>Stop on profit</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.stopOnProfit}
            onChange={(e) => setCfg({ ...cfg, stopOnProfit: Math.max(0, Number(e.target.value)) })}
            disabled={running}
            min={0}
          />
        </div>
        <div>
          <label className={labelCls}>Stop on loss</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.stopOnLoss}
            onChange={(e) => setCfg({ ...cfg, stopOnLoss: Math.max(0, Number(e.target.value)) })}
            disabled={running}
            min={0}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {running ? (
          <button type="button" className={btnDanger} onClick={cancel}>
            Cancel (Esc)
          </button>
        ) : (
          <button type="button" className={btnPrimary} onClick={run}>
            Run {cfg.rounds} rounds @ {autoCashout}×
          </button>
        )}
        {progress && (
          <div className="text-[12px] text-white/60 flex gap-3 font-mono">
            <span>{progress.remaining} left</span>
            <span className="text-emerald-300">{progress.wins}W</span>
            <span className="text-rose-300">{progress.losses}L</span>
            <span className={progress.pnlUnits >= 0n ? "text-emerald-300" : "text-rose-300"}>
              pnl {fmtMoney(progress.pnlUnits, token)}
            </span>
            {running && currentStake > 0 && (
              <span>stake {(currentStake / 10 ** token.decimals).toFixed(2)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Verify modal
 * ========================================================================= */

function CrashVerifyModal({
  session,
  onClose,
  revealedSeed,
}: {
  session: Session<CrashAction, CrashState>;
  onClose: () => void;
  revealedSeed: string | null;
}) {
  const [serverSeed, setServerSeed] = useState(revealedSeed ?? "");
  const [result, setResult] = useState<{ ok: boolean; bustAt: number; hashOk: boolean } | null>(null);

  const replay = useCallback(() => {
    if (!serverSeed) return;
    try {
      const hashOk = hashServerSeed(serverSeed).toLowerCase() === session.serverSeedHash.toLowerCase();
      // Pull the raw 52-bit draw deterministically using the same RNG pipeline.
      // We mirror what crashGame.initialState does without needing the full
      // session shape — the verify endpoint already has its own implementation,
      // but this is the lightweight in-modal version.
      const rng = new HmacRngStream(
        {
          id: "replay",
          userId: session.userId,
          serverSeed,
          serverSeedHash: session.serverSeedHash,
          clientSeed: session.clientSeed,
          nonce: session.startNonce - 1,
          status: "retired",
          createdAt: new Date(0).toISOString(),
          retiredAt: new Date(0).toISOString(),
        },
        session.startNonce,
        serverSeed,
      );
      const hi = BigInt(rng.nextUint32());
      const lo = BigInt(rng.nextUint32()) >> 12n;
      const draw = (hi << 20n) | lo;
      const bustAt = bustFromDraw(draw);
      const matched = Math.abs(bustAt - (session.state as CrashState).bustAt) < 1e-9;
      setResult({ ok: matched, bustAt, hashOk });
    } catch (e) {
      setResult({ ok: false, bustAt: 0, hashOk: false });
      console.error(e);
    }
  }, [serverSeed, session]);

  // Also build a deeper full-replay path that exercises the audit log.
  const fullReplay = useMemo(() => {
    if (!serverSeed) return null;
    try {
      const r = verifySession({
        game: crashGame,
        serverSeed,
        serverSeedHash: session.serverSeedHash,
        clientSeed: session.clientSeed,
        startNonce: session.startNonce,
        bet: {
          sessionId: session.id,
          userId: session.userId,
          gameId: "crash",
          chainId: session.chainId,
          token: session.token,
          stake: session.stake,
          config: { autoCashoutMultiplier: (session.state as CrashState).autoCashoutMultiplier },
        },
        actions: session.actions
          .filter((a) => a.actor === "player")
          .map((a) => ({
            ordinal: a.ordinal,
            action: a.action as CrashAction,
            actor: a.actor as "player",
          })),
        expectedStateHashes: session.actions.map((a) => a.stateHash ?? ""),
      });
      return r;
    } catch {
      return null;
    }
  }, [serverSeed, session]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={card + " w-full max-w-xl p-5 max-h-[88vh] overflow-y-auto"}>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-semibold text-white text-lg">Verify this round</h3>
          <button type="button" onClick={onClose} className={btnGhost + " h-8 px-3 text-[11px]"}>
            Close
          </button>
        </div>
        <div className="space-y-3 text-[12px]">
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="Server seed hash">
              <code className="text-white/80 break-all">{session.serverSeedHash}</code>
            </FieldRow>
            <FieldRow label="Client seed">
              <code className="text-white/80 break-all">{session.clientSeed}</code>
            </FieldRow>
            <FieldRow label="Nonce">
              <code className="text-white/80">{session.startNonce}</code>
            </FieldRow>
            <FieldRow label="Recorded bust">
              <code className="text-white/80">{(session.state as CrashState).bustAt.toFixed(4)}×</code>
            </FieldRow>
          </div>
          <div>
            <label className={labelCls}>
              Server seed (paste a revealed one to verify)
            </label>
            <input
              type="text"
              className={inputCls + " font-mono"}
              value={serverSeed}
              onChange={(e) => setServerSeed(e.target.value)}
              placeholder="hex string"
            />
            <button type="button" className={btnPrimary + " mt-2 w-full"} onClick={replay} disabled={!serverSeed}>
              Replay bust derivation
            </button>
          </div>
          {result && (
            <div
              className={
                "p-3 rounded-lg border " +
                (result.ok && result.hashOk
                  ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-200"
                  : "bg-rose-500/10 border-rose-500/20 text-rose-200")
              }
            >
              <div className="font-semibold mb-1">
                {result.ok && result.hashOk ? "✓ Round verified" : "✗ Mismatch"}
              </div>
              <div className="text-[11px] space-y-0.5">
                <div>sha256(seed) match: {result.hashOk ? "yes" : "no"}</div>
                <div>replayed bustAt: {result.bustAt.toFixed(4)}×</div>
                <div>recorded bustAt: {(session.state as CrashState).bustAt.toFixed(4)}×</div>
              </div>
            </div>
          )}
          {fullReplay && (
            <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px]">
              <div className="text-white/70 font-semibold mb-1">Full audit replay</div>
              <div className="text-white/50">
                hashOk={String(fullReplay.hashOk)} · finalStateMatches={String(fullReplay.finalStateMatches)}
              </div>
              <div className="text-white/40 mt-1 break-all">
                replayed hash: {fullReplay.replayedFinalHash.slice(0, 24)}…
              </div>
            </div>
          )}
          <ShareLinkRow
            session={session as unknown as Session<unknown, unknown>}
            serverSeed={revealedSeed}
          />
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[9px] uppercase tracking-[0.15em] text-white/40">{label}</div>
      <div className="text-[10px] font-mono mt-0.5">{children}</div>
    </div>
  );
}
