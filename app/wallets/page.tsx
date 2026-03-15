import type { Metadata } from "next";
import dynamic from "next/dynamic";

const WalletsApp = dynamic(() => import("./wallets-app"));

export const metadata: Metadata = {
  title: "MoneyFund Wallets",
  description: "Create, manage, and use Ethereum wallets on MoneyFund.",
  robots: { index: false, follow: false },
};

export default function WalletsPage() {
  return <WalletsApp />;
}
