import type { Metadata } from "next";
import AuctionApp from "./auction-app";

export const metadata: Metadata = {
  title: "Ad Auction Platform",
  description: "Deploy and manage ad auction contracts on Ethereum.",
  robots: { index: false, follow: false },
};

export default function AuctionPage() {
  return <AuctionApp />;
}
