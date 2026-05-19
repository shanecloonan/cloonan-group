import type { Metadata } from "next";
import dynamic from "next/dynamic";

const CasinoContent = dynamic(() => import("./casino-content"));

export const metadata: Metadata = {
  title: "Casino | MoneyFund",
  description:
    "MoneyFund Casino — a provably-fair, multi-chain crypto casino. Blackjack live now; full roadmap of games on Ethereum + Solana.",
};

export default function CasinoPage() {
  return <CasinoContent />;
}
