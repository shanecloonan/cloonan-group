"use client";

import { useEffect, useState } from "react";
import { getOrCreateGuestProfile } from "@/lib/casino/guest-play";
import { relativeTime, type SocialMessage } from "@/lib/casino/social";

/** Current casino username (the guest name shown on the chip bar). Read fresh at post time. */
export function currentIdentity(): { username: string; posterId: string } {
  const p = getOrCreateGuestProfile();
  return { username: p.displayName, posterId: p.guestId };
}

export function useIdentityName(): string {
  const [name, setName] = useState("");
  useEffect(() => {
    const read = () => setName(currentIdentity().username);
    read();
    window.addEventListener("focus", read);
    window.addEventListener("storage", read);
    const t = setInterval(read, 5000);
    return () => {
      window.removeEventListener("focus", read);
      window.removeEventListener("storage", read);
      clearInterval(t);
    };
  }, []);
  return name;
}

/** Re-render every 30s so relative timestamps stay fresh. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Plain-text message row. Text is rendered as React text nodes only (never HTML). */
export function MessageRow({ m, now, compact }: { m: SocialMessage; now: number; compact?: boolean }) {
  return (
    <li className={"cz-msg " + (compact ? "py-1.5" : "py-3 border-b border-white/[0.05] last:border-0")}>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="cz-msg-user text-[12px] font-semibold text-[#e8d5a3] truncate max-w-[60%]">{m.username}</span>
        <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString()} className="text-[10px] text-white/35 shrink-0">
          {relativeTime(m.created_at, now)}
        </time>
      </div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-[#f6f1e7]/80 whitespace-pre-wrap break-words">{m.body}</p>
    </li>
  );
}
