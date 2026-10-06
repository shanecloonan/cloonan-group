import type { Metadata } from "next";
import dynamic from "next/dynamic";

const CasinoContent = dynamic(() => import("./casino-content"));

export const metadata: Metadata = {
  title: "Casino | MoneyFund",
  description:
    "MoneyFund Salon — provably fair tables, a private vault, and the Monte Carlo floor.",
};

export default function CasinoPage() {
  return <CasinoContent />;
}
