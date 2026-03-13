import type { Metadata } from "next";
import AirdropApp from "./airdrop-app";

export const metadata: Metadata = {
  title: "MoneyFund Airdrop",
  description: "Send ERC-20 token airdrops to multiple recipients on Ethereum.",
  robots: { index: false, follow: false },
};

export default function AirdropPage() {
  return <AirdropApp />;
}
