"use client";

/* ===========================================================================
 *  /casino — Mines table
 *  ---------------------------------------------------------------------------
 *  5×5 grid hides M mines (player picks M ∈ [1, 24]). Reveal tiles one at a
 *  time — each safe reveal advances the live multiplier, one mine ends the
 *  round at 0×. Cash out at any time for stake × multiplier.
 *
 *  Multiplier:  m_k = 0.99 · C(25, k) / C(25 - M, k)
 *  (flat 1% house edge regardless of strategy — proven in smoke test).
 *
 *  Provable fairness: mine layout is committed at session open from
 *  HMAC-SHA256(server_seed, client_seed:nonce) via Fisher–Yates shuffle.
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MINES_CONFIG,
  GRID_SIZE,
  MAX_MINES,
  MIN_MINES,
  TOTAL_TILES,
  minesGame,
  minesMultiplier,
  minesPayoutTable,
  minesSurvivalProbability,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type MinesAction,
  type MinesState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { ShareLinkRow } from "./share-link";

/* ---------------------------------------------------------------------------
 *  Style vocab (matches plinko / crash)
 * ------------------------------------------------------------------------- */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls = "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls =
  "w-full h-10 px-3 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
const btnPrimary =
  "h-11 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnDanger =
  "h-11 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-rose-500 to-orange-500 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnGold =
  "h-11 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-amber-400 to-amber-600 text-black hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
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

const LS_BET = "mf_casino_mines_bet";
const LS_MINES = "mf_casino_mines_count";

/* ===========================================================================
 *  Table
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

interface AutoConfig {
  rounds: number;
  pickCount: number; // pick exactly N safe tiles then cash out (per round)
  onLossMultiplier: number;
  stopOnProfit: number;
  stopOnLoss: number;
}
const DEFAULT_AUTO: AutoConfig = {
  rounds: 25,
  pickCount: 3,
  onLossMultiplier: 1,
  stopOnProfit: 0,
  stopOnLoss: 0,
};

export default function MinesTable({ chainId, token }: Props) {
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

  /* ----- Persisted controls --------------------------------------------- */

  const [betAmount, setBetAmount] = useState(() => {
    if (typeof window === "undefined") return 10;
    const v = Number(window.localStorage.getItem(LS_BET));
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_BET, String(betAmount));
  }, [betAmount]);

  const [mineCount, setMineCount] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_MINES_CONFIG.mines;
    const v = Number(window.localStorage.getItem(LS_MINES));
    return Number.isInteger(v) && v >= MIN_MINES && v <= MAX_MINES ? v : DEFAULT_MINES_CONFIG.mines;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_MINES, String(mineCount));
  }, [mineCount]);

  /* ----- Live round state ----------------------------------------------- */

  const [session, setSession] = useState<Session<MinesAction, MinesState> | null>(null);
  const [history, setHistory] = useState<Session<MinesAction, MinesState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<Session<MinesAction, MinesState> | null>(null);
  // tile -> "exploding" briefly to play the boom animation
  const [hitFlash, setHitFlash] = useState<number | null>(null);

  /* ----- Live multiplier preview ---------------------------------------- */

  const liveState = session?.state ?? null;
  const liveMultiplier = liveState?.multiplier ?? 1.0;
  const livePicks = liveState?.picks ?? 0;
  const liveMines = liveState?.config.mines ?? mineCount;

  const nextMultiplier = useMemo(() => {
    const m = liveState ? liveState.config.mines : mineCount;
    const k = (liveState?.picks ?? 0) + 1;
    return minesMultiplier(m, k).value;
  }, [liveState, mineCount]);

  const fullPayoutTable = useMemo(() => minesPayoutTable(mineCount), [mineCount]);
  const survivalNext = useMemo(
    () => minesSurvivalProbability(liveMines, (liveState?.picks ?? 0) + 1),
    [liveMines, liveState],
  );

  /* ----- Deal: open a new session --------------------------------------- */

  const deal = useCallback(
    async (override?: { stake?: bigint; mines?: number }) => {
      setError(null);
      try {
        if (session && !minesGame.isTerminal(session.state)) {
          throw new Error("Finish or cash out the current round first");
        }
        const stake = override?.stake ?? humanToUnits(betAmount, token);
        if (stake <= 0n) throw new Error("Bet must be > 0");
        if (balance.available < stake) throw new Error("Insufficient balance");
        const minesN = override?.mines ?? mineCount;
        if (minesN < MIN_MINES || minesN > MAX_MINES) {
          throw new Error(`Mines must be in [${MIN_MINES}, ${MAX_MINES}]`);
        }
        setBusy(true);
        const s = await driver.openSession(minesGame, {
          sessionId: newSessionId(),
          userId,
          gameId: minesGame.id,
          chainId,
          token,
          stake,
          config: { mines: minesN } as Record<string, unknown>,
        });
        setSession(s);
        setHitFlash(null);
        await refreshBalance();
        return s;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [balance.available, betAmount, chainId, driver, mineCount, refreshBalance, session, token, userId],
  );

  /* ----- Pick a tile ----------------------------------------------------- */

  const pick = useCallback(
    async (tile: number) => {
      if (!session || busy) return;
      if (minesGame.isTerminal(session.state)) return;
      if (session.state.revealed.includes(tile)) return;
      setError(null);
      try {
        setBusy(true);
        let next = await driver.applyAction(minesGame, session, { type: "pick", tile });
        setSession(next);
        if (minesGame.isTerminal(next.state)) {
          // hit a mine (or auto-cashed because every safe tile cleared)
          if (next.state.phase === "exploded") setHitFlash(tile);
          next = await driver.settleSession(minesGame, next);
          setSession(next);
          setHistory((h) => [next, ...h].slice(0, 30));
          pushHistory({
            game: "mines",
            stakeUnits: next.result!.totalStakedUnits,
            pnlUnits: next.result!.pnlUnits,
            multiplier: next.state.multiplier,
            session: next as unknown as Session<unknown, unknown>,
          });
          void persistSettledSession(
            next as unknown as Parameters<typeof persistSettledSession>[0],
            getSeedPair(),
          );
          await refreshBalance();
          // Brief boom dwell, then clear the active session
          setTimeout(() => setSession(null), 1400);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, driver, getSeedPair, pushHistory, refreshBalance, session],
  );

  /* ----- Cash out -------------------------------------------------------- */

  const cashout = useCallback(async () => {
    if (!session || busy) return;
    if (session.state.picks === 0) return;
    if (minesGame.isTerminal(session.state)) return;
    setError(null);
    try {
      setBusy(true);
      let next = await driver.applyAction(minesGame, session, { type: "cashout" });
      next = await driver.settleSession(minesGame, next);
      setSession(next);
      setHistory((h) => [next, ...h].slice(0, 30));
      pushHistory({
        game: "mines",
        stakeUnits: next.result!.totalStakedUnits,
        pnlUnits: next.result!.pnlUnits,
        multiplier: next.state.multiplier,
        session: next as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(
        next as unknown as Parameters<typeof persistSettledSession>[0],
        getSeedPair(),
      );
      await refreshBalance();
      setTimeout(() => setSession(null), 1400);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, driver, getSeedPair, pushHistory, refreshBalance, session]);

  /* ----- Auto-bet -------------------------------------------------------- */

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

    const safeMines = Math.max(MIN_MINES, Math.min(MAX_MINES, mineCount));
    const targetPicks = Math.max(1, Math.min(TOTAL_TILES - safeMines, auto.pickCount));

    for (let i = 0; i < auto.rounds; i++) {
      if (cancelAutoRef.current) break;
      const bal = (await ledger.getBalance(userId, chainId, token)).available;
      const pnl = bal - startBal;
      if (auto.stopOnProfit > 0 && pnl >= stopProfit) break;
      if (auto.stopOnLoss > 0 && -pnl >= stopLoss) break;
      if (stake > bal || stake <= 0n) break;

      // Open a new round with our chosen stake / mines.
      let s = await driver.openSession(minesGame, {
        sessionId: newSessionId(),
        userId,
        gameId: minesGame.id,
        chainId,
        token,
        stake,
        config: { mines: safeMines } as Record<string, unknown>,
      });

      // Pick `targetPicks` tiles in numerical order (deterministic, fair —
      // mines layout is random independent of the pick order).
      let exploded = false;
      for (let tile = 0; tile < TOTAL_TILES && s.state.picks < targetPicks; tile++) {
        if (s.state.revealed.includes(tile)) continue;
        s = await driver.applyAction(minesGame, s, { type: "pick", tile });
        if (s.state.phase === "exploded") {
          exploded = true;
          break;
        }
      }
      if (!exploded && s.state.phase === "running") {
        s = await driver.applyAction(minesGame, s, { type: "cashout" });
      }
      s = await driver.settleSession(minesGame, s);

      setHistory((h) => [s, ...h].slice(0, 30));
      pushHistory({
        game: "mines",
        stakeUnits: s.result!.totalStakedUnits,
        pnlUnits: s.result!.pnlUnits,
        multiplier: s.state.multiplier,
        session: s as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(
        s as unknown as Parameters<typeof persistSettledSession>[0],
        getSeedPair(),
      );

      const won = (s.result?.pnlUnits ?? 0n) > 0n;
      progress.remaining = auto.rounds - i - 1;
      progress.wins += won ? 1 : 0;
      progress.losses += won ? 0 : 1;
      progress.pnlUnits += s.result?.pnlUnits ?? 0n;
      setAutoProgress({ ...progress });
      await refreshBalance();
      stake = won
        ? humanToUnits(betAmount, token)
        : BigInt(Math.floor(Number(stake) * auto.onLossMultiplier));
      await new Promise((r) => setTimeout(r, 60));
    }
    setAutoRunning(false);
  }, [auto, autoRunning, betAmount, chainId, driver, getSeedPair, ledger, mineCount, pushHistory, refreshBalance, token, userId]);

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
      if (k === "c" && session && session.state.picks > 0 && !busy) {
        e.preventDefault();
        void cashout();
      } else if ((k === " " || k === "enter") && !session && !busy && !autoRunning) {
        e.preventDefault();
        void deal();
      } else if (k === "escape" && autoRunning) {
        cancelAutoRef.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoRunning, busy, cashout, deal, session, verifyTarget]);

  /* ----- Render --------------------------------------------------------- */

  const seedPair = getSeedPair();
  const hashShort = seedPair.serverSeedHash.slice(0, 14) + "…";
  const inRound = session !== null && !minesGame.isTerminal(session.state);
  const terminal = session !== null && minesGame.isTerminal(session.state);
  const currentPayout = session
    ? (session.state.stake * session.state.multiplierMicro) / 1_000_000n
    : 0n;
  const stake = humanToUnits(betAmount, token);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
      <div className="space-y-5">
        {/* Mines board */}
        <MinesBoard
          state={session?.state ?? null}
          terminal={terminal}
          hitFlash={hitFlash}
          onPick={(tile) => void pick(tile)}
          busy={busy || autoRunning}
        />

        {/* Bet panel */}
        <section className={card + " p-5"}>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[120px]">
              <label className={labelCls}>Stake ({token.symbol})</label>
              <input
                type="number"
                className={inputCls}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                min={0}
                step={0.1}
                disabled={inRound || autoRunning}
              />
            </div>
            <div className="flex-[2] min-w-[200px]">
              <div className="flex items-baseline justify-between mb-1.5">
                <label className={labelCls + " mb-0"}>Mines</label>
                <span className="text-[12px] font-mono text-emerald-300">
                  {mineCount} {mineCount === 1 ? "mine" : "mines"} · {25 - mineCount} safe
                </span>
              </div>
              <input
                type="range"
                min={MIN_MINES}
                max={MAX_MINES}
                value={mineCount}
                onChange={(e) => setMineCount(Number(e.target.value))}
                disabled={inRound || autoRunning}
                className="w-full accent-emerald-500"
              />
              <div className="mt-1 flex gap-1.5">
                {[1, 3, 5, 10, 24].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={
                      "h-7 px-2 text-[10px] font-medium rounded-md border transition-all cursor-pointer " +
                      (mineCount === m
                        ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                        : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]")
                    }
                    onClick={() => setMineCount(m)}
                    disabled={inRound || autoRunning}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 items-end">
              {!inRound ? (
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void deal()}
                  disabled={busy || autoRunning || stake > balance.available || stake <= 0n}
                >
                  Bet · {fmtMoney(stake, token)}
                </button>
              ) : (
                <button
                  type="button"
                  className={btnGold}
                  onClick={() => void cashout()}
                  disabled={busy || session?.state.picks === 0}
                  title="Hot key: C"
                >
                  Cash out {currentPayout === 0n ? "" : `· ${fmtMoney(currentPayout, token)}`}
                </button>
              )}
              <button
                type="button"
                className={btnGhost}
                onClick={() => setAutoOpen((o) => !o)}
                disabled={inRound || autoRunning}
              >
                {autoOpen ? "Hide auto" : "Auto bet"}
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            <Stat label="Available" value={fmtMoney(balance.available, token)} />
            <Stat
              label="Current"
              value={inRound ? `${liveMultiplier.toFixed(2)}×` : "—"}
              sub={inRound ? `${livePicks} safe pick${livePicks === 1 ? "" : "s"}` : "no round"}
            />
            <Stat
              label="Next pick"
              value={inRound || !session ? `${nextMultiplier.toFixed(2)}×` : "—"}
              sub={`${(survivalNext * 100).toFixed(1)}% safe`}
            />
            <Stat
              label="House edge"
              value={"1.00%"}
              sub={`flat across all M, k`}
            />
          </div>

          {error && (
            <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-200">
              {error}
            </div>
          )}

          {autoOpen && (
            <AutoPanel
              cfg={auto}
              setCfg={setAuto}
              running={autoRunning}
              progress={autoProgress}
              run={() => void runAuto()}
              cancel={() => {
                cancelAutoRef.current = true;
              }}
              token={token}
              maxPicks={25 - mineCount}
            />
          )}
        </section>

        {/* Bankroll quick-credit */}
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

      {/* Side column */}
      <div className="space-y-5">
        {/* Payout ladder */}
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-white">Payout ladder</h3>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              {mineCount} mines
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto pr-1 space-y-1">
            {fullPayoutTable.map((m, idx) => {
              const k = idx + 1;
              const reached = (liveState?.picks ?? 0) >= k;
              const isNext = (liveState?.picks ?? 0) + 1 === k && inRound;
              return (
                <div
                  key={k}
                  className={
                    "flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] font-mono " +
                    (reached
                      ? "bg-emerald-500/10 border border-emerald-400/30 text-emerald-200"
                      : isNext
                        ? "bg-amber-500/10 border border-amber-400/40 text-amber-200"
                        : "bg-white/[0.02] border border-white/[0.05] text-white/60")
                  }
                >
                  <span>k = {k}</span>
                  <span>{m.toFixed(m >= 100 ? 0 : m >= 10 ? 1 : 2)}×</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Recent rounds */}
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-white">Recent rounds</h3>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              {history.length}/30
            </span>
          </div>
          {history.length === 0 ? (
            <div className="text-[12px] text-white/40 text-center py-6">
              No rounds yet — place a bet.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
              {history.map((s) => {
                const st = s.state as MinesState;
                const won = (s.result?.pnlUnits ?? 0n) > 0n;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-emerald-400/30 hover:bg-emerald-500/[0.04] transition-colors text-left cursor-pointer"
                    onClick={() => setVerifyTarget(s)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          "h-6 px-2 rounded-md text-[10px] font-mono font-semibold flex items-center justify-center " +
                          (won
                            ? "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30"
                            : "bg-rose-500/15 text-rose-200 border border-rose-400/30")
                        }
                      >
                        {st.multiplier.toFixed(2)}×
                      </span>
                      <span className="text-[10px] text-white/40">
                        {st.picks} pick{st.picks === 1 ? "" : "s"} · {st.config.mines} mines
                      </span>
                    </div>
                    <div
                      className={
                        "text-[12px] font-mono " +
                        (won ? "text-emerald-300" : "text-rose-300")
                      }
                    >
                      {won ? "+" : ""}
                      {fmtMoney(s.result?.pnlUnits ?? 0n, token)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Fairness card */}
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-semibold text-white">Provable fairness</h3>
            <button
              type="button"
              className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer"
              onClick={() => rotateSeed()}
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
              Mine layout is a Fisher–Yates shuffle of [0, 25) driven by{" "}
              <code className="text-emerald-300">HMAC-SHA256(server_seed, client_seed:nonce)</code>.
              The first M shuffled positions are the mines. Once the seed is revealed anyone can
              recompute the exact layout.
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
          </section>
        )}
      </div>

      {/* Verify modal */}
      {verifyTarget && (
        <MinesVerifyModal
          session={verifyTarget}
          onClose={() => setVerifyTarget(null)}
          revealedSeed={lastRevealedSeed?.serverSeed ?? null}
        />
      )}
    </div>
  );
}

/* ===========================================================================
 *  Board
 * ========================================================================= */

function MinesBoard({
  state,
  terminal,
  hitFlash,
  onPick,
  busy,
}: {
  state: MinesState | null;
  terminal: boolean;
  hitFlash: number | null;
  onPick: (tile: number) => void;
  busy: boolean;
}) {
  const revealed = state ? new Set(state.revealed) : new Set<number>();
  const mineSet = state && terminal ? new Set(state.mineLayout) : new Set<number>();
  const exploded = state?.phase === "exploded";
  const won = state?.phase === "cashed_out";
  return (
    <section className={card + " p-5"}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-semibold text-white">Mines · 5×5</h3>
        <span className="text-[11px] text-white/40">
          {state
            ? terminal
              ? exploded
                ? "boom"
                : "cashed out"
              : `${state.picks} safe · ${state.multiplier.toFixed(2)}×`
            : "place a bet"}
        </span>
      </div>
      <div
        className="mx-auto grid gap-2 select-none"
        style={{
          gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
          maxWidth: 480,
        }}
      >
        {Array.from({ length: TOTAL_TILES }).map((_, i) => {
          const isRevealed = revealed.has(i);
          const isMine = mineSet.has(i);
          const isHit = hitFlash === i;
          const showMineAtEnd = terminal && isMine;
          const showSafeAtEnd = terminal && isRevealed && !isMine;
          const showSafeMid = !terminal && isRevealed;

          let body: React.ReactNode = null;
          let cls = "bg-white/[0.06] border-white/[0.08] hover:bg-white/[0.10]";
          if (showSafeMid || showSafeAtEnd) {
            body = (
              <span className="text-emerald-300 text-xl drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]">
                ◆
              </span>
            );
            cls = "bg-emerald-500/15 border-emerald-400/40";
          } else if (showMineAtEnd) {
            body = (
              <span className={"text-2xl " + (isHit ? "text-rose-300" : "text-white/40")}>
                ✸
              </span>
            );
            cls = isHit
              ? "bg-rose-500/25 border-rose-400/60 animate-pulse"
              : "bg-white/[0.04] border-white/[0.08]";
          }
          if (won && !isRevealed) {
            cls = "bg-emerald-500/[0.04] border-emerald-400/15";
          }

          const disabled = busy || !state || terminal || isRevealed;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              disabled={disabled}
              className={
                "aspect-square rounded-xl border flex items-center justify-center text-sm font-semibold transition-all cursor-pointer disabled:cursor-not-allowed " +
                cls +
                (disabled && !isRevealed ? " opacity-70" : " hover:scale-[1.02] active:scale-[0.97]")
              }
            >
              {body}
            </button>
          );
        })}
      </div>
      {terminal && (
        <div className="mt-4 text-center">
          {exploded ? (
            <div className="text-[13px] text-rose-300">
              Hit a mine after {state?.picks ?? 0} safe pick{state?.picks === 1 ? "" : "s"}.
            </div>
          ) : (
            <div className="text-[13px] text-emerald-300">
              Cashed out at {state?.multiplier.toFixed(2)}× ·{" "}
              {state?.picks} safe pick{state?.picks === 1 ? "" : "s"}.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ===========================================================================
 *  Auto-bet panel
 * ========================================================================= */

function AutoPanel({
  cfg,
  setCfg,
  running,
  progress,
  run,
  cancel,
  token,
  maxPicks,
}: {
  cfg: AutoConfig;
  setCfg: (c: AutoConfig) => void;
  running: boolean;
  progress: { remaining: number; wins: number; losses: number; pnlUnits: bigint } | null;
  run: () => void;
  cancel: () => void;
  token: TokenSpec;
  maxPicks: number;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
          <label className={labelCls}>Picks / round</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.pickCount}
            onChange={(e) =>
              setCfg({
                ...cfg,
                pickCount: Math.max(1, Math.min(maxPicks, Number(e.target.value))),
              })
            }
            disabled={running}
            min={1}
            max={maxPicks}
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
            Run {cfg.rounds} rounds · pick {cfg.pickCount} each
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
          </div>
        )}
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Small UI primitives
 * ========================================================================= */

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">{label}</div>
      <div className="mt-1 font-mono text-[14px] text-white">{value}</div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ===========================================================================
 *  Verify modal
 * ========================================================================= */

function MinesVerifyModal({
  session,
  onClose,
  revealedSeed,
}: {
  session: Session<MinesAction, MinesState>;
  onClose: () => void;
  revealedSeed: string | null;
}) {
  const state = session.state as MinesState;
  const result = session.result;
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
            <FieldRow label="Outcome">
              <code className="text-white/80">{state.phase}</code>
            </FieldRow>
            <FieldRow label="Multiplier">
              <code className="text-white/80">{state.multiplier.toFixed(2)}×</code>
            </FieldRow>
            <FieldRow label="Mines">
              <code className="text-white/80">{state.config.mines} / 25</code>
            </FieldRow>
            <FieldRow label="Safe picks">
              <code className="text-white/80">{state.picks}</code>
            </FieldRow>
            <FieldRow label="PnL">
              <code className={result && result.pnlUnits > 0n ? "text-emerald-300" : "text-rose-300"}>
                {result?.pnlUnits.toString() ?? "—"}
              </code>
            </FieldRow>
            <FieldRow label="Hit mine">
              <code className="text-white/80">
                {state.hitMine === null ? "—" : `tile ${state.hitMine}`}
              </code>
            </FieldRow>
          </div>
          <FieldRow label="Mine layout (sorted tile indices)">
            <code className="text-white/80 break-all">{state.mineLayout.join(", ")}</code>
          </FieldRow>
          <FieldRow label="Revealed picks (in order)">
            <code className="text-white/80 break-all">{state.revealed.join(", ")}</code>
          </FieldRow>
          <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px] leading-relaxed text-white/70">
            <p className="mb-1">
              <span className="text-white/40">Server seed hash:</span>{" "}
              <code className="break-all">{session.serverSeedHash}</code>
            </p>
            <p className="mb-1">
              <span className="text-white/40">Client seed:</span>{" "}
              <code>{session.clientSeed}</code>
            </p>
            <p>
              <span className="text-white/40">Nonce:</span>{" "}
              <code>{session.startNonce}</code>
            </p>
          </div>
          <ShareLinkRow
            session={session as unknown as Session<unknown, unknown>}
            serverSeed={revealedSeed}
          />
          <div className="text-[11px] text-white/40 leading-relaxed">
            To independently replay this round, paste the session JSON and the
            revealed server seed into <code className="text-emerald-300">/casino/verify</code>.
            The engine runs a Fisher–Yates shuffle of [0, 25) driven by{" "}
            <code className="text-emerald-300">HMAC(seed, client:nonce)</code> — the first M
            shuffled positions are the mine layout above.
          </div>
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
