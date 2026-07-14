"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyFeedback(timeoutMs = 1600) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiedKey(null), timeoutMs);
      } catch {
        setCopiedKey(null);
      }
    },
    [timeoutMs],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { copiedKey, copy };
}

export function CopyButton({
  label,
  text,
  copyKey,
  copiedKey,
  onCopy,
}: {
  label?: string;
  text: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const done = copiedKey === copyKey;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, text)}
      className="shrink-0 rounded-md border border-[var(--pw-line)] bg-[var(--pw-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pw-muted)] transition-colors hover:border-[var(--pw-accent)]/40 hover:text-[var(--pw-ink)] cursor-pointer"
    >
      {done ? "Copied" : label ?? "Copy"}
    </button>
  );
}

export function CodeBlock({
  code,
  copyKey,
  copiedKey,
  onCopy,
}: {
  code: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-[var(--pw-line)] bg-[var(--pw-code)]">
      <div className="flex items-center justify-end border-b border-[var(--pw-line)] px-3 py-1.5">
        <CopyButton
          text={code}
          copyKey={copyKey}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
      </div>
      <pre className="overflow-x-auto p-4 text-[12px] leading-relaxed text-[var(--pw-code-ink)] font-[family-name:var(--font-pw-mono)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function truncateId(id: string | undefined | null, left = 10, right = 8) {
  if (!id) return "—";
  if (id.length <= left + right + 1) return id;
  return `${id.slice(0, left)}…${id.slice(-right)}`;
}

export function formatTime(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Compact local date+time for recent-block rows. */
export function formatDateTime(tsMs: number | null | undefined) {
  if (tsMs == null || !Number.isFinite(tsMs)) return "—";
  return new Date(tsMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** UTC timestamp for genesis reference lines. */
export function formatGenesisUtc(unixSec: number) {
  if (!Number.isFinite(unixSec)) return "—";
  return (
    new Date(unixSec * 1000).toISOString().replace(".000Z", "Z")
  );
}

/** Live chain-age duration (d/h/m/s). */
export function formatChainAge(ageMs: number) {
  if (!Number.isFinite(ageMs) || ageMs < 0) ageMs = 0;
  const totalSec = Math.floor(ageMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${mins}m ${secs}s`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Prefer a fresh protocol timestamp; otherwise estimate from tip wall time
 * and slot spacing (toy genesis headers often use epoch-style timestamps).
 */
export function resolveBlockTimeMs(opts: {
  protocolTsSec?: number;
  height?: number;
  tipHeight: number | null;
  tipSeenAtMs: number | null;
  slotMs: number;
}): number | null {
  const { protocolTsSec, height, tipHeight, tipSeenAtMs, slotMs } = opts;
  if (protocolTsSec != null && Number.isFinite(protocolTsSec)) {
    const ms = protocolTsSec * 1000;
    if (Math.abs(Date.now() - ms) < 7 * 24 * 60 * 60 * 1000) return ms;
  }
  if (
    height != null &&
    tipHeight != null &&
    tipSeenAtMs != null &&
    tipHeight >= height &&
    slotMs > 0
  ) {
    return tipSeenAtMs - (tipHeight - height) * slotMs;
  }
  return null;
}
