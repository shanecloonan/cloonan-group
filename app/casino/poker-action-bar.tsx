"use client";

import { btnGhost, btnPrimary, btnSecondary } from "./casino-ui";
import type { PokerAction, PokerState, TokenSpec } from "@/lib/casino";

function fmtRaise(units: bigint, token: TokenSpec): string {
  const denom = 10n ** BigInt(token.decimals);
  return `${(Number(units) / Number(denom)).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
}

export function PokerActionBar({
  state,
  seat,
  token,
  legal,
  busy,
  onAct,
}: {
  state: PokerState;
  seat: number;
  token: TokenSpec;
  legal: PokerAction[];
  busy: boolean;
  onAct: (a: PokerAction) => void;
}) {
  const p = state.players[seat];
  const toCall = state.currentBet - p.betThisRound;
  const canCheck = legal.some((a) => a.type === "check");
  const canCall = legal.some((a) => a.type === "call");
  const raises = legal.filter((a) => a.type === "raise" && a.raiseTo);

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {legal.some((a) => a.type === "fold") && (
        <button type="button" className={btnGhost + " !border-rose-400/40 !text-rose-200"} disabled={busy} onClick={() => onAct({ type: "fold" })}>
          Fold
        </button>
      )}
      {canCheck && (
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => onAct({ type: "check" })}>
          Check
        </button>
      )}
      {canCall && !canCheck && (
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => onAct({ type: "call" })}>
          Call {fmtRaise(toCall, token)}
        </button>
      )}
      {raises.map((a, i) => (
        <button
          key={i}
          type="button"
          className={btnPrimary}
          disabled={busy}
          onClick={() => onAct(a)}
        >
          {a.raiseTo === p.betThisRound + p.stack ? "All-in" : `Raise ${fmtRaise(a.raiseTo!, token)}`}
        </button>
      ))}
    </div>
  );
}
