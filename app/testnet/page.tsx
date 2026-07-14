import type { Metadata } from "next";
import TestnetApp from "./testnet-app";

export const metadata: Metadata = {
  title: {
    absolute: "Permawrite Public Testnet",
  },
  description:
    "Permawrite experimental public testnet — join steps, boot peers, and live tip from the public mesh.",
  robots: { index: true, follow: true },
};

export default function TestnetPage() {
  return <TestnetApp />;
}
