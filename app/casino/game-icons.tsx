import {
  Activity, ArrowUpDown, Bomb, Cherry, CircleDot, Club, Coins, Crown, Diamond, Dice5, Dices, Disc3,
  Eye, Gem, Hash, Heart, Layers, Rabbit, Spade, Swords, Target, Trophy, TrendingUp, Triangle, Users,
  type LucideIcon,
} from "lucide-react";

const GAME_ICONS: Record<string, LucideIcon> = {
  salon: Users,
  derby: Rabbit,
  nerve: TrendingUp,
  oddone: Eye,
  ticker: Activity,
  "trente-et-quarante": Layers,
  blackjack: Spade,
  baccarat: Diamond,
  roulette: Disc3,
  "dragon-tiger": Swords,
  "casino-war": Swords,
  "red-dog": Heart,
  "three-card-poker": Layers,
  "andar-bahar": ArrowUpDown,
  "caribbean-stud": Gem,
  "casino-holdem": Spade,
  "let-it-ride": Heart,
  "mississippi-stud": Club,
  "ultimate-texas-holdem": Crown,
  "teen-patti": Diamond,
  slots: Cherry,
  crash: TrendingUp,
  plinko: Triangle,
  mines: Bomb,
  dice: Dice5,
  coinflip: Coins,
  hilo: ArrowUpDown,
  keno: Hash,
  wheel: CircleDot,
  "sic-bo": Dices,
  "chuck-a-luck": Dices,
  craps: Dices,
  poker: Club,
  "video-poker": Spade,
  sportsbook: Trophy,
};

export function GameIcon({ id, className }: { id: string; className?: string }) {
  const Icon = GAME_ICONS[id] ?? Target;
  return <Icon className={className} strokeWidth={1.6} aria-hidden />;
}
