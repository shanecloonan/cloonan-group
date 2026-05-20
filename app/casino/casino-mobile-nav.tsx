"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/casino", label: "Play", icon: "♠", match: (p: string) => p === "/casino" },
  { href: "/casino/dashboard", label: "Hub", icon: "◈", match: (p: string) => p.startsWith("/casino/dashboard") },
  {
    href: "/casino/history",
    label: "Bets",
    icon: "◎",
    match: (p: string) => p.startsWith("/casino/history") || p.startsWith("/casino/feed"),
  },
  { href: "/casino/leaderboard", label: "Ranks", icon: "★", match: (p: string) => p.startsWith("/casino/leaderboard") },
  { href: "/casino/wallet", label: "Vault", icon: "◇", match: (p: string) => p.startsWith("/casino/wallet") },
] as const;

/** Sticky bottom nav — thumb-friendly hopping between casino routes. */
export function CasinoMobileNav() {
  const pathname = usePathname();
  if (!pathname.startsWith("/casino")) return null;

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-amber-500/15 bg-[#04050a]/96 backdrop-blur-2xl pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgba(0,0,0,0.5)]"
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
                (active ? "text-amber-300" : "text-white/40")
              }
            >
              <span
                className={
                  "text-base leading-none " +
                  (active ? "drop-shadow-[0_0_8px_rgba(245,158,11,0.7)]" : "")
                }
              >
                {t.icon}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-[0.14em]">{t.label}</span>
              {active && (
                <span className="absolute bottom-1 w-8 h-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-600" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
