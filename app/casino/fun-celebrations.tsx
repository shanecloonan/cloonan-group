"use client";

import { useEffect, useRef, useState } from "react";
import { useCasino } from "./casino-context";
import { funAudio, useFunMode } from "./fun-mode";
import { fmtPnl } from "./table-kit";

type Burst = { id: number; kind: "win" | "jackpot"; label: string };

const COLORS = ["#ff2bd6", "#00e5ff", "#ffe600", "#39ff14", "#ff7a00", "#b44bff"];

/** Fun Mode only: confetti, coin bursts, win/jackpot banners and SFX when a hand settles. */
export function FunCelebrations() {
  const fun = useFunMode();
  const { history, token } = useCasino();
  const lastAt = useRef<string | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);

  // React to newly settled sessions (skip whatever history was loaded on mount).
  useEffect(() => {
    const top = history[0];
    const prev = lastAt.current;
    lastAt.current = top?.at ?? null;
    if (!fun || !top || prev === null || top.at === prev) return;
    if (top.pnlUnits > 0n) {
      const jackpot = top.multiplier >= 10;
      if (jackpot) funAudio.jackpot();
      else funAudio.win();
      setBurst({ id: Date.now(), kind: jackpot ? "jackpot" : "win", label: fmtPnl(top.pnlUnits, token, 2) });
    } else if (top.pnlUnits < 0n) {
      funAudio.lose();
    }
  }, [history, fun, token]);

  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), burst.kind === "jackpot" ? 3600 : 2400);
    return () => clearTimeout(t);
  }, [burst]);

  // Action sounds: primary buttons spin/deal, other table buttons click.
  useEffect(() => {
    if (!fun) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("button");
      if (!el || el.disabled || el.closest(".cz-fun-toggle, .cz-fun-mute, .cz-chat")) return;
      if (el.classList.contains("cz-btn-primary")) {
        const txt = (el.textContent ?? "").toLowerCase();
        if (/deal|draw|hit|stand|double|split|play|bet|call|raise|flip|start|reveal/.test(txt)) funAudio.deal();
        else funAudio.spin();
      } else if (el.closest(".cz-felt, .cz-stage, .cz-card")) {
        funAudio.click();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [fun]);

  if (!fun || !burst) return null;
  const pieces = burst.kind === "jackpot" ? 70 : 36;
  return (
    <div className="cz-celebrate" data-kind={burst.kind} key={burst.id} aria-live="polite">
      <div className="cz-confetti" aria-hidden>
        {Array.from({ length: pieces }, (_, i) => (
          <span
            key={i}
            style={
              {
                left: `${(i * 37) % 100}%`,
                background: COLORS[i % COLORS.length],
                animationDelay: `${(i % 12) * 0.06}s`,
                "--dx": `${((i * 53) % 120) - 60}px`,
                "--rot": `${(i * 97) % 720}deg`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="cz-coins" aria-hidden>
        {Array.from({ length: burst.kind === "jackpot" ? 18 : 10 }, (_, i) => (
          <span key={i} style={{ "--a": `${i * (360 / (burst.kind === "jackpot" ? 18 : 10))}deg` } as React.CSSProperties} />
        ))}
      </div>
      <div className="cz-banner">
        <span className="cz-banner-title">{burst.kind === "jackpot" ? "JACKPOT!" : "WINNER!"}</span>
        <span className="cz-banner-amount">{burst.label}</span>
      </div>
    </div>
  );
}
