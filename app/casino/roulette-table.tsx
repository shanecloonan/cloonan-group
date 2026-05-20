"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describePlacement,
  newSessionId,
  PAYOUT_TO_ONE,
  persistSettledSession,
  placementFor,
  pocketColor,
  RED_POCKETS,
  rouletteGame,
  ROULETTE_RTP_PERCENT,
  verifySession,
  type ChainAdapter,
  type ChainId,
  type RouletteAction,
  type RoulettePlacement,
  type RoulettePlacementKind,
  type RouletteState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { ShareLinkRow } from "./share-link";
import { useLongPress } from "./use-long-press";

/* ---------------------------------------------------------------------------
 *  Style + money helpers (shared idioms)
 * ------------------------------------------------------------------------- */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls = "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls = "w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
const btnPrimary = "h-10 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  const sign = units < 0n ? -1 : 1;
  const abs = units < 0n ? -units : units;
  const w = abs / denom;
  const f = (abs % denom).toString().padStart(token.decimals, "0");
  return sign * Number(`${w}.${f}`);
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

const LAST_CHIP_KEY = "mf_casino_roul_chip";

/* ---------------------------------------------------------------------------
 *  Placement key → placement
 * ------------------------------------------------------------------------- */

/**
 * The UI maintains a Record<placementKey, amount>. Keys describe both the
 * bet kind and the specific numbers covered, so we can re-derive the full
 * Placement object at spin time. Format:
 *   "straight:17", "red", "dozen_1", "column_2", etc.
 */
type PlacementKey =
  | `straight:${number}`
  | `red` | `black` | `odd` | `even` | `low` | `high`
  | `dozen_1` | `dozen_2` | `dozen_3`
  | `column_1` | `column_2` | `column_3`;

function keyToPlacement(key: PlacementKey, amount: bigint): RoulettePlacement {
  if (key.startsWith("straight:")) {
    const n = Number(key.slice("straight:".length));
    return placementFor("straight", amount, [n]);
  }
  return placementFor(key as RoulettePlacementKind, amount);
}

function describeKey(key: PlacementKey): string {
  if (key.startsWith("straight:")) return `Straight ${key.slice("straight:".length)}`;
  return describePlacement({ kind: key as RoulettePlacementKind, numbers: [] });
}

function payoutForKey(key: PlacementKey): number {
  if (key.startsWith("straight:")) return PAYOUT_TO_ONE.straight;
  return PAYOUT_TO_ONE[key as RoulettePlacementKind];
}

/* ===========================================================================
 *  Roulette table component
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

const CHIP_DENOMS = [1, 5, 25, 100, 500];

export default function RouletteTable({ chainId, token }: Props) {
  const {
    driver,
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

  /* ----- Bet construction ----- */

  const [chip, setChip] = useState<number>(() => {
    if (typeof window === "undefined") return 5;
    const v = Number(window.localStorage.getItem(LAST_CHIP_KEY));
    return Number.isFinite(v) && v > 0 ? v : 5;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_CHIP_KEY, String(chip));
  }, [chip]);

  const [placementsByKey, setPlacementsByKey] = useState<Record<string, bigint>>({});
  const [lastBet, setLastBet] = useState<Record<string, bigint> | null>(null);

  const totalStakeUnits = useMemo(() => {
    let s = 0n;
    for (const v of Object.values(placementsByKey)) s += v;
    return s;
  }, [placementsByKey]);

  const addChip = useCallback(
    (key: PlacementKey) => {
      if (spinning) return;
      const delta = humanToUnits(chip, token);
      setPlacementsByKey((prev) => ({
        ...prev,
        [key]: (prev[key] ?? 0n) + delta,
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chip, token],
  );

  const removeChip = useCallback(
    (key: PlacementKey) => {
      setPlacementsByKey((prev) => {
        const cur = prev[key] ?? 0n;
        const delta = humanToUnits(chip, token);
        const next = cur - delta;
        const out = { ...prev };
        if (next <= 0n) delete out[key];
        else out[key] = next;
        return out;
      });
    },
    [chip, token],
  );

  const clearAll = () => setPlacementsByKey({});

  const rebet = () => {
    if (lastBet) setPlacementsByKey({ ...lastBet });
  };

  /* ----- Spin engine ----- */

  const [spinning, setSpinning] = useState(false);
  const [animPocket, setAnimPocket] = useState<number | null>(null);
  const [lastSession, setLastSession] = useState<Session<RouletteAction, RouletteState> | null>(null);
  const [history, setHistory] = useState<Session<RouletteAction, RouletteState>[]>([]);
  const [recentNumbers, setRecentNumbers] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<RouletteAction, RouletteState> | null>(null);

  const spin = useCallback(async () => {
    if (spinning) return;
    setError(null);
    if (totalStakeUnits <= 0n) {
      setError("Place at least one bet to spin.");
      return;
    }
    if (totalStakeUnits > balance.available) {
      setError("Insufficient balance.");
      return;
    }
    const keys = Object.keys(placementsByKey) as PlacementKey[];
    const placements = keys.map((k) => keyToPlacement(k, placementsByKey[k]));
    setSpinning(true);
    setLastBet({ ...placementsByKey });

    try {
      let s = await driver.openSession(rouletteGame, {
        sessionId: newSessionId(),
        userId,
        gameId: rouletteGame.id,
        chainId,
        token,
        stake: totalStakeUnits,
        config: { placements } as unknown as Record<string, unknown>,
      });
      s = await driver.settleSession(rouletteGame, s);
      const finalPocket = s.state.pocket;

      // Wheel animation — flash a sequence of random pockets, ease into the final one.
      const frames = 40;
      for (let i = 0; i < frames; i++) {
        const t = i / (frames - 1);
        const ease = 1 - Math.pow(1 - t, 4);
        const flicker = Math.floor(Math.random() * 37);
        const interp = i < frames - 6 ? flicker : finalPocket;
        setAnimPocket(interp);
        await new Promise((r) => setTimeout(r, 60 + ease * 60));
      }
      setAnimPocket(finalPocket);
      await new Promise((r) => setTimeout(r, 250));

      setHistory((h) => [s, ...h].slice(0, 30));
      setRecentNumbers((rs) => [finalPocket, ...rs].slice(0, 24));
      setLastSession(s);
      pushHistory({
        game: "roulette",
        stakeUnits: s.result!.totalStakedUnits,
        pnlUnits: s.result!.pnlUnits,
        multiplier: Number(s.result!.totalPayoutUnits) / Math.max(1, Number(s.result!.totalStakedUnits)),
        session: s as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(s as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
      await refreshBalance();
      setSpinning(false);
      // Keep placements for "rebet" but visually clear them.
      setPlacementsByKey({});
    } catch (err) {
      setSpinning(false);
      setError((err as Error).message);
    }
  }, [balance.available, chainId, driver, getSeedPair, placementsByKey, pushHistory, refreshBalance, spinning, token, totalStakeUnits, userId]);

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
      if ((e.key === " " || e.key === "Enter") && !spinning) {
        e.preventDefault();
        void spin();
      } else if (e.key.toLowerCase() === "c") {
        clearAll();
      } else if (e.key.toLowerCase() === "r") {
        rebet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin, spinning, verifyTarget, lastBet]);

  const onDepositPlay = useCallback(async () => {
    await depositPlayMoney(humanToUnits(10_000, token));
  }, [depositPlayMoney, token]);

  const seedPair = getSeedPair();
  const revealSeed = lastRevealedSeed;
  const onRotateSeed = useCallback(() => rotateSeed(), [rotateSeed]);

  /* ----- Render ----- */

  return (
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: betting table */}
      <section className={card + " p-6 lg:col-span-2 flex flex-col"}>
        <Header chainId={chainId} token={token} balance={balance} onDeposit={onDepositPlay} />

        {/* Wheel + recents */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <Wheel pocket={animPocket} spinning={spinning} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 mb-2">Recent spins</div>
            <div className="flex items-center gap-1 flex-wrap">
              {recentNumbers.length === 0 && (
                <span className="text-[11px] text-white/30">— no spins yet —</span>
              )}
              {recentNumbers.map((n, i) => (
                <span
                  key={`${n}-${i}`}
                  className={
                    "w-7 h-7 rounded text-[11px] font-mono font-bold flex items-center justify-center " +
                    colorClass(n)
                  }
                >
                  {n}
                </span>
              ))}
            </div>
            {lastSession && !spinning && (
              <SettlementBanner session={lastSession} token={token} onVerify={() => setVerifyTarget(lastSession)} />
            )}
          </div>
        </div>

        {/* Chip stack picker */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.15em] text-white/40 mr-1">Chip</span>
          {CHIP_DENOMS.map((d) => (
            <button
              key={d}
              type="button"
              disabled={spinning}
              onClick={() => setChip(d)}
              className={
                "h-9 w-12 rounded-full text-xs font-bold border-2 transition-all cursor-pointer " +
                (chip === d
                  ? "bg-emerald-500/20 border-emerald-400 text-emerald-200 scale-105"
                  : "bg-white/[0.03] border-white/[0.12] text-white/70 hover:border-white/[0.25]") +
                (spinning ? " opacity-50 cursor-not-allowed" : "")
              }
            >
              {d}
            </button>
          ))}
          <span className="text-[10px] text-white/40 ml-2 hidden sm:inline">Click any zone to place a chip · right-click to remove</span>
        </div>

        {/* Betting layout */}
        <BettingLayout
          placements={placementsByKey}
          onClick={addChip}
          onRightClick={removeChip}
          disabled={spinning}
          chip={chip}
          token={token}
        />

        {/* Active placements bar */}
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[12px] text-white/70">
            Total bet: <span className="font-mono font-semibold text-white">{fmtMoney(totalStakeUnits, token)}</span>
            {Object.keys(placementsByKey).length > 0 && (
              <span className="ml-2 text-white/40">
                · {Object.keys(placementsByKey).length} placement{Object.keys(placementsByKey).length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={spinning || !lastBet} onClick={rebet}
              className="h-9 px-3 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Rebet · R
            </button>
            <button type="button" disabled={spinning || Object.keys(placementsByKey).length === 0} onClick={clearAll}
              className="h-9 px-3 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear · C
            </button>
            <button type="button" disabled={spinning || totalStakeUnits <= 0n} onClick={spin}
              className={btnPrimary}
            >
              {spinning ? "Spinning…" : "Spin · ⏎"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
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
          <button type="button" onClick={onRotateSeed}
            className="text-[11px] px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
          >
            Rotate seed →
          </button>
        </div>
      </section>

      {/* Right column: panels */}
      <aside className="space-y-4">
        <SidePanel title="Active placements" subtitle={Object.keys(placementsByKey).length === 0 ? "none yet" : `${Object.keys(placementsByKey).length}`}>
          {Object.keys(placementsByKey).length === 0 ? (
            <div className="text-[12px] text-white/40">Click any cell on the table to add a chip.</div>
          ) : (
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
              {(Object.entries(placementsByKey) as [PlacementKey, bigint][]).map(([k, amt]) => (
                <div key={k} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <div className="min-w-0">
                    <div className="text-[12px] text-white/80 truncate">{describeKey(k)}</div>
                    <div className="text-[10px] text-white/40">pays {payoutForKey(k)}:1</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] font-mono">{fmtMoney(amt, token)}</div>
                    <button type="button" onClick={() => removeChip(k)} disabled={spinning}
                      className="text-[10px] text-white/40 hover:text-rose-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      − chip
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SidePanel>

        <SidePanel title="Hot keys" subtitle="play faster">
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-[11px]">
            <KeyHint k="Enter" label="Spin" />
            <KeyHint k="C" label="Clear bets" />
            <KeyHint k="R" label="Rebet last" />
            <KeyHint k="Esc" label="Close modal" />
          </div>
          <div className="mt-3 text-[11px] text-white/50">
            European rules · {ROULETTE_RTP_PERCENT.toFixed(2)}% RTP · house edge 2.70%
          </div>
        </SidePanel>

        <SidePanel title="Recent spins" subtitle={`${history.length}`}>
          {history.length === 0 && <div className="text-[12px] text-white/40">No spins yet.</div>}
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
            {history.map((h) => {
              const won = h.state.totalPayout > h.state.totalStake;
              const push = h.state.totalPayout === h.state.totalStake;
              return (
                <div key={h.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={"w-8 h-8 rounded text-[11px] font-mono font-bold flex items-center justify-center " + colorClass(h.state.pocket)}>
                      {h.state.pocket}
                    </span>
                    <span className="text-[10px] text-white/40 truncate">
                      {h.state.placements.length} bet{h.state.placements.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={"text-[11px] font-mono " + (won ? "text-emerald-300" : push ? "text-white/60" : "text-rose-300")}>
                      {won ? "+" : ""}{fmtMoney(h.result!.pnlUnits, token)}
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
        <RouletteVerifyModal
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
 *  Betting layout — number grid + outside bets
 * ========================================================================= */

function BettingLayout({
  placements,
  onClick,
  onRightClick,
  disabled,
  chip,
  token,
}: {
  placements: Record<string, bigint>;
  onClick: (k: PlacementKey) => void;
  onRightClick: (k: PlacementKey) => void;
  disabled: boolean;
  chip: number;
  token: TokenSpec;
}) {
  // Standard European table: 3 rows × 12 columns of 1-36, with 0 to the left.
  // Top row (display top-to-bottom): 3,6,9,...,36
  // Middle row:                       2,5,8,...,35
  // Bottom row:                       1,4,7,...,34
  const topRow = Array.from({ length: 12 }, (_, i) => 3 + i * 3);
  const midRow = Array.from({ length: 12 }, (_, i) => 2 + i * 3);
  const botRow = Array.from({ length: 12 }, (_, i) => 1 + i * 3);

  return (
    <div className="rounded-xl bg-emerald-950/30 border border-emerald-900/40 p-2 sm:p-3 select-none">
      <RouletteMobileLayout
        placements={placements}
        onClick={onClick}
        onRightClick={onRightClick}
        disabled={disabled}
        chip={chip}
        token={token}
        topRow={topRow}
        midRow={midRow}
        botRow={botRow}
      />

      <p className="hidden sm:block text-[10px] text-white/45 mb-2 px-0.5">
        Click any zone to place a chip · right-click to remove
      </p>
      <div className="hidden sm:block overflow-x-auto overscroll-x-contain -mx-0.5 px-0.5 pb-1">
        <div className="w-max min-w-full">
      <div className="flex gap-2">
        {/* Zero cell */}
        <NumberCell
          number={0}
          stake={placements["straight:0"] as bigint | undefined}
          onClick={() => onClick("straight:0")}
          onRightClick={() => onRightClick("straight:0")}
          disabled={disabled}
          chip={chip}
          token={token}
          big
        />
        {/* 12 columns × 3 rows — fixed width so numbers never overlap */}
        <div className="grid grid-cols-12 grid-rows-3 gap-1 w-[39rem] shrink-0">
          {topRow.map((n) => <NumberCell key={n} number={n} stake={placements[`straight:${n}`] as bigint | undefined} onClick={() => onClick(`straight:${n}`)} onRightClick={() => onRightClick(`straight:${n}`)} disabled={disabled} chip={chip} token={token} />)}
          {midRow.map((n) => <NumberCell key={n} number={n} stake={placements[`straight:${n}`] as bigint | undefined} onClick={() => onClick(`straight:${n}`)} onRightClick={() => onRightClick(`straight:${n}`)} disabled={disabled} chip={chip} token={token} />)}
          {botRow.map((n) => <NumberCell key={n} number={n} stake={placements[`straight:${n}`] as bigint | undefined} onClick={() => onClick(`straight:${n}`)} onRightClick={() => onRightClick(`straight:${n}`)} disabled={disabled} chip={chip} token={token} />)}
        </div>
        {/* Column 2:1 markers (top → col_3, mid → col_2, bot → col_1) */}
        <div className="grid grid-rows-3 gap-0.5 sm:gap-1 w-9 sm:w-12 shrink-0">
          <OutsideCell label="2:1" stake={placements["column_3"] as bigint | undefined} onClick={() => onClick("column_3")} onRightClick={() => onRightClick("column_3")} disabled={disabled} chip={chip} token={token} small />
          <OutsideCell label="2:1" stake={placements["column_2"] as bigint | undefined} onClick={() => onClick("column_2")} onRightClick={() => onRightClick("column_2")} disabled={disabled} chip={chip} token={token} small />
          <OutsideCell label="2:1" stake={placements["column_1"] as bigint | undefined} onClick={() => onClick("column_1")} onRightClick={() => onRightClick("column_1")} disabled={disabled} chip={chip} token={token} small />
        </div>
      </div>

      {/* Dozens row */}
      <div className="mt-1.5 sm:mt-2 flex gap-1 sm:gap-2">
        <div className="w-9 sm:w-12 shrink-0" aria-hidden />
        <div className="grid grid-cols-3 gap-1 w-[33.5rem] shrink-0">
        <OutsideCell label="1st 12" stake={placements["dozen_1"] as bigint | undefined} onClick={() => onClick("dozen_1")} onRightClick={() => onRightClick("dozen_1")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="2nd 12" stake={placements["dozen_2"] as bigint | undefined} onClick={() => onClick("dozen_2")} onRightClick={() => onRightClick("dozen_2")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="3rd 12" stake={placements["dozen_3"] as bigint | undefined} onClick={() => onClick("dozen_3")} onRightClick={() => onRightClick("dozen_3")} disabled={disabled} chip={chip} token={token} />
        </div>
        <div className="w-9 sm:w-12 shrink-0" aria-hidden />
      </div>

      <div className="mt-1.5 sm:mt-2 flex gap-1 sm:gap-2">
        <div className="w-9 sm:w-12 shrink-0" aria-hidden />
        <div className="grid grid-cols-6 gap-1 w-[33.5rem] shrink-0">
        <OutsideCell label="1-18" stake={placements["low"] as bigint | undefined} onClick={() => onClick("low")} onRightClick={() => onRightClick("low")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="EVEN" stake={placements["even"] as bigint | undefined} onClick={() => onClick("even")} onRightClick={() => onRightClick("even")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="RED" stake={placements["red"] as bigint | undefined} onClick={() => onClick("red")} onRightClick={() => onRightClick("red")} disabled={disabled} chip={chip} token={token} accent="red" />
        <OutsideCell label="BLK" stake={placements["black"] as bigint | undefined} onClick={() => onClick("black")} onRightClick={() => onRightClick("black")} disabled={disabled} chip={chip} token={token} accent="black" />
        <OutsideCell label="ODD" stake={placements["odd"] as bigint | undefined} onClick={() => onClick("odd")} onRightClick={() => onRightClick("odd")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="19-36" stake={placements["high"] as bigint | undefined} onClick={() => onClick("high")} onRightClick={() => onRightClick("high")} disabled={disabled} chip={chip} token={token} />
        </div>
        <div className="w-9 sm:w-12 shrink-0" aria-hidden />
      </div>
        </div>
      </div>
    </div>
  );
}

/** Touch-first layout: 6-column number grid + full-width outside bets (no horizontal squeeze). */
function RouletteMobileLayout({
  placements,
  onClick,
  onRightClick,
  disabled,
  chip,
  token,
  topRow,
  midRow,
  botRow,
}: {
  placements: Record<string, bigint>;
  onClick: (k: PlacementKey) => void;
  onRightClick: (k: PlacementKey) => void;
  disabled: boolean;
  chip: number;
  token: TokenSpec;
  topRow: number[];
  midRow: number[];
  botRow: number[];
}) {
  const allNums = [...topRow, ...midRow, ...botRow];
  return (
    <div className="sm:hidden space-y-3 mb-1">
      <p className="text-[10px] text-white/45">Tap to bet · hold to remove</p>
      <NumberCell
        number={0}
        stake={placements["straight:0"] as bigint | undefined}
        onClick={() => onClick("straight:0")}
        onRightClick={() => onRightClick("straight:0")}
        disabled={disabled}
        chip={chip}
        token={token}
        big
        compact
      />
      <div className="grid grid-cols-6 gap-1.5">
        {allNums.map((n) => (
          <NumberCell
            key={n}
            number={n}
            compact
            stake={placements[`straight:${n}`] as bigint | undefined}
            onClick={() => onClick(`straight:${n}`)}
            onRightClick={() => onRightClick(`straight:${n}`)}
            disabled={disabled}
            chip={chip}
            token={token}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell label="1st 12" stake={placements["dozen_1"] as bigint | undefined} onClick={() => onClick("dozen_1")} onRightClick={() => onRightClick("dozen_1")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="2nd 12" stake={placements["dozen_2"] as bigint | undefined} onClick={() => onClick("dozen_2")} onRightClick={() => onRightClick("dozen_2")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="3rd 12" stake={placements["dozen_3"] as bigint | undefined} onClick={() => onClick("dozen_3")} onRightClick={() => onRightClick("dozen_3")} disabled={disabled} chip={chip} token={token} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell label="1-18" stake={placements["low"] as bigint | undefined} onClick={() => onClick("low")} onRightClick={() => onRightClick("low")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="EVEN" stake={placements["even"] as bigint | undefined} onClick={() => onClick("even")} onRightClick={() => onRightClick("even")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell label="ODD" stake={placements["odd"] as bigint | undefined} onClick={() => onClick("odd")} onRightClick={() => onRightClick("odd")} disabled={disabled} chip={chip} token={token} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell label="RED" stake={placements["red"] as bigint | undefined} onClick={() => onClick("red")} onRightClick={() => onRightClick("red")} disabled={disabled} chip={chip} token={token} accent="red" />
        <OutsideCell label="BLK" stake={placements["black"] as bigint | undefined} onClick={() => onClick("black")} onRightClick={() => onRightClick("black")} disabled={disabled} chip={chip} token={token} accent="black" />
        <OutsideCell label="19-36" stake={placements["high"] as bigint | undefined} onClick={() => onClick("high")} onRightClick={() => onRightClick("high")} disabled={disabled} chip={chip} token={token} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell label="Col 1" stake={placements["column_1"] as bigint | undefined} onClick={() => onClick("column_1")} onRightClick={() => onRightClick("column_1")} disabled={disabled} chip={chip} token={token} small />
        <OutsideCell label="Col 2" stake={placements["column_2"] as bigint | undefined} onClick={() => onClick("column_2")} onRightClick={() => onRightClick("column_2")} disabled={disabled} chip={chip} token={token} small />
        <OutsideCell label="Col 3" stake={placements["column_3"] as bigint | undefined} onClick={() => onClick("column_3")} onRightClick={() => onRightClick("column_3")} disabled={disabled} chip={chip} token={token} small />
      </div>
    </div>
  );
}

function NumberCell({
  number,
  stake,
  onClick,
  onRightClick,
  disabled,
  chip,
  token,
  big,
  compact,
}: {
  number: number;
  stake?: bigint;
  onClick: () => void;
  onRightClick: () => void;
  disabled: boolean;
  chip: number;
  token: TokenSpec;
  big?: boolean;
  compact?: boolean;
}) {
  const color = pocketColor(number);
  const has = stake !== undefined && stake > 0n;
  const longPress = useLongPress(onRightClick);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick();
      }}
      {...longPress}
      className={
        "relative font-bold tabular-nums transition-all rounded-md border flex items-center justify-center " +
        (compact
          ? big
            ? "w-full h-12 text-sm"
            : "aspect-square w-full min-h-[2.25rem] text-[11px]"
          : big
            ? "w-9 sm:w-12 h-[5.5rem] sm:h-[6.5rem] shrink-0 text-sm"
            : "h-9 w-full min-w-[2.125rem] text-xs sm:text-sm") +
        (color === "red"
          ? "bg-rose-600/40 border-rose-500/40 text-rose-100 hover:bg-rose-600/60"
          : color === "black"
            ? "bg-slate-900/70 border-slate-700/40 text-slate-200 hover:bg-slate-900"
            : "bg-emerald-700/40 border-emerald-600/40 text-emerald-100 hover:bg-emerald-700/60") +
        (disabled ? " cursor-not-allowed opacity-70" : " cursor-pointer active:scale-95")
      }
      title={`Tap: place ${chip} ${token.symbol} · hold / right-click: remove`}
    >
      {number}
      {has && <ChipBadge stake={stake!} token={token} />}
    </button>
  );
}

function OutsideCell({
  label,
  stake,
  onClick,
  onRightClick,
  disabled,
  chip,
  token,
  small,
  accent,
}: {
  label: string;
  stake?: bigint;
  onClick: () => void;
  onRightClick: () => void;
  disabled: boolean;
  chip: number;
  token: TokenSpec;
  small?: boolean;
  accent?: "red" | "black";
}) {
  const has = stake !== undefined && stake > 0n;
  const longPress = useLongPress(onRightClick);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick();
      }}
      {...longPress}
      className={
        "relative font-semibold text-[10px] sm:text-[11px] uppercase tracking-[0.08em] sm:tracking-[0.1em] rounded-md border transition-all " +
        (small ? "h-8 px-0.5 sm:px-1" : "h-9 sm:h-10 px-1 sm:px-2") +
        " " +
        (accent === "red"
          ? "bg-rose-700/30 border-rose-500/30 text-rose-100 hover:bg-rose-700/50"
          : accent === "black"
            ? "bg-slate-900/50 border-slate-700/30 text-slate-200 hover:bg-slate-900/80"
            : "bg-emerald-900/30 border-emerald-700/30 text-emerald-100 hover:bg-emerald-900/50") +
        (disabled ? " cursor-not-allowed opacity-70" : " cursor-pointer active:scale-95")
      }
      title={`Tap: place ${chip} ${token.symbol} · hold / right-click: remove`}
    >
      {label}
      {has && <ChipBadge stake={stake!} token={token} />}
    </button>
  );
}

function ChipBadge({ stake, token }: { stake: bigint; token: TokenSpec }) {
  const human = unitsToHuman(stake, token);
  return (
    <span className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-amber-400 border border-amber-200 sm:border-2 text-amber-950 text-[8px] sm:text-[10px] font-bold flex items-center justify-center shadow-md">
      {human < 1000 ? human : `${(human / 1000).toFixed(human < 10000 ? 1 : 0)}k`}
    </span>
  );
}

/* ===========================================================================
 *  Wheel + supporting components
 * ========================================================================= */

function Wheel({ pocket, spinning }: { pocket: number | null; spinning: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="relative w-32 h-32 shrink-0">
      <div
        ref={ref}
        className={
          "w-full h-full rounded-full border-4 flex items-center justify-center transition-all " +
          (spinning
            ? "border-emerald-300/60 animate-pulse shadow-[0_0_24px_rgba(52,211,153,0.4)]"
            : pocket !== null
              ? "border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              : "border-white/10") +
          " " +
          (pocket !== null ? colorClass(pocket) : "bg-gradient-to-br from-slate-700 to-slate-900")
        }
      >
        <div className="text-3xl font-bold font-mono">
          {pocket !== null ? pocket : "?"}
        </div>
      </div>
    </div>
  );
}

function colorClass(n: number): string {
  if (n === 0) return "bg-emerald-700 text-emerald-100 border-emerald-500/40";
  return RED_POCKETS.has(n)
    ? "bg-rose-600 text-rose-50 border-rose-400/40"
    : "bg-slate-900 text-slate-100 border-slate-600/40";
}

function SettlementBanner({
  session,
  token,
  onVerify,
}: {
  session: Session<RouletteAction, RouletteState>;
  token: TokenSpec;
  onVerify: () => void;
}) {
  const r = session.result;
  if (!r) return null;
  const won = r.pnlUnits > 0n;
  const push = r.pnlUnits === 0n;
  return (
    <div
      className={
        "mt-3 px-3 py-2 rounded-lg border text-sm flex items-center justify-between gap-2 " +
        (won
          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
          : push
            ? "border-white/[0.08] bg-white/[0.03] text-white/70"
            : "border-rose-400/40 bg-rose-500/10 text-rose-300")
      }
    >
      <div className="font-semibold">
        {won ? "+" : ""}{fmtMoney(r.pnlUnits, token)}
      </div>
      <button type="button" onClick={onVerify} className="text-[11px] underline-offset-2 hover:underline cursor-pointer">
        verify →
      </button>
    </div>
  );
}

function Header({ chainId, token, balance, onDeposit }: {
  chainId: ChainId; token: TokenSpec;
  balance: { available: bigint; locked: bigint };
  onDeposit: () => void;
}) {
  const isDev = chainId === "dev-mock";
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Playing on</div>
        <div className="text-base font-semibold">{chainId} · <span className="text-emerald-300">{token.symbol}</span></div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Available</div>
        <div className="text-xl font-bold font-mono text-white">{fmtMoney(balance.available, token)}</div>
        {balance.locked > 0n && <div className="text-[11px] text-white/40 font-mono">{fmtMoney(balance.locked, token)} locked</div>}
        {isDev && (
          <button type="button" onClick={onDeposit}
            className="mt-1 text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer underline-offset-2 hover:underline"
          >+ Add 10,000 play money</button>
        )}
      </div>
    </div>
  );
}

function SidePanel({
  title, subtitle, right, children,
}: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
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

/* ===========================================================================
 *  Verify modal
 * ========================================================================= */

function RouletteVerifyModal({
  session, revealedServerSeed, token, onClose,
}: {
  session: Session<RouletteAction, RouletteState>;
  revealedServerSeed: string | null;
  token: TokenSpec;
  onClose: () => void;
}) {
  const [inputSeed, setInputSeed] = useState(revealedServerSeed ?? "");

  const verification = useMemo(() => {
    if (!inputSeed) return null;
    try {
      return verifySession<RouletteAction, RouletteState>({
        game: rouletteGame,
        serverSeed: inputSeed,
        serverSeedHash: session.serverSeedHash,
        clientSeed: session.clientSeed,
        startNonce: session.startNonce,
        bet: {
          sessionId: session.id,
          userId: session.userId,
          gameId: rouletteGame.id,
          chainId: session.chainId,
          token: session.token,
          stake: session.stake,
          config: { placements: session.state.placements } as unknown as Record<string, unknown>,
        },
        actions: session.actions.map((a) => ({ ordinal: a.ordinal, action: a.action, actor: a.actor })),
        expectedStateHashes: session.actions.map((a) => a.stateHash ?? ""),
      });
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [session, inputSeed]);

  const allOk = verification && !("error" in verification) && verification.hashOk && verification.finalStateMatches && verification.stepMatches.every(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0c0d12] border border-white/[0.08] p-6 space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Provable fairness · client-side replay</div>
            <h2 className="text-xl font-semibold mt-1">Verify spin</h2>
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white cursor-pointer text-2xl leading-none">×</button>
        </header>

        <p className="text-sm text-white/60 leading-relaxed">
          Paste the revealed <span className="text-emerald-300">server seed</span>. We re-derive
          the wheel spin using <span className="font-mono">nextInt(37)</span> (rejection-sampled
          for zero modulo bias).
        </p>

        <div>
          <label className={labelCls}>Server seed (hex)</label>
          <input type="text" className={inputCls + " font-mono"} value={inputSeed} onChange={(e) => setInputSeed(e.target.value.trim())}
            placeholder="Rotate the seed to reveal yours, then paste here" />
        </div>

        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <Field label="Pocket" value={`${session.state.pocket} (${session.state.pocketColor})`} />
          <Field label="Placements" value={String(session.state.placements.length)} />
          <Field label="Total staked" value={fmtMoney(session.state.totalStake, token)} />
          <Field label="Total paid" value={fmtMoney(session.state.totalPayout, token)} />
        </div>

        {!verification && <div className="text-[12px] text-white/40">Enter a server seed to run the replay.</div>}
        {verification && "error" in verification && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
            Verifier threw: {verification.error}
          </div>
        )}
        {verification && !("error" in verification) && (
          <div className="space-y-3">
            <CheckRow ok={verification.hashOk} label="SHA-256(seed) == published hash" />
            <CheckRow ok={verification.finalStateMatches} label="Replayed spin matches recorded outcome" />
            <CheckRow ok={verification.stepMatches.every(Boolean)} label={`All ${verification.stepMatches.length} per-step hashes match`} />
            <div className={"text-center py-2 rounded-lg font-semibold " + (allOk
              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
              : "bg-rose-500/15 text-rose-300 border border-rose-400/30")}>
              {allOk ? "✓ Verified provably fair" : "✗ Verification failed"}
            </div>
          </div>
        )}

        <div className="text-[11px] text-white/40">
          Settled at {new Date(session.updatedAt).toLocaleString()} · Result {fmtMoney(session.result?.pnlUnits ?? 0n, token)}.
        </div>

        <ShareLinkRow session={session} serverSeed={revealedServerSeed} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">{label}</div>
      <div className="text-[12px] text-white/80 break-all font-mono">{value}</div>
    </div>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={"w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold " + (ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "text-white/80" : "text-rose-200"}>{label}</span>
    </div>
  );
}
