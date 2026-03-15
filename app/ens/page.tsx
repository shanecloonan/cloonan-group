import type { Metadata } from "next";
import EnsApp from "./ens-app";

export const metadata: Metadata = {
  title: "ENS Domain Registration",
  description: "Register .eth domain names on Ethereum Mainnet via MoneyFund.",
  robots: { index: false, follow: false },
};

export default function EnsPage() {
  return <EnsApp />;
}
