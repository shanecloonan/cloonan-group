"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Tools", href: "/tools" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div className="bg-brand-950/80 backdrop-blur-xl border-b border-brand-800/60">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-base font-bold tracking-tight text-brand-100 group-hover:text-gold transition-colors">
              Money<span className="text-gold">Fund</span>
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden sm:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-1.5 text-[11px] tracking-[0.15em] uppercase font-semibold rounded-md transition-colors ${
                  isActive(item.href)
                    ? "text-gold bg-gold/10"
                    : "text-brand-400 hover:text-brand-100 hover:bg-brand-800/50"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="sm:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px] group"
            aria-label="Toggle menu"
          >
            <span
              className={`block w-5 h-[1.5px] bg-brand-300 transition-all origin-center ${open ? "rotate-45 translate-y-[6.5px]" : ""}`}
            />
            <span
              className={`block w-5 h-[1.5px] bg-brand-300 transition-all ${open ? "opacity-0" : ""}`}
            />
            <span
              className={`block w-5 h-[1.5px] bg-brand-300 transition-all origin-center ${open ? "-rotate-45 -translate-y-[6.5px]" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="sm:hidden bg-brand-950/95 backdrop-blur-xl border-b border-brand-800/60">
          <div className="px-5 py-3 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`px-4 py-3 text-[11px] tracking-[0.15em] uppercase font-semibold rounded-lg transition-colors ${
                  isActive(item.href)
                    ? "text-gold bg-gold/10"
                    : "text-brand-400 hover:text-brand-100 hover:bg-brand-800/50"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
