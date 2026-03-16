import type { Metadata } from "next";
import MoneyFundLogo from "./money-fund-logo";

export const metadata: Metadata = {
  title: "MoneyFund | The World's Biggest Hedge Fun",
  description: "MoneyFund — The World's Biggest Hedge Fun.",
};

export default function Home() {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden min-h-[calc(100vh-56px)]">
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

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <MoneyFundLogo className="w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 mb-4" />

        <h1 className="font-heading text-[36px] sm:text-[52px] md:text-[64px] font-semibold tracking-[3px] text-white leading-tight mb-2">
          Money<span className="text-gold">Fund</span>
        </h1>

        <p className="text-base sm:text-xl md:text-2xl font-light tracking-[0.05em] text-brand-400 max-w-2xl leading-relaxed">
          The World&rsquo;s Biggest Hedge Fun
        </p>

        <div className="flex items-center gap-4 mt-5">
          <span className="h-px w-12 bg-gold/40" />
          <span className="text-[11px] sm:text-[13px] tracking-[0.3em] uppercase font-semibold text-gold/70">
            Est. 1996
          </span>
          <span className="h-px w-12 bg-gold/40" />
        </div>
      </div>

      <div className="absolute top-8 left-8 w-16 h-16 border-l border-t border-gold/10" />
      <div className="absolute top-8 right-8 w-16 h-16 border-r border-t border-gold/10" />
      <div className="absolute bottom-8 left-8 w-16 h-16 border-l border-b border-gold/10" />
      <div className="absolute bottom-8 right-8 w-16 h-16 border-r border-b border-gold/10" />
    </div>
  );
}
