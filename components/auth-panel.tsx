"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls =
  "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const btnPrimary =
  "h-11 px-6 rounded-xl font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-500 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost =
  "h-11 px-6 rounded-xl font-semibold text-sm border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer";

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 2) return { score, label: "Fair", color: "bg-amber-500" };
  if (score <= 3) return { score, label: "Good", color: "bg-yellow-400" };
  return { score, label: "Strong", color: "bg-emerald-500" };
}

export default function AuthPanel({ inline }: { inline?: boolean }) {
  const { user, vaultUnlocked, signUp, signIn, unlockVault, isLoading } = useWallet();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || !password) return;
      setError(null);
      setInfo(null);

      if (mode === "signup") {
        if (password.length < 8) {
          setError("Password must be at least 8 characters.");
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          return;
        }
      }

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
    [email, password, confirmPassword, mode, signUp, signIn],
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
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
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
      <div className={`${card} p-8 w-full max-w-sm mx-auto space-y-5`}>
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold text-white">
            {mode === "signin" ? "Sign In" : "Create Account"}
          </h2>
          <p className="text-xs text-white/40">
            {mode === "signin"
              ? "Sign in to access your encrypted wallet vault."
              : "Your password also encrypts your wallet keys — choose a strong one."}
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
          <div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {mode === "signup" && password.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= strength.score ? strength.color : "bg-white/[0.08]"
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-[10px] ${
                  strength.score <= 1 ? "text-red-400" : strength.score <= 2 ? "text-amber-400" : strength.score <= 3 ? "text-yellow-400" : "text-emerald-400"
                }`}>
                  {strength.label}
                  {password.length < 8 && " — minimum 8 characters"}
                </p>
              </div>
            )}
          </div>
          {mode === "signup" && (
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {info && <p className="text-xs text-emerald-400">{info}</p>}
          <button
            type="submit"
            disabled={busy || !email || !password || (mode === "signup" && !confirmPassword)}
            className={`w-full ${btnPrimary}`}
          >
            {busy ? "Please wait..." : mode === "signin" ? "Sign In" : "Sign Up"}
          </button>
        </form>

        {mode === "signin" && (
          <div className="text-center">
            <Link
              href="/auth?mode=forgot"
              className="text-xs text-white/30 hover:text-white/50 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setInfo(null); setConfirmPassword(""); }}
            className={btnGhost + " text-xs"}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
