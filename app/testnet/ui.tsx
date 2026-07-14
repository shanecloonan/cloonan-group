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
