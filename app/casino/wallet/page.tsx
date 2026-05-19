import type { Metadata } from "next";
import WalletContent from "./wallet-content";

export const metadata: Metadata = {
  title: "Casino Wallet | MoneyFund",
  description:
    "Deposit, withdraw, and audit on-chain casino balances. Provably fair, multi-chain, EIP-712 authorized withdrawals.",
};

export default function CasinoWalletPage() {
  return <WalletContent />;
}
