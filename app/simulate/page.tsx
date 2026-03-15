import type { Metadata } from "next";
import SimulateApp from "./simulate-app";

export const metadata: Metadata = {
  title: "MoneyFund Dividend Calculator",
  description:
    "Simulate your annual dividend yield from staked MFTL tokens across the MoneyFund protocol.",
  robots: { index: false, follow: false },
};

export default function SimulatePage() {
  return <SimulateApp />;
}
