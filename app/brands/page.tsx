import type { Metadata } from "next";
import CompanyChart from "../company-chart";
import ShareCards from "./share-cards";

export const metadata: Metadata = {
  title: "Brands | MoneyFund",
  description:
    "MoneyFund entity structure — vault, nexus, subsidiaries, and live brand share cards.",
};

export default function BrandsPage() {
  return (
    <div className="min-h-screen bg-brand-950 pt-14">
      <CompanyChart />
      <ShareCards />
    </div>
  );
}
