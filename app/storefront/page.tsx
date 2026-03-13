import type { Metadata } from "next";
import StorefrontApp from "./storefront-app";

export const metadata: Metadata = {
  title: "NFT Storefront Launchpad",
  description: "Deploy and manage NFT storefront contracts on Ethereum.",
  robots: { index: false, follow: false },
};

export default function StorefrontPage() {
  return <StorefrontApp />;
}
