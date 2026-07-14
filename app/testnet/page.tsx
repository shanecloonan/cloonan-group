import type { Metadata } from "next";
import TestnetApp from "./testnet-app";

export const metadata: Metadata = {
  title: {
    absolute: "Permawrite Public Testnet",
  },
  description:
    "Join the Permawrite experimental public testnet — observer setup, boot peers, and lite live tip when an RPC proxy is configured.",
  robots: { index: true, follow: true },
};

export default function TestnetPage() {
  return <TestnetApp />;
}
