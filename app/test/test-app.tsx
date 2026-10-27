"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Bucket =
  | "lane-a-cool"
  | "lane-b-queue"
  | "manual-review"
  | "human-no-candidate"
  | "human-yes-candidate";

type Target = {
  address: string;
  bytecode_hash: string | null;
  tvl_usd: number | string | null;
  status: string | null;
  src_confidence: string | null;
  ir_confidence: string | null;
  heat: number | null;
  bucket: Bucket | null;
  updated_at: string | null;
};

type Feed = {
  ok: boolean;
  dry_run: boolean;
  buckets: Bucket[];
  counts: Record<string, number>;
  targets: Target[];
  results: { address: string; bucket: string; heat: number; notes: string | null; created_at: string }[];
  note?: string;
};

const BUCKET_META: Record<Bucket, { label: string; hint: string; cls: string }> = {
  "lane-a-cool": {
    label: "Lane A cool",
    hint: "High/usable IR, movers gated or none",
    cls: "border-brand-700 text-brand-200",
  },
  "lane-b-queue": {
    label: "Lane B queue",
    hint: "Heat / TVL / weirdness — deep pass",
    cls: "border-amber-700/70 text-amber-200",
  },
  "manual-review": {
    label: "Manual review",
    hint: "Low IR or ambiguous cheap check — not discarded",
    cls: "border-rose-700/70 text-rose-200",
  },
  "human-no-candidate": {
    label: "Human no",
    hint: "High-confidence all-clear — human stamps no",
    cls: "border-emerald-800 text-emerald-200",
  },
  "human-yes-candidate": {
    label: "Human yes",
    hint: "BROKEN locus — human stamps yes after path verify",
    cls: "border-gold/50 text-gold",
  },
};

export default function TestApp() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (bucket !== "all") params.set("bucket", bucket);
    const res = await fetch(`/api/test?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }
    setFeed((await res.json()) as Feed);
  }, [bucket]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const rows = feed?.targets ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((t) =>
      [t.address, t.bucket, t.src_confidence, t.ir_confidence, t.bytecode_hash]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [feed, q]);

  return (
    <main className="min-h-screen bg-brand-950 text-brand-100">
      <div className="max-w-[1100px] mx-auto px-5 sm:px-8 pt-24 pb-16">
        <p className="text-[11px] tracking-[0.2em] uppercase text-gold/80 font-semibold mb-2">
          Internal · Ethereum only · /test
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-brand-50">
          Invariant scanner triage
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-brand-400 leading-relaxed">
          Read-only buckets from Lane A/B. Automation never stamps{" "}
          <span className="text-brand-200">yes</span>. Low IR / decompile confidence
          stays in <span className="text-rose-200">manual-review</span> — never a silent no.
          No exploit payloads. Humans close BROKEN paths in prose.
        </p>

        {feed?.note && (
          <p className="mt-4 text-xs text-brand-400 border border-brand-800/80 rounded-lg px-3 py-2 bg-brand-900/50">
            {feed.dry_run ? "Dry-run / empty: " : ""}
            {feed.note}
          </p>
        )}
        {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

        <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(Object.keys(BUCKET_META) as Bucket[]).map((b) => {
            const meta = BUCKET_META[b];
            const n = feed?.counts?.[b] ?? 0;
            const active = bucket === b;
            return (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(active ? "all" : b)}
                className={`text-left rounded-lg border px-3 py-3 transition-colors ${meta.cls} ${
                  active ? "bg-brand-800/70" : "bg-brand-900/40 hover:bg-brand-900"
                }`}
              >
                <div className="text-[10px] tracking-[0.14em] uppercase opacity-70">{meta.label}</div>
                <div className="text-2xl font-semibold tabular-nums mt-1">{n}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter address / hash / confidence"
            className="flex-1 rounded-md bg-brand-900 border border-brand-800 px-3 py-2 text-sm text-brand-100 placeholder:text-brand-600 focus:outline-none focus:border-gold/50"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase font-semibold rounded-md text-brand-950 bg-gold hover:bg-gold/90"
          >
            Refresh
          </button>
        </div>

        <div className="mt-6 overflow-x-auto border border-brand-800/80 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-brand-900/80 text-brand-400 tracking-[0.12em] uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium">Bucket</th>
                <th className="px-3 py-2 font-medium">Heat</th>
                <th className="px-3 py-2 font-medium">Src / IR</th>
                <th className="px-3 py-2 font-medium">TVL</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-brand-500">
                    No targets in this view. Run Lane A (dry-run writes{" "}
                    <code className="text-brand-300">eth-scanner/work/</code>
                    ) or apply the migration and persist with the service role.
                  </td>
                </tr>
              )}
              {shown.map((t) => (
                <tr key={t.address} className="border-t border-brand-800/70 hover:bg-brand-900/40">
                  <td className="px-3 py-2 font-mono text-[11px] text-brand-200">{t.address}</td>
                  <td className="px-3 py-2 text-brand-100">{t.bucket ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{t.heat ?? 0}</td>
                  <td className="px-3 py-2">
                    {t.src_confidence ?? "—"} / {t.ir_confidence ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{t.tvl_usd ?? "—"}</td>
                  <td className="px-3 py-2 text-brand-400">{t.status ?? "—"}</td>
                  <td className="px-3 py-2">
                    <a
                      href={`/api/test/receipt?address=${encodeURIComponent(t.address)}`}
                      className="text-[11px] tracking-[0.08em] uppercase font-semibold text-gold hover:text-gold/80"
                    >
                      Download .md
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-[11px] text-brand-600 leading-relaxed max-w-2xl">
          Buckets are ranking outputs from §6.0, not disclosure.{" "}
          {bucket !== "all" ? BUCKET_META[bucket].hint + " " : ""}
          Download receipt is Markdown only — paste into another AI as the full scan context.
          See <code className="text-brand-400">eth-scanner/README.md</code> and{" "}
          <code className="text-brand-400">docs/ETH_SWEEP_SCANNING_REFERENCE.md</code>.
        </p>
      </div>
    </main>
  );
}
