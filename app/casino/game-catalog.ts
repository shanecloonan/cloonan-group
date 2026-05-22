import type { CasinoGameId } from "./casino-ui";

export type GameCategory = "cards" | "dice" | "instant" | "poker";

export interface GameTile {
  id: string;
  title: string;
  rtp: string;
  status: "live" | "soon";
  emoji: string;
  category: GameCategory;
}

export const CATEGORY_LABELS: Record<GameCategory, string> = {
  cards: "Card tables",
  dice: "Dice",
  instant: "Instant",
  poker: "Poker",
};

export const CATEGORY_ORDER: GameCategory[] = ["cards", "instant", "dice", "poker"];

/** Live games the lobby can open (matches tables wired in casino-content). */
export const PLAYABLE_GAME_IDS = new Set<string>([
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
]);

export function isPlayableGame(id: string): id is CasinoGameId {
  return PLAYABLE_GAME_IDS.has(id);
}

export const GAME_CATALOG: GameTile[] = [
  { id: "blackjack", title: "Blackjack", rtp: "99.6%", status: "live", emoji: "♠", category: "cards" },
  { id: "baccarat", title: "Baccarat", rtp: "98.9%", status: "live", emoji: "♦", category: "cards" },
  { id: "roulette", title: "Roulette", rtp: "97.3%", status: "live", emoji: "◉", category: "cards" },
  { id: "dragon-tiger", title: "Dragon Tiger", rtp: "96%", status: "live", emoji: "🐉", category: "cards" },
  { id: "casino-war", title: "Casino War", rtp: "97%", status: "live", emoji: "⚔", category: "cards" },
  { id: "red-dog", title: "Red Dog", rtp: "95%", status: "live", emoji: "🂡", category: "cards" },
  { id: "three-card-poker", title: "3 Card Poker", rtp: "96.6%", status: "live", emoji: "🃛", category: "cards" },
  { id: "andar-bahar", title: "Andar Bahar", rtp: "97%", status: "live", emoji: "🎴", category: "cards" },
  { id: "caribbean-stud", title: "Caribbean Stud", rtp: "94.8%", status: "live", emoji: "🏝", category: "cards" },
  { id: "casino-holdem", title: "Casino Hold'em", rtp: "97.8%", status: "live", emoji: "♠", category: "cards" },
  { id: "let-it-ride", title: "Let It Ride", rtp: "97%", status: "live", emoji: "🎰", category: "cards" },
  { id: "mississippi-stud", title: "Mississippi Stud", rtp: "95.9%", status: "live", emoji: "🌊", category: "cards" },
  { id: "ultimate-texas-holdem", title: "Ult. Hold'em", rtp: "97.8%", status: "live", emoji: "♥", category: "cards" },
  { id: "teen-patti", title: "Teen Patti", rtp: "96.2%", status: "live", emoji: "🃏", category: "cards" },
  { id: "slots", title: "Slots", rtp: "96%", status: "live", emoji: "🎰", category: "instant" },
  { id: "crash", title: "Crash", rtp: "99%", status: "live", emoji: "↗", category: "instant" },
  { id: "plinko", title: "Plinko", rtp: "99%", status: "live", emoji: "▼", category: "instant" },
  { id: "mines", title: "Mines", rtp: "99%", status: "live", emoji: "✸", category: "instant" },
  { id: "dice", title: "Dice", rtp: "99%", status: "live", emoji: "⚀", category: "instant" },
  { id: "coinflip", title: "Coinflip", rtp: "99%", status: "live", emoji: "◐", category: "instant" },
  { id: "hilo", title: "HiLo", rtp: "99%", status: "live", emoji: "♣", category: "instant" },
  { id: "keno", title: "Keno", rtp: "92%", status: "live", emoji: "🎱", category: "instant" },
  { id: "wheel", title: "Money Wheel", rtp: "96%", status: "live", emoji: "◎", category: "instant" },
  { id: "sic-bo", title: "Sic Bo", rtp: "97%", status: "live", emoji: "⚄", category: "dice" },
  { id: "chuck-a-luck", title: "Chuck-a-Luck", rtp: "94.5%", status: "live", emoji: "🎯", category: "dice" },
  { id: "craps", title: "Craps", rtp: "98.6%", status: "live", emoji: "🎲", category: "dice" },
  { id: "poker", title: "Poker", rtp: "Skill", status: "live", emoji: "♥", category: "poker" },
  { id: "video-poker", title: "Video Poker", rtp: "99.5%", status: "live", emoji: "🂡", category: "poker" },
  { id: "sportsbook", title: "Sportsbook", rtp: "—", status: "soon", emoji: "🏈", category: "instant" },
];
