import type { Metadata } from "next";
import CompanyChart from "./company-chart";

export const metadata: Metadata = {
  title: "MoneyFund | The World's Biggest Hedge Fund",
  description: "MoneyFund — The World's Biggest Hedge Fund.",
};

export default function Home() {
  return (
    <>
      {/* ── Hero ── */}
      <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-brand-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(212,168,67,0.08),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_120%,rgba(212,168,67,0.04),transparent)]" />

        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(212,168,67,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(212,168,67,0.3) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />

        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-px bg-gradient-to-r from-transparent via-gold/10 to-transparent" />

        <div className="relative z-10 flex flex-col items-center px-6 text-center">
          <div className="flex items-center gap-3 mb-10">
            <span className="h-px w-8 bg-gold/40" />
            <span className="text-[10px] sm:text-[11px] tracking-[0.3em] uppercase font-semibold text-gold/70">
              Est. 2025
            </span>
            <span className="h-px w-8 bg-gold/40" />
          </div>

          <h1 className="font-heading text-6xl sm:text-8xl md:text-9xl font-bold tracking-tight text-brand-100 leading-[0.9] mb-6">
            Money
            <span className="text-gold">Fund</span>
          </h1>

          <div className="w-16 h-px bg-gold/50 mb-6" />

          <p className="text-lg sm:text-xl md:text-2xl font-light tracking-[0.08em] text-brand-400 max-w-xl leading-relaxed">
            The World&rsquo;s Biggest Hedge Fund
          </p>

          <div className="mt-16 flex flex-col items-center gap-4">
            <div className="w-px h-12 bg-gradient-to-b from-gold/30 to-transparent" />
            <span className="text-[9px] tracking-[0.25em] uppercase text-brand-600 font-medium">
              Capital &middot; Infrastructure &middot; Permanence
            </span>
          </div>
        </div>

        <div className="absolute top-8 left-8 w-12 h-12 border-l border-t border-gold/10" />
        <div className="absolute top-8 right-8 w-12 h-12 border-r border-t border-gold/10" />
        <div className="absolute bottom-8 left-8 w-12 h-12 border-l border-b border-gold/10" />
        <div className="absolute bottom-8 right-8 w-12 h-12 border-r border-b border-gold/10" />
      </div>

      {/* ── Entity Structure ── */}
      <CompanyChart />
    </>
  );
}
