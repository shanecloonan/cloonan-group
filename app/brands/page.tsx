import type { Metadata } from "next";
import CompanyChart from "../company-chart";

export const metadata: Metadata = {
  title: "Brands | MoneyFund",
  description: "MoneyFund entity structure — vault, nexus, and subsidiaries.",
};

export default function BrandsPage() {
  return (
    <div className="min-h-screen bg-brand-950 pt-14">
      <CompanyChart />
    </div>
  );
}
