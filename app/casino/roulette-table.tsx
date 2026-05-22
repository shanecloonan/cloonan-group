"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  columnNumbers,
  cornerKey,
  sixLineKey,
  describePlacement,
  newSessionId,
  parseInsideKey,
  PAYOUT_TO_ONE,
  persistSettledSession,
  placementFor,
  pocketColor,
  RED_POCKETS,
  rouletteGame,
  ROULETTE_RTP_PERCENT,
  insideBetsForPocket,
  splitKey,
  streetKey,
  type ChainAdapter,
  type ChainId,
  type InsidePlacementKey,
  type PlacementKey,
  type RouletteAction,
  type RoulettePlacement,
  type RoulettePlacementKind,
  type RouletteState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { ShareLinkRow } from "./share-link";
import { useLongPress } from "./use-long-press";
import { btnPrimary, card, inputCls, labelCls } from "./casino-ui";
import {
  ErrorBanner,
  FairnessStrip,
  fmtMoney as fmtMoneyKit,
  humanToUnits,
  LegacyThreeColLayout,
  RevealedSeedCard,
  SettlementBanner,
  TableBalanceHeader,
  unitsToHuman,
} from "./table-kit";

const fmtMoney = (units: bigint, token: TokenSpec, digits = 2) => fmtMoneyKit(units, token, digits);

const LAST_CHIP_KEY = "mf_casino_roul_chip";

/* ---------------------------------------------------------------------------
 *  Placement key → placement
 * ------------------------------------------------------------------------- */

function isInsideKey(key: PlacementKey): key is InsidePlacementKey {
  return (
    key.startsWith("split:") ||
    key.startsWith("street:") ||
    key.startsWith("corner:") ||
    key.startsWith("six_line:")
  );
}

function keyToPlacement(key: PlacementKey, amount: bigint): RoulettePlacement {
  if (key.startsWith("straight:")) {
    const n = Number(key.slice("straight:".length));
    return placementFor("straight", amount, [n]);
  }
  if (isInsideKey(key)) {
    const { kind, numbers } = parseInsideKey(key);
    return placementFor(kind, amount, numbers);
  }
  return placementFor(key as RoulettePlacementKind, amount);
}

function describeKey(key: PlacementKey): string {
  if (key.startsWith("straight:")) return `Straight ${key.slice("straight:".length)}`;
  if (isInsideKey(key)) {
    const { kind, numbers } = parseInsideKey(key);
    return describePlacement({ kind, numbers });
  }
  return describePlacement(placementFor(key as RoulettePlacementKind, 1n));
}

function payoutForKey(key: PlacementKey): number {
  if (key.startsWith("straight:")) return PAYOUT_TO_ONE.straight;
  if (key.startsWith("split:")) return PAYOUT_TO_ONE.split;
  if (key.startsWith("street:")) return PAYOUT_TO_ONE.street;
  if (key.startsWith("corner:")) return PAYOUT_TO_ONE.corner;
  if (key.startsWith("six_line:")) return PAYOUT_TO_ONE.six_line;
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
  const [mobileFocus, setMobileFocus] = useState<number | null>(null);

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
      setMobileFocus(null);
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
    <LegacyThreeColLayout>
      {/* Left column: betting table */}
      <section className={card + " p-6 lg:col-span-2 flex flex-col"}>
        <TableBalanceHeader
          chainId={chainId}
          token={token}
          balance={balance}
          onDeposit={onDepositPlay}
        />

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
            {lastSession && !spinning && lastSession.result && (
              <div className="mt-3 space-y-1">
                <SettlementBanner
                  headline={`Pocket ${lastSession.state.pocket}`}
                  pnl={lastSession.result.pnlUnits}
                  token={token}
                />
                <button
                  type="button"
                  onClick={() => setVerifyTarget(lastSession)}
                  className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer"
                >
                  verify →
                </button>
              </div>
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
          mobileFocus={mobileFocus}
          onMobileFocus={setMobileFocus}
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
            <button
              type="button"
              disabled={spinning || totalStakeUnits <= 0n}
              onClick={spin}
              className={btnPrimary + " w-full sm:w-auto"}
            >
              {spinning ? "Spinning…" : "Spin · ⏎"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}

        <FairnessStrip seedPair={seedPair} onRotateSeed={onRotateSeed} />
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
          <RevealedSeedCard serverSeed={revealSeed.serverSeed} onDismiss={dismissRevealedSeed} />
        )}
      </aside>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Verify spin"
          description={
            <>
              Paste the revealed <span className="text-emerald-300">server seed</span>. We re-derive the wheel
              spin with <span className="font-mono">nextInt(37)</span> (rejection-sampled, zero modulo bias).
            </>
          }
          session={verifyTarget}
          revealedServerSeed={pickRevealedServerSeed(seedPair, revealSeed, verifyTarget)}
          token={token}
          onClose={() => setVerifyTarget(null)}
          resultLabel="Replayed spin matches recorded outcome"
          extraFields={
            <div className="grid grid-cols-2 gap-3">
              <VerifyField label="Pocket" value={`${verifyTarget.state.pocket} (${verifyTarget.state.pocketColor})`} />
              <VerifyField label="Placements" value={String(verifyTarget.state.placements.length)} />
              <VerifyField label="Total staked" value={fmtMoney(verifyTarget.state.totalStake, token)} />
              <VerifyField label="Total paid" value={fmtMoney(verifyTarget.state.totalPayout, token)} />
            </div>
          }
          runVerify={(serverSeed) =>
            runSessionVerify(rouletteGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: rouletteGame.id,
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { placements: verifyTarget.state.placements } as Record<string, unknown>,
            })
          }
        />
      )}
    </LegacyThreeColLayout>
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
  mobileFocus,
  onMobileFocus,
}: {
  placements: Record<string, bigint>;
  onClick: (k: PlacementKey) => void;
  onRightClick: (k: PlacementKey) => void;
  disabled: boolean;
  chip: number;
  token: TokenSpec;
  mobileFocus: number | null;
  onMobileFocus: (n: number | null) => void;
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
        mobileFocus={mobileFocus}
        onMobileFocus={onMobileFocus}
      />

      <p className="hidden md:block text-[10px] text-white/45 mb-2 px-0.5">
        Click numbers, gold edges (split/street), or corners · right-click to remove
      </p>
      <div className="hidden md:block overflow-x-auto overscroll-x-contain -mx-0.5 px-0.5 pb-1">
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
        <RouletteInsideGrid
          placements={placements}
          onClick={onClick}
          onRightClick={onRightClick}
          disabled={disabled}
          chip={chip}
          token={token}
        />
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

/** Touch-first layout: three flex rows (no grid squeeze) + stacked outside bets. */
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
  mobileFocus,
  onMobileFocus,
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
  mobileFocus: number | null;
  onMobileFocus: (n: number | null) => void;
}) {
  const clearPocket = (n: number) => {
    for (const opt of insideBetsForPocket(n)) {
      if (placements[opt.key]) onRightClick(opt.key);
    }
  };

  const row = (nums: number[]) => (
    <div className="grid grid-cols-12 gap-[2px] w-full">
      {nums.map((n) => (
        <NumberCell
          key={n}
          number={n}
          compact
          gridCell
          selected={mobileFocus === n}
          stake={stakeOnPocket(placements, n)}
          onClick={() => onMobileFocus(mobileFocus === n ? null : n)}
          onRightClick={() => clearPocket(n)}
          disabled={disabled}
          chip={chip}
          token={token}
        />
      ))}
    </div>
  );

  return (
    <div className="md:hidden space-y-3 mb-1 w-full max-w-full overflow-hidden">
      <p className="text-[10px] text-white/45">
        Tap a number, pick inside bets below · hold number to clear its chips
      </p>
      {mobileFocus !== null && (
        <RouletteMobileInsideBar
          pocket={mobileFocus}
          placements={placements}
          disabled={disabled}
          onPlace={onClick}
          onClose={() => onMobileFocus(null)}
        />
      )}
      <div className="flex gap-1.5 w-full">
        <NumberCell
          number={0}
          selected={mobileFocus === 0}
          stake={stakeOnPocket(placements, 0)}
          onClick={() => onMobileFocus(mobileFocus === 0 ? null : 0)}
          onRightClick={() => clearPocket(0)}
          disabled={disabled}
          chip={chip}
          token={token}
          compact
          zeroRail
        />
        <div className="flex-1 min-w-0 space-y-[2px]">
          {row(topRow)}
          {row(midRow)}
          {row(botRow)}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell compact label="1st 12" stake={placements["dozen_1"] as bigint | undefined} onClick={() => onClick("dozen_1")} onRightClick={() => onRightClick("dozen_1")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell compact label="2nd 12" stake={placements["dozen_2"] as bigint | undefined} onClick={() => onClick("dozen_2")} onRightClick={() => onRightClick("dozen_2")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell compact label="3rd 12" stake={placements["dozen_3"] as bigint | undefined} onClick={() => onClick("dozen_3")} onRightClick={() => onRightClick("dozen_3")} disabled={disabled} chip={chip} token={token} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell compact label="1-18" stake={placements["low"] as bigint | undefined} onClick={() => onClick("low")} onRightClick={() => onRightClick("low")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell compact label="EVEN" stake={placements["even"] as bigint | undefined} onClick={() => onClick("even")} onRightClick={() => onRightClick("even")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell compact label="ODD" stake={placements["odd"] as bigint | undefined} onClick={() => onClick("odd")} onRightClick={() => onRightClick("odd")} disabled={disabled} chip={chip} token={token} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell compact label="RED" stake={placements["red"] as bigint | undefined} onClick={() => onClick("red")} onRightClick={() => onRightClick("red")} disabled={disabled} chip={chip} token={token} accent="red" />
        <OutsideCell compact label="BLK" stake={placements["black"] as bigint | undefined} onClick={() => onClick("black")} onRightClick={() => onRightClick("black")} disabled={disabled} chip={chip} token={token} accent="black" />
        <OutsideCell compact label="19-36" stake={placements["high"] as bigint | undefined} onClick={() => onClick("high")} onRightClick={() => onRightClick("high")} disabled={disabled} chip={chip} token={token} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <OutsideCell compact small label="Col 1" stake={placements["column_1"] as bigint | undefined} onClick={() => onClick("column_1")} onRightClick={() => onRightClick("column_1")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell compact small label="Col 2" stake={placements["column_2"] as bigint | undefined} onClick={() => onClick("column_2")} onRightClick={() => onRightClick("column_2")} disabled={disabled} chip={chip} token={token} />
        <OutsideCell compact small label="Col 3" stake={placements["column_3"] as bigint | undefined} onClick={() => onClick("column_3")} onRightClick={() => onRightClick("column_3")} disabled={disabled} chip={chip} token={token} />
      </div>
    </div>
  );
}

/** Desktop 12×3 grid with split / street / corner hit zones. */
function RouletteInsideGrid({
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
  return (
    <div className="grid grid-cols-12 gap-1 w-[39rem] shrink-0">
      {Array.from({ length: 12 }, (_, col) => {
        const { top, mid, bot } = columnNumbers(col);
        const next = col < 11 ? columnNumbers(col + 1) : null;
        const sk = (a: number, b: number) => splitKey(a, b);
        const street = streetKey(bot, mid, top);
        return (
          <div key={col} className="relative grid grid-rows-[1fr_auto_1fr_auto_1fr] gap-0 min-h-[6.5rem]">
            <NumberCell
              number={top}
              stake={placements[`straight:${top}`] as bigint | undefined}
              onClick={() => onClick(`straight:${top}`)}
              onRightClick={() => onRightClick(`straight:${top}`)}
              disabled={disabled}
              chip={chip}
              token={token}
            />
            <InsideEdge
              placementKey={sk(top, mid)}
              stake={placements[sk(top, mid)]}
              onClick={onClick}
              onRightClick={onRightClick}
              disabled={disabled}
            />
            <NumberCell
              number={mid}
              stake={placements[`straight:${mid}`] as bigint | undefined}
              onClick={() => onClick(`straight:${mid}`)}
              onRightClick={() => onRightClick(`straight:${mid}`)}
              disabled={disabled}
              chip={chip}
              token={token}
            />
            <InsideEdge
              placementKey={sk(mid, bot)}
              stake={placements[sk(mid, bot)]}
              onClick={onClick}
              onRightClick={onRightClick}
              disabled={disabled}
            />
            <NumberCell
              number={bot}
              stake={placements[`straight:${bot}`] as bigint | undefined}
              onClick={() => onClick(`straight:${bot}`)}
              onRightClick={() => onRightClick(`straight:${bot}`)}
              disabled={disabled}
              chip={chip}
              token={token}
            />
            <button
              type="button"
              disabled={disabled}
              title="Street (3 numbers)"
              onClick={() => onClick(street)}
              onContextMenu={(e) => {
                e.preventDefault();
                onRightClick(street);
              }}
              className={
                "absolute -left-1 top-1/2 -translate-y-1/2 z-20 w-1.5 h-10 rounded-full " +
                (placements[street]
                  ? "bg-amber-400/80"
                  : "bg-amber-400/25 hover:bg-amber-400/50 border border-amber-400/40") +
                (disabled ? " opacity-40 cursor-not-allowed" : " cursor-pointer")
              }
            />
            {next && (
              <>
                {(() => {
                  const six = sixLineKey(bot, mid, top, next.bot, next.mid, next.top);
                  return (
                    <button
                      type="button"
                      disabled={disabled}
                      title="Six line (6 numbers)"
                      onClick={() => onClick(six)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onRightClick(six);
                      }}
                      className={
                        "absolute -right-0.5 top-[14%] bottom-[14%] z-[15] w-1 rounded-sm " +
                        (placements[six]
                          ? "bg-amber-400/85"
                          : "bg-violet-400/25 hover:bg-violet-400/50 border border-violet-400/35") +
                        (disabled ? " opacity-40 cursor-not-allowed" : " cursor-pointer")
                      }
                    />
                  );
                })()}
                <InsideSideEdge
                  placementKey={sk(top, next.top)}
                  stake={placements[sk(top, next.top)]}
                  onClick={onClick}
                  onRightClick={onRightClick}
                  disabled={disabled}
                  className="top-[6%] h-[26%]"
                />
                <InsideSideEdge
                  placementKey={sk(mid, next.mid)}
                  stake={placements[sk(mid, next.mid)]}
                  onClick={onClick}
                  onRightClick={onRightClick}
                  disabled={disabled}
                  className="top-[38%] h-[26%]"
                />
                <InsideSideEdge
                  placementKey={sk(bot, next.bot)}
                  stake={placements[sk(bot, next.bot)]}
                  onClick={onClick}
                  onRightClick={onRightClick}
                  disabled={disabled}
                  className="top-[70%] h-[26%]"
                />
                <button
                  type="button"
                  disabled={disabled}
                  title="Corner (4 numbers)"
                  onClick={() => onClick(cornerKey(bot, mid, next.bot, next.mid))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onRightClick(cornerKey(bot, mid, next.bot, next.mid));
                  }}
                  className={
                    "absolute -right-1 bottom-0 z-20 w-2.5 h-2.5 rounded-sm " +
                    (placements[cornerKey(bot, mid, next.bot, next.mid)]
                      ? "bg-amber-300"
                      : "bg-amber-400/30 hover:bg-amber-400/60 border border-amber-400/50") +
                    (disabled ? " opacity-40 cursor-not-allowed" : " cursor-pointer")
                  }
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InsideEdge({
  placementKey,
  stake,
  onClick,
  onRightClick,
  disabled,
}: {
  placementKey: PlacementKey;
  stake?: bigint;
  onClick: (k: PlacementKey) => void;
  onRightClick: (k: PlacementKey) => void;
  disabled: boolean;
}) {
  const has = stake !== undefined && stake > 0n;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(placementKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick(placementKey);
      }}
      className={
        "h-1 w-full shrink-0 rounded-sm z-10 " +
        (has ? "bg-amber-400/70" : "bg-amber-400/20 hover:bg-amber-400/45 border border-amber-400/25") +
        (disabled ? " cursor-not-allowed opacity-50" : " cursor-pointer")
      }
      title="Split"
    />
  );
}

function InsideSideEdge({
  placementKey,
  stake,
  onClick,
  onRightClick,
  disabled,
  className,
}: {
  placementKey: PlacementKey;
  stake?: bigint;
  onClick: (k: PlacementKey) => void;
  onRightClick: (k: PlacementKey) => void;
  disabled: boolean;
  className: string;
}) {
  const has = stake !== undefined && stake > 0n;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(placementKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick(placementKey);
      }}
      className={
        "absolute -right-0.5 w-1.5 z-20 rounded-sm " +
        className +
        " " +
        (has ? "bg-amber-400/70" : "bg-amber-400/20 hover:bg-amber-400/45 border border-amber-400/25") +
        (disabled ? " cursor-not-allowed opacity-50" : " cursor-pointer")
      }
      title="Split"
    />
  );
}

/** Sum stakes for any placement touching this pocket. */
function stakeOnPocket(placements: Record<string, bigint>, n: number): bigint | undefined {
  let sum = 0n;
  let any = false;
  for (const opt of insideBetsForPocket(n)) {
    const v = placements[opt.key];
    if (v && v > 0n) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : undefined;
}

function RouletteMobileInsideBar({
  pocket,
  placements,
  disabled,
  onPlace,
  onClose,
}: {
  pocket: number;
  placements: Record<string, bigint>;
  disabled: boolean;
  onPlace: (k: PlacementKey) => void;
  onClose: () => void;
}) {
  const options = insideBetsForPocket(pocket);
  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-amber-100">
          Inside bets on <span className="font-mono">{pocket}</span>
        </span>
        <button
          type="button"
          className="text-[10px] text-white/50 hover:text-white cursor-pointer"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const has = placements[opt.key] !== undefined && placements[opt.key]! > 0n;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={disabled}
              onClick={() => onPlace(opt.key)}
              className={
                "min-h-10 touch-manipulation px-2.5 py-1.5 rounded-lg text-[10px] font-medium border transition-all " +
                (has
                  ? "border-amber-400/60 bg-amber-500/25 text-amber-50"
                  : "border-white/15 bg-black/30 text-white/80 hover:border-amber-400/40") +
                (disabled ? " opacity-50 cursor-not-allowed" : " cursor-pointer active:scale-95")
              }
            >
              {opt.label}
              <span className="text-white/45 ml-1">{opt.payoutToOne}:1</span>
            </button>
          );
        })}
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
  fixed,
  gridCell,
  zeroRail,
  selected,
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
  /** Fixed 2rem width on mobile flex rows — prevents digit overlap. */
  fixed?: boolean;
  /** Equal-width cell in 12-column mobile grid. */
  gridCell?: boolean;
  /** Zero pocket beside the number grid on mobile. */
  zeroRail?: boolean;
  selected?: boolean;
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
          ? zeroRail
            ? "w-11 shrink-0 min-h-[5.75rem] text-sm self-stretch"
            : gridCell
              ? "w-full min-w-0 h-9 text-[10px] leading-none"
              : big
                ? "w-full h-12 text-sm"
                : fixed
                  ? "w-8 h-9 shrink-0 text-[11px] leading-none pb-1"
                  : "aspect-square w-full min-h-[2rem] max-h-[2.75rem] text-[10px] leading-none overflow-hidden"
          : big
            ? "w-9 sm:w-12 h-[5.5rem] sm:h-[6.5rem] shrink-0 text-sm"
            : "h-9 w-full min-w-[2.125rem] text-xs sm:text-sm") +
        (color === "red"
          ? "bg-rose-600/40 border-rose-500/40 text-rose-100 hover:bg-rose-600/60"
          : color === "black"
            ? "bg-slate-900/70 border-slate-700/40 text-slate-200 hover:bg-slate-900"
            : "bg-emerald-700/40 border-emerald-600/40 text-emerald-100 hover:bg-emerald-700/60") +
        (selected ? " ring-2 ring-amber-400 ring-offset-1 ring-offset-emerald-950 " : "") +
        (disabled ? " cursor-not-allowed opacity-70" : " cursor-pointer active:scale-95")
      }
      title={
        compact
          ? `Select · hold to clear chips on ${number}`
          : `Tap: place ${chip} ${token.symbol} · hold / right-click: remove`
      }
    >
      <span className={compact ? "leading-none" : ""}>{number}</span>
      {has && <ChipBadge stake={stake!} token={token} compact={compact} below={compact} />}
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
  compact,
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
  compact?: boolean;
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
      {has && <ChipBadge stake={stake!} token={token} compact={compact} below={compact} />}
    </button>
  );
}

function ChipBadge({
  stake,
  token,
  compact,
  below,
}: {
  stake: bigint;
  token: TokenSpec;
  compact?: boolean;
  below?: boolean;
}) {
  const human = unitsToHuman(stake, token);
  const label = human < 1000 ? String(Math.round(human)) : `${(human / 1000).toFixed(human < 10000 ? 1 : 0)}k`;
  if (below) {
    return (
      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-10 min-w-[14px] h-3.5 px-0.5 rounded-full bg-amber-400 border border-amber-100 text-amber-950 text-[7px] font-bold flex items-center justify-center shadow pointer-events-none">
        {label}
      </span>
    );
  }
  return (
    <span
      className={
        "absolute z-10 rounded-full bg-amber-400 border-2 border-amber-100 text-amber-950 font-bold flex items-center justify-center shadow-md pointer-events-none " +
        (compact ? " -top-1 -right-1 w-4 h-4 text-[7px]" : " -top-1 -right-1 sm:-top-1.5 sm:-right-1.5 w-5 h-5 sm:w-6 sm:h-6 text-[8px] sm:text-[10px]")
      }
    >
      {label}
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

