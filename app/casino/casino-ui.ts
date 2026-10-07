/* Shared casino design tokens — import from any table or page. */

export const casinoPage =
  "min-h-[calc(100vh-56px)] w-full bg-[#070806] text-[#f6f1e7] selection:bg-[#c6a15b]/35";

export const casinoShellBg =
  "relative before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(198,161,91,0.16),transparent_58%),radial-gradient(ellipse_60%_45%_at_0%_30%,rgba(18,48,32,0.55),transparent_60%),radial-gradient(ellipse_50%_40%_at_100%_100%,rgba(12,28,20,0.7),transparent)]";

/** Deep baize used as the play surface inside a table. */
export const felt =
  "relative overflow-hidden rounded-2xl border border-[#c6a15b]/28 bg-[radial-gradient(ellipse_at_50%_0%,rgba(198,161,91,0.14),transparent_46%),radial-gradient(ellipse_at_50%_130%,#04110c,#0c2419_48%,#07140f)] shadow-[inset_0_0_0_1px_rgba(232,213,163,0.1),inset_0_28px_70px_rgba(0,0,0,0.28)]";

/** Premium section header used on hub pages */
export const sectionTitle = "font-heading text-lg sm:text-xl font-semibold tracking-tight text-[#f6f1e7]";

export const filterPillActive =
  "border-[#c6a15b]/55 bg-gradient-to-b from-[#c6a15b]/25 to-[#8a6a32]/10 text-[#f6ecd4] shadow-[inset_0_1px_0_rgba(255,236,196,0.25)]";

export const filterPillIdle =
  "border-[#c6a15b]/15 bg-black/20 text-[#f6f1e7]/55 hover:text-[#f6f1e7] hover:border-[#c6a15b]/35";

export const card =
  "rounded-xl border border-[#c6a15b]/18 bg-gradient-to-b from-[#161810] to-[#0c0e0a] shadow-[inset_0_1px_0_rgba(232,213,163,0.16),0_16px_40px_rgba(0,0,0,0.4)]";

export const cardHover =
  "transition-all duration-300 hover:border-[#e8d5a3]/40 hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgba(232,213,163,0.28),0_18px_44px_rgba(0,0,0,0.5)]";

export const labelCls =
  "block text-white/45 text-[10px] font-semibold uppercase tracking-[0.18em] mb-1.5";

export const inputCls =
  "w-full h-10 px-3 rounded-lg bg-black/40 border border-[#c6a15b]/15 text-[#f6f1e7] text-sm placeholder:text-[#f6f1e7]/30 outline-none focus:border-[#e8d5a3]/55 focus:ring-1 focus:ring-[#c6a15b]/30 transition-all";

export const btnPrimary =
  "min-h-12 touch-manipulation h-11 px-5 rounded-lg font-semibold text-[12px] tracking-[0.16em] uppercase bg-gradient-to-b from-[#f3e6c4] via-[#e0c27a] to-[#a7843c] text-[#1c1508] shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_8px_24px_rgba(167,132,60,0.28)] hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

export const btnSecondary =
  "min-h-12 touch-manipulation h-11 px-5 rounded-lg font-semibold text-sm bg-white/[0.04] border border-[#c6a15b]/20 text-[#f6f1e7]/90 hover:bg-[#c6a15b]/10 hover:border-[#e8d5a3]/40 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer";

export const btnGhost =
  "h-10 px-4 rounded-lg font-medium text-[11px] tracking-[0.14em] uppercase bg-transparent border border-[#c6a15b]/20 text-[#f6f1e7]/70 hover:bg-[#c6a15b]/10 hover:text-[#f6ecd4] hover:border-[#e8d5a3]/40 active:scale-[0.98] transition-all cursor-pointer";

export const btnGold =
  "min-h-12 touch-manipulation h-11 px-5 rounded-lg font-semibold text-[12px] tracking-[0.16em] uppercase bg-gradient-to-b from-[#f3e6c4] via-[#e0c27a] to-[#a7843c] text-[#1c1508] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

export const btnDanger =
  "min-h-12 touch-manipulation h-11 px-5 rounded-lg font-semibold text-[12px] tracking-[0.14em] uppercase bg-gradient-to-b from-[#8a3a32] to-[#4a1c18] text-[#f6e6dc] border border-[#c48a80]/30 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

export const pill =
  "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] border";

export const pillLive =
  pill + " border-emerald-400/35 text-emerald-200 bg-emerald-500/10";

export const pillGold =
  pill + " border-[#c6a15b]/40 text-[#f6ecd4] bg-[#c6a15b]/10";

export const tableHeader =
  "text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold";

export const ALL_GAMES = [
  "blackjack",
  "baccarat",
  "coinflip",
  "dice",
  "roulette",
  "slots",
  "crash",
  "plinko",
  "mines",
  "hilo",
  "poker",
  "video-poker",
  "keno",
  "wheel",
  "sic-bo",
  "dragon-tiger",
  "casino-war",
  "red-dog",
  "three-card-poker",
  "andar-bahar",
  "caribbean-stud",
  "casino-holdem",
  "let-it-ride",
  "mississippi-stud",
  "chuck-a-luck",
  "ultimate-texas-holdem",
  "craps",
  "teen-patti",
  "trente-et-quarante",
  "salon",
] as const;

export type CasinoGameId = (typeof ALL_GAMES)[number];

export const GAME_LABELS: Record<CasinoGameId, string> = {
  blackjack: "Blackjack",
  baccarat: "Baccarat",
  coinflip: "Coinflip",
  dice: "Dice / Limbo",
  roulette: "Roulette",
  slots: "Slots",
  crash: "Crash",
  plinko: "Plinko",
  mines: "Mines",
  hilo: "HiLo",
  poker: "Poker",
  "video-poker": "Video Poker",
  keno: "Keno",
  wheel: "Money Wheel",
  "sic-bo": "Sic Bo",
  "dragon-tiger": "Dragon Tiger",
  "casino-war": "Casino War",
  "red-dog": "Red Dog",
  "three-card-poker": "Three Card Poker",
  "andar-bahar": "Andar Bahar",
  "caribbean-stud": "Caribbean Stud",
  "casino-holdem": "Casino Hold'em",
  "let-it-ride": "Let It Ride",
  "mississippi-stud": "Mississippi Stud",
  "chuck-a-luck": "Chuck-a-Luck",
  "ultimate-texas-holdem": "Ultimate Hold'em",
  craps: "Craps",
  "teen-patti": "Teen Patti",
  "trente-et-quarante": "Trente et Quarante",
  salon: "Salon Tables",
};
