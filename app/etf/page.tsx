import type { Metadata } from "next";
import dynamic from "next/dynamic";

const EtfApp = dynamic(() => import("./etf-app"));

export const metadata: Metadata = {
  title: "MoneyFund ETF Launchpad",
  description: "Launch and manage ETFs on Ethereum with MoneyFund.",
  robots: { index: false, follow: false },
};

export default function EtfPage() {
  return <EtfApp />;
}
