"use client";

import { usePathname } from "next/navigation";

/**
 * Banknote paper stack — global app background.
 *
 * Renders fixed behind everything (z-index: -1) on every route EXCEPT
 * `/about`, which has its own dense whitepaper-style design system that
 * conflicts visually with this texture.
 *
 * Layering from bottom up:
 *   1. Deep intaglio-green base gradient (US currency ink colour)
 *   2. Warm central glow (paper catching light behind a portrait)
 *   3. Guilloché ring pattern (engine-turned currency rosettes)
 *   4. Crossed engraving hairlines (intaglio line art)
 *   5. High-frequency fractal grain (paper fibre tooth)
 *   6. Edge vignette (archival paper falloff)
 */
export default function BanknoteBackground() {
  const pathname = usePathname();
  if (pathname?.startsWith("/about")) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: -1 }}
    >
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

      <svg className="absolute inset-0 h-full w-full opacity-[0.6]">
        <defs>
          <pattern
            id="bgWavesA"
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
            id="bgWavesB"
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
        <rect width="100%" height="100%" fill="url(#bgWavesA)" />
        <rect width="100%" height="100%" fill="url(#bgWavesB)" />
      </svg>

      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: `
            repeating-linear-gradient(45deg, transparent 0, transparent 4px, rgba(176,214,188,0.05) 4px, rgba(176,214,188,0.05) 5px)
          `,
        }}
      />

      <svg className="absolute inset-0 h-full w-full opacity-[0.22] mix-blend-soft-light">
        <filter id="bgPaperGrain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#bgPaperGrain)" />
      </svg>

      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 50%, transparent 55%, rgba(0,0,0,0.6) 100%)",
        }}
      />
    </div>
  );
}
