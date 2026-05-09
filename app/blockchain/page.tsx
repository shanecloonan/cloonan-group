import type { Metadata } from "next";
import dynamic from "next/dynamic";

const BlockchainLab = dynamic(() => import("./blockchain-lab"));

export const metadata: Metadata = {
  title: "Blockchain | MoneyFund",
  description:
    "MoneyFund Network — live cryptographic primitives. Schnorr signatures, Pedersen commitments, stealth addresses, and LSAG ring signatures executing in your browser on ed25519.",
};

export default function BlockchainPage() {
  return <BlockchainLab />;
}
