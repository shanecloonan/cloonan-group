import VerifyContent from "./verify-content";

export const metadata = {
  title: "Verify hand · Casino · MoneyFund",
  description:
    "Paste a casino hand and the revealed server seed. Your browser re-derives every card / roll / coinflip locally — proof that the house didn't cheat.",
};

export default function VerifyPage() {
  return <VerifyContent />;
}
