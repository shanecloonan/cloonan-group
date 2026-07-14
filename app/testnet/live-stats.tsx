"use client";

import { useMemo, useState } from "react";
import type { TestnetConfig } from "@/lib/testnet/types";
import BlockChainGraphic from "./block-chain";
import ChainAge from "./chain-age";
import {
  formatDateTime,
  formatTime,
  resolveBlockTimeMs,
  truncateId,
} from "./ui";
import type { LiveSnapshotState } from "./use-live-snapshot";

const STALE_MS = 2 * 60_000;

export default function LiveStats({
  config,
  live,
  variant = "section",
}: {
  config: TestnetConfig;
  live: LiveSnapshotState;
  /** Hero fills first-viewport dead space; section is the detail block below. */
  variant?: "hero" | "section";
}) {
  const chain = live.status?.chain;
  const tipId =
    chain?.tip_id ?? live.tip?.tip_id ?? live.tip?.id ?? null;
  const tipHeight =
    chain?.tip_height ?? live.tip?.tip_height ?? live.tip?.height ?? null;
  const stale =
    live.tipChangedAt != null && Date.now() - live.tipChangedAt > STALE_MS;
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);

  const recentBlocks = useMemo(() => {
    const rows = live.headers
      .map((h) => {
        const height = h.height;
        if (height == null) return null;
        return {
          height,
          id: h.id ?? h.block_id ?? "",
          slot: h.slot,
          whenMs: resolveBlockTimeMs({
            protocolTsSec: h.timestamp,
            height,
            tipHeight,
            tipSeenAtMs: live.tipChangedAt,
            slotMs: config.slot_duration_ms,
          }),
          userTxCount: h.user_tx_count,
          txCount: h.tx_count,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    rows.sort((a, b) => b.height - a.height);
    return rows;
  }, [
    live.headers,
    tipHeight,
    live.tipChangedAt,
    config.slot_duration_ms,
  ]);

  if (variant === "hero") {
    if (!live.proxyUrl) {
      return (
        <div className="flex h-full min-h-[12rem] flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--pw-line)] bg-[var(--pw-surface)]/40 px-4 text-center text-sm text-[var(--pw-muted)]">
          Live chain offline — observer proxy not configured.
        </div>
      );
    }

    return (
      <div
        id="live"
        className="flex w-full flex-col pt-1 sm:h-full sm:min-h-0 sm:flex-1 sm:justify-end sm:pt-2"
      >
        {(live.headers.length > 0 || live.loading) && (
          <BlockChainGraphic
            headers={live.headers}
            tipHeight={tipHeight}
            tipSeenAtMs={live.tipChangedAt}
            slotMs={config.slot_duration_ms}
            observedBlockIntervalMs={live.observedBlockIntervalMs}
            loading={live.loading}
            fill
            compact
          />
        )}
        {live.error && (
          <p className="mt-2 shrink-0 text-[11px] text-red-300/90">
            {live.error}
          </p>
        )}
      </div>
    );
  }

  if (!live.proxyUrl) {
    return (
      <section className="scroll-mt-8">
        <SectionHead
          title="Live tip"
          lead="Observer proxy not configured — join steps below still work offline."
        />
        <div className="rounded-xl border border-dashed border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-5 py-8 text-center">
          <p className="text-sm text-[var(--pw-muted)]">
            Live stats offline. Set{" "}
            <code className="rounded bg-[var(--pw-code)] px-1.5 py-0.5 text-[12px] text-[var(--pw-accent)]">
              NEXT_PUBLIC_MFND_RPC_PROXY_URL
            </code>{" "}
            to an HTTP→TCP JSON-RPC proxy pointing at a dedicated observer.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="scroll-mt-8 space-y-5">
      <SectionHead title="Network pulse" />

      {stale && !live.error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/90">
          Tip looks stale — height has not advanced for over 2 minutes (slot is{" "}
          {config.slot_duration_ms / 1000}s). Mesh or observer may be lagging.
        </div>
      )}

      {live.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-200/90">
          Live stats error: {live.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ChainAge launchTimestamp={config.launch_timestamp} />
        <Stat
          label="Tip height"
          value={live.loading && tipHeight == null ? "…" : tipHeight ?? "—"}
          mono
        />
        <Stat
          label="Tip id"
          value={live.loading && !tipId ? "…" : truncateId(tipId)}
          title={tipId ?? undefined}
          mono
        />
        <Stat
          label="User transactions"
          value={
            live.txTotals?.totalTxCount != null
              ? live.txTotals.totalTxCount.toLocaleString()
              : live.loading
                ? "…"
                : "—"
          }
          title={
            live.txTotals
              ? live.txTotals.complete
                ? `Non-coinbase txs in blocks 1–${live.txTotals.tipHeight}`
                : `Scanning… ${live.txTotals.coveredHeights}/${live.txTotals.tipHeight} blocks`
              : undefined
          }
          mono
          hint={
            live.txTotals && !live.txTotals.complete
              ? `${live.txTotals.coveredHeights}/${live.txTotals.tipHeight} blocks`
              : live.txTotals?.complete
                ? "excl. coinbase"
                : undefined
          }
        />
        <Stat
          label="Validators"
          value={
            chain?.validator_count ??
            (live.loading ? "…" : config.validator_committee_size)
          }
        />
        <Stat
          label="Mempool"
          value={
            live.status?.mempool?.pool_len ?? (live.loading ? "…" : "—")
          }
        />
        <Stat
          label="P2P peers / sessions"
          value={
            live.status?.p2p
              ? `${live.status.p2p.peer_count ?? "—"} / ${live.status.p2p.session_count ?? "—"}`
              : live.loading
                ? "…"
                : "—"
          }
        />
      </div>

      <p className="text-[11px] tracking-wide text-[var(--pw-faint)]">
        Last refreshed {formatTime(live.refreshedAt)}
        {live.proxyUrl ? " · via observer proxy" : ""}
        {live.txTotals?.complete
          ? " · user txs excl. coinbase"
          : live.txTotals
            ? " · user-tx total still backfilling"
            : ""}
      </p>

      {recentBlocks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pw-muted)]">
            Recent blocks
          </h3>
          <ul className="divide-y divide-[var(--pw-line)] overflow-hidden rounded-lg border border-[var(--pw-line)]">
            {recentBlocks.map((b) => {
              const open = expandedHeight === b.height;
              return (
                <li key={b.height}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedHeight(open ? null : b.height)
                    }
                    className="flex w-full items-center justify-between gap-3 bg-[var(--pw-surface)]/40 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--pw-surface)]/70"
                    aria-expanded={open}
                  >
                    <span className="shrink-0 font-mono text-[var(--pw-accent)]">
                      #{b.height}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--pw-ink)]">
                      {truncateId(b.id)}
                    </span>
                    <span className="shrink-0 tabular-nums text-[11px] text-[var(--pw-muted)]">
                      {formatDateTime(b.whenMs)}
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-1 border-t border-[var(--pw-line)] bg-[var(--pw-code)]/40 px-4 py-3 text-[11px] text-[var(--pw-muted)]">
                      <p className="break-all font-mono text-[var(--pw-ink)]">
                        {b.id || "—"}
                      </p>
                      <p className="tabular-nums text-[var(--pw-faint)]">
                        {formatDateTime(b.whenMs)}
                        {b.whenMs != null
                          ? ` · ${formatTime(b.whenMs)}`
                          : ""}
                        {b.slot != null ? ` · slot ${b.slot}` : ""}
                      </p>
                      {(b.userTxCount != null || b.txCount != null) && (
                        <p className="text-[var(--pw-faint)]">
                          {b.userTxCount != null
                            ? `${b.userTxCount} user tx${b.userTxCount === 1 ? "" : "s"}`
                            : null}
                          {b.userTxCount != null && b.txCount != null
                            ? " · "
                            : ""}
                          {b.txCount != null
                            ? `${b.txCount} total incl. coinbase`
                            : null}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {live.uploads.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pw-muted)]">
            Recent uploads
          </h3>
          <ul className="divide-y divide-[var(--pw-line)] border border-[var(--pw-line)] rounded-lg overflow-hidden">
            {live.uploads.map((u, i) => {
              const id = String(u.tx_id ?? u.id ?? "");
              return (
                <li
                  key={`${id}-${i}`}
                  className="flex items-center justify-between gap-3 bg-[var(--pw-surface)]/40 px-4 py-2.5 text-sm"
                >
                  <span className="text-[var(--pw-muted)]">
                    {u.height != null ? `h${u.height}` : "upload"}
                  </span>
                  <span
                    className="truncate font-mono text-[12px] text-[var(--pw-ink)]"
                    title={id}
                  >
                    {truncateId(id) || (u.summary as string) || "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function SectionHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="mb-1 space-y-1.5">
      <h2 className="font-[family-name:var(--font-pw-display)] text-2xl tracking-tight text-[var(--pw-ink)] sm:text-3xl">
        {title}
      </h2>
      {lead ? (
        <p className="max-w-2xl text-sm text-[var(--pw-muted)]">{lead}</p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  title,
  hint,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  title?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/60 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
        {label}
      </p>
      <p
        className={`mt-1.5 truncate text-lg sm:text-xl ${mono ? "font-mono text-[15px] sm:text-base" : "font-semibold"} text-[var(--pw-ink)]`}
        title={title}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[10px] tabular-nums text-[var(--pw-faint)]">
          {hint}
        </p>
      )}
    </div>
  );
}
