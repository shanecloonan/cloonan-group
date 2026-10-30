"use client";

import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  ROWS,
  SECTIONS,
  confBucket,
  type ConfBucket,
  type FundRow,
  type SectionDef,
  type SectionId,
} from "@/lib/early-money";

type Tab = "all" | SectionId;
type ValFilter = "all" | "under" | "fair" | "over";
type ConfFilter = "all" | ConfBucket;
type SortKey = "rank" | "upside" | "conviction";

const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<
  SectionId,
  SectionDef
>;

const TIMING = ["Very early", "Early", "Mid", "Late"] as const;

/* ------------------------------------------------------------------ */

function ValuationTag({ v, score }: { v: string; score: number | null }) {
  const tone =
    score === null
      ? "text-brand-500 border-brand-700"
      : score >= 2
        ? "text-gold border-gold/50 bg-gold/10"
        : score > 0
          ? "text-gold/80 border-gold/25"
          : score === 0
            ? "text-brand-400 border-brand-700"
            : score <= -2
              ? "text-rose-300/90 border-rose-400/40 bg-rose-400/5"
              : "text-rose-300/70 border-rose-400/20";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[3px] border px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.08em] ${tone}`}
    >
      {v || "—"}
    </span>
  );
}

function ConfMeter({ conf, score }: { conf: string; score: number }) {
  // 1 … 3 in half steps -> 0 … 4 filled half-pips over 3 pips
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`Confidence: ${conf}`}>
      <span className="flex gap-[3px]">
        {[1, 2, 3].map((i) => {
          const fill = score >= i ? "bg-brand-200" : score >= i - 0.5 ? "bg-brand-500" : "bg-brand-800";
          return <span key={i} className={`h-[7px] w-[7px] rounded-full ${fill}`} />;
        })}
      </span>
      <span className="text-[11px] text-brand-400">{conf}</span>
    </span>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-brand-500">{label}</span>
      <div className="flex rounded-md border border-brand-800 bg-brand-900/40 p-[2px]">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`cursor-pointer rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
              value === o.id ? "bg-brand-800 text-brand-100" : "text-brand-500 hover:text-brand-200"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Cell({ value, kind }: { value: unknown; kind?: string }) {
  const s = value === undefined || value === null || value === "" ? "—" : String(value);
  if (kind === "link" && s.startsWith("http")) {
    let host = s;
    try {
      host = new URL(s).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw */
    }
    return (
      <a
        href={s}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-brand-400 underline decoration-brand-700 underline-offset-2 hover:text-gold hover:decoration-gold/50"
      >
        {host}
      </a>
    );
  }
  if (kind === "mono") return <span className="font-mono text-[11.5px] text-brand-300">{s}</span>;
  if (kind === "muted") return <span className="text-brand-400">{s}</span>;
  return <span className="text-brand-200">{s}</span>;
}

/* ------------------------------------------------------------------ */

export default function FundApp() {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [val, setVal] = useState<ValFilter>("all");
  const [conf, setConf] = useState<ConfFilter>("all");
  const [timing, setTiming] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("rank");
  const [open, setOpen] = useState<string | null>(null);
  const q = useDeferredValue(query.trim().toLowerCase());

  const section = tab === "all" ? null : SECTION_BY_ID[tab];

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ROWS.length };
    for (const r of ROWS) c[r.section] = (c[r.section] ?? 0) + 1;
    return c;
  }, []);

  const kpis = useMemo(() => {
    const under = ROWS.filter((r) => (r.vScore ?? 0) > 0).length;
    const strong = ROWS.filter((r) => (r.vScore ?? 0) >= 2).length;
    const high = ROWS.filter((r) => r.cScore >= 2.5).length;
    const asym = ROWS.filter((r) => (r.vScore ?? 0) > 0 && r.cScore >= 2.5).length;
    return { under, strong, high, asym };
  }, []);

  const rows = useMemo(() => {
    const terms = q.split(/\s+/).filter(Boolean);
    const out = ROWS.filter((r) => {
      if (tab !== "all" && r.section !== tab) return false;
      if (val !== "all") {
        const v = r.vScore;
        if (val === "under" && !(v !== null && v > 0)) return false;
        if (val === "fair" && v !== 0) return false;
        if (val === "over" && !(v !== null && v < 0)) return false;
      }
      if (conf !== "all" && confBucket(r.conf) !== conf) return false;
      if (tab === "overlooked" && timing !== "all" && r.entry !== timing) return false;
      for (const t of terms) if (!r.haystack.includes(t)) return false;
      return true;
    });
    const secOrder = Object.fromEntries(SECTIONS.map((s, i) => [s.id, i]));
    const byRank = (a: FundRow, b: FundRow) =>
      tab === "all" && sort === "rank"
        ? secOrder[a.section] - secOrder[b.section] || a.rank - b.rank
        : a.rank - b.rank;
    if (sort === "upside")
      out.sort((a, b) => (b.vScore ?? -9) - (a.vScore ?? -9) || b.cScore - a.cScore || byRank(a, b));
    else if (sort === "conviction")
      out.sort((a, b) => b.cScore - a.cScore || (b.vScore ?? -9) - (a.vScore ?? -9) || byRank(a, b));
    else out.sort(byRank);
    return out;
  }, [tab, q, val, conf, timing, sort]);

  const filtersActive = query !== "" || val !== "all" || conf !== "all" || timing !== "all";
  const reset = () => {
    setQuery("");
    setVal("all");
    setConf("all");
    setTiming("all");
  };

  const colCount = section ? section.columns.length + 4 : 7;

  // Window virtualization: only rows near the viewport are mounted, so the
  // table stays fast with thousands of positions. Each virtual item is one
  // <tbody> (main row + optional detail row) measured for its real height.
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const update = () => setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 58,
    overscan: 12,
    scrollMargin,
    getItemKey: (i) => rows[i].uid,
  });
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems.length ? vItems[0].start - scrollMargin : 0;
  const padBottom = vItems.length ? virtualizer.getTotalSize() - (vItems[vItems.length - 1].end - scrollMargin) : 0;

  return (
    <main className="min-h-screen bg-brand-950 text-brand-200">
      <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-12 sm:px-8">
        {/* Masthead */}
        <header className="border-b border-brand-800/80 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold/80">
                MoneyFund · Research Desk
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-brand-50 sm:text-[2.6rem]">
                Early Money
              </h1>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-brand-400">
                Thesis tracker for the 2027–2047 allocation horizon. Eleven books, ranked by
                conviction, with a standing bias toward underpriced, early-stage upside.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              {[
                { k: "Positions", v: ROWS.length },
                { k: "Underpriced", v: kpis.under },
                { k: "Strongly under", v: kpis.strong },
                { k: "Asymmetric", v: kpis.asym, hint: "Underpriced with high conviction" },
              ].map((s) => (
                <div key={s.k} title={s.hint}>
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-brand-500">{s.k}</dt>
                  <dd className="mt-1 font-mono text-xl tabular-nums text-brand-100">{s.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        {/* Section tabs */}
        <nav className="-mx-1 mt-6 flex gap-1 overflow-x-auto pb-1" aria-label="Sections">
          {[{ id: "all" as Tab, label: "All" }, ...SECTIONS.map((s) => ({ id: s.id as Tab, label: s.label }))].map(
            (t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setTiming("all");
                  setOpen(null);
                }}
                className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  tab === t.id
                    ? "bg-gold/10 text-gold"
                    : "text-brand-400 hover:bg-brand-800/50 hover:text-brand-100"
                }`}
              >
                {t.label}
                <span
                  className={`font-mono text-[10px] tracking-normal ${tab === t.id ? "text-gold/70" : "text-brand-600"}`}
                >
                  {counts[t.id] ?? 0}
                </span>
              </button>
            ),
          )}
        </nav>

        {/* Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-brand-800/80 py-3">
          <div className="relative min-w-[240px] flex-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={section ? `Search ${section.label.toLowerCase()}…` : "Search names, tickers, theses, risks…"}
              className="w-full rounded-md border border-brand-800 bg-brand-900/40 px-3 py-1.5 text-[13px] text-brand-100 placeholder:text-brand-600 focus:border-gold/40 focus:outline-none"
            />
          </div>
          <Segmented<ValFilter>
            label="Valuation"
            value={val}
            onChange={setVal}
            options={[
              { id: "all", label: "All" },
              { id: "under", label: "Under" },
              { id: "fair", label: "Fair" },
              { id: "over", label: "Over" },
            ]}
          />
          <Segmented<ConfFilter>
            label="Conf"
            value={conf}
            onChange={setConf}
            options={[
              { id: "all", label: "All" },
              { id: "High", label: "High" },
              { id: "Med", label: "Med" },
              { id: "Low", label: "Low" },
            ]}
          />
          {tab === "overlooked" && (
            <Segmented<string>
              label="Timing"
              value={timing}
              onChange={setTiming}
              options={[{ id: "all", label: "All" }, ...TIMING.map((t) => ({ id: t, label: t }))]}
            />
          )}
          <Segmented<SortKey>
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { id: "rank", label: "Rank" },
              { id: "upside", label: "Upside" },
              { id: "conviction", label: "Conviction" },
            ]}
          />
        </div>

        <div className="flex items-center justify-between py-3 text-[11px] text-brand-500">
          <span>
            {section ? <span className="text-brand-300">{section.blurb}</span> : "All books"}
            <span className="mx-2 text-brand-700">/</span>
            <span className="font-mono tabular-nums text-brand-300">{rows.length}</span> shown
          </span>
          {filtersActive && (
            <button type="button" onClick={reset} className="cursor-pointer text-brand-400 hover:text-gold">
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-md border border-brand-800/80">
          <table ref={tableRef} className="w-full border-collapse text-left text-[12.5px] leading-snug">
            <thead className="sticky top-0 bg-brand-900/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-[0.16em] text-brand-500">
                <th className="w-10 px-3 py-2.5 font-medium">#</th>
                {!section && <th className="px-3 py-2.5 font-medium">Book</th>}
                <th className="min-w-[180px] px-3 py-2.5 font-medium">Name</th>
                {section ? (
                  section.columns.map((c) => (
                    <th key={c.key} className="px-3 py-2.5 font-medium">
                      {c.label}
                    </th>
                  ))
                ) : (
                  <>
                    <th className="min-w-[280px] px-3 py-2.5 font-medium">Thesis</th>
                    <th className="px-3 py-2.5 font-medium">Early money / entry</th>
                  </>
                )}
                <th className="px-3 py-2.5 font-medium">Valuation</th>
                <th className="px-3 py-2.5 font-medium">Conf</th>
              </tr>
            </thead>
            {rows.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={colCount} className="px-3 py-16 text-center text-brand-500">
                    No positions match these filters.
                  </td>
                </tr>
              </tbody>
            )}
            {padTop > 0 && (
              <tbody aria-hidden>
                <tr>
                  <td colSpan={colCount} style={{ height: padTop, padding: 0 }} />
                </tr>
              </tbody>
            )}
            {vItems.map((vi) => {
                const r = rows[vi.index];
                const def = SECTION_BY_ID[r.section];
                const isOpen = open === r.uid;
                return (
                  <tbody key={r.uid} data-index={vi.index} ref={virtualizer.measureElement}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : r.uid)}
                      className={`cursor-pointer border-t border-brand-800/60 align-top transition-colors hover:bg-brand-900/60 ${
                        isOpen ? "bg-brand-900/60" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono text-[11px] tabular-nums text-brand-500">{r.rank}</td>
                      {!section && (
                        <td className="whitespace-nowrap px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-brand-500">
                          {def.label}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-brand-50">{r.name}</div>
                        {!section && r.sub && (
                          <div className="mt-0.5 text-[11px] text-brand-500">{r.sub}</div>
                        )}
                      </td>
                      {section ? (
                        section.columns.map((c) => (
                          <td
                            key={c.key}
                            className={`px-3 py-2.5 ${c.kind === "mono" || c.kind === "link" ? "" : "min-w-[160px]"}`}
                          >
                            <Cell value={r.fields[c.key]} kind={c.kind} />
                          </td>
                        ))
                      ) : (
                        <>
                          <td className="px-3 py-2.5 text-brand-200">{r.thesis}</td>
                          <td className="px-3 py-2.5">
                            <Cell value={r.entry ?? (r.section === "stocks" || r.section === "countries" ? r.fields.ret : undefined)} kind="mono" />
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2.5">
                        <ValuationTag v={r.valuation} score={r.vScore} />
                      </td>
                      <td className="px-3 py-2.5">
                        <ConfMeter conf={r.conf} score={r.cScore} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-brand-900/40">
                        <td />
                        <td colSpan={colCount - 1} className="px-3 pb-4 pt-1">
                          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                            {Object.entries(r.fields)
                              .filter(([k]) => k !== "rank" && k !== "name")
                              .map(([k, v]) => (
                                <div key={k} className="min-w-0">
                                  <dt className="text-[9.5px] uppercase tracking-[0.18em] text-brand-600">
                                    {k.replace(/_/g, " ")}
                                  </dt>
                                  <dd className="mt-0.5 break-words text-[12px]">
                                    <Cell value={v} kind={k === "source" ? "link" : "text"} />
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            {padBottom > 0 && (
              <tbody aria-hidden>
                <tr>
                  <td colSpan={colCount} style={{ height: padBottom, padding: 0 }} />
                </tr>
              </tbody>
            )}
          </table>
        </div>

        <footer className="mt-8 flex flex-wrap justify-between gap-4 text-[10.5px] leading-relaxed text-brand-600">
          <p className="max-w-2xl">
            Research notes for discussion only — not investment advice or an offer of any security.
            Valuation labels and confidence reflect internal judgment at time of writing; prices and
            multiples are point-in-time.
          </p>
          <p className="font-mono">Horizon 2027–2047 · {SECTIONS.length} books · {ROWS.length} positions</p>
        </footer>
      </div>
    </main>
  );
}
