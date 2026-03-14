"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    const timeout = setTimeout(() => {
      setReady((prev) => {
        if (!prev) setError("Session expired or invalid link. Please request a new reset link.");
        return prev;
      });
    }, 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }

      setBusy(true);
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(err.message);
      } else {
        setSuccess(true);
        setTimeout(() => router.replace("/auth"), 2000);
      }
      setBusy(false);
    },
    [password, confirmPassword, router],
  );

  if (success) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-6" style={{ background: "#08090e" }}>
        <div className="text-center space-y-4 max-w-sm">
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-white/60">Password updated. Redirecting to sign in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6" style={{ background: "#08090e" }}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <Link href="/" className="inline-block text-xl font-bold tracking-tight text-brand-100 mb-6">
            Money<span className="text-gold">Fund</span>
          </Link>
          <h1 className="text-lg font-bold text-white">Set New Password</h1>
          <p className="text-xs text-white/40">Choose a strong password for your account.</p>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <p className="text-[11px] text-amber-400/80 leading-relaxed">
            If you have encrypted wallets, changing your password will make them inaccessible.
            Export your wallets before resetting.
          </p>
        </div>

        {!ready && !error ? (
          <div className="flex justify-center py-6">
            <div className="w-8 h-8 border-2 border-white/10 border-t-gold rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                autoFocus
                disabled={!ready}
              />
              {password.length > 0 && (
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

            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputCls}
              disabled={!ready}
            />

            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy || !ready || !password || !confirmPassword}
              className={`w-full ${btnPrimary}`}
            >
              {busy ? "Updating…" : "Update Password"}
            </button>
          </form>
        )}

        <div className="text-center">
          <Link href="/auth" className="text-xs text-white/30 hover:text-white/50 transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
