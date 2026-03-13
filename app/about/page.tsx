import type { Metadata } from "next";
import AboutApp from "./about-app";

export const metadata: Metadata = {
  title: "MoneyFund Whitepaper",
  description:
    "MoneyFund whitepaper — tri-layer launchpad, fee structure, contract details, and FAQ.",
  robots: { index: false, follow: false },
};

export default function AboutPage() {
  return <AboutApp />;
}
