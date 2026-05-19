import dynamic from "next/dynamic";

const VerifyContent = dynamic(() => import("./verify-content"), {
  ssr: false,
  loading: () => <div className="p-8 text-white/60">Loading verifier…</div>,
});

export const metadata = {
  title: "Verify hand · Casino · MoneyFund",
  description:
    "Paste a casino hand and the revealed server seed. Your browser re-derives every card / roll / coinflip locally — proof that the house didn't cheat.",
};

export default function VerifyPage() {
  return <VerifyContent />;
}
