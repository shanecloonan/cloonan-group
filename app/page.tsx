import type { Metadata } from "next";
import MoneyFundLogo from "./money-fund-logo";

export const metadata: Metadata = {
  title: "MoneyFund | The World's Biggest Hedge Fun",
  description: "MoneyFund — The World's Biggest Hedge Fun.",
};

export default function Home() {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-[calc(100vh-56px)]">
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <MoneyFundLogo className="w-64 h-64 sm:w-72 sm:h-72 md:w-72 md:h-72 lg:w-80 lg:h-80 mb-4" />

        <h1 className="font-heading text-[36px] sm:text-[44px] md:text-[48px] lg:text-[56px] font-semibold tracking-[3px] text-white leading-tight mb-2">
          MoneyFund
        </h1>

        <p className="text-base sm:text-lg md:text-lg lg:text-xl font-light tracking-[0.05em] text-brand-400 max-w-2xl leading-relaxed">
          The World&rsquo;s Biggest Hedge Fun
        </p>

        <div className="flex items-center gap-4 mt-5">
          <span className="h-px w-10 md:w-12 bg-gold/40" />
          <span className="text-[11px] sm:text-[12px] md:text-[12px] tracking-[0.3em] uppercase font-semibold text-gold/70">
            Est. 1996
          </span>
          <span className="h-px w-10 md:w-12 bg-gold/40" />
        </div>
      </div>
    </div>
  );
}
