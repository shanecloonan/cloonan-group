"use client";

import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import PermawriteContent from "./permawrite-content";

export default function PermawritePage() {
  const { user, vaultUnlocked, isLoading } = useWallet();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#08090e" }}>
        <p className="text-white/30 text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user || !vaultUnlocked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8" style={{ background: "#08090e" }}>
        <div className="w-full max-w-md space-y-5">
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
              Perma<span className="text-sky-400">Write</span>
            </h1>
            <p className="text-xs text-white/30 mt-1">Sign in to access your permanent storage</p>
          </div>
          <AuthPanel inline />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[960px] mx-auto space-y-5">
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
            Perma<span className="text-sky-400">Write</span>
          </h1>
          <p className="text-xs text-white/30 mt-1">Private storage &amp; permanent archival on Arweave</p>
        </div>
        <PermawriteContent />
      </div>
    </div>
  );
}
