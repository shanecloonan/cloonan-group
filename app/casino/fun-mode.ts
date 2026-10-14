"use client";

/**
 * Fun Mode — opt-in Vegas theme for the casino. Off by default.
 * State lives in localStorage; all audio is synthesized with Web Audio (no assets, no licensing).
 */
import { useSyncExternalStore } from "react";

const FUN_KEY = "mf_casino_fun_mode_v1";
const MUTE_KEY = "mf_casino_fun_muted_v1";
const EVT = "mf-casino-fun-change";

function read(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string, v: boolean) {
  try {
    window.localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* storage disabled — state is session-only */
  }
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useFunMode(): boolean {
  return useSyncExternalStore(subscribe, () => read(FUN_KEY), () => false);
}

export function useFunMuted(): boolean {
  return useSyncExternalStore(subscribe, () => read(MUTE_KEY), () => false);
}

export function isFunMode(): boolean {
  return read(FUN_KEY);
}

export function setFunMode(on: boolean) {
  write(FUN_KEY, on);
  if (on && !read(MUTE_KEY)) funAudio.startMusic();
  else funAudio.stopMusic();
}

export function setFunMuted(muted: boolean) {
  write(MUTE_KEY, muted);
  if (muted) funAudio.stopMusic();
  else if (read(FUN_KEY)) funAudio.startMusic();
}

/** True when sound effects should play right now. */
export function funSoundOn(): boolean {
  return read(FUN_KEY) && !read(MUTE_KEY);
}

/* ---------------------------------------------------------------------------
 *  Web Audio synth
 * ------------------------------------------------------------------------- */

type Wave = OscillatorType;

class FunAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  private tone(freq: number, start: number, dur: number, opts: { wave?: Wave; gain?: number; bus?: AudioNode; slideTo?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.wave ?? "square";
    o.frequency.setValueAtTime(freq, start);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur);
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(opts.bus ?? this.master);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private noise(start: number, dur: number, gain = 0.15, freq = 3000) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(start);
  }

  /* ---- Music: an upbeat lounge/arcade loop, scheduled with a light lookahead timer ---- */

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.timer) return;
    this.nextTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 120);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get musicPlaying(): boolean {
    return !!this.timer;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const spb = 60 / 124 / 2; // eighth notes at 124 bpm
    // I – vi – IV – V in C
    const chords = [
      [261.63, 329.63, 392.0],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
    ];
    const bass = [65.41, 55.0, 43.65, 49.0];
    while (this.nextTime < ctx.currentTime + 0.35) {
      const s = this.step % 64;
      const bar = Math.floor(s / 16);
      const pos = s % 16;
      const t = this.nextTime;
      const bus = this.musicBus;
      if (pos % 4 === 0) this.tone(bass[bar], t, spb * 1.6, { wave: "triangle", gain: 0.5, bus });
      if (pos % 4 === 2) this.tone(bass[bar] * 2, t, spb * 0.8, { wave: "triangle", gain: 0.3, bus });
      if (pos === 2 || pos === 6 || pos === 10 || pos === 14) {
        for (const f of chords[bar]) this.tone(f, t, spb * 0.7, { wave: "square", gain: 0.05, bus });
      }
      const arp = chords[bar];
      if (pos % 2 === 1) this.tone(arp[(pos >> 1) % 3] * 2, t, spb * 0.5, { wave: "sine", gain: 0.09, bus });
      if (pos % 4 === 0) this.noise(t, 0.03, 0.05, 8000);
      this.nextTime += spb;
      this.step++;
    }
  }

  /* ---- Sound effects ---- */

  private sfxTime(): number | null {
    if (!funSoundOn()) return null;
    const ctx = this.ensure();
    return ctx ? ctx.currentTime + 0.01 : null;
  }

  click() {
    const t = this.sfxTime();
    if (t === null) return;
    this.tone(880, t, 0.06, { wave: "square", gain: 0.08, slideTo: 1320 });
  }

  spin() {
    const t = this.sfxTime();
    if (t === null) return;
    for (let i = 0; i < 10; i++) this.noise(t + i * 0.045, 0.02, 0.18, 2500 + i * 120);
    this.tone(220, t, 0.45, { wave: "sawtooth", gain: 0.05, slideTo: 660 });
  }

  deal() {
    const t = this.sfxTime();
    if (t === null) return;
    this.noise(t, 0.07, 0.22, 1800);
    this.noise(t + 0.09, 0.06, 0.16, 2200);
  }

  coin() {
    const t = this.sfxTime();
    if (t === null) return;
    this.tone(987.77, t, 0.08, { wave: "square", gain: 0.12 });
    this.tone(1318.51, t + 0.07, 0.25, { wave: "square", gain: 0.12 });
  }

  win() {
    const t = this.sfxTime();
    if (t === null) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.09, 0.22, { wave: "square", gain: 0.12 }));
    for (let i = 0; i < 6; i++) this.tone(1318.51 + (i % 2) * 250, t + 0.4 + i * 0.06, 0.1, { wave: "sine", gain: 0.1 });
  }

  jackpot() {
    const t = this.sfxTime();
    if (t === null) return;
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
    for (let r = 0; r < 3; r++) scale.forEach((f, i) => this.tone(f, t + r * 0.5 + i * 0.05, 0.12, { wave: "square", gain: 0.1 }));
    for (let i = 0; i < 16; i++) this.tone(i % 2 ? 1567.98 : 2093, t + 1.5 + i * 0.07, 0.12, { wave: "sine", gain: 0.12 });
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => this.tone(f, t + 2.65, 0.9, { wave: "triangle", gain: 0.12 }));
  }

  lose() {
    const t = this.sfxTime();
    if (t === null) return;
    this.tone(330, t, 0.25, { wave: "triangle", gain: 0.08, slideTo: 220 });
  }
}

export const funAudio = new FunAudio();
