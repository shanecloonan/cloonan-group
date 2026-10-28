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

type FixtureOpt = { id: string; label: string };

type Feed = {
  ok: boolean;
  dry_run: boolean;
  live_ingest?: boolean;
  persist_remote?: boolean;
  buckets: Bucket[];
  counts: Record<string, number>;
  targets: Target[];
  results: { address: string; bucket: string; heat: number; notes: string | null; created_at: string }[];
  fixtures?: FixtureOpt[];
  note?: string;
};

type RunResult = {
  address: string;
  bucket: string | null;
  dropped: boolean;
  drop_reason: string | null;
  heat: number | null;
  src_confidence: string | null;
  ir_confidence: string | null;
  value_movers: string[];
  contract_class: string | null;
  scope: string | null;
  notes: string[];
};

type RunResponse = {
  ok: boolean;
  error?: string;
  dry_run?: boolean;
  live_ingest?: boolean;
  persist_remote?: boolean;
  fixture?: string | null;
  note?: string;
  result?: RunResult;
  receipt_url?: string;
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

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const DEMO_ADDRESS = "0x1111111111111111111111111111111111111111";

const inputCls =
  "rounded-md bg-brand-900 border border-brand-800 px-3 py-2 text-sm text-brand-100 placeholder:text-brand-600 focus:outline-none focus:border-gold/50";
const btnPrimary =
  "px-4 py-2 text-[11px] tracking-[0.15em] uppercase font-semibold rounded-md text-brand-950 bg-gold hover:bg-gold/90 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "px-4 py-2 text-[11px] tracking-[0.15em] uppercase font-semibold rounded-md border border-brand-700 text-brand-200 hover:bg-brand-900 disabled:opacity-50 disabled:cursor-not-allowed";

export default function TestApp() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [q, setQ] = useState("");
  const [address, setAddress] = useState("");
  const [fixture, setFixture] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

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

  const fixtures = feed?.fixtures ?? [];
  const dryRun = feed?.dry_run ?? true;
  const liveIngest = feed?.live_ingest ?? false;

  const selectTarget = useCallback((addr: string) => {
    setAddress(addr);
    setSelected(addr.toLowerCase());
    setFixture("");
    setRunError(null);
  }, []);

  const runScan = useCallback(async (override?: { address?: string; fixture?: string }) => {
    const addr = (override?.address ?? address).trim();
    const fx = override?.fixture ?? fixture;
    if (!fx && !ADDRESS_RE.test(addr)) {
      setRunError("Enter a 0x address (40 hex chars) or pick a local fixture.");
      return;
    }
    setRunning(true);
    setRunError(null);
    setLastRun(null);
    if (addr) setSelected(addr.toLowerCase());
    try {
      const res = await fetch("/api/test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          address: addr || undefined,
          fixture: fx || undefined,
        }),
      });
      const body = (await res.json()) as RunResponse;
      if (!body.ok) {
        setRunError(body.error || `HTTP ${res.status}`);
        setLastRun(body);
        return;
      }
      setLastRun(body);
      if (body.result?.address) {
        setAddress(body.result.address);
        setSelected(body.result.address.toLowerCase());
      }
      await load();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }, [address, fixture, load]);

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
          Lane A/B buckets. Automation never stamps{" "}
          <span className="text-brand-200">yes</span>. Low IR / decompile confidence
          stays in <span className="text-rose-200">manual-review</span> — never a silent no.
          No exploit payloads. Humans close BROKEN paths in prose.
        </p>

        <div className="mt-4 flex flex-wrap gap-2 text-[10px] tracking-[0.12em] uppercase">
          <span
            className={`rounded-md border px-2 py-1 ${
              dryRun ? "border-amber-800/80 text-amber-200" : "border-emerald-800 text-emerald-200"
            }`}
          >
            Persist · {dryRun ? "dry-run (local work/)" : "live Supabase"}
          </span>
          <span
            className={`rounded-md border px-2 py-1 ${
              liveIngest ? "border-emerald-800 text-emerald-200" : "border-brand-700 text-brand-300"
            }`}
          >
            Ingest · {liveIngest ? "Etherscan" : "stub / local fixture"}
          </span>
        </div>

        {feed?.note && (
          <p className="mt-3 text-xs text-brand-400 border border-brand-800/80 rounded-lg px-3 py-2 bg-brand-900/50">
            {feed.note}
          </p>
        )}
        {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

        <form
          className="mt-8 rounded-lg border border-brand-800/80 bg-brand-900/30 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void runScan();
          }}
        >
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <label className="flex-1 min-w-0">
              <span className="block text-[10px] tracking-[0.14em] uppercase text-brand-500 mb-1.5">
                Address
              </span>
              <input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setSelected(e.target.value.trim().toLowerCase() || null);
                }}
                placeholder="0x… contract to scan"
                spellCheck={false}
                autoComplete="off"
                className={`w-full font-mono text-[13px] ${inputCls}`}
              />
            </label>
            <label className="sm:w-56">
              <span className="block text-[10px] tracking-[0.14em] uppercase text-brand-500 mb-1.5">
                Local fixture
              </span>
              <select
                value={fixture}
                onChange={(e) => setFixture(e.target.value)}
                className={`w-full ${inputCls}`}
              >
                <option value="">None — ingest address</option>
                {fixtures.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={running} className={btnPrimary} aria-busy={running}>
              {running ? "Running…" : "Run"}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-brand-500 leading-relaxed">
            Primary control: Lane A only (S0–S6 cheap skim + gate). Click a table row to
            scan that target. Without Etherscan keys, address-only runs use a low-confidence
            stub unless you pick a local fixture. Receipt download stays Markdown.
          </p>
        </form>

        {running && (
          <p className="mt-4 text-xs text-gold/90 border border-gold/30 rounded-lg px-3 py-2 bg-gold/5">
            Running Lane A{dryRun ? " dry-run" : liveIngest && !fixture ? " (live ingest)" : ""}
            {address ? ` on ${address}` : fixture ? ` on fixture ${fixture}` : ""}
            … ingest → IR → S0–S6. This can take up to a couple of minutes if Etherscan is live.
          </p>
        )}
        {runError && <p className="mt-4 text-sm text-rose-300">{runError}</p>}
        {lastRun?.ok && lastRun.result && (
          <div className="mt-4 rounded-lg border border-brand-700/80 bg-brand-900/50 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[10px] tracking-[0.14em] uppercase text-gold/80 font-semibold">
                Last run · Lane A{lastRun.dry_run ? " · dry-run" : ""}
                {lastRun.fixture ? ` · fixture ${lastRun.fixture}` : ""}
              </p>
              {lastRun.receipt_url && (
                <a
                  href={lastRun.receipt_url}
                  className="text-[11px] tracking-[0.08em] uppercase font-semibold text-gold hover:text-gold/80"
                >
                  Download .md
                </a>
              )}
            </div>
            <p className="mt-2 font-mono text-[11px] text-brand-200">{lastRun.result.address}</p>
            <p className="mt-2 text-brand-200">
              Bucket <span className="text-brand-50">{lastRun.result.bucket ?? "—"}</span>
              {" · "}heat {lastRun.result.heat ?? 0}
              {" · "}src/IR {lastRun.result.src_confidence ?? "—"} / {lastRun.result.ir_confidence ?? "—"}
              {lastRun.result.scope ? ` · scope ${lastRun.result.scope}` : ""}
              {lastRun.result.contract_class ? ` · ${lastRun.result.contract_class}` : ""}
            </p>
            {lastRun.result.dropped && (
              <p className="mt-1 text-brand-400">
                Dropped{lastRun.result.drop_reason ? ` — ${lastRun.result.drop_reason}` : ""}
              </p>
            )}
            {lastRun.result.dropped &&
              lastRun.result.drop_reason === "empty EOA / zero-code" &&
              !lastRun.live_ingest && (
                <p className="mt-2 text-amber-200/90 leading-relaxed">
                  Not a confirmed EOA. ETHERSCAN_API_KEYS is unset, so Lane A had no bytecode.
                  Pick a local fixture or set keys for live ingest.
                </p>
              )}
            {lastRun.result.notes[0] && (
              <p className="mt-2 text-brand-400 leading-relaxed">{lastRun.result.notes[0]}</p>
            )}
          </div>
        )}

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
            className={`flex-1 ${inputCls}`}
          />
          <button type="button" onClick={() => void load()} disabled={running} className={btnSecondary}>
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
                    No targets in this view. Enter an address and click{" "}
                    <span className="text-gold">Run</span>
                    {liveIngest ? "." : ", or run a local fixture."} Dry-run writes{" "}
                    <code className="text-brand-300">eth-scanner/work/</code>
                    {!liveIngest && (
                      <>
                        {" "}
                        <button
                          type="button"
                          disabled={running}
                          onClick={() => {
                            setAddress(DEMO_ADDRESS);
                            setFixture("gated_vault");
                            void runScan({ address: DEMO_ADDRESS, fixture: "gated_vault" });
                          }}
                          className="text-gold hover:text-gold/80 underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Run gated-vault fixture
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
              {shown.map((t) => {
                const active = selected === t.address.toLowerCase();
                return (
                  <tr
                    key={t.address}
                    onClick={() => selectTarget(t.address)}
                    className={`border-t border-brand-800/70 cursor-pointer ${
                      active ? "bg-gold/10" : "hover:bg-brand-900/40"
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-brand-200">{t.address}</td>
                    <td className="px-3 py-2 text-brand-100">{t.bucket ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{t.heat ?? 0}</td>
                    <td className="px-3 py-2">
                      {t.src_confidence ?? "—"} / {t.ir_confidence ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{t.tvl_usd ?? "—"}</td>
                    <td className="px-3 py-2 text-brand-400">{t.status ?? "—"}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <a
                        href={`/api/test/receipt?address=${encodeURIComponent(t.address)}`}
                        className="text-[11px] tracking-[0.08em] uppercase font-semibold text-gold hover:text-gold/80"
                      >
                        Download .md
                      </a>
                    </td>
                  </tr>
                );
              })}
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
