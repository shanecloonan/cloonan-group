"use client";

import { useCallback, useState } from "react";
import { useCasino } from "./casino-context";
import { btnGold, btnGhost, btnSecondary, card, sectionTitle } from "./casino-ui";
import { PLAY_MONEY_CHIP_PRESETS, playMoneyUnits } from "@/lib/casino/guest-play";

function useChipActions() {
  const { playMoney, balance, token, refreshBalance } = useCasino();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
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
    },
    [refreshBalance],
  );

  const fmtBal = useCallback(() => {
    const d = 10n ** BigInt(token.decimals);
    const n = Number(balance.available) / Number(d);
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${token.symbol}`;
  }, [balance.available, token]);

  const refill100k = useCallback(async () => {
    const target = playMoneyUnits(token.decimals, 100_000);
    if (balance.available >= target) {
      setMsg("Balance already at or above 100K");
      return;
    }
    await playMoney.addChips(target - balance.available);
  }, [balance.available, playMoney, token.decimals]);

  return { playMoney, balance, token, busy, msg, run, fmtBal, refill100k, setMsg };
}

/** Lobby wallet card — guest identity + chip controls (not a popup). */
export function PlayMoneyPanel() {
  const { playMoney, busy, msg, run, fmtBal, refill100k } = useChipActions();

  if (!playMoney.enabled) return null;

  return (
    <section
      className={
        card +
        " p-5 sm:p-6 border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] via-transparent to-emerald-500/[0.04]"
      }
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-300/80 font-semibold mb-1">
            Guest wallet · no account
          </p>
          <h2 className={sectionTitle + " font-mono text-amber-100"}>{playMoney.displayName}</h2>
          <p className="mt-1 text-sm text-white/50">
            Free chips for every game on this chain. Balance resets in-browser when you refresh — use
            Add chips anytime.
          </p>
        </div>
        <div className="sm:text-right shrink-0">
          <p className="text-[10px] uppercase tracking-[0.15em] text-white/40">Available</p>
          <p className="text-2xl font-bold font-mono text-emerald-300 tabular-nums">{fmtBal()}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(async () => playMoney.rerollDisplayName())}
            className={btnGhost + " mt-2 !text-xs"}
          >
            New random name
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {PLAY_MONEY_CHIP_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busy}
            onClick={() => run(async () => playMoney.addChips(p.units))}
            className={btnGold + " !min-h-10 !px-4"}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => run(refill100k)}
          className={btnSecondary + " !min-h-10 !px-4"}
        >
          Refill to 100K
        </button>
      </div>

      {msg && <p className="mt-3 text-xs text-white/55">{msg}</p>}
    </section>
  );
}

/** Slim strip under game tabs while playing (dev-mock only). */
export function PlayMoneyChipStrip() {
  const { playMoney, busy, msg, run, fmtBal, refill100k } = useChipActions();

  if (!playMoney.enabled) return null;

  return (
    <div className="-mx-4 sm:-mx-8 px-4 sm:px-8 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-white/50 shrink-0">
          <span className="text-amber-200/90 font-medium">{playMoney.displayName}</span>
          <span className="text-white/30 mx-1.5">·</span>
          <span className="font-mono text-emerald-300/90">{fmtBal()}</span>
        </span>
        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {PLAY_MONEY_CHIP_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => run(async () => playMoney.addChips(p.units))}
              className="h-8 px-3 rounded-lg text-[11px] font-semibold border border-amber-400/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 cursor-pointer disabled:opacity-40 transition-colors"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(refill100k)}
            className="h-8 px-3 rounded-lg text-[11px] font-medium border border-white/[0.1] text-white/70 hover:bg-white/[0.06] cursor-pointer disabled:opacity-40"
          >
            Refill 100K
          </button>
        </div>
      </div>
      {msg && <p className="mt-1.5 text-[10px] text-white/45">{msg}</p>}
    </div>
  );
}
