"use client";

import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "./auth-panel";

interface WalletBarProps {
  onLog?: (msg: string, status?: "pending" | "success" | "error") => void;
  selectCls?: string;
  btnCls?: string;
  cardCls?: string;
}

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export default function WalletBar({ onLog, selectCls, btnCls, cardCls }: WalletBarProps) {
  const {
    user, vaultUnlocked, isLoading,
    ethWallets, selectedEthAddress, selectEthWallet, connectMetaMask,
  } = useWallet();

  const defaultSelect = "h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all appearance-none cursor-pointer";
  const defaultBtn = "h-11 px-5 rounded-xl font-semibold text-sm border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer";
  const defaultCard = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

  const sCls = selectCls ?? defaultSelect;
  const bCls = btnCls ?? defaultBtn;
  const cCls = cardCls ?? defaultCard;

  if (isLoading) {
    return <div className={`${cCls} p-4`}><p className="text-white/30 text-sm animate-pulse">Loading wallet...</p></div>;
  }

  if (!user || !vaultUnlocked) {
    return <AuthPanel inline />;
  }

  return (
    <div className={`${cCls} p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center`}>
      <select
        value={selectedEthAddress ?? ""}
        onChange={(e) => selectEthWallet(e.target.value || null)}
        className={`flex-1 ${sCls}`}
      >
        <option value="">Select wallet...</option>
        {ethWallets.map((w) => (
          <option key={w.address} value={w.address}>{shorten(w.address)} ({w.type})</option>
        ))}
      </select>
      <button
        type="button"
        onClick={async () => {
          try {
            const addr = await connectMetaMask();
            onLog?.(`MetaMask connected: ${shorten(addr)}`, "success");
          } catch (e: unknown) {
            onLog?.(e instanceof Error ? e.message : "MetaMask failed", "error");
          }
        }}
        className={bCls}
      >
        {ethWallets.some((w) => w.type === "metamask") ? "Reconnect MetaMask" : "Connect MetaMask"}
      </button>
      {selectedEthAddress && (
        <span className="text-[10px] text-white/30 font-mono hidden sm:inline">{shorten(selectedEthAddress)}</span>
      )}
    </div>
  );
}
