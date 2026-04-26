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

      {/* Paper-stock grain — fine high-frequency noise, desaturated, blended
          softly over the dark base. Gives the hero a tactile banknote feel
          without introducing motion or competing with the logo. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18] mix-blend-soft-light"
      >
        <filter id="paperGrain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#paperGrain)" />
      </svg>

      {/* Edge vignette — mimics the darkening around the border of a banknote
          or archival paper stock. Pulls focus inward to the center. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />

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
