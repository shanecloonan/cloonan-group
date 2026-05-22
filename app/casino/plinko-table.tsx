"use client";

/* ===========================================================================
 *  /casino — Plinko table
 *  ---------------------------------------------------------------------------
 *  Drop a ball through a peg triangle. Path is determined by `rows` bits
 *  drawn from the provably-fair RNG; bin = number of "right" bits.
 *
 *  Controls:
 *    • Stake input
 *    • Risk selector (low / medium / high)
 *    • Row count selector (8 / 12 / 16)
 *    • Drop button (single play) + Auto-bet (configurable rounds, martingale)
 *
 *  Animation:
 *    • The ball walks down the triangle one row at a time, ~120ms per row.
 *    • Lands in the corresponding bin; the bin's multiplier flashes.
 *    • Recent drops list keeps the last 30 outcomes.
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PLINKO_CONFIG,
  newSessionId,
  persistSettledSession,
  plinkoBinProbability,
  plinkoGame,
  plinkoTheoreticalRtp,
  PLINKO_PAYOUTS,
  type ChainAdapter,
  type ChainId,
  type PlinkoAction,
  type PlinkoConfig,
  type PlinkoRisk,
  type PlinkoRowCount,
  type PlinkoState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { ShareLinkRow } from "./share-link";
import { btnDanger, btnGhost, btnPrimary, card, inputCls, labelCls } from "./casino-ui";
import { fmtMoney as fmtMoneyKit, humanToUnits, unitsToHuman } from "./table-kit";

const fmtMoney = (units: bigint, token: TokenSpec, digits = 2) => fmtMoneyKit(units, token, digits);

const LS_BET = "mf_casino_plinko_bet";
const LS_RISK = "mf_casino_plinko_risk";
const LS_ROWS = "mf_casino_plinko_rows";

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

interface DropAnim {
  path: boolean[];
  bin: number;
  rowAt: number; // current animated row index, 0 → rows+1 (final)
}

export default function PlinkoTable({ chainId, token }: Props) {
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

  const [risk, setRisk] = useState<PlinkoRisk>(() => {
    if (typeof window === "undefined") return "medium";
    const v = window.localStorage.getItem(LS_RISK) as PlinkoRisk | null;
    return v === "low" || v === "medium" || v === "high" ? v : "medium";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_RISK, risk);
  }, [risk]);

  const [rows, setRows] = useState<PlinkoRowCount>(() => {
    if (typeof window === "undefined") return DEFAULT_PLINKO_CONFIG.rows;
    const v = Number(window.localStorage.getItem(LS_ROWS));
    return v === 8 || v === 12 || v === 16 ? (v as PlinkoRowCount) : DEFAULT_PLINKO_CONFIG.rows;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_ROWS, String(rows));
  }, [rows]);

  /* ----- Round state ----------------------------------------------------- */

  const [history, setHistory] = useState<Session<PlinkoAction, PlinkoState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [activeDrop, setActiveDrop] = useState<DropAnim | null>(null);
  const [lastBin, setLastBin] = useState<{ bin: number; mult: number; pnl: bigint } | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<PlinkoAction, PlinkoState> | null>(null);

  const payouts = PLINKO_PAYOUTS[rows][risk];
  const rtp = plinkoTheoreticalRtp({ rows, risk });

  /* ----- Drop one ball --------------------------------------------------- */

  const dropOnce = useCallback(
    async (override?: { stake?: bigint }): Promise<Session<PlinkoAction, PlinkoState> | null> => {
      setError(null);
      try {
        const stake = override?.stake ?? humanToUnits(betAmount, token);
        if (stake <= 0n) throw new Error("Bet must be > 0");
        if (balance.available < stake) throw new Error("Insufficient balance");

        const config: PlinkoConfig = { rows, risk };
        let session = await driver.openSession(plinkoGame, {
          sessionId: newSessionId(),
          userId,
          gameId: plinkoGame.id,
          chainId,
          token,
          stake,
          config: config as unknown as Record<string, unknown>,
        });
        session = await driver.settleSession(plinkoGame, session);

        // Animate the ball down the triangle.
        const state = session.state as PlinkoState;
        setDropping(true);
        setActiveDrop({ path: state.path, bin: state.bin, rowAt: 0 });
        for (let r = 0; r <= state.path.length; r++) {
          setActiveDrop({ path: state.path, bin: state.bin, rowAt: r });
          await new Promise((res) => setTimeout(res, 110));
        }
        setLastBin({
          bin: state.bin,
          mult: state.multiplier,
          pnl: session.result?.pnlUnits ?? 0n,
        });
        setDropping(false);

        setHistory((h) => [session, ...h].slice(0, 30));
        pushHistory({
          game: "plinko",
          stakeUnits: session.result!.totalStakedUnits,
          pnlUnits: session.result!.pnlUnits,
          multiplier: state.multiplier,
          session: session as unknown as Session<unknown, unknown>,
        });
        void persistSettledSession(
          session as unknown as Parameters<typeof persistSettledSession>[0],
          getSeedPair(),
        );
        await refreshBalance();
        return session;
      } catch (e) {
        setError((e as Error).message);
        setDropping(false);
        return null;
      }
    },
    [
      balance.available,
      betAmount,
      chainId,
      driver,
      getSeedPair,
      pushHistory,
      refreshBalance,
      risk,
      rows,
      token,
      userId,
    ],
  );

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

    for (let i = 0; i < auto.rounds; i++) {
      if (cancelAutoRef.current) break;
      const bal = (await ledger.getBalance(userId, chainId, token)).available;
      const pnl = bal - startBal;
      if (auto.stopOnProfit > 0 && pnl >= stopProfit) break;
      if (auto.stopOnLoss > 0 && -pnl >= stopLoss) break;
      if (stake > bal || stake <= 0n) break;

      const s = await dropOnce({ stake });
      if (!s) break;
      const won = (s.result?.pnlUnits ?? 0n) > 0n;
      progress.remaining = auto.rounds - i - 1;
      progress.wins += won ? 1 : 0;
      progress.losses += won ? 0 : 1;
      progress.pnlUnits += s.result?.pnlUnits ?? 0n;
      setAutoProgress({ ...progress });
      stake = won
        ? humanToUnits(betAmount, token)
        : BigInt(Math.floor(Number(stake) * auto.onLossMultiplier));
      await new Promise((r) => setTimeout(r, 80));
    }
    setAutoRunning(false);
  }, [auto, autoRunning, betAmount, chainId, dropOnce, ledger, token, userId]);

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
      if ((k === " " || k === "enter") && !dropping && !autoRunning) {
        e.preventDefault();
        void dropOnce();
      } else if (k === "escape" && autoRunning) {
        cancelAutoRef.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropOnce, dropping, autoRunning, verifyTarget]);

  /* ----- Render --------------------------------------------------------- */

  const seedPair = getSeedPair();
  const hashShort = seedPair.serverSeedHash.slice(0, 14) + "…";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
      <div className="space-y-5">
        {/* Plinko board */}
        <PlinkoBoard
          rows={rows}
          risk={risk}
          payouts={payouts}
          activeDrop={activeDrop}
          dropping={dropping}
          lastBin={lastBin}
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
                disabled={dropping || autoRunning}
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className={labelCls}>Risk</label>
              <div className="flex gap-1">
                {(["low", "medium", "high"] as PlinkoRisk[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={
                      "h-10 px-3 text-[12px] font-medium rounded-lg border transition-all flex-1 cursor-pointer " +
                      (risk === r
                        ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                        : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]")
                    }
                    onClick={() => setRisk(r)}
                    disabled={dropping || autoRunning}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-[100px]">
              <label className={labelCls}>Rows</label>
              <div className="flex gap-1">
                {([8, 12, 16] as PlinkoRowCount[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={
                      "h-10 px-3 text-[12px] font-medium rounded-lg border transition-all flex-1 cursor-pointer " +
                      (rows === r
                        ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                        : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]")
                    }
                    onClick={() => setRows(r)}
                    disabled={dropping || autoRunning}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void dropOnce()}
                disabled={dropping || autoRunning || humanToUnits(betAmount, token) > balance.available}
              >
                Drop · {fmtMoney(humanToUnits(betAmount, token), token)}
              </button>
              <button
                type="button"
                className={btnGhost}
                onClick={() => setAutoOpen((o) => !o)}
                disabled={dropping || autoRunning}
              >
                {autoOpen ? "Hide auto" : "Auto bet"}
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            <Stat label="Available" value={fmtMoney(balance.available, token)} />
            <Stat
              label="Theoretical RTP"
              value={`${(rtp * 100).toFixed(2)}%`}
              sub={`house edge ${((1 - rtp) * 100).toFixed(2)}%`}
            />
            <Stat
              label="Max payout"
              value={`${Math.max(...payouts).toLocaleString()}×`}
              sub={`prob ${(plinkoBinProbability(rows, 0) * 100).toFixed(3)}%`}
            />
            <Stat
              label="Min payout"
              value={`${Math.min(...payouts).toFixed(2)}×`}
              sub={`drops you lose`}
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
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-white">Recent drops</h3>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              {history.length}/30
            </span>
          </div>
          {history.length === 0 ? (
            <div className="text-[12px] text-white/40 text-center py-6">
              No drops yet — pull the lever.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {history.map((s) => {
                const st = s.state as PlinkoState;
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
                        bin {st.bin} · {st.config.risk} · {st.config.rows}r
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
              Each row consumes one bit from{" "}
              <code className="text-emerald-300">HMAC-SHA256(server_seed, client_seed:nonce)</code>.
              <code className="text-emerald-300"> 0</code> = left,
              <code className="text-emerald-300"> 1</code> = right. The bin index = count of 1s.
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
        <CasinoVerifyModal
          title="Verify this drop"
          description={
            <>
              One HMAC byte per row — LSB is the L/R bit. Bin index equals the count of right turns.
            </>
          }
          session={verifyTarget}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => setVerifyTarget(null)}
          resultLabel="Replayed drop matches recorded outcome"
          extraFields={
            <div className="grid grid-cols-2 gap-3">
              <VerifyField
                label="Bin"
                value={`${verifyTarget.state.bin} / ${verifyTarget.state.config.rows}`}
                mono
              />
              <VerifyField label="Multiplier" value={`${verifyTarget.state.multiplier.toFixed(2)}×`} />
              <VerifyField
                label="Risk"
                value={`${verifyTarget.state.config.risk} · ${verifyTarget.state.config.rows} rows`}
              />
              <VerifyField
                label="Path"
                value={verifyTarget.state.path.map((b) => (b ? "R" : "L")).join("")}
                mono
              />
            </div>
          }
          runVerify={(serverSeed) =>
            runSessionVerify(plinkoGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: plinkoGame.id,
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: {
                rows: verifyTarget.state.config.rows,
                risk: verifyTarget.state.config.risk,
              } as Record<string, unknown>,
            })
          }
        />
      )}
    </div>
  );
}

/* ===========================================================================
 *  Board
 * ========================================================================= */

function PlinkoBoard({
  rows,
  risk,
  payouts,
  activeDrop,
  dropping,
  lastBin,
}: {
  rows: PlinkoRowCount;
  risk: PlinkoRisk;
  payouts: number[];
  activeDrop: DropAnim | null;
  dropping: boolean;
  lastBin: { bin: number; mult: number; pnl: bigint } | null;
}) {
  // Render a triangle of pegs. Pixel layout:
  //   x_peg(r, i) = centerX + (i - r/2) * pegStep
  //   y_peg(r)   = topY + r * pegStep
  const pegStep = rows === 8 ? 36 : rows === 12 ? 30 : 26;
  const width = 720;
  const topY = 36;
  const centerX = width / 2;
  const lastY = topY + rows * pegStep;
  const binWidth = pegStep;
  const totalHeight = lastY + 70;

  const ballPos = useMemo(() => {
    if (!activeDrop) return { x: centerX, y: topY - 12 };
    const r = activeDrop.rowAt;
    if (r === 0) return { x: centerX, y: topY - 12 };
    const rights = activeDrop.path.slice(0, r).filter(Boolean).length;
    const lefts = r - rights;
    const x = centerX + (rights - lefts) * (pegStep / 2);
    const y = topY + r * pegStep;
    return { x, y };
  }, [activeDrop, centerX, pegStep]);

  return (
    <section className={card + " p-5 overflow-hidden"}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-semibold text-white">Plinko · {rows} rows · {risk}</h3>
        <span className="text-[11px] text-white/40">
          {dropping ? "dropping…" : "ready"}
        </span>
      </div>
      <div className="relative w-full" style={{ aspectRatio: `${width}/${totalHeight}` }}>
        <svg
          viewBox={`0 0 ${width} ${totalHeight}`}
          className="absolute inset-0 w-full h-full"
        >
          <defs>
            <radialGradient id="ballGrad" cx="0.35" cy="0.3" r="0.65">
              <stop offset="0%" stopColor="#fef3c7" />
              <stop offset="60%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </radialGradient>
          </defs>

          {/* Pegs */}
          {Array.from({ length: rows + 1 }).map((_, r) =>
            Array.from({ length: r + 1 }).map((__, i) => {
              const x = centerX + (i - r / 2) * pegStep;
              const y = topY + r * pegStep;
              const passed = activeDrop && r <= activeDrop.rowAt;
              return (
                <circle
                  key={`${r}-${i}`}
                  cx={x}
                  cy={y}
                  r={3}
                  fill={passed ? "rgba(16,185,129,0.7)" : "rgba(255,255,255,0.25)"}
                />
              );
            }),
          )}

          {/* Ball */}
          {activeDrop && (
            <circle
              cx={ballPos.x}
              cy={ballPos.y}
              r={7}
              fill="url(#ballGrad)"
              style={{
                transition: "cx 100ms ease-out, cy 100ms ease-out",
                filter: "drop-shadow(0 0 4px rgba(245, 158, 11, 0.6))",
              }}
            />
          )}

          {/* Bin labels */}
          {payouts.map((m, i) => {
            const cellX = centerX - (rows / 2) * pegStep + i * pegStep;
            const cellY = lastY + 20;
            const won = lastBin?.bin === i;
            const fill = m >= 10 ? "rgba(244,63,94,0.18)" : m >= 2 ? "rgba(245,158,11,0.18)" : m >= 1 ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.04)";
            const stroke = won ? "rgba(16,185,129,0.9)" : "rgba(255,255,255,0.1)";
            const text = m < 1 ? m.toFixed(1) : m < 10 ? m.toFixed(1) : Math.round(m).toString();
            return (
              <g key={i}>
                <rect
                  x={cellX - binWidth / 2}
                  y={cellY}
                  width={binWidth}
                  height={36}
                  rx={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={won ? 2 : 1}
                />
                <text
                  x={cellX}
                  y={cellY + 24}
                  fill={won ? "#a7f3d0" : "rgba(255,255,255,0.65)"}
                  fontSize={rows >= 16 ? 9 : 11}
                  fontWeight="600"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {text}×
                </text>
              </g>
            );
          })}
        </svg>
      </div>
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
}: {
  cfg: AutoConfig;
  setCfg: (c: AutoConfig) => void;
  running: boolean;
  progress: { remaining: number; wins: number; losses: number; pnlUnits: bigint } | null;
  run: () => void;
  cancel: () => void;
  token: TokenSpec;
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
            Run {cfg.rounds} drops
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

