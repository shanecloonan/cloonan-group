/* Shared casino design tokens — import from any table or page. */

export const casinoPage =
  "min-h-[calc(100vh-56px)] w-full bg-[#06070c] text-white selection:bg-amber-500/30";

export const casinoShellBg =
  "relative before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(245,158,11,0.06),transparent)]";

export const card =
  "rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-white/[0.02] backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.35)]";

export const cardHover =
  "transition-all duration-200 hover:border-amber-400/25 hover:shadow-[0_12px_40px_rgba(245,158,11,0.08)]";

export const labelCls =
  "block text-white/45 text-[10px] font-semibold uppercase tracking-[0.18em] mb-1.5";

export const inputCls =
  "w-full h-10 px-3 rounded-xl bg-black/40 border border-white/[0.1] text-white/95 text-sm placeholder:text-white/35 outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/25 transition-all";

export const btnPrimary =
  "min-h-12 touch-manipulation h-11 px-5 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-black shadow-[0_4px_20px_rgba(245,158,11,0.35)] hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

export const btnSecondary =
  "min-h-12 touch-manipulation h-11 px-5 rounded-xl font-semibold text-sm bg-white/[0.06] border border-white/[0.12] text-white/90 hover:bg-white/[0.1] hover:border-emerald-400/30 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer";

export const btnGhost =
  "h-10 px-4 rounded-xl font-medium text-sm bg-transparent border border-white/[0.1] text-white/75 hover:bg-white/[0.06] hover:text-white active:scale-[0.98] transition-all cursor-pointer";

export const btnGold =
  "min-h-12 touch-manipulation h-11 px-5 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-400 to-amber-600 text-black hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

export const pill =
  "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] border";

export const pillLive =
  pill + " border-emerald-400/35 text-emerald-200 bg-emerald-500/10";

export const pillGold =
  pill + " border-amber-400/40 text-amber-100 bg-amber-500/10";

export const tableHeader =
  "text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold";

export const ALL_GAMES = [
  "blackjack",
  "coinflip",
  "dice",
  "roulette",
  "slots",
  "crash",
  "plinko",
  "mines",
  "hilo",
  "poker",
] as const;

export type CasinoGameId = (typeof ALL_GAMES)[number];

export const GAME_LABELS: Record<CasinoGameId, string> = {
  blackjack: "Blackjack",
  coinflip: "Coinflip",
  dice: "Dice / Limbo",
  roulette: "Roulette",
  slots: "Slots",
  crash: "Crash",
  plinko: "Plinko",
  mines: "Mines",
  hilo: "HiLo",
  poker: "Poker",
};
