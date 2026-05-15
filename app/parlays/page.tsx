import type { Metadata } from "next";
import dynamic from "next/dynamic";

const ParlaysContent = dynamic(() => import("./parlays-content"));

export const metadata: Metadata = {
  title: "Parlays | Quantitative Arbitrageur",
  description:
    "The MoneyFund quantitative parlay engine — de-vigged true prices, Monte-Carlo correlation, Kelly-sized stakes.",
};

export default function ParlaysPage() {
  return <ParlaysContent />;
}
