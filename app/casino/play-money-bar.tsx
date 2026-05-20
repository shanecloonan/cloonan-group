"use client";

import { useState } from "react";
import { useCasino } from "./casino-context";
import { btnGold, btnSecondary, pillGold } from "./casino-ui";
import { PLAY_MONEY_CHIP_PRESETS, playMoneyUnits } from "@/lib/casino/guest-play";

/** Sticky chip refill — play-money chain only (rendered inside CasinoProvider). */
export function PlayMoneyBar() {
  const { playMoney, balance, token, refreshBalance } = useCasino();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!playMoney.enabled) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await refreshBalance();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fmtBal = () => {
    const d = 10n ** BigInt(token.decimals);
    const n = Number(balance.available) / Number(d);
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${token.symbol}`;
  };

  const low = balance.available < playMoneyUnits(token.decimals, 1_000);

  return (
    <div
      className={
        "fixed z-40 left-0 right-0 px-3 pointer-events-none " +
        "bottom-[calc(3.75rem+env(safe-area-inset-bottom))] lg:bottom-4"
      }
    >
      <div
        className={
          "pointer-events-auto max-w-3xl mx-auto rounded-2xl border p-3 sm:p-4 shadow-[0_12px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl " +
          (low
            ? "border-amber-400/50 bg-gradient-to-r from-amber-500/20 via-[#0c0d14]/95 to-amber-600/15 animate-pulse"
            : "border-amber-400/25 bg-[#0c0d14]/95")
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <span className={pillGold + " !text-[9px]"}>Free play · no account</span>
            <p className="text-sm font-semibold text-white mt-1 truncate">
              {playMoney.displayName}
            </p>
            <p className="text-[11px] text-white/45 font-mono">{fmtBal()} available</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(async () => playMoney.rerollDisplayName())}
            className={btnSecondary + " !min-h-9 !h-9 !px-3 !text-xs shrink-0"}
          >
            New name
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {PLAY_MONEY_CHIP_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => run(async () => playMoney.addChips(p.units))}
              className={btnGold + " !min-h-10 flex-1 min-w-[4.5rem] !text-xs sm:!text-sm"}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const target = playMoneyUnits(token.decimals, 100_000);
                if (balance.available >= target) {
                  setMsg("Already above 100K — tap +100K or +1M");
                  return;
                }
                const need = target - balance.available;
                await playMoney.addChips(need);
              })
            }
            className={btnSecondary + " !min-h-10 flex-1 min-w-[5rem] !text-xs sm:!text-sm"}
          >
            Refill 100K
          </button>
        </div>

        {msg && <p className="mt-2 text-[11px] text-amber-200/90">{msg}</p>}
        {low && !msg && (
          <p className="mt-2 text-[11px] text-amber-200/80">Low balance — tap any button for instant chips.</p>
        )}
      </div>
    </div>
  );
}
