import type { Metadata } from "next";
import FeedContent from "./feed-content";

export const metadata: Metadata = {
  title: "Live Bet Feed | MoneyFund Casino",
  description: "Real-time log of settled bets across all games and players who opted in.",
};

export default function CasinoFeedPage() {
  return <FeedContent />;
}
