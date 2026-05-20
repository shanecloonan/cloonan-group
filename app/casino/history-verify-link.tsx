"use client";

import { useState } from "react";
import { fetchSessionForVerify } from "@/lib/casino/load-session-from-db";
import { buildVerifyLink } from "./share-link";

/** Load a cloud session + open /casino/verify with the full payload. */
export function HistoryVerifyLink({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openVerify = async () => {
    setErr(null);
    setBusy(true);
    try {
      const result = await fetchSessionForVerify(sessionId);
      if ("error" in result) {
        setErr(result.error);
        return;
      }
      const href = buildVerifyLink(result.session, result.revealedServerSeed);
      window.location.assign(href);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void openVerify()}
        className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer disabled:opacity-40"
      >
        {busy ? "loading…" : "verify →"}
      </button>
      {err && <span className="text-[9px] text-rose-300/90 max-w-[140px] text-right">{err}</span>}
    </span>
  );
}
