import type { Metadata } from "next";
import DocsApp from "./docs-app";

export const metadata: Metadata = {
  title: "MoneyFund Docs — Visual Smart Contract Architecture",
  description:
    "Interactive visual documentation for every MoneyFund dApp — token flows, smart contract mechanics, fee structures, and architecture diagrams.",
  robots: { index: false, follow: false },
};

export default function DocsPage() {
  return <DocsApp />;
}
