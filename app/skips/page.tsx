import type { Metadata } from "next";
import SkipTool from "./skip-tool";

export const metadata: Metadata = {
  title: "Skip Report Tool",
  description: "Excel-based skip report generator and analytics dashboard.",
  robots: { index: false, follow: false },
};

export default function SkipsPage() {
  return <SkipTool />;
}
