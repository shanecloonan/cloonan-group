"use client";

/* ===========================================================================
 *  Slots table — UI for lib/casino/slots
 *  ---------------------------------------------------------------------------
 *  Visual layout:
 *
 *    ┌────────────────────────────────────────────────────────────────────┐
 *    │  3×5 reel window — animated spin, settles on the engine's grid     │
 *    │  Settlement banner (win / loss / free spins triggered)             │
 *    │  Bet controls (stake · spin · auto · verify)                       │
 *    └────────────────────────────────────────────────────────────────────┘
 *
 *  Animation: each reel is a stack of "phantom" symbols that scrolls down
 *  while spinning. Reels stop left → right, staggered ~120ms apart, with
 *  a snap-to-final on the last frame so the visible window matches the
 *  engine-decided stop position exactly. The settled cells then flash
 *  briefly if they're part of a winning payline.
 *
 *  Free spins: when the base spin triggers free spins, we display all
 *  subsequent spins back-to-back automatically (the engine has already
 *  resolved them — the UI just plays the resolved sequence).
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SLOTS_CONFIG,
  newSessionId,
  persistSettledSession,
  slotsGame,
  SYMBOL_COLOR,
  SYMBOL_GLYPH,
  verifySession,
  type ChainAdapter,
  type ChainId,
  type Session,
  type SlotSymbolId,
  type SlotsAction,
  type SlotsSpinResult,
  type SlotsState,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { ShareLinkRow } from "./share-link";
import { btnGhost, btnPrimary } from "./casino-ui";

/* ---------------------------------------------------------------------------
 *  Shared style vocab
 * ------------------------------------------------------------------------- */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls =
  "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls =
  "w-full h-10 px-3 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
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

const LAST_BET_KEY = "mf_casino_slots_bet";

/* ===========================================================================
 *  Slots table component
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

interface AutoBetState {
  remaining: number;
  totalWagered: bigint;
  totalWon: bigint;
  wins: number;
  losses: number;
  startBalance: bigint;
}

interface AutoBetConfig {
  rounds: number;
  /** Stake multiplier applied on a losing spin. 1 = flat. */
  onLossMultiplier: number;
  /** Reset to base stake on win? */
  resetOnWin: boolean;
  /** Stop if profit reaches this amount (token human units). 0 = no limit. */
  stopOnProfit: number;
  /** Stop if loss reaches this amount. 0 = no limit. */
  stopOnLoss: number;
}

const DEFAULT_AUTO: AutoBetConfig = {
  rounds: 25,
  onLossMultiplier: 1,
  resetOnWin: true,
  stopOnProfit: 0,
  stopOnLoss: 0,
};

export default function SlotsTable({ chainId, token }: Props) {
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

  /* ----- Persisted stake ----- */

  const [betAmount, setBetAmount] = useState<number>(() => {
    if (typeof window === "undefined") return 20;
    const v = Number(window.localStorage.getItem(LAST_BET_KEY));
    return Number.isFinite(v) && v > 0 ? v : 20;
  });
  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
  }, [betAmount]);

  /* ----- Engine state ----- */

  const [lastSession, setLastSession] = useState<Session<SlotsAction, SlotsState> | null>(null);
  const [history, setHistory] = useState<Session<SlotsAction, SlotsState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<SlotsAction, SlotsState> | null>(null);

  /* ----- Reel display state ----- */

  const [displayGrid, setDisplayGrid] = useState<SlotSymbolId[][]>(() => emptyGrid());
  const [winningCells, setWinningCells] = useState<Set<string>>(new Set());
  const [reelSpinning, setReelSpinning] = useState<boolean[]>([false, false, false, false, false]);
  const [currentSpinIdx, setCurrentSpinIdx] = useState(0); // which spin within the session
  const [animating, setAnimating] = useState(false);

  /* ----- Computed ----- */

  const numLines = DEFAULT_SLOTS_CONFIG.numLines;
  const perLineHuman = useMemo(() => betAmount / numLines, [betAmount, numLines]);

  /* ----- Spin (full session, plus animated playback of free spins) ----- */

  const spinOnce = useCallback(
    async (override?: { stake?: bigint }): Promise<Session<SlotsAction, SlotsState> | null> => {
      setError(null);
      try {
        const stake = override?.stake ?? humanToUnits(betAmount, token);
        if (stake <= 0n) throw new Error("Bet must be > 0");
        const lines = BigInt(numLines);
        if (stake % lines !== 0n) {
          throw new Error(
            `Bet must be divisible by ${numLines} (you bet across ${numLines} lines)`,
          );
        }
        if (balance.available < stake) throw new Error("Insufficient balance");

        let s = await driver.openSession(slotsGame, {
          sessionId: newSessionId(),
          userId,
          gameId: slotsGame.id,
          chainId,
          token,
          stake,
        });
        s = await driver.settleSession(slotsGame, s);

        // Animate each spin in the session sequentially. The engine has
        // already settled everything — we're just visualising the sequence.
        setAnimating(true);
        for (let i = 0; i < s.state.spins.length; i++) {
          setCurrentSpinIdx(i);
          await playSpinAnimation(
            s.state.config.reelStrips,
            s.state.spins[i],
            setDisplayGrid,
            setReelSpinning,
            setWinningCells,
            i === 0 ? 70 : 40, // free spins animate faster
          );
        }
        setAnimating(false);

        setHistory((h) => [s, ...h].slice(0, 30));
        setLastSession(s);
        pushHistory({
          game: "slots",
          stakeUnits: s.result!.totalStakedUnits,
          pnlUnits: s.result!.pnlUnits,
          multiplier:
            Number(s.result!.totalPayoutUnits) /
            Math.max(1, Number(s.result!.totalStakedUnits)),
          session: s as unknown as Session<unknown, unknown>,
        });
        void persistSettledSession(
          s as unknown as Parameters<typeof persistSettledSession>[0],
          getSeedPair(),
        );
        await refreshBalance();
        return s;
      } catch (err) {
        setError((err as Error).message);
        setAnimating(false);
        setReelSpinning([false, false, false, false, false]);
        return null;
      }
    },
    [
      balance.available,
      betAmount,
      chainId,
      driver,
      getSeedPair,
      numLines,
      pushHistory,
      refreshBalance,
      token,
      userId,
    ],
  );

  /* ----- Auto-bet ----- */

  const [auto, setAuto] = useState<AutoBetConfig>(DEFAULT_AUTO);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<AutoBetState | null>(null);
  const cancelAutoRef = useRef(false);

  const runAuto = useCallback(async () => {
    if (autoRunning) return;
    setError(null);
    cancelAutoRef.current = false;
    setAutoRunning(true);
    const startBal = (await ledger.getBalance(userId, chainId, token)).available;
    const progress: AutoBetState = {
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

      // Align stake to a multiple of numLines.
      const lines = BigInt(numLines);
      if (stake % lines !== 0n) stake = (stake / lines) * lines;
      if (stake <= 0n) break;

      const s = await spinOnce({ stake });
      if (!s) break;
      const won = s.result!.pnlUnits > 0n;
      progress.remaining -= 1;
      progress.totalWagered += stake;
      progress.totalWon += s.result!.totalPayoutUnits;
      progress.wins += won ? 1 : 0;
      progress.losses += won ? 0 : 1;
      setAutoProgress({ ...progress });

      stake = won && auto.resetOnWin
        ? humanToUnits(betAmount, token)
        : won
          ? stake
          : BigInt(Math.floor(Number(stake) * auto.onLossMultiplier));

      await new Promise((r) => setTimeout(r, 80));
    }
    setAutoRunning(false);
  }, [auto, autoRunning, betAmount, chainId, ledger, numLines, spinOnce, token, userId]);

  /* ----- Hotkeys ----- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (verifyTarget && e.key === "Escape") {
        setVerifyTarget(null);
        return;
      }
      if (autoRunning && e.key === "Escape") {
        cancelAutoRef.current = true;
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!animating && !autoRunning) void spinOnce();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [animating, autoRunning, spinOnce, verifyTarget]);

  const seedPair = getSeedPair();
  const revealSeed = lastRevealedSeed;

  /* ----- Computed display flags ----- */

  const isFreeSpin = useMemo(() => {
    if (!lastSession || !animating) return false;
    if (currentSpinIdx === 0) return false;
    return lastSession.state.spins[currentSpinIdx]?.isFree ?? false;
  }, [animating, currentSpinIdx, lastSession]);

  const settledBanner = useMemo(() => {
    if (!lastSession || animating) return null;
    const pnl = lastSession.result!.pnlUnits;
    const payout = lastSession.result!.totalPayoutUnits;
    const freeSpins = lastSession.state.freeSpinsPlayed;
    return {
      win: pnl > 0n,
      push: pnl === 0n,
      pnl,
      payout,
      freeSpinsTriggered: lastSession.state.freeSpinsTriggered,
      freeSpins,
    };
  }, [animating, lastSession]);

  /* =================== render =================== */

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 pt-8">
      {/* ───── Main column ───── */}
      <section className="space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-4xl font-semibold tracking-tight">
              Slots<span className="text-emerald-400">.</span>
            </h1>
            <p className="text-white/50 text-sm mt-1">
              5 reels · 20 paylines · wilds, scatters, free spins · target RTP ≈ 96%
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              Balance
            </div>
            <div className="font-mono text-lg text-emerald-300">
              {fmtMoney(balance.available, token)}
            </div>
          </div>
        </div>

        {/* Reel window */}
        <div className={card + " p-5 sm:p-7"}>
          <ReelWindow
            grid={displayGrid}
            spinning={reelSpinning}
            winningCells={winningCells}
            isFree={isFreeSpin}
            freeSpinCount={
              lastSession && animating
                ? currentSpinIdx
                : lastSession?.state.freeSpinsPlayed ?? 0
            }
            totalFreeSpins={lastSession?.state.freeSpinsPlayed ?? 0}
          />

          {/* Banner */}
          <div className="mt-5">
            {settledBanner ? (
              <SettlementBanner
                win={settledBanner.win}
                push={settledBanner.push}
                payout={settledBanner.payout}
                pnl={settledBanner.pnl}
                token={token}
                freeSpinsTriggered={settledBanner.freeSpinsTriggered}
                freeSpins={settledBanner.freeSpins}
              />
            ) : (
              <div className="h-[58px] rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-white/40 text-sm">
                Spin the reels — Space or Enter
              </div>
            )}
          </div>
        </div>

        {/* Bet controls */}
        <div className={card + " p-5 flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"}>
          <div>
            <label className={labelCls}>Total bet ({numLines} lines)</label>
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                min="0"
                className={inputCls + " flex-1"}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                disabled={animating || autoRunning}
              />
              <button
                className={btnGhost}
                onClick={() => setBetAmount((b) => Math.max(numLines, b / 2))}
                disabled={animating || autoRunning}
              >
                ½
              </button>
              <button
                className={btnGhost}
                onClick={() => setBetAmount((b) => b * 2)}
                disabled={animating || autoRunning}
              >
                2×
              </button>
            </div>
            <div className="text-[11px] text-white/40 mt-1.5">
              {perLineHuman.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}{" "}
              {token.symbol} per line
            </div>
          </div>

          <button
            className={btnPrimary + " w-full sm:w-auto sm:min-w-[150px]"}
            disabled={animating || autoRunning || balance.available <= 0n}
            onClick={() => void spinOnce()}
          >
            {animating ? "Spinning…" : "Spin"}
          </button>

          <button
            className={btnGhost + " w-full sm:w-auto"}
            disabled={animating}
            onClick={() => setAutoOpen((o) => !o)}
          >
            Auto
          </button>

          <button
            className={btnGhost}
            disabled={!lastSession}
            onClick={() => setVerifyTarget(lastSession)}
          >
            Verify
          </button>
        </div>

        {/* Auto-bet panel */}
        {autoOpen && (
          <AutoPanel
            cfg={auto}
            setCfg={setAuto}
            token={token}
            running={autoRunning}
            progress={autoProgress}
            onStart={runAuto}
            onCancel={() => {
              cancelAutoRef.current = true;
            }}
          />
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* Paytable + paylines */}
        <Paytable token={token} perLineUnits={humanToUnits(perLineHuman, token)} />
      </section>

      {/* ───── Side column ───── */}
      <aside className="space-y-6">
        <SidePanel title="Recent spins">
          {history.length === 0 ? (
            <div className="text-white/40 text-sm">No spins yet. Spin to start.</div>
          ) : (
            <div className="space-y-2">
              {history.slice(0, 10).map((s, i) => (
                <RecentSpinRow
                  key={i}
                  session={s}
                  token={token}
                  onVerify={() => setVerifyTarget(s)}
                />
              ))}
            </div>
          )}
        </SidePanel>

        <SidePanel title="Provably fair">
          <div className="space-y-2 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-white/50">Server seed hash</span>
              <span className="font-mono text-white/80">
                {seedPair.serverSeedHash.slice(0, 10)}…{seedPair.serverSeedHash.slice(-6)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-white/50">Client seed</span>
              <span className="font-mono text-white/80">{seedPair.clientSeed}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-white/50">Nonce</span>
              <span className="font-mono text-white/80">{seedPair.nonce}</span>
            </div>
          </div>
          <button
            className={btnGhost + " w-full mt-4 text-emerald-200"}
            onClick={() => rotateSeed()}
          >
            Rotate seed (reveal current)
          </button>
        </SidePanel>

        <SidePanel title="Dev bankroll">
          <div className="text-[12px] text-white/50 mb-3">
            Play money for testing. In prod this is replaced by on-chain deposits.
          </div>
          <button
            className={btnGhost + " w-full"}
            onClick={() => void depositPlayMoney(1000n * 10n ** BigInt(token.decimals))}
          >
            +1,000 {token.symbol}
          </button>
        </SidePanel>

        {revealSeed && (
          <SidePanel title="Revealed seed">
            <div className="text-[12px] text-white/70 mb-2">
              The previous server seed has been revealed. Use it on{" "}
              <code className="text-emerald-300">/casino/verify</code> to audit
              any settled hand from the prior rotation.
            </div>
            <div className="font-mono text-[11px] text-amber-200 break-all bg-amber-500/5 border border-amber-400/20 p-2 rounded">
              {revealSeed.serverSeed}
            </div>
            <button
              className={btnGhost + " w-full mt-3"}
              onClick={dismissRevealedSeed}
            >
              Dismiss
            </button>
          </SidePanel>
        )}
      </aside>

      {verifyTarget && (
        <SlotsVerifyModal
          session={verifyTarget}
          revealedServerSeed={
            seedPair.serverSeedHash === verifyTarget.serverSeedHash
              ? seedPair.serverSeed ?? null
              : revealSeed?.hash === verifyTarget.serverSeedHash
                ? revealSeed.serverSeed
                : null
          }
          token={token}
          onClose={() => setVerifyTarget(null)}
        />
      )}
    </div>
  );
}

/* ===========================================================================
 *  Reel window
 * ========================================================================= */

const REEL_CELL_HEIGHT = 84;

function ReelWindow({
  grid,
  spinning,
  winningCells,
  isFree,
  freeSpinCount,
  totalFreeSpins,
}: {
  grid: SlotSymbolId[][];
  spinning: boolean[];
  winningCells: Set<string>;
  isFree: boolean;
  freeSpinCount: number;
  totalFreeSpins: number;
}) {
  return (
    <div className="relative">
      {isFree && (
        <div className="absolute -top-2 right-0 z-10 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-200 text-[10px] font-semibold uppercase tracking-[0.15em]">
          Free spin {freeSpinCount}/{totalFreeSpins}
        </div>
      )}
      <div
        className="grid grid-cols-5 gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl bg-gradient-to-b from-black/30 to-black/60 border border-white/[0.08]"
        style={{ height: REEL_CELL_HEIGHT * 3 + 32 }}
      >
        {[0, 1, 2, 3, 4].map((col) => (
          <ReelColumn
            key={col}
            col={col}
            symbols={[grid[0][col], grid[1][col], grid[2][col]]}
            spinning={spinning[col]}
            winningCells={winningCells}
          />
        ))}
      </div>
    </div>
  );
}

function ReelColumn({
  col,
  symbols,
  spinning,
  winningCells,
}: {
  col: number;
  symbols: SlotSymbolId[];
  spinning: boolean;
  winningCells: Set<string>;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-black/30 border border-white/[0.04]">
      <div
        className="flex flex-col"
        style={{
          transition: spinning ? "none" : "transform 240ms cubic-bezier(0.2, 1.2, 0.3, 1)",
          transform: spinning ? "translateY(-30%)" : "translateY(0)",
        }}
      >
        {symbols.map((s, row) => {
          const isWin = winningCells.has(`${row},${col}`);
          return (
            <ReelCell key={row} symbol={s} isWin={isWin} spinning={spinning} />
          );
        })}
      </div>
    </div>
  );
}

function ReelCell({
  symbol,
  isWin,
  spinning,
}: {
  symbol: SlotSymbolId;
  isWin: boolean;
  spinning: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-center font-bold text-3xl sm:text-4xl border-b border-white/[0.04] last:border-b-0 transition-all " +
        SYMBOL_COLOR[symbol] +
        (isWin && !spinning
          ? " bg-emerald-400/15 ring-1 ring-inset ring-emerald-400/40 scale-105"
          : spinning
            ? " opacity-70 blur-[1px]"
            : "")
      }
      style={{ height: REEL_CELL_HEIGHT }}
    >
      {SYMBOL_GLYPH[symbol]}
    </div>
  );
}

function emptyGrid(): SlotSymbolId[][] {
  // Seed the visible grid with a neutral row so the UI looks alive before
  // the first spin.
  return [
    ["K", "A", "Q", "GEM", "J"],
    ["A", "K", "WILD", "A", "Q"],
    ["Q", "J", "K", "GEM", "K"],
  ];
}

/* ---------------------------------------------------------------------------
 *  Spin animation — per-spin in a multi-spin session
 *
 *  We staircase the reel stops left→right. While a reel is "spinning" it
 *  displays a random sequence of phantom symbols pulled from that reel's
 *  strip; on stop we snap to the engine's resolved 3-cell slice and (after
 *  all reels land) light up the winning cells.
 * ------------------------------------------------------------------------- */

async function playSpinAnimation(
  strips: SlotSymbolId[][],
  spin: SlotsSpinResult,
  setDisplayGrid: (g: SlotSymbolId[][]) => void,
  setReelSpinning: (s: boolean[]) => void,
  setWinningCells: (s: Set<string>) => void,
  baseSpinMs: number,
) {
  // Stage 1: start all reels spinning, blank the winning highlight.
  setWinningCells(new Set());
  setReelSpinning([true, true, true, true, true]);

  // Stage 2: tick the phantom symbols.
  const phantomTicks = 12;
  for (let t = 0; t < phantomTicks; t++) {
    const phantom: SlotSymbolId[][] = [[], [], []];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const strip = strips[col];
        phantom[row].push(strip[Math.floor(Math.random() * strip.length)]);
      }
    }
    setDisplayGrid(phantom);
    await new Promise((r) => setTimeout(r, baseSpinMs));
  }

  // Stage 3: stop reels left→right, snapping to the engine grid.
  const stopping = [true, true, true, true, true];
  for (let col = 0; col < 5; col++) {
    stopping[col] = false;
    setReelSpinning([...stopping]);
    // Snap that column to the resolved symbols. Build a fresh grid each step.
    setDisplayGrid(rebuildGridForStopped(spin.grid, stopping));
    await new Promise((r) => setTimeout(r, 120));
  }

  // Stage 4: highlight winning cells.
  const winSet = new Set<string>();
  for (const w of spin.lineWins) {
    // For each line win, mark the first `w.count` cells along the payline.
    // The payline is fixed per line index — we look it up from defaults.
    const line = DEFAULT_SLOTS_CONFIG.paylines[w.line];
    for (let col = 0; col < w.count; col++) {
      winSet.add(`${line[col]},${col}`);
    }
  }
  // Also highlight scatters anywhere if 3+ scatters present.
  if (spin.scatterCount >= 3) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        if (spin.grid[row][col] === "SCATTER") winSet.add(`${row},${col}`);
      }
    }
  }
  setWinningCells(winSet);

  // Pause so the user sees the result before the next free spin (if any).
  await new Promise((r) => setTimeout(r, 400));
}

function rebuildGridForStopped(
  finalGrid: SlotSymbolId[][],
  stillSpinning: boolean[],
): SlotSymbolId[][] {
  const grid: SlotSymbolId[][] = [[], [], []];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      if (stillSpinning[col]) {
        // Keep showing a phantom symbol while spinning.
        const set: SlotSymbolId[] = ["TEN", "J", "Q", "K", "A", "GEM", "BELL", "SEVEN"];
        grid[row].push(set[Math.floor(Math.random() * set.length)]);
      } else {
        grid[row].push(finalGrid[row][col]);
      }
    }
  }
  return grid;
}

/* ===========================================================================
 *  Settlement banner
 * ========================================================================= */

function SettlementBanner({
  win,
  push,
  payout,
  pnl,
  token,
  freeSpinsTriggered,
  freeSpins,
}: {
  win: boolean;
  push: boolean;
  payout: bigint;
  pnl: bigint;
  token: TokenSpec;
  freeSpinsTriggered: boolean;
  freeSpins: number;
}) {
  if (push) {
    return (
      <div className="h-[58px] flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-white/60 text-sm">
        No win — try again
      </div>
    );
  }
  if (!win) {
    return (
      <div className="h-[58px] flex items-center justify-center rounded-lg border border-rose-400/20 bg-rose-500/10 text-rose-200 text-sm">
        Lost {fmtMoney(-pnl, token)} {freeSpinsTriggered ? ` — but ${freeSpins} free spin(s) triggered next` : ""}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 flex items-center justify-between">
      <div>
        <div className="text-emerald-200 text-[11px] uppercase tracking-[0.15em] font-semibold">
          {freeSpinsTriggered ? `Win + ${freeSpins} free spins!` : "You won"}
        </div>
        <div className="text-emerald-300 font-mono text-xl font-semibold mt-0.5">
          +{fmtMoney(pnl, token)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-white/40 text-[10px] uppercase tracking-[0.15em]">
          Total payout
        </div>
        <div className="text-white/90 font-mono">{fmtMoney(payout, token)}</div>
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Paytable
 * ========================================================================= */

function Paytable({ token, perLineUnits }: { token: TokenSpec; perLineUnits: bigint }) {
  const symbols: (keyof typeof DEFAULT_SLOTS_CONFIG.paytable)[] = [
    "SEVEN", "BELL", "GEM", "A", "K", "Q", "J", "TEN",
  ];
  return (
    <div className={card + " p-5"}>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold">Paytable</h2>
        <div className="text-[11px] text-white/40">
          Multipliers of per-line bet ({fmtMoney(perLineUnits, token, 4)})
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {symbols.map((sym) => (
          <div
            key={sym}
            className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
          >
            <div className="flex items-center gap-3">
              <span className={"text-2xl font-bold " + SYMBOL_COLOR[sym]}>
                {SYMBOL_GLYPH[sym]}
              </span>
              <span className="text-white/70 text-[12px] font-medium">{sym}</span>
            </div>
            <div className="flex gap-3 text-[11px] font-mono text-white/70">
              {DEFAULT_SLOTS_CONFIG.paytable[sym].map((m, i) => (
                <span key={i}>
                  <span className="text-white/40">{i + 3}×</span> {m}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="p-3 rounded-lg bg-fuchsia-500/5 border border-fuchsia-400/20">
          <div className="flex items-center gap-2">
            <span className={"text-2xl font-bold " + SYMBOL_COLOR.WILD}>
              {SYMBOL_GLYPH.WILD}
            </span>
            <span className="text-white/80 text-[12px] font-medium">WILD</span>
          </div>
          <div className="text-[11px] text-white/50 mt-1">
            Substitutes for any non-scatter symbol on paylines.
          </div>
        </div>
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-400/20">
          <div className="flex items-center gap-2">
            <span className={"text-2xl font-bold " + SYMBOL_COLOR.SCATTER}>
              {SYMBOL_GLYPH.SCATTER}
            </span>
            <span className="text-white/80 text-[12px] font-medium">SCATTER</span>
          </div>
          <div className="text-[11px] text-white/50 mt-1">
            3+ anywhere pays{" "}
            <span className="font-mono text-amber-200">
              {DEFAULT_SLOTS_CONFIG.scatterPay.join("×, ")}×
            </span>{" "}
            total bet + free spins.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Side panels & rows
 * ========================================================================= */

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={card + " p-5"}>
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function RecentSpinRow({
  session,
  token,
  onVerify,
}: {
  session: Session<SlotsAction, SlotsState>;
  token: TokenSpec;
  onVerify: () => void;
}) {
  const pnl = session.result!.pnlUnits;
  const win = pnl > 0n;
  const fs = session.state.freeSpinsPlayed;
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <div className="text-[12px] flex items-center gap-2">
        <span
          className={
            "w-2 h-2 rounded-full " + (win ? "bg-emerald-400" : pnl === 0n ? "bg-white/30" : "bg-rose-400")
          }
        />
        <span className="font-mono text-white/80">
          {pnl >= 0n ? "+" : ""}
          {fmtMoney(pnl, token)}
        </span>
        {fs > 0 && (
          <span className="text-[10px] text-amber-300 uppercase tracking-wide">
            +{fs} FS
          </span>
        )}
      </div>
      <button
        className="text-[11px] text-emerald-300 hover:text-emerald-200 hover:underline underline-offset-2"
        onClick={onVerify}
      >
        verify →
      </button>
    </div>
  );
}

/* ===========================================================================
 *  Auto-bet panel
 * ========================================================================= */

function AutoPanel({
  cfg,
  setCfg,
  token,
  running,
  progress,
  onStart,
  onCancel,
}: {
  cfg: AutoBetConfig;
  setCfg: (c: AutoBetConfig) => void;
  token: TokenSpec;
  running: boolean;
  progress: AutoBetState | null;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={card + " p-5 space-y-3"}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Auto-bet</h2>
        <span className="text-[11px] text-white/40">Esc cancels</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Rounds</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.rounds}
            min="1"
            disabled={running}
            onChange={(e) => setCfg({ ...cfg, rounds: Math.max(1, Number(e.target.value)) })}
          />
        </div>
        <div>
          <label className={labelCls}>On-loss ×</label>
          <input
            type="number"
            step="0.1"
            className={inputCls}
            value={cfg.onLossMultiplier}
            min="0.1"
            disabled={running}
            onChange={(e) => setCfg({ ...cfg, onLossMultiplier: Math.max(0.1, Number(e.target.value)) })}
          />
        </div>
        <div>
          <label className={labelCls}>Stop profit ({token.symbol})</label>
          <input
            type="number"
            min="0"
            className={inputCls}
            value={cfg.stopOnProfit}
            disabled={running}
            onChange={(e) => setCfg({ ...cfg, stopOnProfit: Math.max(0, Number(e.target.value)) })}
          />
        </div>
        <div>
          <label className={labelCls}>Stop loss ({token.symbol})</label>
          <input
            type="number"
            min="0"
            className={inputCls}
            value={cfg.stopOnLoss}
            disabled={running}
            onChange={(e) => setCfg({ ...cfg, stopOnLoss: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12px] text-white/60 cursor-pointer">
        <input
          type="checkbox"
          checked={cfg.resetOnWin}
          disabled={running}
          onChange={(e) => setCfg({ ...cfg, resetOnWin: e.target.checked })}
        />
        Reset to base stake after a win
      </label>

      <div className="flex gap-2">
        {!running ? (
          <button className={btnPrimary} onClick={onStart}>
            Start auto-bet
          </button>
        ) : (
          <button className={btnGhost} onClick={onCancel}>
            Cancel
          </button>
        )}
        {progress && (
          <div className="flex-1 text-[11px] text-white/60 flex items-center gap-3">
            <span>
              <span className="text-white/40">Remaining:</span>{" "}
              <span className="font-mono">{progress.remaining}</span>
            </span>
            <span>
              <span className="text-white/40">W/L:</span>{" "}
              <span className="font-mono">
                {progress.wins}/{progress.losses}
              </span>
            </span>
            <span>
              <span className="text-white/40">Net:</span>{" "}
              <span className="font-mono">
                {fmtMoney(progress.totalWon - progress.totalWagered, token)}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Verify modal
 * ========================================================================= */

function SlotsVerifyModal({
  session,
  revealedServerSeed,
  token,
  onClose,
}: {
  session: Session<SlotsAction, SlotsState>;
  revealedServerSeed: string | null;
  token: TokenSpec;
  onClose: () => void;
}) {
  const verifier = useMemo(() => {
    if (!revealedServerSeed) return null;
    try {
      return verifySession({
        game: slotsGame,
        serverSeed: revealedServerSeed,
        serverSeedHash: session.serverSeedHash,
        clientSeed: session.clientSeed,
        startNonce: session.startNonce,
        bet: {
          sessionId: session.id,
          userId: session.userId,
          gameId: session.gameId,
          chainId: session.chainId,
          token: session.token,
          stake: session.stake,
        },
        actions: session.actions.map((a) => ({
          ordinal: a.ordinal,
          action: a.action,
          actor: a.actor,
        })),
        expectedStateHashes: session.actions.map((a) => a.stateHash ?? ""),
      });
    } catch {
      return null;
    }
  }, [revealedServerSeed, session]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/[0.08] bg-[#0b0d12] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Verify this spin</h2>
          <button className="text-white/40 hover:text-white/80" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="space-y-3 text-[12px]">
          <div className="flex justify-between gap-2">
            <span className="text-white/50">Session</span>
            <span className="font-mono text-white/80 break-all">
              {session.id.slice(0, 12)}…{session.id.slice(-6)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-white/50">Total stake</span>
            <span className="font-mono">{fmtMoney(session.stake, token)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-white/50">Total payout</span>
            <span className="font-mono">
              {fmtMoney(session.result!.totalPayoutUnits, token)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-white/50">Spins played</span>
            <span className="font-mono">{session.state.spins.length}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-white/50">Free spins triggered</span>
            <span className="font-mono">
              {session.state.freeSpinsTriggered ? `Yes (${session.state.freeSpinsPlayed})` : "No"}
            </span>
          </div>
        </div>

        {revealedServerSeed && verifier ? (
          <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-400/30">
            <div className="text-emerald-200 text-sm font-semibold mb-1">
              ✓ {verifier.hashOk && verifier.finalStateMatches
                ? "Verified provably fair"
                : "Verification mismatch — escalate"}
            </div>
            <div className="text-[11px] text-white/60">
              Hash check {verifier.hashOk ? "ok" : "FAIL"} · final-state{" "}
              {verifier.finalStateMatches ? "ok" : "FAIL"} · {verifier.stepMatches.length}{" "}
              step(s)
            </div>
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-400/30">
            <div className="text-amber-200 text-sm font-semibold mb-1">
              Server seed not yet revealed
            </div>
            <div className="text-[11px] text-white/60">
              Rotate the seed to reveal it, or use{" "}
              <code className="text-amber-200">/casino/verify</code> after rotation.
            </div>
          </div>
        )}

        <ShareLinkRow session={session} serverSeed={revealedServerSeed} />
      </div>
    </div>
  );
}
