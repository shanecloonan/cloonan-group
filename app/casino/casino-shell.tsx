"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CasinoMobileNav } from "./casino-mobile-nav";
import { casinoPage, casinoShellBg } from "./casino-ui";

const MAIN_NAV = [
  { href: "/casino", label: "Play", match: (p: string) => p === "/casino" },
  { href: "/casino/dashboard", label: "Dashboard", match: (p: string) => p.startsWith("/casino/dashboard") },
  { href: "/casino/feed", label: "Live feed", match: (p: string) => p.startsWith("/casino/feed") },
  { href: "/casino/leaderboard", label: "Rankings", match: (p: string) => p.startsWith("/casino/leaderboard") },
  { href: "/casino/history", label: "History", match: (p: string) => p.startsWith("/casino/history") },
  { href: "/casino/docs", label: "Docs", match: (p: string) => p.startsWith("/casino/docs") },
] as const;

const UTIL_NAV = [
  { href: "/casino/wallet", label: "Vault" },
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
      <header className="sticky top-0 z-40 border-b border-amber-500/10 bg-[#04050a]/92 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link href="/casino" className="flex items-center gap-2.5 shrink-0 group">
              <span
                className="hidden sm:flex h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-700 items-center justify-center text-black font-bold text-sm shadow-[0_0_24px_rgba(245,158,11,0.35)]"
                aria-hidden
              >
                ◆
              </span>
              <span className="text-xl font-heading font-semibold tracking-tight">
                Cloonan<span className="text-amber-400 group-hover:text-amber-300 transition-colors">Casino</span>
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-1 overflow-x-auto max-w-[min(54vw,560px)] scrollbar-none">
              {MAIN_NAV.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      "px-3.5 py-2 rounded-full text-[13px] font-medium transition-all whitespace-nowrap " +
                      (active
                        ? "bg-gradient-to-r from-amber-500/25 to-amber-600/10 text-amber-50 border border-amber-400/35 shadow-[0_0_16px_rgba(245,158,11,0.12)]"
                        : "text-white/55 hover:text-white hover:bg-white/[0.06] border border-transparent")
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
                  className="hidden md:inline-flex h-9 px-3.5 items-center rounded-full text-[12px] font-semibold text-amber-100/90 border border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-400/40 transition-all"
                >
                  {item.label}
                </Link>
              ))}
              <button
                type="button"
                className="md:hidden h-9 w-9 rounded-lg border border-white/[0.12] text-white/80 flex items-center justify-center cursor-pointer"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Menu"
              >
                {menuOpen ? "✕" : "☰"}
              </button>
            </div>
          </div>

          {menuOpen && (
            <nav className="md:hidden pb-4 flex flex-col gap-1 border-t border-white/[0.06] pt-3">
              {[...MAIN_NAV, ...UTIL_NAV.map((u) => ({ ...u, match: (p: string) => p.startsWith(u.href) }))].map(
                (item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={
                      "px-4 py-3 rounded-xl text-sm font-medium " +
                      (item.match(pathname)
                        ? "bg-amber-500/15 text-amber-100 border border-amber-400/25"
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
        <div className="border-b border-white/[0.05] bg-gradient-to-b from-amber-500/[0.06] via-transparent to-transparent">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-11">
            {badge && (
              <span className="inline-flex items-center gap-2 mb-3 text-[10px] uppercase tracking-[0.22em] text-amber-300/95 font-bold">
                <span className="h-px w-6 bg-gradient-to-r from-amber-400/80 to-transparent" />
                {badge}
              </span>
            )}
            {title && (
              <h1 className="font-heading text-3xl sm:text-[2.35rem] font-semibold tracking-tight text-white bg-gradient-to-r from-white via-white to-white/70 bg-clip-text">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-3 max-w-2xl text-white/50 text-sm sm:text-base leading-relaxed">{subtitle}</p>
            )}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10 pb-28 lg:pb-12">{children}</main>
      <CasinoMobileNav />
    </div>
  );
}
