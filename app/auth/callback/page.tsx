"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // PKCE flow: exchange ?code= for a session
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          setStatus("error");
          setMessage("Verification failed. You may close this page and try signing in.");
          return;
        }
        // Check if this was a password recovery flow
        const type = params.get("type");
        if (type === "recovery") {
          router.replace("/auth/reset-password");
          return;
        }
        if (data.session) {
          setStatus("success");
          setMessage("Email verified — redirecting…");
          setTimeout(() => router.replace("/"), 1500);
        }
        return;
      }

      // Implicit flow fallback: check existing session from hash fragment
      const { data: { session } } = await supabase.auth.getSession();
      if (!cancelled && session) {
        setStatus("success");
        setMessage("Email verified — redirecting…");
        setTimeout(() => router.replace("/"), 1500);
      }
    }

    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY") {
        router.replace("/auth/reset-password");
        return;
      }
      if (event === "SIGNED_IN") {
        setStatus("success");
        setMessage("Email verified — redirecting…");
        setTimeout(() => router.replace("/"), 1500);
      }
    });

    const timeout = setTimeout(() => {
      if (!cancelled) {
        setStatus((prev) => {
          if (prev === "loading") {
            setMessage("Verification is taking longer than expected. You may close this page and try signing in.");
            return "error";
          }
          return prev;
        });
      }
    }, 10000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">
        {status === "loading" && (
          <div className="mx-auto w-8 h-8 border-2 border-white/10 border-t-gold rounded-full animate-spin" />
        )}
        {status === "success" && (
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {status === "error" && (
          <div className="mx-auto w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <span className="text-amber-400 text-lg">!</span>
          </div>
        )}
        <p className={`text-sm ${status === "error" ? "text-white/50" : "text-white/40"}`}>{message}</p>
      </div>
    </div>
  );
}
