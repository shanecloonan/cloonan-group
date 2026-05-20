import type { Metadata } from "next";
import DashboardContent from "./dashboard-content";

export const metadata: Metadata = {
  title: "Casino Dashboard | MoneyFund",
  description: "Your play stats, filters, and a live feed of settled bets across the casino.",
};

export default function CasinoDashboardPage() {
  return <DashboardContent />;
}
