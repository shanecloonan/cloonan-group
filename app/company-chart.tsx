"use client";

import { useRef, useCallback, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2 } from "lucide-react";

const SUBSIDIARIES = [
  {
    name: "AntlerGear",
    url: "https://antlergear.com",
    role: "Hunting Gear",
    desc: "Premium hunting apparel, equipment, and accessories for bowhunters.",
    accent: "text-gold",
    border: "border-gold/40",
    bg: "bg-gold/5",
    tag: "bg-gold/15 text-gold",
  },
  {
    name: "PermaWrite",
    url: "https://permawrite.com",
    role: "Permanent Storage",
    desc: "Decentralized permanent data storage solutions built on Arweave infrastructure.",
    accent: "text-sky-400",
    border: "border-sky-400/40",
    bg: "bg-sky-400/5",
    tag: "bg-sky-400/15 text-sky-400",
  },
  {
    name: "ChipFab",
    url: "https://chipfab.com",
    role: "Semiconductor Research",
    desc: "Semiconductor research company focused on next-generation chip design and fabrication processes.",
    accent: "text-violet-400",
    border: "border-violet-400/40",
    bg: "bg-violet-400/5",
    tag: "bg-violet-400/15 text-violet-400",
  },
  {
    name: "FileDisplay",
    url: "https://filedisplay.com",
    role: "Internal-Tooling SaaS",
    desc: "Internal tooling SaaS platform for operations across all subsidiaries.",
    accent: "text-emerald-400",
    border: "border-emerald-400/40",
    bg: "bg-emerald-400/5",
    tag: "bg-emerald-400/15 text-emerald-400",
  },
];

function FlowConnector() {
  return (
    <div className="flex items-center justify-center py-1">
      <svg
        width="12"
        height="48"
        viewBox="0 0 12 48"
        className="text-brand-600 shrink-0 hidden sm:block"
      >
        <line x1="6" y1="0" x2="6" y2="42" stroke="currentColor" strokeWidth="1" />
        <path
          d="M2 38 L6 47 L10 38"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        width="10"
        height="36"
        viewBox="0 0 10 36"
        className="text-brand-600 shrink-0 sm:hidden"
      >
        <line x1="5" y1="0" x2="5" y2="30" stroke="currentColor" strokeWidth="1" />
        <path
          d="M2 27 L5 35 L8 27"
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
      <div className="relative px-5 sm:px-8 pt-20 pb-10 sm:pt-28 sm:pb-14">
        <div className="absolute inset-0 bg-gradient-to-b from-forest/20 to-transparent" />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight uppercase mb-4 text-brand-200">
            Entity Structure
          </h2>
          <p className="text-brand-500 text-sm max-w-lg mx-auto mb-8">
            Three-tier holding structure — vault, nexus, and operating
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
      <div className="px-5 sm:px-8 pb-24 sm:pb-32 overflow-visible">
        <div
          ref={chartRef}
          className="max-w-5xl mx-auto py-4 px-2 overflow-visible"
        >
          {/* Level 1: MoneyFund */}
          <div className="flex flex-col items-center">
            <a
              href="https://moneyfund.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative w-full max-w-md border border-amber-500/50 bg-amber-500/5 rounded-sm pt-5 pb-5 px-5 sm:pt-7 sm:pb-6 sm:px-8 text-center block transition-all hover:border-amber-400 hover:bg-amber-500/10"
            >
              <p className="text-[9px] sm:text-[10px] tracking-[0.2em] uppercase font-semibold text-amber-500/70 mb-2">
                Grandparent Vault
              </p>
              <h3 className="font-heading text-2xl sm:text-4xl font-bold uppercase tracking-wide text-amber-400 mb-3">
                MoneyFund
              </h3>
              <p className="text-brand-400 text-xs sm:text-sm leading-relaxed">
                Protects capital and converts subsidiary profits into Arweave
                and other long-term assets. Top-level entity and ultimate
                beneficial owner.
              </p>
            </a>

            <FlowConnector />

            {/* Level 2: DeltaMorph */}
            <a
              href="https://deltamorph.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative w-full max-w-md border border-brand-400/40 bg-brand-400/5 rounded-sm pt-5 pb-5 px-5 sm:pt-7 sm:pb-6 sm:px-8 text-center block transition-all hover:border-brand-300 hover:bg-brand-400/10"
            >
              <p className="text-[9px] sm:text-[10px] tracking-[0.2em] uppercase font-semibold text-brand-400/70 mb-2">
                Parent Nexus
              </p>
              <h3 className="font-heading text-2xl sm:text-4xl font-bold uppercase tracking-wide text-brand-200 mb-3">
                DeltaMorph
              </h3>
              <p className="text-brand-400 text-xs sm:text-sm leading-relaxed">
                Parent holding company and profit-distribution nexus. Receives
                all subsidiary revenue and channels it upstream to the vault.
                Holds 100% of every operating subsidiary.
              </p>
            </a>

            <FlowConnector />
          </div>

          {/* Branch lines (desktop) */}
          <div className="hidden sm:block relative mx-auto max-w-4xl">
            <div className="absolute top-0 left-[12.5%] right-[12.5%] h-px bg-brand-700" />
            <div className="flex justify-between px-[12.5%]">
              {SUBSIDIARIES.map((s) => (
                <div key={s.name} className="w-px h-4 bg-brand-700" />
              ))}
            </div>
          </div>

          {/* Level 3: Subsidiaries */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-3 max-w-4xl mx-auto mt-2 sm:mt-0">
            {SUBSIDIARIES.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`relative border ${s.border} ${s.bg} rounded-sm p-3 sm:p-5 text-center flex flex-col transition-all hover:brightness-125 hover:scale-[1.02]`}
              >
                <p className="text-[8px] sm:text-[9px] tracking-[0.15em] uppercase font-semibold text-brand-600 mb-1.5 sm:mb-2">
                  Subsidiary
                </p>
                <h4
                  className={`font-heading text-base sm:text-2xl font-bold uppercase tracking-wide ${s.accent} mb-1.5 sm:mb-2`}
                >
                  {s.name}
                </h4>
                <span
                  className={`inline-block self-center text-[8px] sm:text-[10px] tracking-[0.1em] sm:tracking-[0.12em] uppercase font-semibold px-2 py-0.5 rounded-full ${s.tag} mb-2 sm:mb-3`}
                >
                  {s.role}
                </span>
                <p className="text-brand-500 text-[10px] sm:text-xs leading-relaxed">
                  {s.desc}
                </p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
