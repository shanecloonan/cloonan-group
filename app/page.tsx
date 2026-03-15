import type { Metadata } from "next";
import CompanyChart from "./company-chart";
import MoneyFundLogo from "./money-fund-logo";

export const metadata: Metadata = {
  title: "MoneyFund | The World's Biggest Hedge Fun",
  description: "MoneyFund — The World's Biggest Hedge Fund.",
};

export default function Home() {
  return (
    <>
      {/* ── Hero ── */}
      <div className="relative flex flex-col items-center justify-center overflow-hidden py-20 sm:py-28">
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
          <MoneyFundLogo className="w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 mb-6" />

          <h1 className="font-heading text-[28px] sm:text-[36px] md:text-[44px] font-semibold tracking-[2px] text-white leading-tight mb-3">
            Money<span className="text-gold">Fund</span>
          </h1>

          <div className="w-12 h-px bg-gold/40 mb-4" />

          <p className="text-sm sm:text-base md:text-lg font-light tracking-[0.05em] text-brand-400 max-w-xl leading-relaxed">
            The World&rsquo;s Biggest Hedge Fun
          </p>

          <div className="flex items-center gap-3 mt-6">
            <span className="h-px w-8 bg-gold/40" />
            <span className="text-[10px] sm:text-[11px] tracking-[0.3em] uppercase font-semibold text-gold/70">
              Est. 1996
            </span>
            <span className="h-px w-8 bg-gold/40" />
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
