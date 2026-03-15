"use client";

import { Suspense, useState, useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";

type Mode = "signin" | "signup" | "forgot";

const inputCls =
  "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const btnPrimary =
  "h-11 px-6 rounded-xl font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-500 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

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

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[80vh] flex items-center justify-center" style={{ background: "#08090e" }}>
          <div className="w-6 h-6 border-2 border-white/10 border-t-indigo-400 rounded-full animate-spin" />
        </div>
      }
    >
      <AuthPageInner />
    </Suspense>
  );
}

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, vaultUnlocked, signUp, signIn, resetPassword, unlockVault, isLoading } = useWallet();

  const initialMode = (searchParams.get("mode") as Mode) ?? "signin";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  useEffect(() => {
    if (user && vaultUnlocked) router.replace("/");
  }, [user, vaultUnlocked, router]);

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  }, []);

  const handleAuth = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setInfo(null);

      if (mode === "forgot") {
        if (!email) return;
        setBusy(true);
        const err = await resetPassword(email);
        if (err) setError(err);
        else setInfo("Check your email for a password reset link.");
        setBusy(false);
        return;
      }

      if (!email || !password) return;

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
          else router.push("/");
        }
      } catch (ex: unknown) {
        setError(ex instanceof Error ? ex.message : "Unknown error");
      }
      setBusy(false);
    },
    [email, password, confirmPassword, mode, signUp, signIn, resetPassword, router],
  );

  const handleUnlock = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!password) return;
      setError(null);
      setBusy(true);
      const ok = await unlockVault(password);
      if (ok) router.push("/");
      else setError("Wrong password — could not decrypt vault.");
      setBusy(false);
    },
    [password, unlockVault, router],
  );

  if (isLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center" style={{ background: "#08090e" }}>
        <div className="w-8 h-8 border-2 border-white/10 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (user && !vaultUnlocked) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-6" style={{ background: "#08090e" }}>
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-lg font-bold text-white">Unlock Vault</h1>
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
              {busy ? "Decrypting…" : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const titles: Record<Mode, string> = {
    signin: "Sign In",
    signup: "Create Account",
    forgot: "Reset Password",
  };

  const subtitles: Record<Mode, string> = {
    signin: "Sign in to access your encrypted wallet vault.",
    signup: "Your password also encrypts your wallet keys — choose a strong one.",
    forgot: "We'll send a reset link to your email.",
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6" style={{ background: "#08090e" }}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-lg font-bold text-white">{titles[mode]}</h1>
          <p className="text-xs text-white/40">{subtitles[mode]}</p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              autoFocus
            />
          </div>

          {mode !== "forgot" && (
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
          )}

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
            disabled={
              busy ||
              !email ||
              (mode !== "forgot" && !password) ||
              (mode === "signup" && !confirmPassword)
            }
            className={`w-full ${btnPrimary}`}
          >
            {busy ? "Please wait…" : mode === "forgot" ? "Send Reset Link" : titles[mode]}
          </button>
        </form>

        <div className="space-y-2 text-center">
          {mode === "signin" && (
            <>
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="text-xs text-white/30 hover:text-white/50 transition-colors cursor-pointer"
              >
                Forgot password?
              </button>
              <div className="flex items-center gap-3 text-white/10">
                <span className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-[10px] uppercase tracking-wider">or</span>
                <span className="flex-1 h-px bg-white/[0.06]" />
              </div>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="text-xs text-white/40 hover:text-white/60 transition-colors cursor-pointer"
              >
                Create an account
              </button>
            </>
          )}
          {mode === "signup" && (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-xs text-white/40 hover:text-white/60 transition-colors cursor-pointer"
            >
              Already have an account? Sign in
            </button>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-xs text-white/40 hover:text-white/60 transition-colors cursor-pointer"
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
