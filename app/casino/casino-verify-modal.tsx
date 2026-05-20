"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { VerifyResult } from "@/lib/casino/verify";
import type { Session, TokenSpec } from "@/lib/casino";
import { ShareLinkRow } from "./share-link";
import { inputCls, labelCls } from "./casino-ui";

export type VerifyRunResult<State> = VerifyResult<State> | { error: string };

function fmtMoney(units: bigint, token: TokenSpec): string {
  const denom = 10n ** BigInt(token.decimals);
  const whole = units / denom;
  const frac = units % denom;
  const fracStr = frac.toString().padStart(token.decimals, "0").replace(/0+$/, "");
  const n = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${token.symbol}`;
}

/** Shared provably-fair replay modal for settled sessions. */
export function CasinoVerifyModal<State>({
  title,
  description,
  session,
  revealedServerSeed,
  token,
  onClose,
  runVerify,
  extraFields,
  resultLabel = "Replayed outcome matches recorded result",
  renderVerifiedDetail,
}: {
  title: string;
  description: ReactNode;
  session: Session<unknown, State>;
  revealedServerSeed: string | null;
  token: TokenSpec;
  onClose: () => void;
  runVerify: (serverSeed: string) => VerifyRunResult<State> | null;
  extraFields?: ReactNode;
  resultLabel?: string;
  /** Optional detail shown after replay checks (e.g. blackjack card layout). */
  renderVerifiedDetail?: (verification: VerifyResult<State>) => ReactNode;
}) {
  const [inputSeed, setInputSeed] = useState(revealedServerSeed ?? "");

  const verification = useMemo(() => {
    if (!inputSeed) return null;
    return runVerify(inputSeed);
  }, [inputSeed, runVerify]);

  const allOk =
    verification &&
    !("error" in verification) &&
    verification.hashOk &&
    verification.finalStateMatches &&
    verification.stepMatches.every(Boolean);

  const pnl = session.result?.pnlUnits ?? 0n;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0c0d12] border border-white/[0.08] p-6 space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              Provable fairness · client-side replay
            </div>
            <h2 className="text-xl font-semibold mt-1">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white cursor-pointer text-2xl leading-none"
          >
            ×
          </button>
        </header>

        <p className="text-sm text-white/60 leading-relaxed">{description}</p>

        <div>
          <label className={labelCls}>Server seed (hex)</label>
          <input
            type="text"
            className={inputCls + " font-mono"}
            value={inputSeed}
            onChange={(e) => setInputSeed(e.target.value.trim())}
            placeholder="Rotate the seed to reveal yours, then paste here"
          />
        </div>

        {extraFields}

        {!verification && (
          <div className="text-[12px] text-white/40">Enter a server seed to run the replay.</div>
        )}
        {verification && "error" in verification && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
            Verifier threw: {verification.error}
          </div>
        )}
        {verification && !("error" in verification) && (
          <div className="space-y-3">
            <VerifyCheckRow ok={verification.hashOk} label="SHA-256(seed) == published hash" />
            <VerifyCheckRow ok={verification.finalStateMatches} label={resultLabel} />
            <VerifyCheckRow
              ok={verification.stepMatches.every(Boolean)}
              label={`All ${verification.stepMatches.length} per-step hashes match`}
            />
            {renderVerifiedDetail?.(verification)}
            <div
              className={
                "text-center py-2 rounded-lg font-semibold " +
                (allOk
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
                  : "bg-rose-500/15 text-rose-300 border border-rose-400/30")
              }
            >
              {allOk ? "✓ Verified provably fair" : "✗ Verification failed"}
            </div>
          </div>
        )}

        <div className="text-[11px] text-white/40">
          Settled at {new Date(session.updatedAt).toLocaleString()} · PnL{" "}
          {(pnl >= 0n ? "+" : "") + fmtMoney(pnl, token)}
        </div>

        <ShareLinkRow session={session} serverSeed={revealedServerSeed} />
      </div>
    </div>
  );
}

export function VerifyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">{label}</div>
      <div className={"text-[12px] text-white/80 break-all " + (mono ? "font-mono" : "")}>{value}</div>
    </div>
  );
}

function VerifyCheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={
          "w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold " +
          (ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")
        }
      >
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "text-white/80" : "text-rose-200"}>{label}</span>
    </div>
  );
}
