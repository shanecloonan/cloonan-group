"use client";

import { useRef, useCallback, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2 } from "lucide-react";

function siteLabel(name: string) {
  return `${name.replace(/\s+/g, "")}.com`;
}

function siteUrl(name: string) {
  return `https://${name.replace(/\s+/g, "").toLowerCase()}.com`;
}

const ACCENTS = [
  { accent: "text-gold", border: "border-gold/40", bg: "bg-gold/5", tag: "bg-gold/15 text-gold" },
  { accent: "text-emerald-400", border: "border-emerald-400/40", bg: "bg-emerald-400/5", tag: "bg-emerald-400/15 text-emerald-400" },
  { accent: "text-sky-400", border: "border-sky-400/40", bg: "bg-sky-400/5", tag: "bg-sky-400/15 text-sky-400" },
  { accent: "text-violet-400", border: "border-violet-400/40", bg: "bg-violet-400/5", tag: "bg-violet-400/15 text-violet-400" },
  { accent: "text-amber-300", border: "border-amber-300/40", bg: "bg-amber-300/5", tag: "bg-amber-300/15 text-amber-300" },
  { accent: "text-cyan-300", border: "border-cyan-300/40", bg: "bg-cyan-300/5", tag: "bg-cyan-300/15 text-cyan-300" },
  { accent: "text-rose-300", border: "border-rose-300/40", bg: "bg-rose-300/5", tag: "bg-rose-300/15 text-rose-300" },
];

const SUBSIDIARIES = [
  { name: "Antler Gear", desc: "Premium bowhunting equipment." },
  { name: "File Display", desc: "Internal tooling SaaS platform." },
  { name: "Glycell", desc: "Synthetic biology research." },
  { name: "Cheaper Brand", desc: "Knockoff products and Chinese bullshit." },
  { name: "Acre Division", desc: "Fractionalized Land Investing." },
  { name: "Joint Pacific", desc: "" },
  { name: "DTV Sports", desc: "NIL Agency." },
  { name: "Wynport", desc: "Casino and Sportsbook." },
  { name: "Wit Research", desc: "Market analytics platform." },
  { name: "Deltamorph", desc: "Genomic Discovery Lab." },
  { name: "Permawrite", desc: "Permanent Database Blockchain." },
  { name: "Chip Fab", desc: "Semiconductor Research." },
  { name: "Vix Ventures", desc: "Venture Capital Partners." },
  { name: "Stock FUD", desc: "FUD dissemination platform." },
].map((s, i) => ({
  ...s,
  ...ACCENTS[i % ACCENTS.length],
  url: siteUrl(s.name),
  site: siteLabel(s.name),
}));

function FlowConnector() {
  return (
    <div className="flex items-center justify-center">
      <svg
        width="12"
        height="32"
        viewBox="0 0 12 32"
        className="text-brand-600 shrink-0 hidden sm:block"
      >
        <line x1="6" y1="0" x2="6" y2="26" stroke="currentColor" strokeWidth="1" />
        <path
          d="M2 23 L6 31 L10 23"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        width="10"
        height="24"
        viewBox="0 0 10 24"
        className="text-brand-600 shrink-0 sm:hidden"
      >
        <line x1="5" y1="0" x2="5" y2="19" stroke="currentColor" strokeWidth="1" />
        <path
          d="M2 17 L5 23 L8 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default function CompanyChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!chartRef.current || exporting) return;
    setExporting(true);
    try {
      const el = chartRef.current;
      const w = el.scrollWidth;
      const h = el.scrollHeight;
      const dataUrl = await toPng(el, {
        pixelRatio: 3,
        backgroundColor: "#0C0A09",
        width: w,
        height: h,
        style: {
          overflow: "visible",
          width: `${w}px`,
          height: `${h}px`,
          maxWidth: "none",
        },
      });
      const link = document.createElement("a");
      link.download = "entity-structure.png";
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  return (
    <section className="relative bg-brand-950 overflow-visible">
      {/* Section header */}
      <div className="relative px-5 sm:px-8 pt-14 pb-6 sm:pt-20 sm:pb-10">
        <div className="absolute inset-0 bg-gradient-to-b from-forest/20 to-transparent" />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-lg sm:text-xl md:text-2xl font-bold tracking-tight uppercase mb-3 text-brand-200">
            Entity Structure
          </h2>
          <p className="text-brand-500 text-sm max-w-lg mx-auto mb-5">
            Three-tier holding structure — vault, nexus, and
            subsidiaries.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 border border-brand-700 hover:border-gold/40 text-brand-300 hover:text-gold px-5 py-2.5 text-[11px] tracking-[0.12em] uppercase font-semibold transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Export as PNG
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="px-5 sm:px-8 pb-16 sm:pb-20 overflow-visible">
        <div
          ref={chartRef}
          className="max-w-6xl mx-auto py-2 px-2 overflow-visible"
        >
          {/* Level 1: MoneyFund */}
          <div className="flex flex-col items-center">
            <a
              href="https://moneyfund.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative w-full max-w-sm border border-amber-500/50 bg-amber-500/5 rounded-sm pt-4 pb-4 px-4 sm:pt-5 sm:pb-5 sm:px-6 text-center block transition-all hover:border-amber-400 hover:bg-amber-500/10"
            >
              <p className="text-[9px] sm:text-[10px] tracking-[0.2em] uppercase font-semibold text-amber-500/70 mb-1.5">
                Grandparent Vault
              </p>
              <h3 className="font-heading text-xl sm:text-3xl font-bold uppercase tracking-wide text-amber-400 mb-2">
                Money Fund
              </h3>
              <span className="inline-block text-[10px] sm:text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 mb-2">
                MoneyFund.com
              </span>
              <p className="text-brand-400 text-[11px] sm:text-xs leading-relaxed">
                Protects capital and converts subsidiary profits into Arweave, MONEY, and other high-upside assets. Top-level entity and ultimate
                beneficial owner.
              </p>
            </a>

            <FlowConnector />

            {/* Level 2: ParentHolding */}
            <a
              href="https://parentholding.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative w-full max-w-sm border border-brand-400/40 bg-brand-400/5 rounded-sm pt-4 pb-4 px-4 sm:pt-5 sm:pb-5 sm:px-6 text-center block transition-all hover:border-brand-300 hover:bg-brand-400/10"
            >
              <p className="text-[9px] sm:text-[10px] tracking-[0.2em] uppercase font-semibold text-brand-400/70 mb-1.5">
                Parent Nexus
              </p>
              <h3 className="font-heading text-xl sm:text-3xl font-bold uppercase tracking-wide text-brand-200 mb-2">
                Parent Holding
              </h3>
              <span className="inline-block text-[10px] sm:text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-brand-400/15 text-brand-200 mb-2">
                ParentHolding.com
              </span>
              <p className="text-brand-400 text-[11px] sm:text-xs leading-relaxed">
                Profit-distribution nexus that receives
                cashflow from subsidiaries and channels it upstream to the vault.
                Holds 100% of every subsidiary.
              </p>
            </a>

            <FlowConnector />
          </div>

          {/* Branch line across the first row of subsidiaries */}
          <div className="hidden sm:block relative mx-auto max-w-6xl h-3">
            <div className="absolute top-0 left-[16.666%] right-[16.666%] lg:left-[12.5%] lg:right-[12.5%] h-px bg-brand-700" />
          </div>

          {/* Level 3: Subsidiaries */}
          <div className="flex flex-wrap justify-center gap-2 max-w-6xl mx-auto mt-1.5 sm:mt-0">
            {SUBSIDIARIES.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`relative border ${s.border} ${s.bg} rounded-sm p-2.5 sm:p-4 text-center flex flex-col w-[calc(50%-0.25rem)] sm:w-[calc(33.333%-0.34rem)] lg:w-[calc(25%-0.375rem)] transition-all hover:brightness-125 hover:scale-[1.02]`}
              >
                <p className="text-[8px] sm:text-[9px] tracking-[0.15em] uppercase font-semibold text-brand-600 mb-1 sm:mb-1.5">
                  Subsidiary
                </p>
                <h4
                  className={`font-heading text-sm sm:text-lg font-bold uppercase tracking-wide ${s.accent} mb-1 sm:mb-1.5`}
                >
                  {s.name}
                </h4>
                <span
                  className={`block max-w-full self-center text-[8px] sm:text-[11px] font-semibold leading-snug px-2 py-0.5 rounded-full ${s.tag} mb-1.5 sm:mb-2 break-words`}
                >
                  {s.site}
                </span>
                {s.desc ? (
                  <p className="text-brand-500 text-[9px] sm:text-[11px] leading-relaxed">
                    {s.desc}
                  </p>
                ) : null}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
