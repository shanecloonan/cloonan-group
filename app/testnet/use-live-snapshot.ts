"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BlockHeaderSummary,
  ChainParams,
  FraudContestSnapshot,
  LightCheckpointSummary,
  MempoolPulse,
  MfndStatus,
  MfndTip,
  RecentUpload,
  StoragePulse,
  TestnetConfig,
} from "@/lib/testnet/types";
import {
  fetchLiveSnapshot,
  getRpcProxyUrl,
  type TxCountTotals,
} from "@/lib/testnet/rpc";
import type { PrivacySampleAggregate } from "@/lib/testnet/tx-meta";

/** Fast enough to catch 30s slots without looking laggy at tip updates. */
const POLL_MS = 2_500;
const MAX_INTERVAL_SAMPLES = 8;

export type LiveSnapshotState = {
  proxyUrl: string | null;
  status: MfndStatus | null;
  tip: MfndTip | null;
  headers: BlockHeaderSummary[];
  uploads: RecentUpload[];
  /** Running sum of per-block tx counts (backfills across polls). */
  txTotals: TxCountTotals | null;
  chainParams: ChainParams | null;
  checkpoint: LightCheckpointSummary | null;
  fraudContests: FraudContestSnapshot | null;
  storagePulse: StoragePulse | null;
  mempoolPulse: MempoolPulse | null;
  privacySample: PrivacySampleAggregate | null;
  refreshedAt: number | null;
  tipChangedAt: number | null;
  lastTipHeight: number | null;
  /** Wall-clock gaps between tip advances (includes gossip + poll lag). */
  tipIntervalSamplesMs: number[];
  /** Median of samples, or null until we have two tip advances. */
  observedBlockIntervalMs: number | null;
  error: string | null;
  loading: boolean;
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

export function useLiveSnapshot(config: TestnetConfig): LiveSnapshotState {
  const proxyUrl = getRpcProxyUrl(config.rpc_proxy_url);
  const [live, setLive] = useState<Omit<LiveSnapshotState, "proxyUrl">>({
    status: null,
    tip: null,
    headers: [],
    uploads: [],
    txTotals: null,
    chainParams: null,
    checkpoint: null,
    fraudContests: null,
    storagePulse: null,
    mempoolPulse: null,
    privacySample: null,
    refreshedAt: null,
    tipChangedAt: null,
    lastTipHeight: null,
    tipIntervalSamplesMs: [],
    observedBlockIntervalMs: null,
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
        const now = Date.now();
        setLive((prev) => {
          const tipMoved = height != null && height !== prev.lastTipHeight;
          let samples = prev.tipIntervalSamplesMs;
          if (
            tipMoved &&
            prev.tipChangedAt != null &&
            prev.lastTipHeight != null &&
            height != null &&
            height === prev.lastTipHeight + 1
          ) {
            const gap = now - prev.tipChangedAt;
            // Ignore pathological gaps (tab sleep / long stall).
            if (gap >= 8_000 && gap <= 120_000) {
              samples = [...samples, gap].slice(-MAX_INTERVAL_SAMPLES);
            }
          }
          return {
            status: snap.status,
            tip: snap.tip,
            headers: snap.headers,
            uploads: snap.uploads,
            txTotals: snap.txTotals ?? prev.txTotals,
            chainParams: snap.chainParams ?? prev.chainParams,
            checkpoint: snap.checkpoint ?? prev.checkpoint,
            fraudContests: snap.fraudContests ?? prev.fraudContests,
            storagePulse: snap.storagePulse ?? prev.storagePulse,
            mempoolPulse: snap.mempoolPulse ?? prev.mempoolPulse,
            privacySample: snap.privacySample ?? prev.privacySample,
            refreshedAt: now,
            tipChangedAt: tipMoved
              ? now
              : prev.tipChangedAt ?? (height != null ? now : null),
            lastTipHeight: height ?? prev.lastTipHeight,
            tipIntervalSamplesMs: samples,
            observedBlockIntervalMs: median(samples),
            error: null,
            loading: false,
          };
        });
      } catch (err) {
        if (
          cancelled ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
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

  return { proxyUrl, ...live };
}
