import type { Metadata } from "next";
import TestApp from "./test-app";

export const metadata: Metadata = {
  title: "ETH scanner triage",
  description: "Ethereum invariant-scanner triage. Run Lane A on one address. Not a verdict UI.",
  robots: { index: false, follow: false },
};

export default function TestPage() {
  return <TestApp />;
}
