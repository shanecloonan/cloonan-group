import type { Metadata } from "next";
import dynamic from "next/dynamic";

const DaoApp = dynamic(() => import("./dao-app"));

export const metadata: Metadata = {
  title: "MoneyFund DAO Launchpad",
  description: "Launch and manage DAOs on Ethereum.",
  robots: { index: false, follow: false },
};

export default function DaoPage() {
  return <DaoApp />;
}
