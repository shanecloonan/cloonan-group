"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockHeaderSummary } from "@/lib/testnet/types";
import {
  formatDateTime,
  formatTime,
  resolveBlockTimeMs,
  truncateId,
} from "./ui";

export type ChainBlockView = {
  height: number;
  id: string;
  slot?: number;
  whenMs: number | null;
};

type Props = {
  headers: BlockHeaderSummary[];
  tipHeight: number | null;
  tipSeenAtMs: number | null;
  slotMs: number;
  loading?: boolean;
};

export default function BlockChainGraphic({
  headers,
  tipHeight,
  tipSeenAtMs,
  slotMs,
  loading,
}: Props) {
  const blocks = useMemo(() => {
    const rows: ChainBlockView[] = headers
      .map((h) => {
        const height = h.height;
        if (height == null) return null;
        const id = h.id ?? h.block_id ?? "";
        return {
          height,
          id,
          slot: h.slot,
          whenMs: resolveBlockTimeMs({
            protocolTsSec: h.timestamp,
            height,
            tipHeight,
            tipSeenAtMs,
            slotMs,
          }),
        };
      })
      .filter((b): b is ChainBlockView => b != null)
      .sort((a, b) => a.height - b.height);

    // Deduplicate by height (keep last).
    const byH = new Map<number, ChainBlockView>();
    for (const b of rows) byH.set(b.height, b);
    return [...byH.values()].sort((a, b) => a.height - b.height);
  }, [headers, tipHeight, tipSeenAtMs, slotMs]);

  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const revealedRef = useRef<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const heightKey = blocks.map((b) => b.height).join(",");

  // Stagger initial reveal, then append each new tip block.
  useEffect(() => {
    if (!heightKey) return;
    const heights = heightKey.split(",").map(Number).filter(Number.isFinite);
    const missing = heights.filter((h) => !revealedRef.current.has(h));
    if (missing.length === 0) return;

    let cancelled = false;
    const timers = missing.map((h, i) =>
      setTimeout(() => {
        if (cancelled) return;
        revealedRef.current = new Set(revealedRef.current).add(h);
        setRevealed(new Set(revealedRef.current));
        setSelected(h);
      }, i * 160),
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [heightKey]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tip = tipHeight ?? blocks[blocks.length - 1]?.height ?? null;
  const nextEtaMs =
    tipSeenAtMs != null && slotMs > 0
      ? Math.max(0, tipSeenAtMs + slotMs - now)
      : null;
  const buildingProgress =
    tipSeenAtMs != null && slotMs > 0
      ? Math.min(1, Math.max(0, (now - tipSeenAtMs) / slotMs))
      : 0;

  const selectedBlock =
    selected != null ? blocks.find((b) => b.height === selected) : null;

  if (loading && blocks.length === 0) {
    return (
      <div className="pw-chain rounded-2xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-4 py-10 text-center text-sm text-[var(--pw-muted)]">
        Syncing chain…
      </div>
    );
  }

  if (blocks.length === 0) return null;

  return (
    <div className="pw-chain space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pw-muted)]">
            Live chain
          </h3>
          <p className="mt-1 text-[12px] text-[var(--pw-faint)]">
            Blocks link forward as the tip advances · ~{slotMs / 1000}s slots
          </p>
        </div>
        {tip != null && (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pw-faint)]">
              Tip
            </p>
            <p className="font-mono text-sm text-[var(--pw-accent)]">#{tip}</p>
          </div>
        )}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-[var(--pw-line)] bg-gradient-to-br from-[rgba(16,28,24,0.95)] via-[rgba(10,18,16,0.92)] to-[rgba(8,14,12,0.98)] px-3 py-5 sm:px-5 sm:py-6">
        {/* Ambient depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(ellipse 55% 80% at 85% 40%, rgba(196,163,90,0.1), transparent 65%), radial-gradient(ellipse 40% 60% at 10% 80%, rgba(80,140,110,0.08), transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.2]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(232,239,230,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(232,239,230,0.04) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent)",
          }}
        />

        {/* Mobile: vertical. Desktop: horizontal scroll chain. */}
        <div className="relative z-[1]">
          <ol className="flex flex-col gap-0 sm:flex-row sm:items-stretch sm:gap-0 sm:overflow-x-auto sm:pb-1 sm:snap-x sm:snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {blocks.map((b, i) => {
              const isTip = tip != null && b.height === tip;
              const show = revealed.has(b.height);
              const linkShow =
                i > 0 &&
                revealed.has(blocks[i - 1]!.height) &&
                revealed.has(b.height);
              const intervalSec =
                i > 0 &&
                b.whenMs != null &&
                blocks[i - 1]!.whenMs != null
                  ? Math.max(
                      0,
                      Math.round((b.whenMs - blocks[i - 1]!.whenMs!) / 1000),
                    )
                  : null;

              return (
                <li
                  key={b.height}
                  className="flex flex-col sm:flex-row sm:items-center sm:snap-center"
                >
                  {/* Vertical connector (mobile) */}
                  {i > 0 && (
                    <div
                      className="relative mx-auto flex h-10 w-px flex-col items-center sm:hidden"
                      aria-hidden
                    >
                      <span
                        className={`absolute inset-0 origin-top bg-gradient-to-b from-[var(--pw-accent)]/70 to-[var(--pw-accent)]/25 transition-transform duration-500 ease-out ${
                          linkShow ? "scale-y-100" : "scale-y-0"
                        }`}
                      />
                      {intervalSec != null && linkShow && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-[var(--pw-line)] bg-[var(--pw-bg)]/80 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-[var(--pw-accent)]">
                          {intervalSec}s
                        </span>
                      )}
                    </div>
                  )}

                  {/* Horizontal connector (desktop) */}
                  {i > 0 && (
                    <div
                      className="relative mx-1 hidden h-px w-10 shrink-0 sm:block md:w-14"
                      aria-hidden
                    >
                      <span
                        className={`absolute inset-0 origin-left bg-gradient-to-r from-[var(--pw-accent)]/70 to-[var(--pw-accent)]/25 transition-transform duration-500 ease-out ${
                          linkShow ? "scale-x-100" : "scale-x-0"
                        }`}
                      />
                      <span
                        className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--pw-accent)] transition-opacity duration-300 ${
                          linkShow ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {intervalSec != null && linkShow && (
                        <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium tabular-nums text-[var(--pw-accent)]/90">
                          {intervalSec}s
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setSelected(selected === b.height ? null : b.height)
                    }
                    className={`group relative mx-auto w-full max-w-[16rem] sm:mx-0 sm:w-[9.5rem] md:w-[10.5rem] text-left transition-all duration-500 ease-out ${
                      show
                        ? "opacity-100 translate-y-0 scale-100"
                        : "opacity-0 translate-y-3 scale-95 pointer-events-none"
                    }`}
                    style={{ transitionDelay: show ? "0ms" : "0ms" }}
                    aria-pressed={selected === b.height}
                  >
                    <div
                      className={`relative overflow-hidden rounded-xl border px-3.5 py-3 backdrop-blur-sm transition-colors ${
                        isTip
                          ? "border-[var(--pw-accent)]/55 bg-[var(--pw-accent-soft)] shadow-[0_0_28px_rgba(196,163,90,0.18)]"
                          : selected === b.height
                            ? "border-[var(--pw-accent)]/35 bg-[var(--pw-surface)]"
                            : "border-[var(--pw-line)] bg-[rgba(12,22,18,0.75)] hover:border-[var(--pw-accent)]/30"
                      }`}
                    >
                      {isTip && (
                        <span
                          aria-hidden
                          className="pw-tip-sheen absolute -inset-px rounded-xl"
                          style={{
                            background:
                              "linear-gradient(135deg, rgba(196,163,90,0.25), transparent 45%)",
                          }}
                        />
                      )}
                      <div className="relative flex items-start justify-between gap-2">
                        <span
                          className={`font-mono text-lg font-semibold tracking-tight ${
                            isTip
                              ? "text-[var(--pw-accent)]"
                              : "text-[var(--pw-ink)]"
                          }`}
                        >
                          #{b.height}
                        </span>
                        {isTip && (
                          <span className="mt-0.5 rounded-full border border-[var(--pw-accent)]/40 bg-[var(--pw-bg)]/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--pw-accent)]">
                            Tip
                          </span>
                        )}
                      </div>
                      <p className="relative mt-1.5 text-[11px] tabular-nums text-[var(--pw-muted)]">
                        {formatDateTime(b.whenMs)}
                      </p>
                      <p
                        className="relative mt-1 truncate font-mono text-[10px] text-[var(--pw-faint)]"
                        title={b.id}
                      >
                        {truncateId(b.id, 6, 4)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}

            {/* Next block building ghost */}
            <li className="flex flex-col sm:flex-row sm:items-center">
              <div
                className="relative mx-auto flex h-10 w-px flex-col items-center sm:hidden"
                aria-hidden
              >
                <span
                  className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,rgba(196,163,90,0.45)_0_4px,transparent_4px_8px)]"
                  style={{ opacity: 0.35 + buildingProgress * 0.55 }}
                />
              </div>
              <div
                className="relative mx-1 hidden h-px w-10 shrink-0 sm:block md:w-14"
                aria-hidden
              >
                <span
                  className="absolute inset-0 origin-left bg-[repeating-linear-gradient(90deg,rgba(196,163,90,0.45)_0_4px,transparent_4px_8px)]"
                  style={{
                    transform: `scaleX(${0.2 + buildingProgress * 0.8})`,
                    transformOrigin: "left center",
                    transition: "transform 0.4s linear",
                  }}
                />
              </div>
              <div className="relative mx-auto w-full max-w-[16rem] sm:mx-0 sm:w-[9.5rem] md:w-[10.5rem]">
                <div className="rounded-xl border border-dashed border-[var(--pw-accent)]/30 bg-[rgba(12,22,18,0.45)] px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg font-semibold tracking-tight text-[var(--pw-faint)]">
                      #{tip != null ? tip + 1 : "…"}
                    </span>
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-[var(--pw-accent)]"
                      style={{ animation: "pwPulse 1.4s ease-in-out infinite" }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--pw-faint)]">
                    Building…
                  </p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--pw-line)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--pw-accent)]/40 to-[var(--pw-accent)]"
                      style={{
                        width: `${Math.round(buildingProgress * 100)}%`,
                        transition: "width 0.4s linear",
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] tabular-nums text-[var(--pw-faint)]">
                    {nextEtaMs != null
                      ? `~${Math.ceil(nextEtaMs / 1000)}s to next slot`
                      : "awaiting tip"}
                  </p>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </div>

      {selectedBlock && (
        <div className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-4 py-3 text-[12px] text-[var(--pw-muted)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-sm text-[var(--pw-ink)]">
              Block #{selectedBlock.height}
            </p>
            <p className="tabular-nums text-[var(--pw-faint)]">
              {formatDateTime(selectedBlock.whenMs)}
              {selectedBlock.whenMs != null
                ? ` · ${formatTime(selectedBlock.whenMs)}`
                : ""}
            </p>
          </div>
          <p className="mt-1.5 break-all font-mono text-[11px] text-[var(--pw-ink)]">
            {selectedBlock.id || "—"}
          </p>
          {selectedBlock.slot != null && (
            <p className="mt-1 text-[11px] text-[var(--pw-faint)]">
              Slot {selectedBlock.slot}
            </p>
          )}
        </div>
      )}

    </div>
  );
}
