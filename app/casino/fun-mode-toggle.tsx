"use client";

import { Sparkles, Volume2, VolumeX } from "lucide-react";
import { useEffect } from "react";
import { funAudio, setFunMode, setFunMuted, useFunMode, useFunMuted } from "./fun-mode";

/** Keeps background music in sync with Fun Mode while a casino page is mounted. */
export function useFunMusic(fun: boolean, muted: boolean) {
  useEffect(() => {
    if (!fun || muted) {
      funAudio.stopMusic();
      return;
    }
    if (funAudio.running) {
      funAudio.startMusic();
    } else {
      // Fresh page load with Fun Mode saved on: wait for any user gesture (autoplay policy).
      const start = () => funAudio.startMusic();
      window.addEventListener("pointerdown", start, { once: true });
      window.addEventListener("keydown", start, { once: true });
      return () => {
        window.removeEventListener("pointerdown", start);
        window.removeEventListener("keydown", start);
      };
    }
  }, [fun, muted]);
  useEffect(() => () => funAudio.stopMusic(), []);
}

export function FunModeToggle() {
  const fun = useFunMode();
  const muted = useFunMuted();
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setFunMode(!fun)}
        aria-pressed={fun}
        title={fun ? "Turn Fun Mode off" : "Turn Fun Mode on: Vegas lights, music and effects"}
        className={
          "cz-fun-toggle inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] tracking-[0.16em] uppercase font-medium border cursor-pointer transition-colors " +
          (fun
            ? "text-[#f6ecd4] border-[#e8d5a3]/60 bg-[#c6a15b]/20"
            : "text-[#e8d5a3]/80 border-[#c6a15b]/25 hover:text-[#f6ecd4] hover:border-[#e8d5a3]/50")
        }
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        <span>Fun Mode</span>
        <span className="sr-only">{fun ? "on" : "off"}</span>
      </button>
      {fun && (
        <button
          type="button"
          onClick={() => setFunMuted(!muted)}
          aria-pressed={muted}
          aria-label={muted ? "Unmute casino sound" : "Mute casino sound"}
          title={muted ? "Unmute" : "Mute"}
          className="cz-fun-mute inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#c6a15b]/30 text-[#e8d5a3] cursor-pointer"
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}
