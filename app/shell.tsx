"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import Navbar from "./navbar";
import { WalletProvider } from "@/lib/wallet-context";

/** Standalone product surfaces that skip MoneyFund chrome. */
const STANDALONE = ["/testnet"];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const standalone = STANDALONE.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (standalone) {
    return <>{children}</>;
  }

  return (
    <WalletProvider>
      <Navbar />
      <div className="pt-14">{children}</div>
    </WalletProvider>
  );
}
