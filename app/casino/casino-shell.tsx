"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CasinoMobileNav } from "./casino-mobile-nav";
import { casinoPage, casinoShellBg } from "./casino-ui";

const DESKTOP_NAV = [
  { href: "/casino", label: "Games", match: (p: string) => p === "/casino" },
  { href: "/casino/dashboard", label: "Dashboard", match: (p: string) => p.startsWith("/casino/dashboard") },
  { href: "/casino/history", label: "Activity", match: (p: string) => p.startsWith("/casino/history") || p.startsWith("/casino/feed") },
  { href: "/casino/leaderboard", label: "Rankings", match: (p: string) => p.startsWith("/casino/leaderboard") },
] as const;

function CasinoShellInner({
  children,
  title,
  subtitle,
  badge,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  badge?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inTable = pathname === "/casino" && !!searchParams.get("game");

  return (
    <div className={casinoPage + " " + casinoShellBg}>
      <header className="sticky top-0 z-40 border-b border-[#c6a15b]/20 bg-[#070806]/90 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-4">
            <Link href="/casino" className="flex items-center gap-3 shrink-0 group">
              <span
                className="hidden sm:flex h-8 w-8 rounded-full border border-[#e8d5a3]/50 items-center justify-center text-[#e8d5a3] text-[11px]"
                aria-hidden
              >
                ◆
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-[9px] tracking-[0.42em] uppercase text-[#c6a15b]/80">MoneyFund</span>
                <span className="mt-1 text-[15px] sm:text-base font-heading font-semibold tracking-[0.22em] uppercase text-[#f6f1e7]">
                  Salon
                </span>
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-1" aria-label="Casino sections">
              {DESKTOP_NAV.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      "px-3.5 py-1.5 rounded-full text-[11px] tracking-[0.16em] uppercase font-medium transition-colors " +
                      (active
                        ? "text-[#f6ecd4] bg-[#c6a15b]/15 border border-[#c6a15b]/40"
                        : "text-[#f6f1e7]/50 hover:text-[#f6f1e7] hover:bg-white/[0.04] border border-transparent")
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/casino/wallet"
                className="ml-2 px-3.5 py-1.5 rounded-full text-[11px] tracking-[0.16em] uppercase font-medium text-[#e8d5a3]/80 hover:text-[#f6ecd4] border border-[#c6a15b]/25 hover:border-[#e8d5a3]/50"
              >
                Vault
              </Link>
            </nav>

            <Link
              href="/casino/wallet"
              className="md:hidden text-[10px] tracking-[0.18em] uppercase font-medium text-[#e8d5a3] px-2.5 py-1.5 rounded-full border border-[#c6a15b]/35"
            >
              Vault
            </Link>
          </div>
        </div>
      </header>

      {(title || subtitle) && (
        <div className="border-b border-[#c6a15b]/10 bg-gradient-to-b from-[#c6a15b]/[0.06] to-transparent">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-9">
            {badge && (
              <span className="inline-block mb-2 text-[10px] uppercase tracking-[0.28em] text-[#c6a15b] font-semibold">
                {badge}
              </span>
            )}
            {title && <h1 className="font-heading text-2xl sm:text-4xl font-semibold tracking-tight text-[#f6f1e7]">{title}</h1>}
            {subtitle && <p className="mt-2 max-w-2xl text-[#f6f1e7]/50 text-sm leading-relaxed">{subtitle}</p>}
          </div>
        </div>
      )}

      <main
        className={
          "max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 " + (inTable ? "pb-6 lg:pb-10" : "pb-24 lg:pb-10")
        }
      >
        {children}
      </main>
      <CasinoMobileNav />
    </div>
  );
}

export function CasinoShell(props: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  badge?: string;
}) {
  return (
    <Suspense fallback={<div className={casinoPage + " min-h-[40vh]"} />}>
      <CasinoShellInner {...props} />
    </Suspense>
  );
}
