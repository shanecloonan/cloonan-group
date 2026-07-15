"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChainParams } from "@/lib/testnet/types";
import {
  PRIVACY_SHIELDS,
  PRODUCTION_PRIVACY_POLICY,
} from "@/lib/testnet/privacy-policy";
import type { PrivacySampleAggregate } from "@/lib/testnet/tx-meta";

type Props = {
  chainParams: ChainParams | null;
  privacySample: PrivacySampleAggregate | null;
  loading?: boolean;
};

export default function PrivacyPulse({
  chainParams,
  privacySample,
  loading,
}: Props) {
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setHighlight((h) => (h + 1) % PRODUCTION_PRIVACY_POLICY.ringSize);
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const ringDots = useMemo(
    () => Array.from({ length: PRODUCTION_PRIVACY_POLICY.ringSize }, (_, i) => i),
    [],
  );

  const endowment = chainParams?.endowment;
  const mferOn = endowment?.require_endowment_range_proof === 1;
  const mfeoOn = endowment?.require_endowment_opening === 1;

  const ringUniformPct =
    privacySample && privacySample.totalRings > 0
      ? Math.round((privacySample.ring16Count / privacySample.totalRings) * 100)
      : null;

  const sampledLabel =
    privacySample && privacySample.sampled > 0
      ? `${privacySample.sampled} recent tx${privacySample.sampled === 1 ? "" : "s"} sampled`
      : loading
        ? "Sampling ring shapes…"
        : "Awaiting user transactions";

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="font-[family-name:var(--font-pw-display)] text-2xl tracking-tight text-[var(--pw-ink)] sm:text-3xl">
          Privacy pulse
        </h2>
        <p className="max-w-2xl text-sm text-[var(--pw-muted)]">
          Aggregate chain posture only — no addresses, amounts, or ring indices.
          Every dot below is a decoy candidate; the real spend is indistinguishable.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {/* Ring visualizer */}
        <div className="relative overflow-hidden rounded-2xl border border-[var(--pw-line)] bg-gradient-to-br from-[rgba(16,28,24,0.95)] to-[rgba(8,14,12,0.98)] px-5 py-6">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 50% 45%, rgba(196,163,90,0.14), transparent 70%)",
            }}
          />
          <div className="relative flex flex-col items-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--pw-faint)]">
              Ring-{PRODUCTION_PRIVACY_POLICY.ringSize} anonymity set
            </p>
            <p className="mt-1 text-center text-xs text-[var(--pw-muted)]">
              Which member is the real signer? The chain will not tell you.
            </p>

            <div
              className="relative mt-6 h-44 w-44 sm:h-52 sm:w-52"
              role="img"
              aria-label={`Animated ring of ${PRODUCTION_PRIVACY_POLICY.ringSize} indistinguishable members`}
            >
              {ringDots.map((i) => {
                const angle = (i / ringDots.length) * Math.PI * 2 - Math.PI / 2;
                const r = 42;
                const x = 50 + Math.cos(angle) * r;
                const y = 50 + Math.sin(angle) * r;
                const active = i === highlight;
                return (
                  <span
                    key={i}
                    className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-500 ${
                      active
                        ? "scale-125 border-[var(--pw-accent)] bg-[var(--pw-accent)] shadow-[0_0_16px_rgba(196,163,90,0.55)]"
                        : "border-[var(--pw-line)] bg-[rgba(232,239,230,0.12)]"
                    }`}
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                    }}
                  />
                );
              })}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                <span className="block font-mono text-2xl font-semibold text-[var(--pw-accent)]">
                  {PRODUCTION_PRIVACY_POLICY.ringSize}
                </span>
                <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--pw-faint)]">
                  members
                </span>
              </span>
            </div>

            <dl className="mt-5 grid w-full grid-cols-3 gap-2 text-center">
              <MiniStat
                label="Avg ring"
                value={
                  privacySample?.avgRingSize != null
                    ? String(privacySample.avgRingSize)
                    : "16"
                }
              />
              <MiniStat
                label="Avg inputs"
                value={
                  privacySample?.avgInputs != null
                    ? String(privacySample.avgInputs)
                    : "≥2"
                }
              />
              <MiniStat
                label="Avg outputs"
                value={
                  privacySample?.avgOutputs != null
                    ? String(privacySample.avgOutputs)
                    : "≥2"
                }
              />
            </dl>
            <p className="mt-3 text-[10px] text-[var(--pw-faint)]">{sampledLabel}</p>
            {ringUniformPct != null && ringUniformPct >= 90 && (
              <p className="mt-1 text-[10px] text-[var(--pw-accent)]/90">
                {ringUniformPct}% of sampled rings are uniform size-16
              </p>
            )}
          </div>
        </div>

        {/* Policy shields + live toggles */}
        <div className="space-y-3">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {PRIVACY_SHIELDS.map((shield) => (
              <li
                key={shield.id}
                className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/55 px-4 py-3"
              >
                <p className="text-xs font-semibold text-[var(--pw-ink)]">
                  {shield.label}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--pw-muted)]">
                  {shield.detail}
                </p>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <PolicyBadge
              label="MFER range proofs"
              on={mferOn}
              loading={loading && !chainParams}
            />
            <PolicyBadge
              label="MFEO openings"
              on={mfeoOn}
              loading={loading && !chainParams}
            />
            <PolicyBadge
              label="Tx v2 view tags"
              on
              hint={
                privacySample && privacySample.sampled > 0
                  ? `${privacySample.v2Count}/${privacySample.sampled} sampled`
                  : undefined
              }
            />
          </div>

          {privacySample && privacySample.sampled > 0 && (
            <div className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-code)]/35 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pw-faint)]">
                Activity spectrum (shape only)
              </p>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--pw-line)]">
                <ActivityBar
                  count={privacySample.transfers}
                  total={privacySample.sampled}
                  className="bg-emerald-600/70"
                />
                <ActivityBar
                  count={privacySample.uploads}
                  total={privacySample.sampled}
                  className="bg-[var(--pw-accent)]/80"
                />
                <ActivityBar
                  count={privacySample.mixed}
                  total={privacySample.sampled}
                  className="bg-sky-600/60"
                />
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--pw-muted)]">
                <li>
                  <span className="inline-block h-2 w-2 rounded-sm bg-emerald-600/70 mr-1" />
                  Transfers {privacySample.transfers}
                </li>
                <li>
                  <span className="inline-block h-2 w-2 rounded-sm bg-[var(--pw-accent)]/80 mr-1" />
                  Uploads {privacySample.uploads}
                </li>
                <li>
                  <span className="inline-block h-2 w-2 rounded-sm bg-sky-600/60 mr-1" />
                  Mixed {privacySample.mixed}
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--pw-line)]/80 bg-[var(--pw-surface)]/40 px-2 py-2">
      <dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--pw-faint)]">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm text-[var(--pw-ink)]">{value}</dd>
    </div>
  );
}

function PolicyBadge({
  label,
  on,
  loading,
  hint,
}: {
  label: string;
  on?: boolean;
  loading?: boolean;
  hint?: string;
}) {
  const state = loading ? "…" : on ? "enforced" : "off";
  const tone = loading
    ? "border-[var(--pw-line)] text-[var(--pw-faint)]"
    : on
      ? "border-emerald-500/40 bg-emerald-950/25 text-emerald-100/90"
      : "border-[var(--pw-line)] text-[var(--pw-muted)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${tone}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-[var(--pw-faint)]"}`}
        aria-hidden
      />
      {label}
      <span className="font-normal normal-case tracking-normal opacity-80">
        {hint ?? state}
      </span>
    </span>
  );
}

function ActivityBar({
  count,
  total,
  className,
}: {
  count: number;
  total: number;
  className: string;
}) {
  if (count <= 0 || total <= 0) return null;
  const pct = Math.max(4, Math.round((count / total) * 100));
  return (
    <span
      className={className}
      style={{ width: `${pct}%` }}
      title={`${count} of ${total}`}
    />
  );
}
