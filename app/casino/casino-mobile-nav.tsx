"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const TABS = [
  { href: "/casino", label: "Games", icon: "▦", match: (p: string) => p === "/casino" },
  { href: "/casino/dashboard", label: "Stats", icon: "◈", match: (p: string) => p.startsWith("/casino/dashboard") },
  {
    href: "/casino/history",
    label: "Bets",
    icon: "◎",
    match: (p: string) => p.startsWith("/casino/history") || p.startsWith("/casino/feed"),
  },
  { href: "/casino/leaderboard", label: "Top", icon: "★", match: (p: string) => p.startsWith("/casino/leaderboard") },
  { href: "/casino/wallet", label: "Vault", icon: "◇", match: (p: string) => p.startsWith("/casino/wallet") },
] as const;

function CasinoMobileNavInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!pathname.startsWith("/casino")) return null;
  if (pathname === "/casino" && searchParams.get("game")) return null;

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-[#c6a15b]/25 bg-[#070806]/96 backdrop-blur-2xl pb-[env(safe-area-inset-bottom)] shadow-[0_-16px_40px_rgba(0,0,0,0.55)]"
      aria-label="Casino navigation"
    >
      <div className="flex justify-around items-stretch h-[3.25rem] max-w-lg mx-auto px-1">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                "relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-all " +
                (active ? "text-[#e8d5a3]" : "text-[#f6f1e7]/35")
              }
            >
              <span className="text-[13px] leading-none">{t.icon}</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em]">{t.label}</span>
              {active && <span className="absolute bottom-1 w-6 h-px bg-[#e8d5a3]" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Sticky bottom nav — hidden while a table is open on /casino?game= */
export function CasinoMobileNav() {
  return (
    <Suspense fallback={null}>
      <CasinoMobileNavInner />
    </Suspense>
  );
}
