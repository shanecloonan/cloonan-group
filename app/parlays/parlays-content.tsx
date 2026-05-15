"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  scanDailyParlays,
  persistScanReport,
  type LaggingLine,
  type ParlayCandidate,
  type ScanReport,
} from "@/lib/parlay-scanner";
import {
  americanToDecimal,
  americanToImpliedProbability,
  calculateParlayAlpha,
  devig,
  type DevigMethod,
  type Leg,
  type ParlayResult,
} from "@/lib/parlay-engine";

/* ---------------------------------------------------------------------------
 *  Visual primitives — match the styling vocabulary already used elsewhere
 *  (gateway-content.tsx, about-app.tsx, etc.)
 * ------------------------------------------------------------------------- */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls =
  "w-full h-10 px-3 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
const selectCls = inputCls + " appearance-none cursor-pointer";
const labelCls =
  "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const btnPrimary =
  "h-10 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnGhost =
  "h-10 px-4 rounded-lg font-medium text-sm bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer";
const pill =
  "inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[10px] font-medium border border-white/[0.08] text-white/60";

function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const s = n.toFixed(digits);
  return `${n >= 0 ? "+" : ""}${s}%`;
}
function fmtSignedAmerican(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${Math.round(n)}`;
  return `${Math.round(n)}`;
}
function fmtMoney(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function fmtProb(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(2)}%`;
}
function fmtDecimal(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/* ===========================================================================
 *  Page
 * ========================================================================= */

type Mode = "scanner" | "calculator" | "math";

export default function ParlaysContent() {
  const [mode, setMode] = useState<Mode>("scanner");

  /* ----- Scanner config + state ------------------------------------- */
  const [bankroll, setBankroll] = useState(1000);
  const [minLegs, setMinLegs] = useState(2);
  const [maxLegs, setMaxLegs] = useState(3);
  const [minLegEv, setMinLegEv] = useState(1);
  const [minParlayEv, setMinParlayEv] = useState(3);
  const [trials, setTrials] = useState(10_000);
  const [devigMethod, setDevigMethod] = useState<DevigMethod>("auto");
  const [oddsApiKey, setOddsApiKey] = useState("");

  const [report, setReport] = useState<ScanReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [autoPersist, setAutoPersist] = useState(false);
  const [persistMsg, setPersistMsg] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setPersistMsg(null);
    try {
      const r = await scanDailyParlays({
        bankroll,
        minLegs,
        maxLegs,
        minLegEvPct: minLegEv,
        minParlayEvPct: minParlayEv,
        monteCarloTrials: trials,
        devigMethod,
        oddsApiKey: oddsApiKey || undefined,
        maxResults: 24,
      });
      setReport(r);
      if (autoPersist) {
        await persistScanReport(r);
        setPersistMsg("Persisted to Supabase ✓");
      }
    } catch (err) {
      setScanError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [bankroll, minLegs, maxLegs, minLegEv, minParlayEv, trials, devigMethod, oddsApiKey, autoPersist]);

  // Auto-scan once on mount so the page is never empty.
  useEffect(() => {
    runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-[calc(100vh-56px)] w-full bg-[#08090e] text-white">
      <PageHeader mode={mode} setMode={setMode} />

      <div className="max-w-7xl mx-auto px-5 sm:px-8 pb-24">
        {mode === "scanner" && (
          <ScannerPanel
            {...{
              bankroll,
              setBankroll,
              minLegs,
              setMinLegs,
              maxLegs,
              setMaxLegs,
              minLegEv,
              setMinLegEv,
              minParlayEv,
              setMinParlayEv,
              trials,
              setTrials,
              devigMethod,
              setDevigMethod,
              oddsApiKey,
              setOddsApiKey,
              autoPersist,
              setAutoPersist,
              report,
              scanning,
              scanError,
              persistMsg,
              runScan,
            }}
          />
        )}

        {mode === "calculator" && <CalculatorPanel bankroll={bankroll} />}

        {mode === "math" && <MathPanel />}
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Header
 * ========================================================================= */

function PageHeader({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const tabs: { id: Mode; label: string; sub: string }[] = [
    { id: "scanner", label: "Scanner", sub: "Daily +EV picks" },
    { id: "calculator", label: "Calculator", sub: "Analyze your own slip" },
    { id: "math", label: "The Math", sub: "How the engine works" },
  ];
  return (
    <header className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-950/40 via-[#08090e] to-[#08090e]">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 pt-12 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className={pill + " border-emerald-400/30 text-emerald-300 bg-emerald-500/10"}>
            ◎ Quantitative Arbitrageur
          </span>
          <span className={pill}>Decimal.js precision</span>
          <span className={pill}>Gaussian-copula Monte Carlo</span>
          <span className={pill}>Quarter Kelly</span>
        </div>
        <h1 className="font-heading text-4xl sm:text-5xl font-semibold tracking-tight">
          Parlays<span className="text-emerald-400">.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-white/60 leading-relaxed">
          We don&rsquo;t ask &ldquo;can this hit?&rdquo;. We ask{" "}
          <span className="text-emerald-300">&ldquo;is the book paying more than the actual risk?&rdquo;</span>{" "}
          Every leg is de-vigged from the sharpest available price, every combo is run through a
          Gaussian-copula Monte Carlo so correlations are priced in, and every stake is sized by
          fractional Kelly. The four pillars: +EV, parlay math, correlation logic, bankroll
          management.
        </p>

        <div className="mt-7 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={
                "group flex flex-col items-start px-4 py-2 rounded-xl border transition-all cursor-pointer " +
                (mode === t.id
                  ? "border-emerald-400/50 bg-emerald-500/10 text-white"
                  : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:bg-white/[0.06]")
              }
            >
              <span className="text-sm font-semibold">{t.label}</span>
              <span className="text-[11px] text-white/40 group-hover:text-white/60">{t.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

/* ===========================================================================
 *  Scanner panel
 * ========================================================================= */

interface ScannerPanelProps {
  bankroll: number; setBankroll: (n: number) => void;
  minLegs: number; setMinLegs: (n: number) => void;
  maxLegs: number; setMaxLegs: (n: number) => void;
  minLegEv: number; setMinLegEv: (n: number) => void;
  minParlayEv: number; setMinParlayEv: (n: number) => void;
  trials: number; setTrials: (n: number) => void;
  devigMethod: DevigMethod; setDevigMethod: (m: DevigMethod) => void;
  oddsApiKey: string; setOddsApiKey: (s: string) => void;
  autoPersist: boolean; setAutoPersist: (b: boolean) => void;
  report: ScanReport | null;
  scanning: boolean;
  scanError: string | null;
  persistMsg: string | null;
  runScan: () => void;
}

function ScannerPanel(p: ScannerPanelProps) {
  return (
    <div className="mt-8 space-y-8">
      {/* Settings strip */}
      <section className={card + " p-5"}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Scan parameters</h2>
            <p className="text-xs text-white/40 mt-0.5">Tune the engine, then refresh.</p>
          </div>
          <div className="flex items-center gap-2">
            {p.persistMsg && (
              <span className="text-emerald-300 text-xs font-medium">{p.persistMsg}</span>
            )}
            <label className="flex items-center gap-2 text-xs text-white/50 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={p.autoPersist}
                onChange={(e) => p.setAutoPersist(e.target.checked)}
                className="accent-emerald-500 cursor-pointer"
              />
              Persist to Supabase
            </label>
            <button type="button" className={btnPrimary} disabled={p.scanning} onClick={p.runScan}>
              {p.scanning ? "Scanning…" : "Run scan"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div>
            <label className={labelCls}>Bankroll</label>
            <input
              type="number"
              className={inputCls}
              value={p.bankroll}
              min={1}
              step={100}
              onChange={(e) => p.setBankroll(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>Min legs</label>
            <input
              type="number"
              className={inputCls}
              value={p.minLegs}
              min={2}
              max={p.maxLegs}
              onChange={(e) => p.setMinLegs(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>Max legs</label>
            <input
              type="number"
              className={inputCls}
              value={p.maxLegs}
              min={p.minLegs}
              max={6}
              onChange={(e) => p.setMaxLegs(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>Min leg EV %</label>
            <input
              type="number"
              className={inputCls}
              value={p.minLegEv}
              step={0.5}
              onChange={(e) => p.setMinLegEv(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>Min parlay EV %</label>
            <input
              type="number"
              className={inputCls}
              value={p.minParlayEv}
              step={0.5}
              onChange={(e) => p.setMinParlayEv(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>MC trials</label>
            <select
              className={selectCls}
              value={p.trials}
              onChange={(e) => p.setTrials(Number(e.target.value))}
            >
              <option value={1_000}>1,000</option>
              <option value={5_000}>5,000</option>
              <option value={10_000}>10,000</option>
              <option value={25_000}>25,000</option>
              <option value={50_000}>50,000</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>De-vig method</label>
            <select
              className={selectCls}
              value={p.devigMethod}
              onChange={(e) => p.setDevigMethod(e.target.value as DevigMethod)}
            >
              <option value="auto">Auto</option>
              <option value="power">Power</option>
              <option value="multiplicative">Multiplicative</option>
              <option value="additive">Additive</option>
            </select>
          </div>
        </div>

        <div className="mt-3">
          <label className={labelCls}>
            Odds API key override (optional — engine ships with a live key built in)
          </label>
          <input
            type="password"
            placeholder="leave blank to use the built-in key"
            className={inputCls}
            value={p.oddsApiKey}
            onChange={(e) => p.setOddsApiKey(e.target.value)}
          />
        </div>

        {p.scanError && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-200">
            {p.scanError}
          </div>
        )}
      </section>

      {/* Engine summary */}
      {p.report && <EngineSummary report={p.report} />}

      {/* Top parlays */}
      {p.report && p.report.topPicks.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Top parlays — ranked by expected ROI</h2>
            <span className="text-xs text-white/40">
              {p.report.topPicks.length} of {p.report.candidates.length} candidates surface above
              your EV floor
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {p.report.topPicks.map((c, i) => (
              <ParlayCard key={c.signature} candidate={c} rank={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* Lagging lines */}
      {p.report && p.report.laggingLines.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Lagging single lines</h2>
            <span className="text-xs text-white/40">
              Books still offering a price better than the de-vigged consensus
            </span>
          </div>
          <LaggingTable lines={p.report.laggingLines} />
        </section>
      )}

      {p.report && p.report.topPicks.length === 0 && (
        <section className={card + " p-8 text-center"}>
          <p className="text-white/60 text-sm">
            No parlays cleared the EV floor on this scan. Try lowering{" "}
            <span className="text-white">min parlay EV %</span> or widening the leg range.
          </p>
        </section>
      )}
    </div>
  );
}

function EngineSummary({ report }: { report: ScanReport }) {
  const totalEdge = report.candidates.reduce((acc, c) => acc + c.result.expectedRoiPercent, 0);
  const top = report.topPicks[0];

  return (
    <section className={card + " p-5"}>
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Data source</div>
          <div className="text-sm font-semibold mt-0.5">
            {report.source === "odds-api" ? "The Odds API (live)" : "Mock data (no API key set)"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Events scanned</div>
          <div className="text-sm font-semibold mt-0.5">{report.eventsConsidered}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Lagging lines</div>
          <div className="text-sm font-semibold mt-0.5">{report.laggingLines.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">+EV parlays</div>
          <div className="text-sm font-semibold mt-0.5">{report.candidates.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Cumulative edge</div>
          <div className="text-sm font-semibold mt-0.5">{fmtPct(totalEdge, 1)}</div>
        </div>
        {top && (
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Top pick ROI</div>
            <div className="text-2xl font-bold text-emerald-400 mt-0.5">
              {fmtPct(top.result.expectedRoiPercent, 1)}
            </div>
          </div>
        )}
      </div>

      {report.warnings.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {report.warnings.map((w, i) => (
            <span key={i} className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md">
              ⚠ {w}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 text-[11px] text-white/40">
        Generated {new Date(report.generatedAt).toLocaleString()}
      </div>
    </section>
  );
}

/* ===========================================================================
 *  Parlay card
 * ========================================================================= */

function ParlayCard({ candidate, rank }: { candidate: ParlayCandidate; rank: number }) {
  const r = candidate.result;
  const ratio =
    r.independentJointProbability > 0
      ? r.monteCarloJointProbability / r.independentJointProbability
      : 1;
  const corrSign = ratio > 1.05 ? "positive" : ratio < 0.95 ? "negative" : "neutral";

  return (
    <div className={card + " p-5 flex flex-col gap-4 hover:border-emerald-400/30 transition-colors"}>
      {/* Header strip */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center text-emerald-300 font-bold text-sm">
            {rank}
          </div>
          <div>
            <div className="text-sm font-semibold">
              {candidate.legs.length}-leg parlay ·{" "}
              <span className="text-emerald-300">{fmtPct(r.expectedRoiPercent, 1)} EV</span>
            </div>
            <div className="text-[11px] text-white/40">
              Offered {fmtSignedAmerican(r.offeredAmericanOdds)} · Fair{" "}
              {fmtSignedAmerican(r.monteCarloFairAmericanOdds)} · α{" "}
              {fmtPct(r.alphaPercent, 1)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
            Quarter Kelly
          </div>
          <div className="text-lg font-bold text-white">
            {fmtMoney(r.recommendedStake, 2)}
          </div>
          <div className="text-[10px] text-white/40">
            {(r.recommendedStakeFraction * 100).toFixed(2)}% of bankroll
          </div>
        </div>
      </div>

      {/* Legs */}
      <div className="space-y-2">
        {candidate.legs.map((l, i) => {
          const an = r.legs[i];
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]"
            >
              <div className="min-w-0">
                <div className="text-[13px] text-white/90 font-medium truncate">
                  {l.outcomeName}
                  {l.point !== undefined ? ` ${l.point}` : ""}
                </div>
                <div className="text-[11px] text-white/40 truncate">
                  {l.sport} · {l.game} · {l.market.toUpperCase()} · {l.bookTitle}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-[10px] text-white/40">True</div>
                  <div className="text-[12px] font-mono text-white/80">{fmtProb(an.trueProbability)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-white/40">Book</div>
                  <div className="text-[12px] font-mono text-white/80">
                    {fmtSignedAmerican(an.americanOdds)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-emerald-400">EV</div>
                  <div className="text-[12px] font-mono text-emerald-300 font-semibold">
                    {fmtPct(an.expectedValue * 100, 1)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <Stat label="MC joint" value={fmtProb(r.monteCarloJointProbability)} />
        <Stat label="Independent" value={fmtProb(r.independentJointProbability)} />
        <Stat
          label="Correlation"
          value={
            corrSign === "positive" ? "+ ve" : corrSign === "negative" ? "- ve" : "≈ 0"
          }
          tone={corrSign === "positive" ? "good" : corrSign === "negative" ? "bad" : "neutral"}
        />
        <Stat label="Vig comp." value={`×${fmtDecimal(r.vigCompoundingFactor, 2)}`} />
      </div>

      {/* Warnings */}
      {r.warnings.length > 0 && (
        <div className="space-y-1">
          {r.warnings.map((w, i) => (
            <div
              key={i}
              className="text-[11px] text-amber-300/90 bg-amber-500/5 border border-amber-500/15 px-2 py-1 rounded-md"
            >
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-300 border-emerald-500/20 bg-emerald-500/5"
      : tone === "bad"
        ? "text-rose-300 border-rose-500/20 bg-rose-500/5"
        : "text-white/80 border-white/[0.06] bg-white/[0.03]";
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${toneCls}`}>
      <div className="text-[9px] uppercase tracking-[0.12em] opacity-60">{label}</div>
      <div className="text-[12px] font-semibold font-mono mt-0.5">{value}</div>
    </div>
  );
}

/* ===========================================================================
 *  Lagging-lines table
 * ========================================================================= */

function LaggingTable({ lines }: { lines: LaggingLine[] }) {
  return (
    <div className={card + " overflow-hidden"}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.15em] text-white/40">
            <th className="text-left px-4 py-2.5 font-medium">Sport</th>
            <th className="text-left px-4 py-2.5 font-medium">Game</th>
            <th className="text-left px-4 py-2.5 font-medium">Pick</th>
            <th className="text-left px-4 py-2.5 font-medium">Book</th>
            <th className="text-right px-4 py-2.5 font-medium">Offered</th>
            <th className="text-right px-4 py-2.5 font-medium">Fair</th>
            <th className="text-right px-4 py-2.5 font-medium">Edge</th>
            <th className="text-right px-4 py-2.5 font-medium">EV</th>
          </tr>
        </thead>
        <tbody>
          {lines.slice(0, 24).map((l, i) => (
            <tr
              key={i}
              className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
            >
              <td className="px-4 py-2 text-white/60 text-xs">{l.sport}</td>
              <td className="px-4 py-2 text-white/70 text-xs">{l.game}</td>
              <td className="px-4 py-2">
                <div className="text-[13px] text-white/90">
                  {l.outcomeName}
                  {l.point !== undefined ? ` ${l.point}` : ""}
                </div>
                <div className="text-[10px] text-white/40 uppercase tracking-wide">
                  {l.market}
                </div>
              </td>
              <td className="px-4 py-2 text-white/80 text-xs">{l.bookTitle}</td>
              <td className="px-4 py-2 text-right font-mono text-white/90">
                {fmtSignedAmerican(l.bookAmericanOdds)}
              </td>
              <td className="px-4 py-2 text-right font-mono text-white/60">
                {fmtSignedAmerican(l.consensusFairAmericanOdds)}
              </td>
              <td className="px-4 py-2 text-right font-mono text-emerald-300">
                {fmtPct(l.edgePct, 1)}
              </td>
              <td className="px-4 py-2 text-right font-mono text-emerald-400 font-semibold">
                {fmtPct(l.expectedValuePct, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ===========================================================================
 *  Custom-parlay calculator
 * ========================================================================= */

interface CalcLeg {
  description: string;
  americanOdds: number;
  oppositeAmericanOdds: number | "";
}

function emptyLeg(): CalcLeg {
  return { description: "", americanOdds: -110, oppositeAmericanOdds: -110 };
}

function CalculatorPanel({ bankroll: initialBankroll }: { bankroll: number }) {
  const [legs, setLegs] = useState<CalcLeg[]>([
    { description: "Chiefs ML", americanOdds: -135, oppositeAmericanOdds: 115 },
    { description: "Over 48.5", americanOdds: -105, oppositeAmericanOdds: -115 },
  ]);
  const [offered, setOffered] = useState<number>(280);
  const [bankroll, setBankroll] = useState(initialBankroll);
  const [trials, setTrials] = useState(10_000);
  const [devigMethod, setDevigMethod] = useState<DevigMethod>("auto");
  const [useCorrelation, setUseCorrelation] = useState(true);
  const [pairwiseRho, setPairwiseRho] = useState(0.0);

  // Build correlation matrix dynamically. For >2 legs we apply rho on every pair.
  const correlationMatrix = useMemo(() => {
    if (!useCorrelation) return undefined;
    const n = legs.length;
    const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) m[i][i] = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) m[i][j] = m[j][i] = pairwiseRho;
    }
    return m;
  }, [legs.length, pairwiseRho, useCorrelation]);

  const result = useMemo<ParlayResult | { error: string } | null>(() => {
    if (legs.length < 2) return null;
    try {
      const engineLegs: Leg[] = legs.map((l, i) => ({
        id: `leg-${i}`,
        description: l.description || `Leg ${i + 1}`,
        americanOdds: Number(l.americanOdds),
        oppositeAmericanOdds:
          l.oppositeAmericanOdds === "" || isNaN(Number(l.oppositeAmericanOdds))
            ? undefined
            : Number(l.oppositeAmericanOdds),
      }));
      return calculateParlayAlpha(engineLegs, Number(offered), bankroll, correlationMatrix, {
        monteCarloTrials: trials,
        devigMethod,
      });
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [legs, offered, bankroll, correlationMatrix, trials, devigMethod]);

  const isError = result && "error" in result;
  const r = !isError ? (result as ParlayResult | null) : null;

  return (
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Legs editor */}
      <section className={card + " p-5 lg:col-span-3"}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Your parlay slip</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Add each leg you intend to play. If you provide an opposite-side price (same
              book or sharp book), the engine will de-vig automatically to derive the
              <em> true</em> probability.
            </p>
          </div>
          <button
            type="button"
            className={btnGhost}
            onClick={() => setLegs([...legs, emptyLeg()])}
          >
            + Add leg
          </button>
        </div>

        <div className="space-y-3">
          {legs.map((leg, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                <label className={labelCls}>Leg {i + 1}</label>
                <input
                  className={inputCls}
                  placeholder="Chiefs ML"
                  value={leg.description}
                  onChange={(e) => {
                    const next = [...legs];
                    next[i] = { ...leg, description: e.target.value };
                    setLegs(next);
                  }}
                />
              </div>
              <div className="col-span-3">
                <label className={labelCls}>American odds</label>
                <input
                  type="number"
                  className={inputCls}
                  value={leg.americanOdds}
                  onChange={(e) => {
                    const next = [...legs];
                    next[i] = { ...leg, americanOdds: Number(e.target.value) };
                    setLegs(next);
                  }}
                />
              </div>
              <div className="col-span-3">
                <label className={labelCls}>Opposite (for de-vig)</label>
                <input
                  type="number"
                  className={inputCls}
                  placeholder="optional"
                  value={leg.oppositeAmericanOdds}
                  onChange={(e) => {
                    const next = [...legs];
                    next[i] = {
                      ...leg,
                      oppositeAmericanOdds:
                        e.target.value === "" ? "" : Number(e.target.value),
                    };
                    setLegs(next);
                  }}
                />
              </div>
              <div className="col-span-1">
                <button
                  type="button"
                  className={btnGhost + " w-full px-2"}
                  disabled={legs.length <= 2}
                  onClick={() => setLegs(legs.filter((_, idx) => idx !== i))}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <hr className="my-5 border-white/[0.06]" />

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Offered parlay price</label>
            <input
              type="number"
              className={inputCls}
              value={offered}
              onChange={(e) => setOffered(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>Bankroll</label>
            <input
              type="number"
              className={inputCls}
              value={bankroll}
              onChange={(e) => setBankroll(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>MC trials</label>
            <select
              className={selectCls}
              value={trials}
              onChange={(e) => setTrials(Number(e.target.value))}
            >
              <option value={1_000}>1,000</option>
              <option value={5_000}>5,000</option>
              <option value={10_000}>10,000</option>
              <option value={25_000}>25,000</option>
              <option value={50_000}>50,000</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>De-vig method</label>
            <select
              className={selectCls}
              value={devigMethod}
              onChange={(e) => setDevigMethod(e.target.value as DevigMethod)}
            >
              <option value="auto">Auto</option>
              <option value="power">Power</option>
              <option value="multiplicative">Multiplicative</option>
              <option value="additive">Additive</option>
            </select>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useCorrelation}
              onChange={(e) => setUseCorrelation(e.target.checked)}
              className="accent-emerald-500 cursor-pointer"
            />
            Apply pairwise correlation
          </label>
          {useCorrelation && (
            <div className="mt-3 flex items-center gap-3">
              <label className="text-xs text-white/50 w-32">Pairwise ρ</label>
              <input
                type="range"
                min={-0.9}
                max={0.9}
                step={0.05}
                value={pairwiseRho}
                onChange={(e) => setPairwiseRho(Number(e.target.value))}
                className="flex-1 accent-emerald-500"
              />
              <span className="font-mono text-sm text-white/80 w-12 text-right">
                {pairwiseRho.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Results */}
      <section className="lg:col-span-2 space-y-4">
        {isError && (
          <div className={card + " p-5 border-red-500/30"}>
            <div className="text-sm text-red-300">{(result as { error: string }).error}</div>
          </div>
        )}

        {r && (
          <>
            <div
              className={
                card +
                ` p-5 ${r.isProfitable ? "border-emerald-400/30" : "border-rose-500/30"}`
              }
            >
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
                Expected ROI
              </div>
              <div
                className={`text-4xl font-bold mt-1 ${r.isProfitable ? "text-emerald-400" : "text-rose-400"}`}
              >
                {fmtPct(r.expectedRoiPercent, 2)}
              </div>
              <div className="mt-1 text-xs text-white/40">
                {r.isProfitable
                  ? "Positive expected value — this is alpha"
                  : "Negative EV — engine recommends passing"}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <KV k="Alpha (vs. fair)" v={fmtPct(r.alphaPercent, 2)} />
                <KV k="MC fair odds" v={fmtSignedAmerican(r.monteCarloFairAmericanOdds)} />
                <KV k="Offered odds" v={fmtSignedAmerican(r.offeredAmericanOdds)} />
                <KV k="MC joint prob." v={fmtProb(r.monteCarloJointProbability)} />
                <KV
                  k="Independent prob."
                  v={fmtProb(r.independentJointProbability)}
                />
                <KV k="MC trials" v={r.monteCarloTrials.toLocaleString()} />
              </div>
            </div>

            <div className={card + " p-5"}>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
                Recommended stake (¼ Kelly, capped 5%)
              </div>
              <div className="text-3xl font-bold mt-1 text-white">
                {fmtMoney(r.recommendedStake, 2)}
              </div>
              <div className="mt-1 text-xs text-white/40">
                {(r.recommendedStakeFraction * 100).toFixed(3)}% of {fmtMoney(r.bankroll, 0)} ·
                full Kelly = {(r.fullKellyFraction * 100).toFixed(2)}%
              </div>
            </div>

            {r.warnings.length > 0 && (
              <div className={card + " p-5"}>
                <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 mb-2">
                  Diagnostics
                </div>
                <div className="space-y-1">
                  {r.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="text-[12px] text-amber-300/90 bg-amber-500/5 border border-amber-500/15 px-2 py-1 rounded-md"
                    >
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={card + " p-5"}>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 mb-2">
                Per-leg breakdown
              </div>
              <div className="space-y-2">
                {r.legs.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded-md bg-white/[0.03] border border-white/[0.05]"
                  >
                    <div className="text-[12px] text-white/80">
                      {l.leg.description || `Leg ${i + 1}`}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono">
                      <span className="text-white/40">
                        impl {fmtProb(l.impliedProbability)}
                      </span>
                      <span className="text-white/80">
                        true {fmtProb(l.trueProbability)}
                      </span>
                      <span
                        className={
                          l.expectedValue > 0 ? "text-emerald-300" : "text-rose-300"
                        }
                      >
                        ev {fmtPct(l.expectedValue * 100, 1)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!r && !isError && (
          <div className={card + " p-5 text-sm text-white/40"}>
            Enter at least 2 legs to compute alpha.
          </div>
        )}
      </section>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">{k}</span>
      <span className="text-[13px] font-mono text-white/90 mt-0.5">{v}</span>
    </div>
  );
}

/* ===========================================================================
 *  Math / about panel — live demo of the four pillars
 * ========================================================================= */

function MathPanel() {
  const exampleImplied = [0.5238, 0.5238]; // -110 / -110
  const mult = devig(exampleImplied, "multiplicative").trueProbabilities;
  const power = devig(exampleImplied, "power").trueProbabilities;
  const dec1 = americanToDecimal(-110);
  const ip1 = americanToImpliedProbability(-110);

  return (
    <div className="mt-8 space-y-6">
      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">Pillar 1 · Positive Expected Value</h2>
        <p className="text-white/60 text-sm leading-relaxed">
          Every American odds line implies a probability. <code>-110</code> implies{" "}
          <span className="text-emerald-300 font-mono">
            110 ÷ 210 = {(ip1 * 100).toFixed(2)}%
          </span>
          . Decimal form: <span className="font-mono">{dec1.toFixed(4)}</span>. We then
          de-vig the *opposite* line on the same market to recover the book&rsquo;s view of
          the true probability — and then de-vig the <em>sharp</em> market (Pinnacle / Circa)
          to get the cleanest possible estimate of fair price.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <Demo
            label="Raw implied (–110 / –110)"
            value={`${(exampleImplied[0] * 100).toFixed(2)}% / ${(exampleImplied[1] * 100).toFixed(2)}%`}
            note={`Sum = ${((exampleImplied[0] + exampleImplied[1]) * 100).toFixed(2)}% (4.76% vig)`}
          />
          <Demo
            label="Multiplicative de-vig"
            value={`${(mult[0] * 100).toFixed(2)}% / ${(mult[1] * 100).toFixed(2)}%`}
            note="Divide each by sum"
          />
          <Demo
            label="Power de-vig"
            value={`${(power[0] * 100).toFixed(2)}% / ${(power[1] * 100).toFixed(2)}%`}
            note="Σ pᵢᵏ = 1"
          />
        </div>
      </section>

      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">Pillar 2 · Parlay Math</h2>
        <p className="text-white/60 text-sm leading-relaxed">
          Combined parlay decimal odds = product of leg decimals. The trick is the
          book&rsquo;s vig compounds <em>multiplicatively</em> too, so a 3-leg parlay at
          4.76% vig per leg accumulates 1.0476³ ≈ 15% house edge before you place the bet.
          Your edge per leg must compound at least that fast to break even, and faster to
          generate alpha.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-sm text-white/80">
          <Demo label="Leg 1" value="−110 → 1.9091 dec → 52.38%" note="ε = book edge here" />
          <Demo label="Leg 2" value="+150 → 2.5000 dec → 40.00%" />
          <Demo
            label="Parlay"
            value="1.9091 × 2.5 = 4.7727"
            note={`vs. fair = ${(1 / (0.5238 * 0.4)).toFixed(2)}; you need true prob > implied`}
          />
        </div>
      </section>

      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">Pillar 3 · Correlation Logic</h2>
        <p className="text-white/60 text-sm leading-relaxed">
          Standard parlay math assumes independence. Inside a single game, that&rsquo;s a
          lie. We simulate joint outcomes via a <em>Gaussian copula</em>: draw correlated
          latent normals via Cholesky decomposition, run them through Φ(·), and count how
          often all legs hit. 5,000–50,000 trials gives us a tight bracket around the
          true joint probability — and any deviation between that and the book&rsquo;s
          implied SGP price is alpha.
        </p>
      </section>

      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">Pillar 4 · Kelly Criterion</h2>
        <p className="text-white/60 text-sm leading-relaxed">
          f<sup>*</sup> = (b·p − q) / b, where b = decimal − 1, p = true probability,
          q = 1 − p. Full Kelly maximises log-growth but is brutally volatile. We default
          to <span className="text-emerald-300">Quarter Kelly</span> with a 5% hard cap —
          you give up ≈ 6% of long-run growth for ≈ 75% less drawdown. The engine refuses
          to recommend any stake on a parlay whose MC-derived EV is non-positive.
        </p>
        <div className="mt-4 p-4 rounded-lg bg-white/[0.04] border border-white/[0.08] font-mono text-sm text-white/80">
          Example: offered +200 (decimal 3.00), true p = 40%. b = 2, q = 60%.<br />
          f* = (2 · 0.40 − 0.60) / 2 = <span className="text-emerald-300">10%</span> of bankroll.<br />
          ¼ Kelly = <span className="text-emerald-300">2.5%</span>. EV per $1 = 0.40·3 − 1 = 20¢.
        </div>
      </section>
    </div>
  );
}

function Demo({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</div>
      <div className="text-sm font-mono mt-1 text-white/90">{value}</div>
      {note && <div className="text-[11px] text-white/40 mt-1">{note}</div>}
    </div>
  );
}
