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
      <header className="sticky top-0 z-40 border-b border-amber-500/10 bg-[#04050a]/92 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-12 sm:h-14 gap-4">
            <Link href="/casino" className="flex items-center gap-2 shrink-0 group">
              <span
                className="hidden sm:flex h-7 w-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-700 items-center justify-center text-black font-bold text-xs"
                aria-hidden
              >
                ◆
              </span>
              <span className="text-base sm:text-lg font-heading font-semibold tracking-tight">
                Casino
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
                      "px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors " +
                      (active
                        ? "text-amber-100 bg-amber-500/15 border border-amber-400/30"
                        : "text-white/55 hover:text-white hover:bg-white/[0.05] border border-transparent")
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/casino/wallet"
                className="ml-1 px-3 py-1.5 rounded-full text-[12px] font-medium text-white/55 hover:text-amber-100 border border-white/[0.08] hover:border-amber-400/30"
              >
                Vault
              </Link>
            </nav>

            <Link
              href="/casino/wallet"
              className="md:hidden text-xs font-medium text-amber-200/90 px-2.5 py-1.5 rounded-lg border border-amber-500/25"
            >
              Vault
            </Link>
          </div>
        </div>
      </header>

      {(title || subtitle) && (
        <div className="border-b border-white/[0.05] bg-gradient-to-b from-amber-500/[0.05] to-transparent">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            {badge && (
              <span className="inline-block mb-2 text-[10px] uppercase tracking-[0.2em] text-amber-300/90 font-bold">
                {badge}
              </span>
            )}
            {title && <h1 className="font-heading text-2xl sm:text-3xl font-semibold text-white">{title}</h1>}
            {subtitle && <p className="mt-2 max-w-2xl text-white/50 text-sm leading-relaxed">{subtitle}</p>}
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
