/**
 * Early Money / Money Fund thesis tracker (2027–2047).
 * Source of truth: the static JSON lists in ./data — names and fields are
 * rendered as-is; this module only normalizes them into one row shape.
 */
import chips from "./data/chips.json";
import mines from "./data/mines.json";
import meds from "./data/meds.json";
import overlooked from "./data/overlooked.json";
import materials from "./data/materials.json";
import technologies from "./data/technologies.json";
import industries from "./data/industries.json";
import stocks from "./data/stocks.json";
import re from "./data/re.json";
import construction from "./data/construction.json";
import countries from "./data/countries.json";

export type SectionId =
  | "chips"
  | "mines"
  | "meds"
  | "overlooked"
  | "materials"
  | "tech"
  | "industries"
  | "stocks"
  | "re"
  | "construction"
  | "countries";

type Raw = Record<string, string | number>;

export interface FieldDef {
  key: string;
  label: string;
  /** Column treatment in the section table. */
  kind?: "text" | "muted" | "mono" | "link";
}

export interface SectionDef {
  id: SectionId;
  label: string;
  blurb: string;
  /** Key holding the valuation label (stocks uses `label`, `price` is a quote). */
  valuationKey: string;
  /** Primary thesis text key. */
  thesisKey: string;
  /** Entry / early-money key, if present. */
  entryKey?: string;
  /** Secondary detail key shown under the name. */
  subKey?: string;
  columns: FieldDef[];
  rows: Raw[];
}

export const SECTIONS: SectionDef[] = [
  {
    id: "stocks",
    label: "Stocks",
    blurb: "Listed names with an expected-return case.",
    valuationKey: "label",
    thesisKey: "thesis",
    subKey: "ticker",
    columns: [
      { key: "ticker", label: "Ticker", kind: "mono" },
      { key: "price", label: "Price", kind: "mono" },
      { key: "thesis", label: "Thesis" },
      { key: "ret", label: "Exp. return", kind: "mono" },
      { key: "risks", label: "Risks", kind: "muted" },
    ],
    rows: stocks as Raw[],
  },
  {
    id: "meds",
    label: "Meds",
    blurb: "Franchise therapies and the pipeline behind them.",
    valuationKey: "price",
    thesisKey: "why",
    entryKey: "early",
    subKey: "maker",
    columns: [
      { key: "maker", label: "Maker", kind: "muted" },
      { key: "indication", label: "Indication", kind: "muted" },
      { key: "why", label: "Why" },
      { key: "early", label: "Stage", kind: "mono" },
    ],
    rows: meds as Raw[],
  },
  {
    id: "industries",
    label: "Industries",
    blurb: "Sectors with multi-decade demand visibility.",
    valuationKey: "price",
    thesisKey: "why",
    entryKey: "early",
    subKey: "drivers",
    columns: [
      { key: "why", label: "Why" },
      { key: "drivers", label: "Drivers", kind: "muted" },
      { key: "early", label: "Early money", kind: "mono" },
    ],
    rows: industries as Raw[],
  },
  {
    id: "tech",
    label: "Tech",
    blurb: "Platform technologies compounding to 2047.",
    valuationKey: "price",
    thesisKey: "why",
    entryKey: "early",
    columns: [
      { key: "why", label: "Why" },
      { key: "early", label: "Early money", kind: "mono" },
    ],
    rows: technologies as Raw[],
  },
  {
    id: "materials",
    label: "Materials",
    blurb: "Inputs the build-out can't substitute.",
    valuationKey: "price",
    thesisKey: "why",
    subKey: "drivers",
    columns: [
      { key: "why", label: "Why" },
      { key: "drivers", label: "Drivers", kind: "muted" },
    ],
    rows: materials as Raw[],
  },
  {
    id: "re",
    label: "RE",
    blurb: "Metros where capital, talent and supply converge.",
    valuationKey: "price",
    thesisKey: "why",
    subKey: "drivers",
    columns: [
      { key: "why", label: "Why" },
      { key: "drivers", label: "Drivers", kind: "muted" },
    ],
    rows: re as Raw[],
  },
  {
    id: "construction",
    label: "Construction",
    blurb: "Trades and niches the build-out runs short of.",
    valuationKey: "price",
    thesisKey: "why",
    entryKey: "early",
    columns: [
      { key: "why", label: "Why" },
      { key: "early", label: "Early path", kind: "mono" },
    ],
    rows: construction as Raw[],
  },
  {
    id: "countries",
    label: "Countries",
    blurb: "Sovereign allocation with listed proxies.",
    valuationKey: "price",
    thesisKey: "thesis",
    subKey: "proxy",
    columns: [
      { key: "proxy", label: "Proxy", kind: "mono" },
      { key: "thesis", label: "Thesis" },
      { key: "ret", label: "Exp. return", kind: "mono" },
      { key: "risks", label: "Risks", kind: "muted" },
    ],
    rows: countries as Raw[],
  },
  {
    id: "chips",
    label: "Chips",
    blurb: "Silicon that sets the pace of compute.",
    valuationKey: "price",
    thesisKey: "why",
    entryKey: "early",
    subKey: "maker",
    columns: [
      { key: "maker", label: "Maker", kind: "muted" },
      { key: "why", label: "Why" },
      { key: "early", label: "Early money", kind: "mono" },
    ],
    rows: chips as Raw[],
  },
  {
    id: "mines",
    label: "Mines",
    blurb: "Tier-one deposits behind the supply curve.",
    valuationKey: "price",
    thesisKey: "why",
    entryKey: "early",
    subKey: "commodity",
    columns: [
      { key: "commodity", label: "Commodity", kind: "muted" },
      { key: "where", label: "Where", kind: "muted" },
      { key: "why", label: "Why" },
      { key: "early", label: "Early money", kind: "mono" },
    ],
    rows: mines as Raw[],
  },
  {
    id: "overlooked",
    label: "Overlooked",
    blurb: "Choke points the market isn't watching yet.",
    valuationKey: "price",
    thesisKey: "why_rising",
    entryKey: "early",
    subKey: "category",
    columns: [
      { key: "category", label: "Category", kind: "muted" },
      { key: "why_rising", label: "Why rising" },
      { key: "why_overlooked", label: "Why overlooked", kind: "muted" },
      { key: "early", label: "Timing", kind: "mono" },
      { key: "source", label: "Source", kind: "link" },
    ],
    rows: overlooked as Raw[],
  },
];

/** -2 (strongly over) … +2 (strongly under); null when unclear. */
export function valuationScore(v: string): number | null {
  const s = v.toLowerCase();
  if (s.includes("unclear")) return null;
  const strong = s.includes("strongly");
  const modest = s.includes("modestly");
  if (s.includes("underpriced")) return strong && !modest ? 2 : 1;
  if (s.includes("overpriced")) return strong && modest ? -1.5 : strong ? -2 : -1;
  if (s.includes("fair")) return 0;
  return null;
}

/** 1 (low) … 3 (high). */
export function confScore(c: string): number {
  const s = c.toLowerCase().replace("medium", "med");
  if (s === "high") return 3;
  if (s === "med-high") return 2.5;
  if (s === "med") return 2;
  if (s === "med-low" || s === "low-med") return 1.5;
  return 1;
}

export type ConfBucket = "High" | "Med" | "Low";
export function confBucket(c: string): ConfBucket {
  const n = confScore(c);
  return n >= 2.5 ? "High" : n >= 1.5 ? "Med" : "Low";
}

export interface FundRow {
  uid: string;
  section: SectionId;
  rank: number;
  name: string;
  sub?: string;
  thesis: string;
  valuation: string;
  vScore: number | null;
  conf: string;
  cScore: number;
  entry?: string;
  fields: Raw;
  /** Lower-cased concatenation of every field, for search. */
  haystack: string;
}

export const ROWS: FundRow[] = SECTIONS.flatMap((s) =>
  s.rows.map((r) => {
    const valuation = String(r[s.valuationKey] ?? "");
    const conf = String(r.conf ?? "");
    return {
      uid: `${s.id}-${r.rank}`,
      section: s.id,
      rank: Number(r.rank),
      name: String(r.name),
      sub: s.subKey ? String(r[s.subKey] ?? "") : undefined,
      thesis: String(r[s.thesisKey] ?? ""),
      valuation,
      vScore: valuationScore(valuation),
      conf,
      cScore: confScore(conf),
      entry: s.entryKey ? String(r[s.entryKey] ?? "") : undefined,
      fields: r,
      haystack: Object.values(r).join(" \u00b7 ").toLowerCase(),
    };
  }),
);
