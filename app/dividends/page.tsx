import type { Metadata } from "next";
import DividendsApp from "./dividends-app";

export const metadata: Metadata = {
  title: "Dividend Pool Launcher",
  description: "Launch and manage dividend staking pools on Ethereum.",
  robots: { index: false, follow: false },
};

export default function DividendsPage() {
  return <DividendsApp />;
}
