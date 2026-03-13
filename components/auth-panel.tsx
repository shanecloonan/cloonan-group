"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@/lib/wallet-context";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls =
  "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const btnPrimary =
  "h-11 px-6 rounded-xl font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-500 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost =
  "h-11 px-6 rounded-xl font-semibold text-sm border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer";

export default function AuthPanel({ inline }: { inline?: boolean }) {
  const { user, vaultUnlocked, signUp, signIn, unlockVault, isLoading } = useWallet();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || !password) return;
      setError(null);
      setInfo(null);
      setBusy(true);
      try {
        if (mode === "signup") {
          const err = await signUp(email, password);
          if (err) setError(err);
          else setInfo("Check your email to confirm your account.");
        } else {
          const err = await signIn(email, password);
          if (err) setError(err);
        }
      } catch (ex: unknown) {
        setError(ex instanceof Error ? ex.message : "Unknown error");
      }
      setBusy(false);
    },
    [email, password, mode, signUp, signIn],
  );

  const handleUnlock = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!password) return;
      setError(null);
      setBusy(true);
      const ok = await unlockVault(password);
      if (!ok) setError("Wrong password — could not decrypt vault.");
      setBusy(false);
    },
    [password, unlockVault],
  );

  if (isLoading) {
    return (
      <div className={`${inline ? "" : "flex items-center justify-center min-h-[60vh]"}`}>
        <p className="text-white/30 text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  if (user && !vaultUnlocked) {
    return (
      <div className={`${inline ? "" : "flex items-center justify-center min-h-[60vh]"}`}>
        <div className={`${card} p-8 w-full max-w-sm space-y-5`}>
          <div className="text-center space-y-1">
            <h2 className="text-lg font-bold text-white">Unlock Vault</h2>
            <p className="text-xs text-white/40">Enter your password to decrypt your wallets.</p>
          </div>
          <form onSubmit={handleUnlock} className="space-y-4">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              autoFocus
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button type="submit" disabled={busy || !password} className={`w-full ${btnPrimary}`}>
              {busy ? "Decrypting..." : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (user) return null;

  return (
    <div className={`${inline ? "" : "flex items-center justify-center min-h-[60vh]"}`}>
      <div className={`${card} p-8 w-full max-w-sm space-y-5`}>
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold text-white">
            {mode === "signin" ? "Sign In" : "Create Account"}
          </h2>
          <p className="text-xs text-white/40">
            {mode === "signin"
              ? "Sign in to access your encrypted wallet vault."
              : "Your password also encrypts your wallet keys."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          {info && <p className="text-xs text-emerald-400">{info}</p>}
          <button type="submit" disabled={busy || !email || !password} className={`w-full ${btnPrimary}`}>
            {busy ? "Please wait..." : mode === "signin" ? "Sign In" : "Sign Up"}
          </button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setInfo(null); }}
            className={btnGhost + " text-xs"}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
