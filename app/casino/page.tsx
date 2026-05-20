import type { Metadata } from "next";
import dynamic from "next/dynamic";

const CasinoContent = dynamic(() => import("./casino-content"));

export const metadata: Metadata = {
  title: "Casino | MoneyFund",
  description:
    "MoneyFund Casino — ten provably-fair games, live leaderboards, on-chain vault, and multiplayer poker.",
};

export default function CasinoPage() {
  return <CasinoContent />;
}
