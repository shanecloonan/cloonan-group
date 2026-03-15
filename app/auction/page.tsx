import type { Metadata } from "next";
import dynamic from "next/dynamic";

const AuctionApp = dynamic(() => import("./auction-app"));

export const metadata: Metadata = {
  title: "Ad Auction Platform",
  description: "Deploy and manage ad auction contracts on Ethereum.",
  robots: { index: false, follow: false },
};

export default function AuctionPage() {
  return <AuctionApp />;
}
