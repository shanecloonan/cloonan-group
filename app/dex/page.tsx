import type { Metadata } from "next";
import dynamic from "next/dynamic";

const DexApp = dynamic(() => import("./dex-app"));

export const metadata: Metadata = {
  title: "MoneyFund DEX",
  description: "MoneyFund decentralized exchange.",
  robots: { index: false, follow: false },
};

export default function DexPage() {
  return <DexApp />;
}
