import type { Metadata } from "next";
import dynamic from "next/dynamic";

const NetworkContent = dynamic(() => import("./network-content"));

export const metadata: Metadata = {
  title: "Network | MoneyFund",
  description:
    "The MoneyFund Network — decoupled zkVM consensus for yield-sustained data permanence. Whitepaper v6.1 + architecture illustration v6.2.",
};

export default function NetworkPage() {
  return <NetworkContent />;
}
