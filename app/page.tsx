import type { Metadata } from "next";
import CompanyChart from "./company-chart";

export const metadata: Metadata = {
  title: "Entity Structure",
  description: "Entity structure and subsidiary overview.",
  robots: { index: false, follow: false },
};

export default function Home() {
  return <CompanyChart />;
}
