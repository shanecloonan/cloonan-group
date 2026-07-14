"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BlockHeaderSummary,
  MfndStatus,
  MfndTip,
  RecentUpload,
  TestnetConfig,
} from "@/lib/testnet/types";
import { fetchLiveSnapshot, getRpcProxyUrl } from "@/lib/testnet/rpc";
import { formatTime, truncateId } from "./ui";

const POLL_MS = 8_000;
const STALE_MS = 2 * 60_000;

type LiveState = {
  status: MfndStatus | null;
  tip: MfndTip | null;
  headers: BlockHeaderSummary[];
  uploads: RecentUpload[];
  refreshedAt: number | null;
  tipChangedAt: number | null;
  lastTipHeight: number | null;
  error: string | null;
  loading: boolean;
};

export default function LiveStats({ config }: { config: TestnetConfig }) {
  const proxyUrl = getRpcProxyUrl(config.rpc_proxy_url);
  const [live, setLive] = useState<LiveState>({
    status: null,
    tip: null,
    headers: [],
    uploads: [],
    refreshedAt: null,
    tipChangedAt: null,
    lastTipHeight: null,
    error: null,
    loading: Boolean(proxyUrl),
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!proxyUrl) return;

    let cancelled = false;

    const tick = async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const snap = await fetchLiveSnapshot(proxyUrl, ac.signal);
        if (cancelled) return;
        const height =
          snap.status.chain?.tip_height ??
          snap.tip?.tip_height ??
          snap.tip?.height ??
          null;
        setLive((prev) => {
          const tipMoved =
            height != null && height !== prev.lastTipHeight;
          return {
            status: snap.status,
            tip: snap.tip,
            headers: snap.headers,
            uploads: snap.uploads,
            refreshedAt: Date.now(),
            tipChangedAt: tipMoved
              ? Date.now()
              : prev.tipChangedAt ?? (height != null ? Date.now() : null),
            lastTipHeight: height ?? prev.lastTipHeight,
            error: null,
            loading: false,
          };
        });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        const msg = err instanceof Error ? err.message : "RPC unreachable";
        setLive((prev) => ({
          ...prev,
          loading: false,
          error:
            msg === "Failed to fetch" || msg === "Load failed"
              ? `${msg} (blocked HTTP from HTTPS? use /api/testnet/rpc)`
              : msg,
        }));
      }
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [proxyUrl]);

  if (!proxyUrl) {
    return (
      <section id="live" className="scroll-mt-8">
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

  const chain = live.status?.chain;
  const tipId =
    chain?.tip_id ?? live.tip?.tip_id ?? live.tip?.id ?? null;
  const tipHeight =
    chain?.tip_height ?? live.tip?.tip_height ?? live.tip?.height ?? null;
  const genesis =
    chain?.genesis_id ?? live.tip?.genesis_id ?? null;
  const genesisOk = genesis ? genesis === config.genesis_id : null;
  const stale =
    live.tipChangedAt != null && Date.now() - live.tipChangedAt > STALE_MS;

  return (
    <section id="live" className="scroll-mt-8 space-y-5">
      <SectionHead
        title="Live tip"
        lead="Lite explorer — tip, peers, and permanence activity. No address balances."
      />

      {genesisOk === false && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/50 bg-red-950/40 px-4 py-3 text-sm text-red-200"
        >
          Genesis mismatch: node reports{" "}
          <span className="font-mono text-[12px] break-all">{genesis}</span>
          {" "}but this page is pinned to{" "}
          <span className="font-mono text-[12px] break-all">
            {config.genesis_id}
          </span>
          . Do not treat heights as this network.
        </div>
      )}

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
          label="Genesis"
          value={
            genesisOk == null
              ? live.loading
                ? "…"
                : "—"
              : genesisOk
                ? "Match ✓"
                : "Mismatch ✗"
          }
          accent={genesisOk === true ? "ok" : genesisOk === false ? "bad" : undefined}
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
        {proxyUrl ? " · via observer proxy" : ""}
      </p>

      {live.headers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pw-muted)]">
            Recent headers
          </h3>
          <ul className="divide-y divide-[var(--pw-line)] border border-[var(--pw-line)] rounded-lg overflow-hidden">
            {live.headers
              .slice()
              .reverse()
              .map((h, i) => (
                <li
                  key={`${h.height}-${h.id}-${i}`}
                  className="flex items-center justify-between gap-3 bg-[var(--pw-surface)]/40 px-4 py-2.5 text-sm"
                >
                  <span className="font-mono text-[var(--pw-ink)]">
                    #{h.height ?? "?"}
                  </span>
                  <span
                    className="truncate font-mono text-[12px] text-[var(--pw-muted)]"
                    title={h.id}
                  >
                    {truncateId(h.id)}
                  </span>
                </li>
              ))}
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

function SectionHead({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="space-y-1.5 mb-1">
      <h2 className="font-[family-name:var(--font-pw-display)] text-2xl sm:text-3xl text-[var(--pw-ink)] tracking-tight">
        {title}
      </h2>
      <p className="text-sm text-[var(--pw-muted)] max-w-2xl">{lead}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  title,
  accent,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  title?: string;
  accent?: "ok" | "bad";
}) {
  const accentCls =
    accent === "ok"
      ? "text-emerald-300"
      : accent === "bad"
        ? "text-red-300"
        : "text-[var(--pw-ink)]";
  return (
    <div className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/60 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
        {label}
      </p>
      <p
        className={`mt-1.5 text-lg sm:text-xl ${mono ? "font-mono text-[15px] sm:text-base" : "font-semibold"} ${accentCls} truncate`}
        title={title}
      >
        {value}
      </p>
    </div>
  );
}
