"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useWallet } from "@/lib/wallet-context";
import ArweaveGateway, { buildGqlQuery, winstonToAr } from "@/lib/arweave";
import { ARWEAVE_DIRECT_GATEWAYS } from "@/lib/config";
import {
  discoverGateways,
  resolveToTxId,
  resolveArns,
  isArnsName,
  getArnsUrl,
  computeNetworkStats,
  type ArioGatewayHealth,
  type GatewayNetworkStats,
} from "@/lib/ario";
import type {
  ArweaveNetworkInfo,
  ArweaveCostEstimate,
  ArweaveGqlEdge,
  ArweaveTag,
  ArweaveUploadRecord,
  ArweaveBookmark,
  ArweavePoolStatus,
  GqlQueryParams,
  UploadMethod,
} from "@/lib/wallet-types";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/30 transition-all";
const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnSmall = "h-9 px-4 rounded-xl font-medium text-xs bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";
const pillBtn = "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-medium border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";

function shorten(s: string, len = 12) {
  if (!s || s.length <= len) return s;
  return `${s.slice(0, len / 2)}...${s.slice(-(len / 2))}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function relativeTime(ts: number | string): string {
  const d = typeof ts === "number" ? ts * 1000 : new Date(ts).getTime();
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 365) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

type Tab = "network" | "explorer" | "browser" | "upload" | "history" | "graphql" | "bookmarks";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "network", label: "Network", icon: "◉" },
  { id: "explorer", label: "Explorer", icon: "◎" },
  { id: "browser", label: "Browser", icon: "◫" },
  { id: "upload", label: "Upload", icon: "☁" },
  { id: "history", label: "History", icon: "◷" },
  { id: "graphql", label: "GraphQL", icon: "⬡" },
  { id: "bookmarks", label: "Saved", icon: "★" },
];

export default function GatewayContent() {
  const { user, arweaveWallet } = useWallet();
  const gw = useMemo(() => new ArweaveGateway(), []);

  const [tab, setTab] = useState<Tab>("network");

  const [netInfo, setNetInfo] = useState<ArweaveNetworkInfo | null>(null);
  const [costPerMb, setCostPerMb] = useState<ArweaveCostEstimate | null>(null);
  const [gwHealth, setGwHealth] = useState<Record<string, "up" | "down" | "checking">>({});
  const [gwStats, setGwStats] = useState<{ totalRequests: number; cacheHitRate: number; avgResponseMs: number } | null>(null);
  const [poolStatus, setPoolStatus] = useState<ArweavePoolStatus | null>(null);
  const [poolRefreshing, setPoolRefreshing] = useState(false);

  const [expQuery, setExpQuery] = useState("");
  const [expType, setExpType] = useState<"txid" | "owner" | "recipient" | "tags">("txid");
  const [expResults, setExpResults] = useState<ArweaveGqlEdge[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expExpanded, setExpExpanded] = useState<string | null>(null);

  const [browseTxId, setBrowseTxId] = useState("");
  const [browseData, setBrowseData] = useState<{ url: string; contentType: string } | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseHistory, setBrowseHistory] = useState<string[]>([]);

  const [uploadText, setUploadText] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadTags, setUploadTags] = useState<ArweaveTag[]>([]);
  const [uploadNewTagName, setUploadNewTagName] = useState("");
  const [uploadNewTagValue, setUploadNewTagValue] = useState("");
  const [uploadCost, setUploadCost] = useState<ArweaveCostEstimate | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ msg: string; type: "success" | "error" | "loading" } | null>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadMethod, setUploadMethod] = useState<UploadMethod>("turbo");
  const [turboCost, setTurboCost] = useState<{ winc: string; ar: string } | null>(null);
  const [turboBalance, setTurboBalance] = useState<{ winc: string; ar: string } | null>(null);

  const [uploads, setUploads] = useState<ArweaveUploadRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);

  const [gqlQuery, setGqlQuery] = useState("");
  const [gqlResult, setGqlResult] = useState("");
  const [gqlLoading, setGqlLoading] = useState(false);

  const [arioGateways, setArioGateways] = useState<ArioGatewayHealth[]>([]);
  const [arioNetStats, setArioNetStats] = useState<GatewayNetworkStats | null>(null);
  const [arioLoading, setArioLoading] = useState(false);

  const [arnsInput, setArnsInput] = useState("");
  const [arnsResult, setArnsResult] = useState<{ name: string; txId: string; url: string } | null>(null);
  const [arnsLoading, setArnsLoading] = useState(false);

  const [bookmarks, setBookmarks] = useState<ArweaveBookmark[]>([]);
  const [bmLabel, setBmLabel] = useState("");
  const [bmTarget, setBmTarget] = useState("");
  const [bmType, setBmType] = useState<"transaction" | "address" | "content">("transaction");
  const [bmNotes, setBmNotes] = useState("");

  const loadNetworkInfo = useCallback(async () => {
    try {
      const [info, cost] = await Promise.all([gw.getNetworkInfo(), gw.estimateCost(1024 * 1024)]);
      setNetInfo(info);
      setCostPerMb(cost);
    } catch { /* silent */ }
    try { const stats = await ArweaveGateway.getGatewayStats(); setGwStats(stats); } catch { /* silent */ }
    try { setPoolStatus(await gw.getPoolStatus()); } catch { /* silent */ }
    for (const gateway of ARWEAVE_DIRECT_GATEWAYS) {
      setGwHealth((prev) => ({ ...prev, [gateway]: "checking" }));
      try {
        const res = await fetch(`${gateway}/info`, { signal: AbortSignal.timeout(5000) });
        setGwHealth((prev) => ({ ...prev, [gateway]: res.ok ? "up" : "down" }));
      } catch { setGwHealth((prev) => ({ ...prev, [gateway]: "down" })); }
    }
  }, [gw]);

  const handleRefreshPool = useCallback(async () => {
    setPoolRefreshing(true);
    try {
      await gw.refreshPeerPool();
      setPoolStatus(await gw.getPoolStatus());
    } catch { /* silent */ }
    finally { setPoolRefreshing(false); }
  }, [gw]);

  const loadArioGateways = useCallback(async () => {
    setArioLoading(true);
    try {
      const gws = await discoverGateways();
      setArioGateways(gws);
      setArioNetStats(computeNetworkStats(gws));
    } catch { /* silent */ }
    finally { setArioLoading(false); }
  }, []);

  const handleArnsResolve = useCallback(async () => {
    const input = arnsInput.trim();
    if (!input) return;
    setArnsLoading(true);
    setArnsResult(null);
    try {
      const txId = await resolveToTxId(input);
      if (txId) {
        const name = input.replace(/^ar:\/\//, "");
        setArnsResult({ name, txId, url: isArnsName(name) ? getArnsUrl(name) : `https://arweave.net/${txId}` });
      } else {
        setArnsResult(null);
      }
    } catch { /* silent */ }
    finally { setArnsLoading(false); }
  }, [arnsInput]);

  useEffect(() => { if (tab === "network") { loadNetworkInfo(); loadArioGateways(); } }, [tab, loadNetworkInfo, loadArioGateways]);
  useEffect(() => { if (tab !== "network") return; const iv = setInterval(loadNetworkInfo, 30000); return () => clearInterval(iv); }, [tab, loadNetworkInfo]);

  const searchExplorer = useCallback(async () => {
    if (!expQuery.trim()) return;
    setExpLoading(true);
    setExpResults([]);
    try {
      if (expType === "txid") {
        const tx = await gw.getTx(expQuery.trim());
        const tags: ArweaveTag[] = (tx.tags ?? []).map((t) => { try { return { name: atob(t.name), value: atob(t.value) }; } catch { return t; } });
        const node = { id: tx.id, anchor: tx.last_tx, signature: tx.signature || "", recipient: tx.target || "", owner: { address: "", key: tx.owner || "" }, fee: { winston: tx.reward || "0", ar: winstonToAr(tx.reward || "0") }, quantity: { winston: tx.quantity || "0", ar: winstonToAr(tx.quantity || "0") }, data: { size: tx.data_size || "0", type: null }, tags, block: null, parent: null };
        setExpResults([{ cursor: "", node }]);
      } else {
        const params: GqlQueryParams = { first: 25, sort: "HEIGHT_DESC" };
        if (expType === "owner") params.owners = [expQuery.trim()];
        else if (expType === "recipient") params.recipients = [expQuery.trim()];
        else if (expType === "tags") { try { const parsed = JSON.parse(expQuery.trim()); params.tags = Array.isArray(parsed) ? parsed : [parsed]; } catch { params.tags = [{ name: "Content-Type", values: [expQuery.trim()] }]; } }
        const result = await gw.queryTransactions(params);
        setExpResults(result.edges);
      }
    } catch (e) { setExpResults([]); console.error("Explorer search failed:", e); }
    finally { setExpLoading(false); }
  }, [gw, expQuery, expType]);

  const loadBrowseData = useCallback(async (txId?: string) => {
    const input = (txId || browseTxId).trim();
    if (!input) return;
    setBrowseLoading(true); setBrowseData(null);
    try {
      // Resolve ArNS names or ar:// URLs to TX IDs
      const id = await resolveToTxId(input) ?? input;
      if (id !== input) setBrowseTxId(id);
      const { data, contentType } = await gw.getRawData(id);
      const blob = new Blob([data], { type: contentType });
      const url = URL.createObjectURL(blob);
      setBrowseData({ url, contentType });
      setBrowseHistory((prev) => [input, ...prev.filter((h) => h !== input && h !== id)].slice(0, 20));
    } catch (e) { console.error("Browse failed:", e); }
    finally { setBrowseLoading(false); }
  }, [gw, browseTxId]);

  const computeUploadCost = useCallback(async () => {
    let size = 0;
    if (uploadFile) size = uploadFile.size;
    else if (uploadText) size = new TextEncoder().encode(uploadText).byteLength;
    if (size === 0) { setUploadCost(null); setTurboCost(null); return; }
    try { setUploadCost(await gw.estimateCost(size)); } catch { setUploadCost(null); }
    try { setTurboCost(await ArweaveGateway.getTurboPrice(size)); } catch { setTurboCost(null); }
  }, [gw, uploadFile, uploadText]);

  useEffect(() => { if (tab === "upload") { const t = setTimeout(computeUploadCost, 500); return () => clearTimeout(t); } }, [tab, computeUploadCost]);

  useEffect(() => {
    if (tab !== "upload" || !arweaveWallet) { setTurboBalance(null); return; }
    ArweaveGateway.getTurboBalance(arweaveWallet.address).then(setTurboBalance).catch(() => setTurboBalance(null));
  }, [tab, arweaveWallet]);

  const addTag = useCallback(() => {
    if (!uploadNewTagName.trim()) return;
    setUploadTags((prev) => [...prev, { name: uploadNewTagName.trim(), value: uploadNewTagValue.trim() }]);
    setUploadNewTagName(""); setUploadNewTagValue("");
  }, [uploadNewTagName, uploadNewTagValue]);

  const removeTag = useCallback((i: number) => { setUploadTags((prev) => prev.filter((_, idx) => idx !== i)); }, []);

  const handleUpload = useCallback(async () => {
    if (!arweaveWallet) { setUploadStatus({ msg: "Connect an Arweave wallet first (switch to Arweave tab)", type: "error" }); return; }
    const file = uploadFile; const text = uploadText.trim();
    if (!file && !text) { setUploadStatus({ msg: "Add text or choose a file", type: "error" }); return; }
    const methodLabel = uploadMethod === "turbo" ? "Bundling via Turbo" : "Uploading to L1";
    setUploadStatus({ msg: `${methodLabel}...`, type: "loading" }); setUploadProgress(0);
    try {
      let result;
      if (file) { result = await gw.smartUploadFile(file, uploadTags, arweaveWallet.jwk, uploadMethod, uploadDesc || undefined, (pct) => setUploadProgress(pct)); }
      else { const data = new TextEncoder().encode(text); const tags: ArweaveTag[] = [{ name: "Content-Type", value: "text/plain" }, ...uploadTags]; result = await gw.smartUploadData(data, tags, arweaveWallet.jwk, uploadMethod, uploadDesc || undefined, (pct) => setUploadProgress(pct)); }
      if (result.status === 200) {
        const methodMsg = result.method === "turbo" ? " (instant via Turbo)" : " (L1 — ~10-30 min confirmation)";
        setUploadStatus({ msg: `Uploaded! TX: ${result.txId}${methodMsg}`, type: "success" });
        setUploadText(""); setUploadFile(null); setUploadDesc(""); setUploadTags([]); if (uploadFileRef.current) uploadFileRef.current.value = "";
      }
      else { setUploadStatus({ msg: `Upload failed (status ${result.status})`, type: "error" }); }
    } catch (e) { setUploadStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" }); }
    finally { setUploadProgress(null); }
  }, [gw, arweaveWallet, uploadFile, uploadText, uploadTags, uploadDesc, uploadMethod]);

  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try { setUploads(await ArweaveGateway.getUploads()); } catch { /* silent */ }
    finally { setUploadsLoading(false); }
  }, []);

  useEffect(() => { if (tab === "history" && user) loadUploads(); }, [tab, user, loadUploads]);

  const GQL_TEMPLATES = useMemo(() => [
    { label: "My Transactions", query: arweaveWallet ? buildGqlQuery({ owners: [arweaveWallet.address], first: 25, sort: "HEIGHT_DESC" }) : "# Connect an Arweave wallet first" },
    { label: "By Content Type", query: buildGqlQuery({ tags: [{ name: "Content-Type", values: ["image/png"] }], first: 10, sort: "HEIGHT_DESC" }) },
    { label: "By App Name", query: buildGqlQuery({ tags: [{ name: "App-Name", values: ["MoneyFund"] }], first: 25, sort: "HEIGHT_DESC" }) },
    { label: "Recent Large Transfers", query: buildGqlQuery({ first: 10, sort: "HEIGHT_DESC" }) },
  ], [arweaveWallet]);

  const runGql = useCallback(async () => {
    if (!gqlQuery.trim()) return; setGqlLoading(true); setGqlResult("");
    try { setGqlResult(JSON.stringify(await gw.rawGraphQL(gqlQuery.trim()), null, 2)); }
    catch (e) { setGqlResult(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setGqlLoading(false); }
  }, [gw, gqlQuery]);

  const loadBookmarks = useCallback(async () => { try { setBookmarks(await ArweaveGateway.getBookmarks()); } catch { /* silent */ } }, []);
  useEffect(() => { if (tab === "bookmarks" && user) loadBookmarks(); }, [tab, user, loadBookmarks]);

  const addBookmark = useCallback(async () => {
    if (!bmTarget.trim()) return;
    await ArweaveGateway.addBookmark(bmType, bmTarget.trim(), bmLabel.trim() || undefined, bmNotes.trim() || undefined);
    setBmTarget(""); setBmLabel(""); setBmNotes(""); loadBookmarks();
  }, [bmType, bmTarget, bmLabel, bmNotes, loadBookmarks]);

  const deleteBookmark = useCallback(async (id: string) => { await ArweaveGateway.removeBookmark(id); loadBookmarks(); }, [loadBookmarks]);

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className={`${card} p-1.5 flex gap-1 overflow-x-auto`}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex-1 min-w-0 h-10 rounded-xl text-xs sm:text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap px-2 ${tab === t.id ? "bg-purple-500/20 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"}`}>
            <span className="text-xs opacity-60 hidden sm:inline">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* NETWORK */}
      {tab === "network" && (
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Network Status</span>
              <button type="button" onClick={loadNetworkInfo} className={pillBtn}>Refresh</button>
            </div>
            {netInfo ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div><p className="text-2xl font-bold text-white tracking-tight">{netInfo.height?.toLocaleString()}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Block Height</p></div>
                <div><p className="text-2xl font-bold text-white tracking-tight">{netInfo.peers}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Peers</p></div>
                <div><p className="text-2xl font-bold text-white tracking-tight">{netInfo.queue_length ?? 0}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Queue</p></div>
                <div><p className="text-2xl font-bold text-white tracking-tight">v{netInfo.version}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Version</p></div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin" /></div>
            )}
          </div>
          {costPerMb && (
            <div className={`${card} p-5`}>
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Storage Cost (1 MB)</span>
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div><p className="text-lg font-bold text-white">{parseFloat(costPerMb.ar).toFixed(8)}</p><p className="text-[10px] text-white/30 uppercase">AR</p></div>
                <div><p className="text-lg font-bold text-white">${parseFloat(costPerMb.usd).toFixed(4)}</p><p className="text-[10px] text-white/30 uppercase">USD</p></div>
                <div><p className="text-lg font-bold text-white">${costPerMb.usd_per_ar?.toFixed(2)}</p><p className="text-[10px] text-white/30 uppercase">AR/USD Rate</p></div>
              </div>
            </div>
          )}
          {/* Peer Pool */}
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Direct Peer Pool</span>
                {poolStatus && (
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${poolStatus.pool_fresh ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"}`}>
                    {poolStatus.pool_fresh ? "LIVE" : "STALE"}
                  </span>
                )}
              </div>
              <button type="button" onClick={handleRefreshPool} disabled={poolRefreshing} className={pillBtn}>
                {poolRefreshing ? <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" /> : "Discover Peers"}
              </button>
            </div>
            {poolStatus ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div><p className="text-2xl font-bold text-emerald-400">{poolStatus.active_peers}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Active Peers</p></div>
                  <div><p className="text-2xl font-bold text-white">{poolStatus.top_peers.length > 0 ? `${Math.min(...poolStatus.top_peers.map(p => p.latency_ms))}ms` : "—"}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Best Latency</p></div>
                </div>
                {poolStatus.top_peers.length > 0 && (
                  <div className="space-y-1 max-h-[280px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                    {poolStatus.top_peers.map((peer) => {
                      const health = parseFloat(peer.health);
                      return (
                        <div key={peer.address} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors group">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${health >= 0.7 ? "bg-emerald-400" : health >= 0.4 ? "bg-yellow-400" : "bg-red-400"}`} />
                          <span className="text-[11px] font-mono text-white/50 min-w-0 truncate">{peer.address}</span>
                          <span className="text-[10px] text-white/25 tabular-nums shrink-0">{peer.latency_ms}ms</span>
                          <span className="text-[10px] text-white/20 tabular-nums shrink-0">h{peer.block_height.toLocaleString()}</span>
                          <div className="ml-auto w-12 h-1.5 rounded-full bg-white/[0.06] overflow-hidden shrink-0">
                            <div className={`h-full rounded-full transition-all ${health >= 0.7 ? "bg-emerald-400" : health >= 0.4 ? "bg-yellow-400" : "bg-red-400"}`} style={{ width: `${Math.round(health * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {poolStatus.active_peers === 0 && (
                  <p className="text-xs text-white/30 text-center py-4">No peers discovered yet. Click &ldquo;Discover Peers&rdquo; to bootstrap.</p>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-6"><div className="w-5 h-5 border-2 border-white/10 border-t-emerald-400 rounded-full animate-spin" /></div>
            )}
          </div>
          {/* Fallback Gateways (last resort) */}
          <div className={`${card} p-5`}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Fallback Gateways <span className="normal-case text-white/15">(last resort only)</span></span>
            <div className="mt-3 space-y-2">
              {ARWEAVE_DIRECT_GATEWAYS.map((g) => {
                const status = gwHealth[g] || "checking";
                return (
                  <div key={g} className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${status === "up" ? "bg-emerald-400" : status === "down" ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`} />
                    <span className="text-sm text-white/60 font-mono">{g.replace("https://", "")}</span>
                    <span className={`ml-auto text-[10px] uppercase font-semibold ${status === "up" ? "text-emerald-400" : status === "down" ? "text-red-400" : "text-yellow-400"}`}>{status}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* ar.io Gateway Network */}
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/30 uppercase tracking-wider">ar.io Gateway Network</span>
                {arioNetStats && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    {arioNetStats.healthyCount}/{arioNetStats.totalChecked} LIVE
                  </span>
                )}
              </div>
              <button type="button" onClick={loadArioGateways} disabled={arioLoading} className={pillBtn}>
                {arioLoading ? <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" /> : "Scan"}
              </button>
            </div>
            {arioNetStats && (
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div><p className="text-2xl font-bold text-cyan-400">{arioNetStats.healthyCount}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Healthy</p></div>
                <div><p className="text-2xl font-bold text-white">{arioNetStats.bestLatencyMs}ms</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Best Latency</p></div>
                <div><p className="text-2xl font-bold text-white">{arioNetStats.avgLatencyMs}ms</p><p className="text-[10px] text-white/30 mt-0.5 uppercase">Avg Latency</p></div>
              </div>
            )}
            {arioGateways.length > 0 && (
              <div className="space-y-1 max-h-[300px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                {arioGateways.map((g) => (
                  <div key={g.fqdn} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors group">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${g.healthy ? "bg-emerald-400" : "bg-red-400"}`} />
                    <span className="text-[11px] font-mono text-white/50 min-w-0 truncate flex-1">{g.fqdn}</span>
                    <span className="text-[10px] text-white/25 tabular-nums shrink-0">{g.latencyMs}ms</span>
                    {g.version && <span className="text-[10px] text-white/15 shrink-0">v{g.version}</span>}
                    {g.healthy && (
                      <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400/40 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Open</a>
                    )}
                  </div>
                ))}
              </div>
            )}
            {arioGateways.length === 0 && !arioLoading && (
              <p className="text-xs text-white/30 text-center py-4">Click Scan to discover ar.io gateways.</p>
            )}
          </div>

          {/* ArNS Resolver */}
          <div className={`${card} p-5`}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider mb-3 block">ArNS Name Resolver</span>
            <div className="flex gap-2">
              <input
                value={arnsInput}
                onChange={(e) => setArnsInput(e.target.value)}
                placeholder="Enter ArNS name or ar://name..."
                className={`flex-1 ${inputCls}`}
                onKeyDown={(e) => e.key === "Enter" && handleArnsResolve()}
              />
              <button type="button" onClick={handleArnsResolve} disabled={arnsLoading} className={btnPrimary}>
                {arnsLoading ? <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" /> : "Resolve"}
              </button>
            </div>
            {arnsResult && (
              <div className="mt-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-cyan-300/40 uppercase font-medium">Name</span>
                  <span className="text-xs font-mono text-cyan-300/80">{arnsResult.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/30 uppercase font-medium">TX ID</span>
                  <span className="text-xs font-mono text-white/50 break-all">{arnsResult.txId}</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setBrowseTxId(arnsResult.txId); setTab("browser"); loadBrowseData(arnsResult.txId); }} className={pillBtn}>View Data</button>
                  <a href={arnsResult.url} target="_blank" rel="noopener noreferrer" className={pillBtn}>Open URL</a>
                  <button type="button" onClick={() => navigator.clipboard.writeText(arnsResult.txId)} className={pillBtn}>Copy TX</button>
                </div>
              </div>
            )}
          </div>

          {gwStats && gwStats.totalRequests > 0 && (
            <div className={`${card} p-5`}>
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Your Gateway Usage</span>
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div><p className="text-2xl font-bold text-white">{gwStats.totalRequests}</p><p className="text-[10px] text-white/30 uppercase">Requests</p></div>
                <div><p className="text-2xl font-bold text-white">{(gwStats.cacheHitRate * 100).toFixed(1)}%</p><p className="text-[10px] text-white/30 uppercase">Cache Hit</p></div>
                <div><p className="text-2xl font-bold text-white">{gwStats.avgResponseMs}ms</p><p className="text-[10px] text-white/30 uppercase">Avg Response</p></div>
              </div>
            </div>
          )}
          <div className={`${card} p-4 text-center`}>
            <p className="text-[10px] text-white/20 leading-relaxed">
              Requests route through directly-discovered Arweave peer nodes.
              Public gateways are only used as a last resort if all peers are unreachable.
              Peer pool self-sustains through peer-to-peer discovery after initial bootstrap.
            </p>
          </div>
        </div>
      )}

      {/* EXPLORER */}
      {tab === "explorer" && (
        <div className="space-y-4">
          <div className={`${card} p-5 space-y-3`}>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={expType} onChange={(e) => setExpType(e.target.value as typeof expType)} className={`sm:w-40 ${inputCls} appearance-none cursor-pointer`}>
                <option value="txid">TX ID</option><option value="owner">Owner</option><option value="recipient">Recipient</option><option value="tags">Tags</option>
              </select>
              <input value={expQuery} onChange={(e) => setExpQuery(e.target.value)} placeholder={expType === "txid" ? "Transaction ID..." : expType === "tags" ? '{"name":"Content-Type","values":["image/png"]}' : "Arweave address..."} className={`flex-1 ${inputCls}`} onKeyDown={(e) => e.key === "Enter" && searchExplorer()} />
              <button type="button" onClick={searchExplorer} disabled={expLoading} className={btnPrimary}>
                {expLoading ? <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" /> : "Search"}
              </button>
            </div>
          </div>
          {expResults.length > 0 && (
            <div className="space-y-2">
              {expResults.map((edge) => {
                const n = edge.node; const expanded = expExpanded === n.id;
                const ct = n.tags?.find((t) => t.name === "Content-Type")?.value;
                return (
                  <div key={n.id + edge.cursor} className={`${card} overflow-hidden`}>
                    <button type="button" onClick={() => setExpExpanded(expanded ? null : n.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-purple-300/80 truncate">{n.id}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {n.block && <span className="text-[10px] text-white/30">Block {n.block.height.toLocaleString()}</span>}
                          {ct && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300/60 border border-purple-500/20">{ct}</span>}
                          {parseInt(n.data?.size || "0") > 0 && <span className="text-[10px] text-white/30">{formatBytes(parseInt(n.data.size))}</span>}
                          {n.block && <span className="text-[10px] text-white/30">{relativeTime(n.block.timestamp)}</span>}
                        </div>
                      </div>
                      <span className="text-white/20 text-sm">{expanded ? "▾" : "▸"}</span>
                    </button>
                    {expanded && (
                      <div className="px-4 pb-4 space-y-3 border-t border-white/[0.04]">
                        <div className="grid grid-cols-2 gap-3 pt-3">
                          <div><span className="text-[10px] text-white/30 uppercase">Owner</span><p className="text-xs font-mono text-white/50 break-all">{n.owner?.address || shorten(n.owner?.key || "", 20)}</p></div>
                          <div><span className="text-[10px] text-white/30 uppercase">Recipient</span><p className="text-xs font-mono text-white/50 break-all">{n.recipient || "—"}</p></div>
                          <div><span className="text-[10px] text-white/30 uppercase">Fee</span><p className="text-xs text-white/50">{n.fee?.ar} AR</p></div>
                          <div><span className="text-[10px] text-white/30 uppercase">Quantity</span><p className="text-xs text-white/50">{n.quantity?.ar} AR</p></div>
                        </div>
                        {n.tags && n.tags.length > 0 && (
                          <div>
                            <span className="text-[10px] text-white/30 uppercase">Tags</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">{n.tags.map((t, i) => (<span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/40">{t.name}: {t.value}</span>))}</div>
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button type="button" onClick={() => { setBrowseTxId(n.id); setTab("browser"); loadBrowseData(n.id); }} className={btnSmall}>View Data</button>
                          <button type="button" onClick={() => ArweaveGateway.addBookmark("transaction", n.id, ct || "TX").then(loadBookmarks)} className={btnSmall}>Bookmark</button>
                          <a href={`https://viewblock.io/arweave/tx/${n.id}`} target="_blank" rel="noopener noreferrer" className={btnSmall}>ViewBlock</a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!expLoading && expResults.length === 0 && expQuery && (<div className={`${card} p-10 text-center`}><p className="text-sm text-white/30">No results found</p></div>)}
        </div>
      )}

      {/* BROWSER */}
      {tab === "browser" && (
        <div className="space-y-4">
          <div className={`${card} p-4 flex gap-2`}>
            <input value={browseTxId} onChange={(e) => setBrowseTxId(e.target.value)} placeholder="TX ID, ArNS name, or ar://name..." className={`flex-1 ${inputCls}`} onKeyDown={(e) => e.key === "Enter" && loadBrowseData()} />
            <button type="button" onClick={() => loadBrowseData()} disabled={browseLoading} className={btnPrimary}>
              {browseLoading ? <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" /> : "View"}
            </button>
          </div>
          {browseData && (
            <div className={`${card} p-5 space-y-3`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300/60 border border-purple-500/20">{browseData.contentType}</span>
                <div className="flex gap-2">
                  <a href={browseData.url} target="_blank" rel="noopener noreferrer" className={pillBtn}>Open Raw</a>
                  <button type="button" onClick={() => ArweaveGateway.addBookmark("content", browseTxId.trim(), browseData.contentType)} className={pillBtn}>Bookmark</button>
                </div>
              </div>
              <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black/30 min-h-[200px] max-h-[500px] overflow-auto">
                {ArweaveGateway.contentCategory(browseData.contentType) === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={browseData.url} alt="Arweave content" className="max-w-full h-auto mx-auto" />
                )}
                {ArweaveGateway.contentCategory(browseData.contentType) === "video" && <video src={browseData.url} controls className="max-w-full mx-auto" />}
                {ArweaveGateway.contentCategory(browseData.contentType) === "audio" && <div className="p-8 flex justify-center"><audio src={browseData.url} controls /></div>}
                {ArweaveGateway.contentCategory(browseData.contentType) === "html" && <iframe src={browseData.url} title="Arweave HTML" sandbox="allow-scripts" className="w-full h-[400px] border-0" />}
                {(ArweaveGateway.contentCategory(browseData.contentType) === "text" || ArweaveGateway.contentCategory(browseData.contentType) === "json") && <BlobTextViewer url={browseData.url} />}
                {ArweaveGateway.contentCategory(browseData.contentType) === "pdf" && <iframe src={browseData.url} title="PDF" className="w-full h-[500px] border-0" />}
                {ArweaveGateway.contentCategory(browseData.contentType) === "binary" && <div className="p-8 text-center text-white/30 text-sm">Binary content. <a href={browseData.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 underline">Download</a></div>}
              </div>
            </div>
          )}
          {browseHistory.length > 0 && (
            <div className={`${card} p-4`}>
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Recent Views</span>
              <div className="mt-2 space-y-1">
                {browseHistory.map((id) => (<button key={id} type="button" onClick={() => { setBrowseTxId(id); loadBrowseData(id); }} className="block w-full text-left text-xs font-mono text-purple-300/50 hover:text-purple-300 py-1 px-2 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer truncate">{id}</button>))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* UPLOAD */}
      {tab === "upload" && (
        <div className="space-y-4">
          {!arweaveWallet && (
            <div className={`${card} p-5 text-center`}>
              <p className="text-sm text-white/50 mb-3">You need an Arweave wallet to upload data.</p>
              <p className="text-xs text-white/30">Switch to the Arweave tab above to set up a wallet.</p>
            </div>
          )}
          {arweaveWallet && (
            <>
              {/* Upload Method Selector */}
              <div className={`${card} p-1.5 flex gap-1`}>
                <button type="button" onClick={() => setUploadMethod("turbo")} className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${uploadMethod === "turbo" ? "bg-emerald-500/15 text-emerald-300 shadow-[inset_0_1px_0_rgba(52,211,153,0.2)]" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"}`}>
                  <span className="w-2 h-2 rounded-full bg-emerald-400" style={{ opacity: uploadMethod === "turbo" ? 1 : 0.3 }} />Bundled (Instant)
                </button>
                <button type="button" onClick={() => setUploadMethod("l1")} className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${uploadMethod === "l1" ? "bg-purple-500/15 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"}`}>
                  <span className="w-2 h-2 rounded-full bg-purple-400" style={{ opacity: uploadMethod === "l1" ? 1 : 0.3 }} />Standard (L1)
                </button>
              </div>

              <div className={`${card} p-4 text-xs ${uploadMethod === "turbo" ? "text-emerald-300/60 border-emerald-500/10" : "text-purple-300/60 border-purple-500/10"}`}>
                {uploadMethod === "turbo"
                  ? "Bundled mode: Data is bundled via Turbo for instant confirmation (~8ms). Uses Turbo credits — fund at app.ardrive.io. Falls back to L1 if credits are insufficient."
                  : "Standard mode: Transaction is submitted directly to the Arweave network (L1). Confirmation takes ~10-30 minutes but requires only AR in your wallet."}
              </div>

              {/* Turbo Balance */}
              {uploadMethod === "turbo" && turboBalance && (
                <div className={`${card} p-4`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-emerald-300/40 uppercase tracking-wider font-medium">Turbo Credits</span>
                    <a href="https://app.ardrive.io" target="_blank" rel="noopener noreferrer" className={pillBtn}>Fund Account</a>
                  </div>
                  <p className="text-lg font-bold text-white mt-1">{parseFloat(turboBalance.ar).toFixed(8)} <span className="text-sm font-normal text-white/30">AR equivalent</span></p>
                </div>
              )}

              <div className={`${card} p-5 space-y-4`}>
                <h3 className="text-sm font-semibold text-white/80">Upload to the Permaweb</h3>
                <div>
                  <label className={labelCls}>Text Data</label>
                  <textarea rows={4} value={uploadText} onChange={(e) => { setUploadText(e.target.value); setUploadFile(null); }} placeholder="Enter text to store permanently..." className={`${inputCls} h-auto py-3`} style={{ resize: "vertical" }} />
                </div>
                <div>
                  <label className={labelCls}>Or Choose a File</label>
                  <input ref={uploadFileRef} type="file" accept="*/*" onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setUploadText(""); }} className="block w-full text-sm text-white/40 file:mr-3 file:h-9 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-medium file:bg-white/[0.06] file:text-white/60 hover:file:bg-white/[0.1] file:cursor-pointer file:transition-all" />
                  {uploadFile && <p className="text-[11px] text-white/30 mt-1">{uploadFile.name} ({formatBytes(uploadFile.size)})</p>}
                </div>
                <div><label className={labelCls}>Description (optional)</label><input value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)} placeholder="What is this upload?" className={inputCls} /></div>
              </div>
              <div className={`${card} p-5 space-y-3`}>
                <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Custom Tags</span>
                {uploadTags.length > 0 && (<div className="flex flex-wrap gap-1.5">{uploadTags.map((t, i) => (<span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300/60">{t.name}: {t.value}<button type="button" onClick={() => removeTag(i)} className="text-red-400/60 hover:text-red-400 cursor-pointer">x</button></span>))}</div>)}
                <div className="flex gap-2">
                  <input value={uploadNewTagName} onChange={(e) => setUploadNewTagName(e.target.value)} placeholder="Tag name" className={`flex-1 ${inputCls}`} />
                  <input value={uploadNewTagValue} onChange={(e) => setUploadNewTagValue(e.target.value)} placeholder="Tag value" className={`flex-1 ${inputCls}`} />
                  <button type="button" onClick={addTag} className={btnSmall}>Add</button>
                </div>
              </div>
              {(uploadCost || turboCost) && (
                <div className={`${card} p-4`}>
                  <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Estimated Cost</span>
                  {uploadMethod === "turbo" && turboCost && (
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div><p className="text-sm font-bold text-emerald-300">{parseFloat(turboCost.ar).toFixed(8)}</p><p className="text-[10px] text-emerald-300/40">AR (Turbo)</p></div>
                      <div><p className="text-sm font-bold text-white/40">{uploadCost ? parseFloat(uploadCost.ar).toFixed(8) : "—"}</p><p className="text-[10px] text-white/20">AR (L1 comparison)</p></div>
                    </div>
                  )}
                  {uploadMethod === "l1" && uploadCost && (
                    <div className="grid grid-cols-3 gap-4 mt-2">
                      <div><p className="text-sm font-bold text-white">{parseFloat(uploadCost.ar).toFixed(8)}</p><p className="text-[10px] text-white/30">AR</p></div>
                      <div><p className="text-sm font-bold text-white">${parseFloat(uploadCost.usd).toFixed(6)}</p><p className="text-[10px] text-white/30">USD</p></div>
                      <div><p className="text-sm font-bold text-white">{uploadCost.winston}</p><p className="text-[10px] text-white/30">Winston</p></div>
                    </div>
                  )}
                </div>
              )}
              {uploadProgress !== null && (
                <div className={`${card} p-4`}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-violet-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} /></div>
                    <span className="text-xs text-white/50 w-12 text-right">{uploadProgress}%</span>
                  </div>
                </div>
              )}
              <button type="button" onClick={handleUpload} disabled={uploadProgress !== null} className={`w-full ${btnPrimary}`}>{uploadProgress !== null ? "Uploading..." : uploadMethod === "turbo" ? "Upload via Turbo (Instant)" : "Upload to Arweave (L1)"}</button>
              {uploadStatus && (<div className={`${card} p-3 text-xs font-medium ${uploadStatus.type === "success" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" : uploadStatus.type === "error" ? "text-red-400 border-red-500/20 bg-red-500/5" : "text-purple-300 border-purple-500/20 bg-purple-500/5"} break-all`}>{uploadStatus.msg}</div>)}
            </>
          )}
        </div>
      )}

      {/* HISTORY */}
      {tab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">My Uploads</span>
            <button type="button" onClick={loadUploads} className={pillBtn}>Refresh</button>
          </div>
          {uploadsLoading && uploads.length === 0 && (<div className={`${card} p-10 text-center`}><div className="w-5 h-5 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" /><p className="text-xs text-white/30">Loading...</p></div>)}
          {!uploadsLoading && uploads.length === 0 && (<div className={`${card} p-10 text-center`}><p className="text-sm text-white/30">No uploads yet</p><p className="text-xs text-white/20 mt-1">Upload data from the Upload tab to see it here.</p></div>)}
          {uploads.length > 0 && (
            <>
              <div className={`${card} p-4`}>
                <div className="grid grid-cols-3 gap-4">
                  <div><p className="text-xl font-bold text-white">{uploads.length}</p><p className="text-[10px] text-white/30 uppercase">Uploads</p></div>
                  <div><p className="text-xl font-bold text-white">{formatBytes(uploads.reduce((s, u) => s + (u.data_size || 0), 0))}</p><p className="text-[10px] text-white/30 uppercase">Total Data</p></div>
                  <div><p className="text-xl font-bold text-white">{uploads.reduce((s, u) => s + parseFloat(u.cost_ar || "0"), 0).toFixed(6)}</p><p className="text-[10px] text-white/30 uppercase">Total AR</p></div>
                </div>
              </div>
              <div className="space-y-1.5">
                {uploads.map((u) => (
                  <div key={u.id} className={`${card} px-4 py-3 flex items-center gap-3`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-purple-300/60 truncate">{u.tx_id || "Preparing..."}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {u.filename && <span className="text-[10px] text-white/40">{u.filename}</span>}
                        {u.content_type && <span className="text-[10px] text-white/30">{u.content_type}</span>}
                        <span className="text-[10px] text-white/30">{formatBytes(u.data_size)}</span>
                        <span className="text-[10px] text-white/30">{relativeTime(u.created_at)}</span>
                      </div>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase ${u.status === "confirmed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : u.status === "submitted" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : u.status === "failed" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"}`}>{u.status}</span>
                    {u.tx_id && (<button type="button" onClick={() => { setBrowseTxId(u.tx_id!); setTab("browser"); loadBrowseData(u.tx_id!); }} className={pillBtn}>View</button>)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* GRAPHQL */}
      {tab === "graphql" && (
        <div className="space-y-4">
          <div className={`${card} p-4`}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider mb-2 block">Templates</span>
            <div className="flex flex-wrap gap-2">{GQL_TEMPLATES.map((t) => (<button key={t.label} type="button" onClick={() => setGqlQuery(t.query)} className={pillBtn}>{t.label}</button>))}</div>
          </div>
          <div className={`${card} p-5 space-y-3`}>
            <label className={labelCls}>GraphQL Query</label>
            <textarea rows={10} value={gqlQuery} onChange={(e) => setGqlQuery(e.target.value)} placeholder="{ transactions(first: 10) { edges { node { id } } } }" className={`${inputCls} h-auto py-3 font-mono text-xs`} style={{ resize: "vertical" }} />
            <button type="button" onClick={runGql} disabled={gqlLoading} className={`w-full ${btnPrimary}`}>{gqlLoading ? <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin mx-auto" /> : "Run Query"}</button>
          </div>
          {gqlResult && (<div className={`${card} p-4`}><span className="text-xs font-medium text-white/30 uppercase tracking-wider mb-2 block">Result</span><pre className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs text-white/40 max-h-[400px] overflow-auto whitespace-pre-wrap break-all font-mono" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>{gqlResult}</pre></div>)}
        </div>
      )}

      {/* BOOKMARKS */}
      {tab === "bookmarks" && (
        <div className="space-y-4">
          <div className={`${card} p-5 space-y-3`}>
            <h3 className="text-sm font-semibold text-white/80">Add Bookmark</h3>
            <div className="flex gap-2">
              <select value={bmType} onChange={(e) => setBmType(e.target.value as typeof bmType)} className={`w-36 ${inputCls} appearance-none cursor-pointer`}>
                <option value="transaction">Transaction</option><option value="address">Address</option><option value="content">Content</option>
              </select>
              <input value={bmTarget} onChange={(e) => setBmTarget(e.target.value)} placeholder="TX ID or address" className={`flex-1 ${inputCls}`} />
            </div>
            <div className="flex gap-2">
              <input value={bmLabel} onChange={(e) => setBmLabel(e.target.value)} placeholder="Label (optional)" className={`flex-1 ${inputCls}`} />
              <input value={bmNotes} onChange={(e) => setBmNotes(e.target.value)} placeholder="Notes (optional)" className={`flex-1 ${inputCls}`} />
            </div>
            <button type="button" onClick={addBookmark} className={btnPrimary}>Save Bookmark</button>
          </div>
          {bookmarks.length === 0 && (<div className={`${card} p-10 text-center`}><p className="text-sm text-white/30">No bookmarks yet</p><p className="text-xs text-white/20 mt-1">Save transactions, addresses, or content for quick access.</p></div>)}
          {bookmarks.length > 0 && (
            <div className="space-y-1.5">
              {bookmarks.map((bm) => (
                <div key={bm.id} className={`${card} px-4 py-3 flex items-center gap-3`}>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase ${bm.bookmark_type === "transaction" ? "bg-purple-500/10 text-purple-300 border border-purple-500/20" : bm.bookmark_type === "address" ? "bg-blue-500/10 text-blue-300 border border-blue-500/20" : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"}`}>{bm.bookmark_type}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white/70">{bm.label || shorten(bm.target_id, 24)}</p>
                    {bm.notes && <p className="text-[10px] text-white/30 mt-0.5">{bm.notes}</p>}
                    <p className="text-[10px] font-mono text-white/20 truncate mt-0.5">{bm.target_id}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {bm.bookmark_type === "transaction" && (<button type="button" onClick={() => { setBrowseTxId(bm.target_id); setTab("browser"); loadBrowseData(bm.target_id); }} className={pillBtn}>View</button>)}
                    {bm.bookmark_type === "address" && (<button type="button" onClick={() => { setExpQuery(bm.target_id); setExpType("owner"); setTab("explorer"); }} className={pillBtn}>Explore</button>)}
                    <button type="button" onClick={() => navigator.clipboard.writeText(bm.target_id)} className={pillBtn}>Copy</button>
                    <button type="button" onClick={() => deleteBookmark(bm.id)} className={`${pillBtn} text-red-400/50 hover:text-red-400`}>Del</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BlobTextViewer({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { fetch(url).then((r) => r.text()).then(setText).catch(() => setText("Failed to load")); }, [url]);
  if (text === null) return <div className="p-4 text-white/30 text-xs">Loading...</div>;
  return <pre className="p-4 text-xs text-white/40 whitespace-pre-wrap break-all font-mono max-h-[400px] overflow-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>{text}</pre>;
}
