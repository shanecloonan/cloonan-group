import type { Metadata } from "next";
import EtfApp from "./etf-app";

export const metadata: Metadata = {
  title: "MoneyFund ETF Launchpad",
  description: "Launch and manage ETFs on Ethereum with MoneyFund.",
  robots: { index: false, follow: false },
};

export default function EtfPage() {
  return <EtfApp />;
}
