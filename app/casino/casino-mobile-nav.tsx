"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/casino", label: "Play", match: (p: string) => p === "/casino" },
  { href: "/casino/dashboard", label: "Hub", match: (p: string) => p.startsWith("/casino/dashboard") },
  { href: "/casino/feed", label: "Feed", match: (p: string) => p.startsWith("/casino/feed") },
  { href: "/casino/leaderboard", label: "Ranks", match: (p: string) => p.startsWith("/casino/leaderboard") },
  { href: "/casino/wallet", label: "Wallet", match: (p: string) => p.startsWith("/casino/wallet") },
] as const;

/** Sticky bottom nav on phones — low-friction hopping between casino routes. */
export function CasinoMobileNav() {
  const pathname = usePathname();
  if (!pathname.startsWith("/casino")) return null;

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-white/[0.08] bg-[#06070c]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      aria-label="Casino navigation"
    >
      <div className="flex justify-around items-stretch h-14 max-w-lg mx-auto">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors " +
                (active ? "text-amber-300" : "text-white/45")
              }
            >
              <span
                className={
                  "w-1 h-1 rounded-full " + (active ? "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]" : "bg-transparent")
                }
              />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
