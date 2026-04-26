"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useWallet } from "@/lib/wallet-context";
import ArweaveGateway, { winstonToAr } from "@/lib/arweave";
import { getMyItems, type PermawriteItem } from "@/lib/permawrite";
import type { ArweaveUploadRecord, ArweaveTag, ArweaveGqlEdge } from "@/lib/wallet-types";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const pillActive = "bg-purple-500/20 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]";
const pillInactive = "text-white/35 hover:text-white/55 hover:bg-white/[0.03]";

/* ------------------------------------------------------------------ */
/*  Content-type helpers                                               */
/* ------------------------------------------------------------------ */

type ContentGroup = "code" | "image" | "document" | "media" | "data" | "other";

const CODE_EXTENSIONS: Record<string, string> = {
  "application/javascript": "JS", "text/javascript": "JS", "application/typescript": "TS",
  "text/typescript": "TS", "application/json": "JSON", "text/html": "HTML",
  "text/css": "CSS", "text/xml": "XML", "application/xml": "XML",
  "text/x-python": "PY", "application/x-python": "PY", "text/x-rust": "RS",
  "text/x-go": "GO", "text/x-c": "C", "text/x-c++": "C++",
  "text/x-java": "JAVA", "text/x-ruby": "RB", "text/x-php": "PHP",
  "application/x-sh": "SH", "text/x-shellscript": "SH", "text/markdown": "MD",
  "text/x-toml": "TOML", "text/x-yaml": "YAML", "application/yaml": "YAML",
  "text/csv": "CSV", "application/sql": "SQL", "text/x-sol": "SOL",
  "application/wasm": "WASM",
};

function getContentGroup(ct: string | null): ContentGroup {
  if (!ct) return "other";
  if (CODE_EXTENSIONS[ct] || ct.startsWith("text/x-") || ct.includes("script") || ct.includes("json") || ct.includes("xml") || ct === "text/plain") return "code";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/") || ct.startsWith("audio/")) return "media";
  if (ct.includes("pdf") || ct.includes("document") || ct.includes("spreadsheet") || ct.includes("presentation")) return "document";
  if (ct.includes("csv") || ct.includes("sql") || ct.includes("parquet") || ct.includes("arrow")) return "data";
  return "other";
}

function getCodeLabel(ct: string | null): string | null {
  if (!ct) return null;
  return CODE_EXTENSIONS[ct] || null;
}

function contentIcon(group: ContentGroup): string {
  switch (group) {
    case "code": return "{ }";
    case "image": return "🖼";
    case "document": return "📄";
    case "media": return "▶";
    case "data": return "📊";
    default: return "◦";
  }
}

function contentGroupLabel(group: ContentGroup): string {
  switch (group) {
    case "code": return "Code";
    case "image": return "Image";
    case "document": return "Document";
    case "media": return "Media";
    case "data": return "Data";
    default: return "Other";
  }
}

function contentGroupColor(group: ContentGroup): string {
  switch (group) {
    case "code": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "image": return "bg-pink-500/10 text-pink-400 border-pink-500/20";
    case "document": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "media": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "data": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
    default: return "bg-white/5 text-white/40 border-white/10";
  }
}

/* ------------------------------------------------------------------ */
/*  Unified history item                                               */
/* ------------------------------------------------------------------ */

interface HistoryEntry {
  id: string;
  kind: "upload" | "send" | "receive" | "permawrite" | "repo-created";
  txId: string | null;
  title: string;
  subtitle: string | null;
  contentType: string | null;
  contentGroup: ContentGroup;
  codeLabel: string | null;
  size: number;
  costAr: string | null;
  status: string;
  method: string | null;
  timestamp: string;
  tags: ArweaveTag[];
  pwCategory: string | null;
  pwVisibility: string | null;
  recipient: string | null;
  sender: string | null;
  bundleId: string | null;
}

function uploadToEntry(u: ArweaveUploadRecord): HistoryEntry {
  const ct = u.content_type;
  const group = getContentGroup(ct);
  const pwType = u.tags?.find((t) => t.name === "PermaWrite-Type")?.value;
  const repoName = u.tags?.find((t) => t.name === "Repo-Name")?.value;
  const repoSlug = u.tags?.find((t) => t.name === "Repo-Slug")?.value;
  const isRepoCreated = pwType === "repo-created";

  return {
    id: u.id,
    kind: isRepoCreated ? "repo-created" : "upload",
    txId: u.tx_id,
    title: isRepoCreated
      ? (repoName ? `Repo Created — ${repoName}` : "Repo Created")
      : (u.filename || u.description || u.tx_id?.slice(0, 12) || "Upload"),
    subtitle: isRepoCreated ? (repoSlug ? `slug: ${repoSlug}` : "PermaWrite declaration") : ct,
    contentType: ct,
    contentGroup: group,
    codeLabel: getCodeLabel(ct),
    size: u.data_size,
    costAr: u.cost_ar,
    status: u.status,
    method: u.upload_method || null,
    timestamp: u.created_at,
    tags: u.tags || [],
    pwCategory: null,
    pwVisibility: null,
    recipient: null,
    sender: null,
    bundleId: u.bundle_id || null,
  };
}

function pwToEntry(p: PermawriteItem): HistoryEntry {
  const group = getContentGroup(p.content_type);
  return {
    id: p.id,
    kind: "permawrite",
    txId: p.arweave_tx_id,
    title: p.title || p.file_name || "PermaWrite Item",
    subtitle: p.description,
    contentType: p.content_type,
    contentGroup: group,
    codeLabel: getCodeLabel(p.content_type),
    size: p.file_size,
    costAr: null,
    status: p.arweave_tx_id ? "confirmed" : "vault-only",
    method: null,
    timestamp: p.created_at,
    tags: p.arweave_tags || [],
    pwCategory: p.category_slug,
    pwVisibility: p.visibility,
    recipient: null,
    sender: null,
    bundleId: null,
  };
}

function gqlToEntry(edge: ArweaveGqlEdge, myAddr: string): HistoryEntry {
  const n = edge.node;
  const isSend = (n.owner?.address === myAddr || n.owner?.key === myAddr);
  const ct = n.tags?.find((t) => t.name === "Content-Type")?.value || null;
  const appName = n.tags?.find((t) => t.name === "App-Name")?.value;
  const pwType = n.tags?.find((t) => t.name === "PermaWrite-Type")?.value;
  const repoName = n.tags?.find((t) => t.name === "Repo-Name")?.value;
  const repoSlug = n.tags?.find((t) => t.name === "Repo-Slug")?.value;
  const group = getContentGroup(ct);
  const hasQuantity = n.quantity && parseFloat(n.quantity.ar) > 0;

  // Genesis repo declaration? Promote it to a first-class action.
  const isRepoCreated = pwType === "repo-created";

  let kind: HistoryEntry["kind"];
  let title: string;
  if (isRepoCreated) {
    kind = "repo-created";
    title = repoName ? `Repo Created — ${repoName}` : "Repo Created";
  } else if (hasQuantity) {
    kind = isSend ? "send" : "receive";
    title = `${isSend ? "Sent" : "Received"} ${parseFloat(n.quantity!.ar).toFixed(6)} AR`;
  } else {
    kind = "upload";
    title = appName || ct || n.id.slice(0, 16);
  }

  return {
    id: n.id,
    kind,
    txId: n.id,
    title,
    subtitle: isRepoCreated ? (repoSlug ? `slug: ${repoSlug}` : "PermaWrite declaration") : ct,
    contentType: ct,
    contentGroup: group,
    codeLabel: getCodeLabel(ct),
    size: parseInt(n.data?.size || "0"),
    costAr: n.fee?.ar || null,
    status: n.block ? "confirmed" : "pending",
    method: null,
    timestamp: n.block ? new Date(n.block.timestamp * 1000).toISOString() : new Date().toISOString(),
    tags: n.tags || [],
    pwCategory: null,
    pwVisibility: null,
    recipient: n.recipient || null,
    sender: isSend ? myAddr : (n.owner?.address || null),
    bundleId: null,
  };
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

function isWithinDays(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() < days * 86400000;
}

/* ------------------------------------------------------------------ */
/*  Filter types                                                       */
/* ------------------------------------------------------------------ */

type KindFilter = "all" | "upload" | "send" | "receive" | "permawrite";
type PwSubFilter = "all" | "files" | "repos";
type ContentFilter = "all" | ContentGroup;
type StatusFilter = "all" | "confirmed" | "pending" | "failed" | "vault-only";
type DateFilter = "all" | "today" | "week" | "month" | "year";
type SortField = "date" | "size" | "cost";

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ArweaveHistory() {
  const { arweaveWallet } = useWallet();
  const gw = useMemo(() => new ArweaveGateway(), []);

  const [uploads, setUploads] = useState<ArweaveUploadRecord[]>([]);
  const [pwItems, setPwItems] = useState<PermawriteItem[]>([]);
  const [chainTxs, setChainTxs] = useState<ArweaveGqlEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [pwSubFilter, setPwSubFilter] = useState<PwSubFilter>("all");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [uploadData, pwData, chainData] = await Promise.all([
        ArweaveGateway.getUploads().catch(() => []),
        getMyItems({ limit: 200 }).then((r) => r.items).catch(() => []),
        arweaveWallet?.address
          ? gw.getTransactionsByOwner(arweaveWallet.address, 50).then((r) => r.edges).catch(() => [])
          : Promise.resolve([]),
      ]);
      setUploads(uploadData);
      setPwItems(pwData);
      setChainTxs(chainData);
      setLoaded(true);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [gw, arweaveWallet]);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  /* ---- Build unified list ---- */
  const allEntries = useMemo(() => {
    const addr = arweaveWallet?.address || "";
    const uploadEntries = uploads.map(uploadToEntry);
    const pwEntries = pwItems.map(pwToEntry);
    const chainEntries = chainTxs.map((e) => gqlToEntry(e, addr));

    const seen = new Set<string>();
    const merged: HistoryEntry[] = [];

    for (const e of uploadEntries) { if (e.txId) seen.add(e.txId); merged.push(e); }
    for (const e of pwEntries) {
      if (e.txId && seen.has(e.txId)) {
        const existing = merged.find((m) => m.txId === e.txId);
        if (existing) {
          // Don't demote repo-created genesis transactions to plain PermaWrite.
          if (existing.kind !== "repo-created") existing.kind = "permawrite";
          existing.pwCategory = e.pwCategory;
          existing.pwVisibility = e.pwVisibility;
          if (e.title && e.title !== "PermaWrite Item" && existing.kind !== "repo-created") existing.title = e.title;
          if (e.subtitle && existing.kind !== "repo-created") existing.subtitle = e.subtitle;
        }
        continue;
      }
      if (e.txId) seen.add(e.txId);
      merged.push(e);
    }
    for (const e of chainEntries) {
      if (e.txId && seen.has(e.txId)) continue;
      merged.push(e);
    }

    return merged;
  }, [uploads, pwItems, chainTxs, arweaveWallet]);

  /* ---- Filter + sort ---- */
  const filtered = useMemo(() => {
    let list = allEntries;

    if (kindFilter === "permawrite") {
      // PermaWrite is an umbrella: plain files + genesis repo declarations.
      list = list.filter((e) => e.kind === "permawrite" || e.kind === "repo-created");
      if (pwSubFilter === "files") list = list.filter((e) => e.kind === "permawrite");
      else if (pwSubFilter === "repos") list = list.filter((e) => e.kind === "repo-created");
    } else if (kindFilter !== "all") {
      list = list.filter((e) => e.kind === kindFilter);
    }
    if (contentFilter !== "all") list = list.filter((e) => e.contentGroup === contentFilter);
    if (statusFilter !== "all") list = list.filter((e) => e.status === statusFilter);
    if (dateFilter === "today") list = list.filter((e) => isWithinDays(e.timestamp, 1));
    else if (dateFilter === "week") list = list.filter((e) => isWithinDays(e.timestamp, 7));
    else if (dateFilter === "month") list = list.filter((e) => isWithinDays(e.timestamp, 30));
    else if (dateFilter === "year") list = list.filter((e) => isWithinDays(e.timestamp, 365));

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        e.txId?.toLowerCase().includes(q) ||
        e.contentType?.toLowerCase().includes(q) ||
        e.pwCategory?.toLowerCase().includes(q) ||
        e.tags.some((t) => t.name.toLowerCase().includes(q) || t.value.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      else if (sortField === "size") cmp = a.size - b.size;
      else if (sortField === "cost") cmp = parseFloat(a.costAr || "0") - parseFloat(b.costAr || "0");
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [allEntries, kindFilter, pwSubFilter, contentFilter, statusFilter, dateFilter, search, sortField, sortAsc]);

  /* ---- Stats ---- */
  const stats = useMemo(() => {
    const total = allEntries.length;
    const totalSize = allEntries.reduce((s, e) => s + e.size, 0);
    const totalCost = allEntries.reduce((s, e) => s + parseFloat(e.costAr || "0"), 0);
    const byKind = { upload: 0, send: 0, receive: 0, permawrite: 0, "repo-created": 0 };
    for (const e of allEntries) byKind[e.kind]++;
    const byContent: Record<string, number> = {};
    for (const e of allEntries) byContent[e.contentGroup] = (byContent[e.contentGroup] || 0) + 1;
    return { total, totalSize, totalCost, byKind, byContent };
  }, [allEntries]);

  const handleCopy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortAsc((p) => !p);
    else { setSortField(field); setSortAsc(false); }
  }, [sortField]);

  /* ---- Kind badge ---- */
  function kindBadge(kind: HistoryEntry["kind"]) {
    switch (kind) {
      case "upload": return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-purple-500/10 text-purple-300 border border-purple-500/20">Upload</span>;
      case "send": return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-orange-500/10 text-orange-400 border border-orange-500/20">Send</span>;
      case "receive": return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Receive</span>;
      case "permawrite": return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">PermaWrite</span>;
      case "repo-created": return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-violet-500/15 text-violet-300 border border-violet-500/30">Repo Created</span>;
    }
  }

  function statusBadge(status: string) {
    if (status === "confirmed") return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Confirmed</span>;
    if (status === "submitted" || status === "pending") return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20">Pending</span>;
    if (status === "failed") return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-red-500/10 text-red-400 border border-red-500/20">Failed</span>;
    if (status === "vault-only") return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Vault Only</span>;
    return <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase bg-white/5 text-white/30 border border-white/10">{status}</span>;
  }

  if (!arweaveWallet) {
    return (
      <div className={`${card} p-10 text-center`}>
        <p className="text-sm text-white/30">Connect an Arweave wallet to view transaction history.</p>
        <a href="/wallets" className="inline-block mt-2 text-[10px] text-purple-400/60 hover:text-purple-300 uppercase tracking-wider font-semibold transition-colors">Set Up Wallet →</a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stats Bar ── */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Transaction History</span>
          <button type="button" onClick={() => { setLoaded(false); }} disabled={loading} className="inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-medium border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer">
            {loading ? <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" /> : "Refresh"}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><p className="text-xl font-bold text-white tabular-nums">{stats.total}</p><p className="text-[10px] text-white/30 uppercase mt-0.5">Total Items</p></div>
          <div><p className="text-xl font-bold text-white tabular-nums">{fmtBytes(stats.totalSize)}</p><p className="text-[10px] text-white/30 uppercase mt-0.5">Total Size</p></div>
          <div><p className="text-xl font-bold text-white tabular-nums">{stats.totalCost.toFixed(6)}</p><p className="text-[10px] text-white/30 uppercase mt-0.5">Total AR</p></div>
          <div className="flex items-center gap-2 flex-wrap">
            {stats.byKind.upload > 0 && <span className="text-[10px] text-purple-300/60">{stats.byKind.upload} uploads</span>}
            {stats.byKind.send > 0 && <span className="text-[10px] text-orange-400/60">{stats.byKind.send} sends</span>}
            {stats.byKind.receive > 0 && <span className="text-[10px] text-emerald-400/60">{stats.byKind.receive} received</span>}
            {(stats.byKind.permawrite + stats.byKind["repo-created"]) > 0 && (
              <span className="text-[10px] text-cyan-400/60">
                {stats.byKind.permawrite + stats.byKind["repo-created"]} permawrite
                {stats.byKind["repo-created"] > 0 && (
                  <span className="text-violet-300/50"> · {stats.byKind["repo-created"]} repos</span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className={`${card} p-3 space-y-3`}>
        {/* Type filter pills — "Repo Created" lives as a sub-filter under PermaWrite */}
        <div className="flex gap-1 flex-wrap">
          {(["all", "upload", "send", "receive", "permawrite"] as KindFilter[]).map((k) => {
            const count =
              k === "permawrite"
                ? stats.byKind.permawrite + stats.byKind["repo-created"]
                : k === "all"
                  ? 0
                  : stats.byKind[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKindFilter(k);
                  if (k !== "permawrite") setPwSubFilter("all");
                }}
                className={`h-7 px-3 rounded-full text-[11px] font-medium transition-all cursor-pointer ${kindFilter === k ? pillActive : pillInactive}`}
              >
                {k === "all"
                  ? "All"
                  : k === "permawrite"
                    ? "PermaWrite"
                    : k.charAt(0).toUpperCase() + k.slice(1)}
                {k !== "all" && <span className="ml-1 opacity-50">({count})</span>}
              </button>
            );
          })}
        </div>

        {/* PermaWrite sub-filter — only shown when PermaWrite is the active category */}
        {kindFilter === "permawrite" && (
          <div className="flex items-center gap-1.5 flex-wrap pl-2 border-l-2 border-purple-500/20">
            <span className="text-[9px] font-bold text-white/30 uppercase tracking-wider mr-1">Sub</span>
            {(
              [
                { value: "all", label: "All", count: stats.byKind.permawrite + stats.byKind["repo-created"] },
                { value: "files", label: "Files", count: stats.byKind.permawrite },
                { value: "repos", label: "Repos", count: stats.byKind["repo-created"] },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPwSubFilter(opt.value)}
                className={`h-6 px-2.5 rounded-full text-[10px] font-medium transition-all cursor-pointer ${
                  pwSubFilter === opt.value
                    ? "bg-violet-500/20 text-violet-200 border border-violet-500/30"
                    : "text-white/35 hover:text-white/55 border border-transparent hover:border-white/[0.06]"
                }`}
              >
                {opt.label}
                <span className="ml-1 opacity-50">({opt.count})</span>
              </button>
            ))}
          </div>
        )}

        {/* Second row: content, status, date, sort */}
        <div className="flex gap-2 flex-wrap items-center">
          <select value={contentFilter} onChange={(e) => setContentFilter(e.target.value as ContentFilter)}
            className="h-8 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 text-[11px] outline-none focus:border-purple-400/40 transition-all cursor-pointer appearance-none">
            <option value="all">All Types</option>
            <option value="code">Code</option>
            <option value="image">Images</option>
            <option value="document">Documents</option>
            <option value="media">Media</option>
            <option value="data">Data</option>
            <option value="other">Other</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-8 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 text-[11px] outline-none focus:border-purple-400/40 transition-all cursor-pointer appearance-none">
            <option value="all">All Status</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="vault-only">Vault Only</option>
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="h-8 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 text-[11px] outline-none focus:border-purple-400/40 transition-all cursor-pointer appearance-none">
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
          </select>

          <span className="hidden sm:block h-4 w-px bg-white/[0.06]" />

          {/* Sort */}
          <div className="flex gap-1">
            {(["date", "size", "cost"] as SortField[]).map((f) => (
              <button key={f} type="button" onClick={() => handleSort(f)}
                className={`h-7 px-2.5 rounded-lg text-[10px] font-medium uppercase tracking-wider transition-all cursor-pointer ${sortField === f ? "bg-white/[0.06] text-white/60" : "text-white/25 hover:text-white/40"}`}>
                {f}{sortField === f && (sortAsc ? " ↑" : " ↓")}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by TX ID, filename, tag, category..."
          className="w-full h-9 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/80 text-xs placeholder:text-white/20 outline-none focus:border-purple-400/40 focus:ring-1 focus:ring-purple-400/20 transition-all"
        />
      </div>

      {/* ── Results count ── */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-white/25">{filtered.length} of {allEntries.length} items</span>
        {(kindFilter !== "all" || pwSubFilter !== "all" || contentFilter !== "all" || statusFilter !== "all" || dateFilter !== "all" || search) && (
          <button type="button" onClick={() => { setKindFilter("all"); setPwSubFilter("all"); setContentFilter("all"); setStatusFilter("all"); setDateFilter("all"); setSearch(""); }}
            className="text-[10px] text-purple-400/50 hover:text-purple-300 transition-colors cursor-pointer">Clear filters</button>
        )}
      </div>

      {/* ── Item list ── */}
      {loading && !loaded && (
        <div className={`${card} p-10 text-center`}>
          <div className="w-5 h-5 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-white/30">Loading history...</p>
        </div>
      )}

      {loaded && filtered.length === 0 && (
        <div className={`${card} p-10 text-center`}>
          <p className="text-sm text-white/30">No transactions match your filters.</p>
          <p className="text-xs text-white/20 mt-1">Try adjusting your filters or search terms.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-1.5">
          {filtered.map((entry) => {
            const isOpen = expanded === entry.id;
            return (
              <div key={entry.id} className={`${card} overflow-hidden transition-all ${isOpen ? "ring-1 ring-purple-500/20" : ""}`}>
                {/* Summary row */}
                <button type="button" onClick={() => setExpanded(isOpen ? null : entry.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/[0.015] transition-colors cursor-pointer">

                  {/* Content type icon */}
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center text-xs font-bold shrink-0 ${contentGroupColor(entry.contentGroup)}`}>
                    {entry.codeLabel || contentIcon(entry.contentGroup)}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-white/80 truncate">{entry.title}</p>
                      {entry.pwCategory && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400/60 border border-cyan-500/15 hidden sm:inline">{entry.pwCategory}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {entry.txId && <span className="text-[10px] font-mono text-purple-300/40 truncate max-w-[120px]">{entry.txId}</span>}
                      {entry.size > 0 && <span className="text-[10px] text-white/25">{fmtBytes(entry.size)}</span>}
                      <span className="text-[10px] text-white/20">{relTime(entry.timestamp)}</span>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="hidden sm:inline-flex">{kindBadge(entry.kind)}</span>
                    {statusBadge(entry.status)}
                  </div>

                  <span className={`text-white/15 text-sm shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                </button>

                {/* Detail panel */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-white/[0.04] space-y-3">
                    {/* Badges row (mobile) */}
                    <div className="flex items-center gap-1.5 sm:hidden flex-wrap">
                      {kindBadge(entry.kind)}
                      {entry.contentType && (
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium border ${contentGroupColor(entry.contentGroup)}`}>
                          {contentGroupLabel(entry.contentGroup)}
                        </span>
                      )}
                    </div>

                    {/* Detail grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] text-white/25 uppercase">TX ID</span>
                        {entry.txId ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleCopy(entry.txId!, entry.id + "-tx"); }}
                            className="block w-full text-left text-[11px] font-mono text-purple-300/60 hover:text-purple-300 truncate cursor-pointer transition-colors mt-0.5">
                            {copied === entry.id + "-tx" ? "Copied!" : entry.txId}
                          </button>
                        ) : (
                          <p className="text-[11px] text-white/20 mt-0.5">—</p>
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-white/25 uppercase">Content Type</span>
                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                          {entry.codeLabel && <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${contentGroupColor("code")}`}>{entry.codeLabel}</span>}
                          <p className="text-[11px] text-white/40 truncate min-w-0">{entry.contentType || "—"}</p>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-white/25 uppercase">Size</span>
                        <p className="text-[11px] text-white/50 mt-0.5">{entry.size > 0 ? fmtBytes(entry.size) : "—"}</p>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-white/25 uppercase">Cost</span>
                        <p className="text-[11px] text-white/50 mt-0.5">{entry.costAr && parseFloat(entry.costAr) > 0 ? `${parseFloat(entry.costAr).toFixed(8)} AR` : "—"}</p>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-white/25 uppercase">Date</span>
                        <p className="text-[11px] text-white/50 mt-0.5">{fmtDate(entry.timestamp)} {fmtTime(entry.timestamp)}</p>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-white/25 uppercase">Method</span>
                        <p className="text-[11px] text-white/50 mt-0.5">
                          {entry.method === "turbo" ? "Turbo (Bundled)" : entry.method === "l1" ? "Standard (L1)" : "—"}
                        </p>
                      </div>
                      {entry.recipient && (
                        <div className="col-span-2 sm:col-span-3 min-w-0">
                          <span className="text-[10px] text-white/25 uppercase">Recipient</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleCopy(entry.recipient!, entry.id + "-rcpt"); }}
                            className="block w-full text-left text-[11px] font-mono text-white/40 hover:text-white/60 truncate cursor-pointer transition-colors mt-0.5">
                            {copied === entry.id + "-rcpt" ? "Copied!" : entry.recipient}
                          </button>
                        </div>
                      )}
                      {entry.sender && entry.kind === "receive" && (
                        <div className="col-span-2 sm:col-span-3 min-w-0">
                          <span className="text-[10px] text-white/25 uppercase">Sender</span>
                          <p className="text-[11px] font-mono text-white/40 truncate mt-0.5">{entry.sender}</p>
                        </div>
                      )}
                      {entry.pwCategory && (
                        <div className="min-w-0">
                          <span className="text-[10px] text-white/25 uppercase">Category</span>
                          <p className="text-[11px] text-cyan-400/60 mt-0.5 truncate">{entry.pwCategory}</p>
                        </div>
                      )}
                      {entry.pwVisibility && (
                        <div className="min-w-0">
                          <span className="text-[10px] text-white/25 uppercase">Visibility</span>
                          <p className="text-[11px] text-white/50 mt-0.5">{entry.pwVisibility === "permawrite" ? "Public (Arweave)" : "Private (Vault)"}</p>
                        </div>
                      )}
                      {entry.bundleId && (
                        <div className="min-w-0">
                          <span className="text-[10px] text-white/25 uppercase">Bundle ID</span>
                          <p className="text-[11px] font-mono text-white/30 truncate mt-0.5">{entry.bundleId}</p>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {entry.tags.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/25 uppercase block mb-1.5">Tags</span>
                        <div className="flex flex-wrap gap-1">
                          {entry.tags.map((t, i) => (
                            <span key={i} className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-white/30 font-mono">
                              {t.name}: {t.value.length > 50 ? t.value.slice(0, 50) + "…" : t.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Subtitle / description */}
                    {entry.subtitle && entry.subtitle !== entry.contentType && (
                      <p className="text-[11px] text-white/30 leading-relaxed">{entry.subtitle}</p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1 flex-wrap">
                      {entry.txId && (
                        <a href={`https://arweave.net/${entry.txId}`} target="_blank" rel="noopener noreferrer"
                          className="h-8 px-3.5 rounded-lg font-medium text-[11px] bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.08] inline-flex items-center gap-1.5 transition-all">
                          View Data
                        </a>
                      )}
                      {entry.txId && (
                        <a href={`https://viewblock.io/arweave/tx/${entry.txId}`} target="_blank" rel="noopener noreferrer"
                          className="h-8 px-3.5 rounded-lg font-medium text-[11px] bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.08] inline-flex items-center gap-1.5 transition-all">
                          ViewBlock
                        </a>
                      )}
                      {entry.txId && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleCopy(entry.txId!, entry.id + "-copy"); }}
                          className="h-8 px-3.5 rounded-lg font-medium text-[11px] bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.08] inline-flex items-center gap-1.5 transition-all cursor-pointer">
                          {copied === entry.id + "-copy" ? "Copied!" : "Copy TX"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
