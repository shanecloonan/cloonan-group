import type { Metadata } from "next";
import DocsContent from "./docs-content";

export const metadata: Metadata = {
  title: "Casino Docs | MoneyFund",
  description: "Rules, odds, provable fairness, and on-chain settlement for every MoneyFund Casino game.",
};

export default function CasinoDocsPage() {
  return <DocsContent />;
}
