"use client";

import { useMemo, useState } from "react";

/**
 * Build a shareable /casino/verify URL that pre-loads a settled session and
 * (optionally) the revealed server seed. Encodes the entire payload into
 * the URL using URL-safe base64 — no server round-trip required.
 *
 * Used by every game's "verify hand" modal to give the player a one-click
 * share-this link they can hand to anyone who wants to audit them.
 */
export function buildVerifyLink(session: unknown, serverSeed?: string | null): string {
  const json = JSON.stringify(session, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  const b64 = typeof window === "undefined"
    ? Buffer.from(json, "utf-8").toString("base64")
    : btoa(unescape(encodeURIComponent(json)));
  const url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const base = typeof window === "undefined" ? "" : window.location.origin;
  const seedQs = serverSeed ? `&seed=${encodeURIComponent(serverSeed)}` : "";
  return `${base}/casino/verify?session=${url}${seedQs}`;
}

/** Drop-in row component for any game's verify modal. */
export function ShareLinkRow({
  session,
  serverSeed,
}: {
  session: unknown;
  serverSeed: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const link = useMemo(() => buildVerifyLink(session, serverSeed ?? null), [session, serverSeed]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // no-op
    }
  };
  return (
    <div className="pt-3 border-t border-white/[0.06] space-y-2">
      <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Shareable link</div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={link}
          className="flex-1 h-9 px-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px] font-mono text-white/70"
        />
        <button
          type="button"
          onClick={copy}
          className="h-9 px-3 rounded-lg font-medium text-xs bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 hover:text-emerald-100 hover:bg-emerald-500/25 cursor-pointer transition-all"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <p className="text-[10px] text-white/40">
        Anyone who opens this link replays the exact same hand in their own browser. No server trust.
      </p>
    </div>
  );
}
