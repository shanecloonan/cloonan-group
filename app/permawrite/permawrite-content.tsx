"use client";

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

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

export default function PermawriteContent() {
  return (
    <div className="space-y-5">
      <div className={`${card} p-4 flex items-center gap-3`}>
        <span className="text-lg">☁</span>
        <div className="flex-1">
          <p className="text-xs text-white/50">
            Upload files and manage PermaWrite from{" "}
            <Link href="/wallets" className="text-violet-400 hover:text-violet-300 transition-colors font-medium">
              Wallets → Upload
            </Link>
          </p>
        </div>
        <Link
          href="/wallets"
          className="h-8 px-4 rounded-xl text-xs font-medium bg-violet-500/15 border border-violet-500/20 text-violet-300 hover:bg-violet-500/25 transition-all flex items-center"
        >
          Go to Upload
        </Link>
      </div>
      <PermaFeed />
    </div>
  );
}
