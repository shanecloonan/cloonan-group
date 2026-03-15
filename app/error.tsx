"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Uncaught error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4" style={{ background: "#08090e" }}>
      <div className="text-center space-y-4 max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
          <span className="text-2xl">!</span>
        </div>
        <h2 className="text-xl font-bold text-white/90">Something went wrong</h2>
        <p className="text-sm text-white/40 leading-relaxed">
          An unexpected error occurred. This may be due to a network issue or a temporary problem with the blockchain provider.
        </p>
        <button
          type="button"
          onClick={reset}
          className="h-11 px-8 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
