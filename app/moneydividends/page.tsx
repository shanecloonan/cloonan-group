import type { Metadata } from "next";
import MoneyDividendsApp from "./moneydividends-app";

export const metadata: Metadata = {
  title: "MoneyFund Dividends",
  description: "Stake MONEY tokens and claim ETH and ERC-20 dividend rewards.",
  robots: { index: false, follow: false },
};

export default function MoneyDividendsPage() {
  return <MoneyDividendsApp />;
}
