import type { Metadata } from "next";
import DexApp from "./dex-app";

export const metadata: Metadata = {
  title: "MoneyFund DEX",
  description: "MoneyFund decentralized exchange.",
  robots: { index: false, follow: false },
};

export default function DexPage() {
  return <DexApp />;
}
