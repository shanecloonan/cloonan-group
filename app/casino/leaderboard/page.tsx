import type { Metadata } from "next";
import LeaderboardContent from "./leaderboard-content";

export const metadata: Metadata = {
  title: "Casino Leaderboard | MoneyFund",
  description: "Top winners, biggest losses, and record single-bet outcomes across MoneyFund Casino.",
};

export default function CasinoLeaderboardPage() {
  return <LeaderboardContent />;
}
