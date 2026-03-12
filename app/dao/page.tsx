import type { Metadata } from "next";
import DaoApp from "./dao-app";

export const metadata: Metadata = {
  title: "MoneyFund DAO Launchpad",
  description: "Launch and manage DAOs on Ethereum.",
  robots: { index: false, follow: false },
};

export default function DaoPage() {
  return <DaoApp />;
}
