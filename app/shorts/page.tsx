import type { Metadata } from "next";
import ShortsTool from "./shorts-tool";

export const metadata: Metadata = {
  title: "Shorts Tool",
  description: "Excel-based shortage report generator.",
  robots: { index: false, follow: false },
};

export default function ShortsPage() {
  return <ShortsTool />;
}
