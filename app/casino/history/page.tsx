import { Suspense } from "react";
import HistoryContent from "./history-content";

export const metadata = {
  title: "Casino · Activity",
  description: "Your session history and the global bet log — filter, export, verify, and watch the house live.",
};

export default function CasinoHistoryPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <HistoryContent />
    </Suspense>
  );
}
