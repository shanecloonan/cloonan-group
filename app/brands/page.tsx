import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brands | MoneyFund",
  description: "MoneyFund portfolio brands — AntlerGear, DeltaMorph, ChipFab, PermaWrite, FileDisplay.",
};

const BRANDS: {
  name: string;
  url: string;
  tagline: string;
  description: string;
  accent: string;
  border: string;
  bg: string;
  glow: string;
  icon: string;
}[] = [
  {
    name: "DeltaMorph",
    url: "https://deltamorph.com",
    tagline: "Parent Nexus",
    description: "Parent holding company and profit-distribution nexus. Receives all subsidiary revenue and channels it upstream to the vault. Holds 100% of every subsidiary.",
    accent: "text-brand-200",
    border: "border-brand-400/30",
    bg: "from-brand-400/8 to-brand-400/2",
    glow: "group-hover:shadow-brand-400/10",
    icon: "△",
  },
  {
    name: "AntlerGear",
    url: "https://antlergear.com",
    tagline: "Hunting Gear",
    description: "Premium bowhunting equipment. Purpose-built gear for serious bowhunters who demand performance in the field.",
    accent: "text-amber-400",
    border: "border-amber-500/30",
    bg: "from-amber-500/8 to-amber-500/2",
    glow: "group-hover:shadow-amber-500/10",
    icon: "◈",
  },
  {
    name: "PermaWrite",
    url: "https://permawrite.com",
    tagline: "Permanent Storage",
    description: "Decentralized permanent data storage solutions built on Arweave infrastructure. Upload once, stored forever — no hosting fees, no expiration.",
    accent: "text-sky-400",
    border: "border-sky-400/30",
    bg: "from-sky-400/8 to-sky-400/2",
    glow: "group-hover:shadow-sky-400/10",
    icon: "◫",
  },
  {
    name: "ChipFab",
    url: "https://chipfab.com",
    tagline: "Semiconductor Research",
    description: "Semiconductor research company focused on next-generation chip design and fabrication processes.",
    accent: "text-violet-400",
    border: "border-violet-400/30",
    bg: "from-violet-400/8 to-violet-400/2",
    glow: "group-hover:shadow-violet-400/10",
    icon: "⬡",
  },
  {
    name: "FileDisplay",
    url: "https://filedisplay.com",
    tagline: "Internal-Tooling SaaS",
    description: "Internal tooling SaaS platform for operations across all subsidiaries. Centralized dashboards and workflow automation.",
    accent: "text-emerald-400",
    border: "border-emerald-400/30",
    bg: "from-emerald-400/8 to-emerald-400/2",
    glow: "group-hover:shadow-emerald-400/10",
    icon: "◉",
  },
];

export default function BrandsPage() {
  return (
    <div className="min-h-screen bg-brand-950">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(212,168,67,0.06),transparent)]" />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(212,168,67,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(212,168,67,0.3) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />

        <div className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 pt-24 sm:pt-32 pb-20">

          {/* Header */}
          <div className="text-center mb-16 sm:mb-20">
            <div className="flex items-center justify-center gap-3 mb-6">
              <span className="h-px w-10 bg-gold/40" />
              <span className="text-[10px] tracking-[0.3em] uppercase font-semibold text-gold/60">
                Portfolio
              </span>
              <span className="h-px w-10 bg-gold/40" />
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-brand-100 mb-4">
              Our <span className="text-gold">Brands</span>
            </h1>
            <p className="text-sm sm:text-base text-brand-400 max-w-lg mx-auto leading-relaxed">
              The companies and products that make up the MoneyFund ecosystem.
            </p>
          </div>

          {/* Brand Cards */}
          <div className="space-y-4 sm:space-y-5">
            {BRANDS.map((brand) => (
              <a
                key={brand.name}
                href={brand.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`group block rounded-2xl border ${brand.border} bg-gradient-to-br ${brand.bg} backdrop-blur-sm transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl ${brand.glow} overflow-hidden`}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 p-5 sm:p-7">
                  {/* Icon */}
                  <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl border ${brand.border} bg-brand-950/60 flex items-center justify-center text-2xl sm:text-3xl ${brand.accent} shrink-0 transition-transform duration-300 group-hover:scale-110`}>
                    {brand.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className={`text-xl sm:text-2xl font-bold tracking-tight ${brand.accent} transition-colors`}>
                        {brand.name}
                      </h2>
                      <span className={`text-[9px] tracking-[0.12em] uppercase font-semibold px-2.5 py-0.5 rounded-full border ${brand.border} ${brand.accent} opacity-50`}>
                        {brand.tagline}
                      </span>
                    </div>
                    <p className="text-sm text-brand-400 leading-relaxed mt-1">
                      {brand.description}
                    </p>
                    <span className="inline-block mt-3 text-[10px] tracking-[0.15em] uppercase font-semibold text-brand-500 group-hover:text-brand-300 transition-colors">
                      {brand.url.replace("https://", "")} →
                    </span>
                  </div>

                  {/* Arrow */}
                  <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-full border border-white/[0.06] text-brand-600 group-hover:text-brand-300 group-hover:border-white/[0.12] transition-all shrink-0">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8h10M9 4l4 4-4 4" />
                    </svg>
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* Footer note */}
          <div className="text-center mt-14 sm:mt-16">
            <div className="inline-flex items-center gap-3">
              <span className="h-px w-8 bg-brand-800" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-brand-600 font-medium">
                A MoneyFund Company
              </span>
              <span className="h-px w-8 bg-brand-800" />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
