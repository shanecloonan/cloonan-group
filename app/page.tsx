import type { Metadata } from "next";
import MoneyFundLogo from "./money-fund-logo";

export const metadata: Metadata = {
  title: "MoneyFund | The World's Biggest Hedge Fun",
  description: "MoneyFund — The World's Biggest Hedge Fun.",
};

export default function Home() {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden min-h-[calc(100vh-56px)]">
      {/*
        Banknote paper stack — each layer is intentionally subtle so the
        hero artwork/text stays the focal point. Layering from bottom up:

          1. Deep intaglio-green base gradient (US currency ink colour)
          2. Warm central glow (paper catching light behind a portrait)
          3. Guilloché ring pattern (engine-turned currency rosettes)
          4. Crossed engraving hairlines (intaglio line art)
          5. High-frequency fractal grain (paper fibre tooth)
          6. Edge vignette (archival paper falloff)
      */}

      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 80% at 50% 35%, #132922 0%, #0b1b14 55%, #050e0a 100%)",
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 42%, rgba(212,168,67,0.10), transparent 70%)",
        }}
      />

      {/*
        Guilloché waves — three interwoven bands of sinusoidal curves.
        This is the actual engraving style used on banknotes (engine-
        turning / Spirograph-derived). We layer two copies at different
        rotations so the eye reads it as a braided mesh rather than a
        repeating stamp.
      */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.6]"
      >
        <defs>
          <pattern
            id="wavesA"
            x="0"
            y="0"
            width="160"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <g stroke="rgba(176,214,188,0.15)" strokeWidth="0.5" fill="none">
              <path d="M 0,6  Q 20,-6 40,6  T 80,6  T 120,6  T 160,6" />
              <path d="M 0,12 Q 20,0  40,12 T 80,12 T 120,12 T 160,12" />
              <path d="M 0,18 Q 20,6  40,18 T 80,18 T 120,18 T 160,18" />
            </g>
          </pattern>
          <pattern
            id="wavesB"
            x="0"
            y="0"
            width="160"
            height="24"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(28)"
          >
            <g stroke="rgba(176,214,188,0.11)" strokeWidth="0.45" fill="none">
              <path d="M 0,6  Q 20,-6 40,6  T 80,6  T 120,6  T 160,6" />
              <path d="M 0,12 Q 20,0  40,12 T 80,12 T 120,12 T 160,12" />
              <path d="M 0,18 Q 20,6  40,18 T 80,18 T 120,18 T 160,18" />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wavesA)" />
        <rect width="100%" height="100%" fill="url(#wavesB)" />
      </svg>

      {/* Faint diagonal intaglio hairlines — reinforces the etched-paper feel
          without competing with the waves. Kept very low alpha. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: `
            repeating-linear-gradient(45deg, transparent 0, transparent 4px, rgba(176,214,188,0.05) 4px, rgba(176,214,188,0.05) 5px)
          `,
        }}
      />

      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.22] mix-blend-soft-light"
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

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 50%, transparent 55%, rgba(0,0,0,0.6) 100%)",
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
