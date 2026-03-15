import type { Metadata } from "next";
import dynamic from "next/dynamic";

const MultiswapApp = dynamic(() => import("./multiswap-app"));

export const metadata: Metadata = {
  title: "Multiswap Factory",
  description: "Deploy custom multiswap and airdrop contracts on Ethereum.",
  robots: { index: false, follow: false },
};

export default function MultiswapPage() {
  return <MultiswapApp />;
}
