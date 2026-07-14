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

const POLL_MS = 8_000;

export type LiveSnapshotState = {
  proxyUrl: string | null;
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

export function useLiveSnapshot(config: TestnetConfig): LiveSnapshotState {
  const proxyUrl = getRpcProxyUrl(config.rpc_proxy_url);
  const [live, setLive] = useState<Omit<LiveSnapshotState, "proxyUrl">>({
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
          const tipMoved = height != null && height !== prev.lastTipHeight;
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
