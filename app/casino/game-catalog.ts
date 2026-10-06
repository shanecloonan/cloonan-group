import type { CasinoGameId } from "./casino-ui";

export type GameCategory = "cards" | "dice" | "instant" | "poker";

export interface GameTile {
  id: string;
  title: string;
  rtp: string;
  status: "live" | "soon";
  emoji: string;
  /** Short salon mark shown on the floor, not a cartoon glyph. */
  mark: string;
  category: GameCategory;
}

export const CATEGORY_LABELS: Record<GameCategory, string> = {
  cards: "Card salon",
  dice: "Dice pit",
  instant: "The floor",
  poker: "Poker room",
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
  "trente-et-quarante",
]);

export function isPlayableGame(id: string): id is CasinoGameId {
  return PLAYABLE_GAME_IDS.has(id);
}

export const GAME_CATALOG: GameTile[] = [
  { id: "trente-et-quarante", title: "Trente et Quarante", rtp: "98.7%", status: "live", emoji: "◆", mark: "TQ", category: "cards" },
  { id: "blackjack", title: "Blackjack", rtp: "99.6%", status: "live", emoji: "♠", mark: "BJ", category: "cards" },
  { id: "baccarat", title: "Baccarat", rtp: "98.9%", status: "live", emoji: "♦", mark: "BA", category: "cards" },
  { id: "roulette", title: "Roulette", rtp: "97.3%", status: "live", emoji: "◉", mark: "RL", category: "cards" },
  { id: "dragon-tiger", title: "Dragon Tiger", rtp: "96%", status: "live", emoji: "♦", mark: "DT", category: "cards" },
  { id: "casino-war", title: "Casino War", rtp: "97%", status: "live", emoji: "♠", mark: "WR", category: "cards" },
  { id: "red-dog", title: "Red Dog", rtp: "95%", status: "live", emoji: "♥", mark: "RD", category: "cards" },
  { id: "three-card-poker", title: "3 Card Poker", rtp: "96.6%", status: "live", emoji: "♣", mark: "3C", category: "cards" },
  { id: "andar-bahar", title: "Andar Bahar", rtp: "97%", status: "live", emoji: "♦", mark: "AB", category: "cards" },
  { id: "caribbean-stud", title: "Caribbean Stud", rtp: "94.8%", status: "live", emoji: "♠", mark: "CS", category: "cards" },
  { id: "casino-holdem", title: "Casino Hold'em", rtp: "97.8%", status: "live", emoji: "♠", mark: "CH", category: "cards" },
  { id: "let-it-ride", title: "Let It Ride", rtp: "97%", status: "live", emoji: "♥", mark: "LR", category: "cards" },
  { id: "mississippi-stud", title: "Mississippi Stud", rtp: "95.9%", status: "live", emoji: "♣", mark: "MS", category: "cards" },
  { id: "ultimate-texas-holdem", title: "Ult. Hold'em", rtp: "97.8%", status: "live", emoji: "♥", mark: "UH", category: "cards" },
  { id: "teen-patti", title: "Teen Patti", rtp: "96.2%", status: "live", emoji: "♦", mark: "TP", category: "cards" },
  { id: "slots", title: "Slots", rtp: "96%", status: "live", emoji: "◎", mark: "SL", category: "instant" },
  { id: "crash", title: "Crash", rtp: "99%", status: "live", emoji: "↗", mark: "CR", category: "instant" },
  { id: "plinko", title: "Plinko", rtp: "99%", status: "live", emoji: "▼", mark: "PL", category: "instant" },
  { id: "mines", title: "Mines", rtp: "99%", status: "live", emoji: "✸", mark: "MN", category: "instant" },
  { id: "dice", title: "Dice", rtp: "99%", status: "live", emoji: "⚀", mark: "DC", category: "instant" },
  { id: "coinflip", title: "Coinflip", rtp: "99%", status: "live", emoji: "◐", mark: "CF", category: "instant" },
  { id: "hilo", title: "HiLo", rtp: "99%", status: "live", emoji: "♣", mark: "HL", category: "instant" },
  { id: "keno", title: "Keno", rtp: "92%", status: "live", emoji: "◉", mark: "KN", category: "instant" },
  { id: "wheel", title: "Money Wheel", rtp: "96%", status: "live", emoji: "◎", mark: "WH", category: "instant" },
  { id: "sic-bo", title: "Sic Bo", rtp: "97%", status: "live", emoji: "⚄", mark: "SB", category: "dice" },
  { id: "chuck-a-luck", title: "Chuck-a-Luck", rtp: "94.5%", status: "live", emoji: "◎", mark: "CL", category: "dice" },
  { id: "craps", title: "Craps", rtp: "98.6%", status: "live", emoji: "⚀", mark: "CP", category: "dice" },
  { id: "poker", title: "Poker", rtp: "Skill", status: "live", emoji: "♥", mark: "PK", category: "poker" },
  { id: "video-poker", title: "Video Poker", rtp: "99.5%", status: "live", emoji: "♠", mark: "VP", category: "poker" },
  { id: "sportsbook", title: "Sportsbook", rtp: "—", status: "soon", emoji: "◇", mark: "SP", category: "instant" },
];
