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
  txCount?: number;
  userTxCount?: number;
};

type Props = {
  headers: BlockHeaderSummary[];
  tipHeight: number | null;
  tipSeenAtMs: number | null;
  slotMs: number;
  /** Median wall-clock gap between tip advances (produce + gossip + poll). */
  observedBlockIntervalMs?: number | null;
  loading?: boolean;
  /** Stretch into remaining hero viewport (mobile + desktop). */
  fill?: boolean;
  /** Hide selected-block detail panel (hero stays tight). */
  compact?: boolean;
};

export default function BlockChainGraphic({
  headers,
  tipHeight,
  tipSeenAtMs,
  slotMs,
  observedBlockIntervalMs = null,
  loading,
  fill = false,
  compact = false,
}: Props) {
  const blocks = useMemo(() => {
    const rows: ChainBlockView[] = [];
    for (const h of headers) {
      const height = h.height;
      if (height == null) continue;
      rows.push({
        height,
        id: h.id ?? h.block_id ?? "",
        slot: h.slot,
        whenMs: resolveBlockTimeMs({
          protocolTsSec: h.timestamp,
          height,
          tipHeight,
          tipSeenAtMs,
          slotMs,
        }),
        txCount: h.tx_count,
        userTxCount: h.user_tx_count,
      });
    }
    rows.sort((a, b) => a.height - b.height);

    const byH = new Map<number, ChainBlockView>();
    for (const b of rows) byH.set(b.height, b);
    return [...byH.values()].sort((a, b) => a.height - b.height);
  }, [headers, tipHeight, tipSeenAtMs, slotMs]);

  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const revealedRef = useRef<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scrollerRef = useRef<HTMLOListElement | null>(null);
  const tipTailRef = useRef<HTMLLIElement | null>(null);
  const heightKey = blocks.map((b) => b.height).join(",");
  // Prefer measured tip cadence when we have samples; else configured 30s slot.
  const cadenceMs =
    observedBlockIntervalMs != null && observedBlockIntervalMs > 0
      ? observedBlockIntervalMs
      : slotMs;

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
      }, i * 140),
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [heightKey]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // Keep tip + building ghost pinned at the right edge of the viewport.
  useEffect(() => {
    const el = tipTailRef.current;
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    const id = requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(
        0,
        scroller.scrollWidth - scroller.clientWidth,
      );
      el.scrollIntoView({
        behavior: "smooth",
        inline: "end",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(id);
  }, [tipHeight, heightKey, revealed.size]);

  const tip = tipHeight ?? blocks[blocks.length - 1]?.height ?? null;
  const elapsedMs =
    tipSeenAtMs != null ? Math.max(0, now - tipSeenAtMs) : null;
  const remainingMs =
    elapsedMs != null && cadenceMs > 0 ? cadenceMs - elapsedMs : null;
  const overdueMs =
    remainingMs != null && remainingMs < 0 ? -remainingMs : 0;
  const inSlotWindow = remainingMs != null && remainingMs > 0;
  // Progress fills across observed/configured cadence; holds at 100% while awaiting tip.
  const buildingProgress =
    elapsedMs != null && cadenceMs > 0
      ? Math.min(1, elapsedMs / cadenceMs)
      : 0;

  const etaLabel =
    remainingMs == null
      ? "…"
      : inSlotWindow
        ? `~${Math.max(1, Math.ceil(remainingMs / 1000))}s`
        : overdueMs < 1500
          ? "sealing…"
          : `+${Math.floor(overdueMs / 1000)}s awaiting tip`;

  const selectedBlock =
    selected != null ? blocks.find((b) => b.height === selected) : null;

  if (loading && blocks.length === 0) {
    return (
      <div
        className={`pw-chain rounded-2xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-4 text-center text-sm text-[var(--pw-muted)] ${
          fill
            ? "flex h-full min-h-[11rem] flex-1 items-center justify-center"
            : "py-10"
        }`}
      >
        Syncing chain…
      </div>
    );
  }

  if (blocks.length === 0) return null;

  return (
    <div
      className={`pw-chain flex flex-col ${
        fill ? "sm:h-full sm:min-h-0 sm:flex-1" : "space-y-3"
      }`}
    >
      <div
        className={`flex shrink-0 items-end justify-between gap-3 ${fill ? "mb-1.5 sm:mb-3" : "mb-3"}`}
      >
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pw-muted)]">
            Live chain
          </h3>
        </div>
        {tip != null && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pw-faint)]">
              Tip
            </p>
            <p className="font-mono text-sm text-[var(--pw-accent)]">#{tip}</p>
          </div>
        )}
      </div>

      <div
        className={`relative min-h-0 overflow-hidden rounded-2xl border border-[var(--pw-line)] bg-gradient-to-br from-[rgba(16,28,24,0.95)] via-[rgba(10,18,16,0.92)] to-[rgba(8,14,12,0.98)] ${
          fill
            ? "px-2.5 py-2.5 sm:flex sm:flex-1 sm:flex-col sm:justify-center sm:px-5 sm:py-5"
            : "px-3 py-5 sm:px-5 sm:py-6"
        }`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(ellipse 55% 80% at 85% 40%, rgba(196,163,90,0.12), transparent 65%), radial-gradient(ellipse 40% 60% at 10% 80%, rgba(80,140,110,0.08), transparent 60%)",
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

        <div className="relative z-[1] w-full">
          <ol
            ref={scrollerRef}
            className="flex items-center gap-0 overflow-x-auto pb-1 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
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
                  className="flex shrink-0 items-center snap-center"
                >
                  {i > 0 && (
                    <div
                      className="relative mx-0.5 h-px w-7 shrink-0 sm:mx-1 sm:w-10 md:w-14"
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
                        <span className="absolute left-1/2 top-2.5 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium tabular-nums text-[var(--pw-accent)]/90">
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
                    className={`group relative w-[7.75rem] text-left transition-all duration-500 ease-out sm:w-[9.5rem] md:w-[10.5rem] ${
                      show
                        ? "opacity-100 translate-y-0 scale-100"
                        : "pointer-events-none translate-y-3 scale-95 opacity-0"
                    }`}
                    aria-pressed={selected === b.height}
                  >
                    <div
                      className={`relative overflow-hidden rounded-xl border px-3 py-3 backdrop-blur-sm transition-colors sm:px-3.5 ${
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
                      <div className="relative flex items-start justify-between gap-1">
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
                      <p className="relative mt-1.5 text-[10px] tabular-nums text-[var(--pw-muted)] sm:text-[11px]">
                        {formatDateTime(b.whenMs)}
                      </p>
                      <p className="relative mt-0.5 text-[10px] tabular-nums text-[var(--pw-muted)] sm:text-[11px]">
                        {b.userTxCount != null
                          ? `${b.userTxCount} transaction${b.userTxCount === 1 ? "" : "s"}`
                          : b.txCount != null
                            ? `${b.txCount} transaction${b.txCount === 1 ? "" : "s"}`
                            : "… transactions"}
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

            <li ref={tipTailRef} className="flex shrink-0 items-center">
              <div
                className="relative mx-0.5 h-px w-7 shrink-0 sm:mx-1 sm:w-10 md:w-14"
                aria-hidden
              >
                <span
                  className="absolute inset-0 origin-left bg-[repeating-linear-gradient(90deg,rgba(196,163,90,0.45)_0_4px,transparent_4px_8px)]"
                  style={{
                    transform: `scaleX(${0.25 + buildingProgress * 0.75})`,
                    transformOrigin: "left center",
                    transition: "transform 0.25s linear",
                  }}
                />
              </div>
              <div className="relative w-[7.75rem] sm:w-[9.5rem] md:w-[10.5rem]">
                <div
                  className={`rounded-xl border border-dashed px-3 py-3 sm:px-3.5 ${
                    inSlotWindow
                      ? "border-[var(--pw-accent)]/30 bg-[rgba(12,22,18,0.45)]"
                      : "border-[var(--pw-accent)]/50 bg-[var(--pw-accent-soft)]/40"
                  }`}
                >
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
                    {inSlotWindow ? "Building…" : "Awaiting tip…"}
                  </p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--pw-line)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--pw-accent)]/40 to-[var(--pw-accent)]"
                      style={{
                        width: `${Math.round(buildingProgress * 100)}%`,
                        transition: "width 0.25s linear",
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] tabular-nums text-[var(--pw-faint)]">
                    {etaLabel}
                  </p>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </div>

      {!compact && selectedBlock && (
        <div className="mt-3 shrink-0 rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-4 py-3 text-[12px] text-[var(--pw-muted)]">
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
          {selectedBlock.userTxCount != null && (
            <p className="mt-1 text-[11px] text-[var(--pw-faint)]">
              {selectedBlock.userTxCount} user transaction
              {selectedBlock.userTxCount === 1 ? "" : "s"}
              {selectedBlock.txCount != null
                ? ` · ${selectedBlock.txCount} total incl. coinbase`
                : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
