import type { Metadata } from "next";
import FundApp from "./fund-app";

export const metadata: Metadata = {
  title: "Early Money — Thesis Tracker 2027–2047",
  description:
    "MoneyFund research desk: ranked theses across chips, mines, meds, materials, tech, industries, stocks, real estate, construction and countries, with a bias toward underpriced early-money upside.",
};

export default function FundPage() {
  return <FundApp />;
}
