"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CasinoMobileNav } from "./casino-mobile-nav";
import { casinoPage, casinoShellBg, pillGold } from "./casino-ui";

const MAIN_NAV = [
  { href: "/casino", label: "Play", match: (p: string) => p === "/casino" },
  { href: "/casino/dashboard", label: "Dashboard", match: (p: string) => p.startsWith("/casino/dashboard") },
  { href: "/casino/leaderboard", label: "Leaderboard", match: (p: string) => p.startsWith("/casino/leaderboard") },
  { href: "/casino/feed", label: "Live feed", match: (p: string) => p.startsWith("/casino/feed") },
  { href: "/casino/history", label: "History", match: (p: string) => p.startsWith("/casino/history") },
  { href: "/casino/docs", label: "Docs", match: (p: string) => p.startsWith("/casino/docs") },
] as const;

const UTIL_NAV = [
  { href: "/casino/wallet", label: "Wallet" },
  { href: "/casino/verify", label: "Verify" },
] as const;

export function CasinoShell({
  children,
  title,
  subtitle,
  badge,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  badge?: string;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={casinoPage + " " + casinoShellBg}>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#06070c]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link href="/casino" className="flex items-center gap-2 shrink-0 group">
              <span className="text-xl font-heading font-semibold tracking-tight">
                Casino<span className="text-amber-400 group-hover:text-amber-300 transition-colors">.</span>
              </span>
              <span className={pillGold + " hidden sm:inline-flex"}>Private</span>
            </Link>

            <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto max-w-[min(52vw,520px)] scrollbar-none">
              {MAIN_NAV.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      "px-4 py-2 rounded-xl text-sm font-medium transition-all " +
                      (active
                        ? "bg-amber-500/15 text-amber-100 border border-amber-400/30"
                        : "text-white/60 hover:text-white hover:bg-white/[0.05]")
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              {UTIL_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hidden md:inline-flex h-9 px-3 items-center rounded-lg text-[12px] font-medium text-white/60 border border-white/[0.08] hover:border-amber-400/30 hover:text-amber-100 transition-all"
                >
                  {item.label}
                </Link>
              ))}
              <button
                type="button"
                className="lg:hidden h-9 w-9 rounded-lg border border-white/[0.1] text-white/80 flex items-center justify-center cursor-pointer"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Menu"
              >
                {menuOpen ? "✕" : "☰"}
              </button>
            </div>
          </div>

          {menuOpen && (
            <nav className="lg:hidden pb-4 flex flex-col gap-1 border-t border-white/[0.06] pt-3">
              {[...MAIN_NAV, ...UTIL_NAV.map((u) => ({ ...u, match: (p: string) => p.startsWith(u.href) }))].map(
                (item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={
                      "px-4 py-3 rounded-xl text-sm font-medium " +
                      (item.match(pathname)
                        ? "bg-amber-500/15 text-amber-100"
                        : "text-white/70 hover:bg-white/[0.05]")
                    }
                  >
                    {item.label}
                  </Link>
                ),
              )}
            </nav>
          )}
        </div>
      </header>

      {(title || subtitle) && (
        <div className="border-b border-white/[0.05] bg-gradient-to-b from-white/[0.03] to-transparent">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
            {badge && (
              <span className="inline-block mb-2 text-[10px] uppercase tracking-[0.2em] text-amber-300/90 font-semibold">
                {badge}
              </span>
            )}
            {title && (
              <h1 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-white">{title}</h1>
            )}
            {subtitle && (
              <p className="mt-2 max-w-2xl text-white/55 text-sm sm:text-base leading-relaxed">{subtitle}</p>
            )}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10 pb-24 lg:pb-28">{children}</main>
      <CasinoMobileNav />
    </div>
  );
}
