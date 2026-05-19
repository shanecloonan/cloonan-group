import dynamic from "next/dynamic";

const HistoryContent = dynamic(() => import("./history-content"), {
  ssr: false,
  loading: () => <div className="p-8 text-white/60">Loading history…</div>,
});

export const metadata = {
  title: "Casino · Session history",
  description: "Every settled hand, roll, and flip in one auditable feed. Filter, sort, export, and verify.",
};

export default function CasinoHistoryPage() {
  return <HistoryContent />;
}
