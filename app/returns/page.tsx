import type { Metadata } from "next";
import ReturnsTool from "./returns-tool";

export const metadata: Metadata = {
  title: "Returns Report Tool",
  description: "Excel-based truck error returns report generator.",
  robots: { index: false, follow: false },
};

export default function ReturnsPage() {
  return <ReturnsTool />;
}
