import type { Metadata } from "next";
import ShareCards, { ACTIVE_BRAND_CARDS } from "../share-cards";

export const metadata: Metadata = {
  title: "Active Brands | MoneyFund",
  description: `Cloonan Group brands marked active: ${ACTIVE_BRAND_CARDS.map((brand) => brand.name).join(", ")}.`,
};

export default function ActiveBrandsPage() {
  return (
    <div className="min-h-screen bg-brand-950 pt-14">
      <ShareCards heading="Active Brands" />
    </div>
  );
}
