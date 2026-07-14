"use client";

import { useEffect, useState } from "react";
import { formatChainAge, formatGenesisUtc } from "./ui";

type Props = {
  /** Genesis unix seconds from the pinned genesis JSON. */
  genesisTimestamp: number;
  /** Compact one-line variant for the live-chain header. */
  compact?: boolean;
};

export default function ChainAge({ genesisTimestamp, compact = false }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!Number.isFinite(genesisTimestamp) || genesisTimestamp <= 0) {
    return null;
  }

  const genesisMs = genesisTimestamp * 1000;
  const ageMs = Math.max(0, now - genesisMs);
  const age = formatChainAge(ageMs);
  const genesisUtc = formatGenesisUtc(genesisTimestamp);

  if (compact) {
    return (
      <p
        className="mt-1 text-[11px] tabular-nums text-[var(--pw-faint)] sm:text-[12px]"
        title={`Genesis timestamp ${genesisTimestamp} (${genesisUtc})`}
      >
        Chain age{" "}
        <span className="font-mono text-[var(--pw-muted)]">{age}</span>
        <span className="text-[var(--pw-faint)]">
          {" "}
          · genesis {genesisUtc}
        </span>
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/60 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
        Chain age
      </p>
      <p className="mt-1.5 font-mono text-lg tabular-nums text-[var(--pw-ink)] sm:text-xl">
        {age}
      </p>
      <p className="mt-1 text-[10px] tabular-nums text-[var(--pw-faint)]">
        since genesis {genesisUtc}
      </p>
    </div>
  );
}
