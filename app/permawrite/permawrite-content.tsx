"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const PermaFeed = dynamic(() => import("@/app/wallets/permafeed"), {
  ssr: false,
  loading: () => (
    <div className="py-10 text-center">
      <div className="w-5 h-5 border-2 border-white/10 border-t-violet-400 rounded-full animate-spin mx-auto" />
    </div>
  ),
});

const UnifiedUpload = dynamic(() => import("@/app/wallets/unified-upload"), {
  ssr: false,
  loading: () => (
    <div className="py-10 text-center">
      <div className="w-5 h-5 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto" />
    </div>
  ),
});

const PermawriteRepos = dynamic(() => import("@/app/wallets/permawrite-repos"), {
  ssr: false,
  loading: () => (
    <div className="py-10 text-center">
      <div className="w-5 h-5 border-2 border-white/10 border-t-cyan-400 rounded-full animate-spin mx-auto" />
    </div>
  ),
});

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

export default function PermawriteContent() {
  const [pwTab, setPwTab] = useState<"feed" | "upload" | "repos">("feed");

  return (
    <div className="space-y-5">
      {/* How it works */}
      <div className={`${card} p-5`}>
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl mt-0.5">📜</span>
          <div className="flex-1">
            <p className="text-xs text-white/50 leading-relaxed">
              PermaWrite stores your files permanently on Arweave — a decentralized network where data persists forever with a single upfront payment. Files are organized by category and tags, making them easy to browse and discover.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-white/30">
          <div className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-2">
            <span className="text-sm">💾</span>
            <span>Store forever</span>
          </div>
          <div className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-2">
            <span className="text-sm">🗂</span>
            <span>44 categories</span>
          </div>
          <div className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-2">
            <span className="text-sm">⚡</span>
            <span>Instant via Turbo</span>
          </div>
          <div className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-2">
            <span className="text-sm">🔒</span>
            <span>Private or public</span>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className={`${card} p-1.5 flex gap-1`}>
        <button
          type="button"
          onClick={() => setPwTab("feed")}
          className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            pwTab === "feed"
              ? "bg-violet-500/20 text-violet-300 shadow-[inset_0_1px_0_rgba(139,92,246,0.2)]"
              : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
          }`}
        >
          <span className="text-xs opacity-60">◫</span>Browse Feed
        </button>
        <button
          type="button"
          onClick={() => setPwTab("upload")}
          className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            pwTab === "upload"
              ? "bg-purple-500/20 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]"
              : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
          }`}
        >
          <span className="text-xs opacity-60">☁</span>Upload
        </button>
        <button
          type="button"
          onClick={() => setPwTab("repos")}
          className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            pwTab === "repos"
              ? "bg-cyan-500/20 text-cyan-300 shadow-[inset_0_1px_0_rgba(34,211,238,0.2)]"
              : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
          }`}
        >
          <span className="text-xs opacity-60">⌥</span>Repos
        </button>
      </div>

      {pwTab === "feed" && <PermaFeed />}
      {pwTab === "upload" && (
        <div className="space-y-4">
          <div className={`${card} p-3 flex items-center gap-3 border-purple-500/10`}>
            <span className="text-sm">🔐</span>
            <p className="text-[11px] text-white/40 flex-1">
              Need to set up a wallet first?{" "}
              <Link href="/wallets" className="text-purple-300/70 hover:text-purple-300 font-medium transition-colors">
                Go to Wallets →
              </Link>
            </p>
          </div>
          <UnifiedUpload />
        </div>
      )}
      {pwTab === "repos" && <PermawriteRepos />}
    </div>
  );
}
