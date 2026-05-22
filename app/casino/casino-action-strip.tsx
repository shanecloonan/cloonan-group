"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCasino } from "./casino-context";
import { PlayMoneyChipStrip } from "./play-money-bar";
import { btnGhost } from "./casino-ui";
import { fmtMoney, RevealedSeedBanner, shortSeedHash } from "./table-kit";
import type { ChainId } from "@/lib/casino";

/** Compact bar above tables: chips (play money) or vault balance + seed controls. */
export function CasinoActionStrip() {
  const {
    playMoney,
    chainId,
    persistent,
    balance,
    token,
    refreshBalance,
    getSeedPair,
    rotateSeed,
    lastRevealedSeed,
    dismissRevealedSeed,
  } = useCasino();

  const [busy, setBusy] = useState(false);
  const pair = getSeedPair();
  const isVaultChain = chainId !== "dev-mock";

  const onRefresh = useCallback(async () => {
    setBusy(true);
    try {
      await refreshBalance();
    } finally {
      setBusy(false);
    }
  }, [refreshBalance]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshBalance();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshBalance]);

  if (playMoney.enabled) return <PlayMoneyChipStrip />;

  if (!isVaultChain) return null;

  const walletHref = `/casino/wallet?chain=${encodeURIComponent(chainId)}`;

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 mb-4 border-y border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <span className="text-xs text-white/50 shrink-0">
            Balance{" "}
            <span className="font-mono text-emerald-300/90 font-semibold tabular-nums">
              {fmtMoney(balance.available, token, 2)}
            </span>
            {balance.locked > 0n && (
              <span className="text-white/35 ml-1.5">
                ({fmtMoney(balance.locked, token, 2)} locked)
              </span>
            )}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRefresh()}
            className={btnGhost + " !h-7 !px-2 !text-[10px]"}
          >
            Refresh
          </button>
          <Link
            href={walletHref}
            className="h-7 px-2.5 rounded-lg text-[10px] font-semibold border border-amber-400/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 transition-colors"
          >
            Deposit / withdraw
          </Link>
          {!persistent && (
            <Link href="/auth" className="text-[10px] text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline">
              Sign in to sync
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/45 min-w-0">
          <span className="font-mono truncate max-w-[min(42vw,220px)]" title={pair.serverSeedHash}>
            Commit {shortSeedHash(pair.serverSeedHash, 14)}
          </span>
          <button
            type="button"
            onClick={() => rotateSeed()}
            className="h-7 px-2.5 rounded-lg border border-white/[0.1] text-white/70 hover:bg-white/[0.06] cursor-pointer transition-colors"
          >
            Rotate seed
          </button>
          <Link href="/casino/verify" className="text-emerald-300/90 hover:text-emerald-200">
            Verify →
          </Link>
        </div>
      </div>

      {lastRevealedSeed && (
        <RevealedSeedBanner serverSeed={lastRevealedSeed.serverSeed} onDismiss={dismissRevealedSeed} />
      )}

      {!persistent && (
        <p className="px-4 sm:px-6 lg:px-8 pb-2.5 text-[10px] text-amber-200/85">
          Guest on {chainId.replaceAll("-", " ")} —{" "}
          <Link href="/auth" className="underline text-amber-300">
            sign in
          </Link>{" "}
          to sync balance.
        </p>
      )}
    </div>
  );
}

export function VaultChainLobbyBanner({ chainId }: { chainId: ChainId }) {
  const { persistent } = useCasino();
  if (chainId === "dev-mock" || persistent) return null;

  return (
    <div className="mt-3 p-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] text-sm text-amber-100/90">
      <Link href="/auth" className="text-amber-300 hover:underline font-medium">
        Sign in
      </Link>{" "}
      to sync balance on this chain.{" "}
      <Link href={`/casino/wallet?chain=${encodeURIComponent(chainId)}`} className="text-amber-300 hover:underline">
        Wallet →
      </Link>
    </div>
  );
}
