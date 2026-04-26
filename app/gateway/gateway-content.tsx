"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@/lib/wallet-context";
import ArweaveGateway, { buildGqlQuery, winstonToAr } from "@/lib/arweave";
import { ARWEAVE_DIRECT_GATEWAYS, ARWEAVE_PRIMARY_GATEWAY } from "@/lib/config";
import { getPoolStats, type GatewayStat } from "@/lib/gateway-pool";
import {
  discoverGateways,
  resolveToTxId,
  isArnsName,
  getArnsUrl,
  computeNetworkStats,
  type ArioGatewayHealth,
  type GatewayNetworkStats,
} from "@/lib/ario";
import {
  dryrun,
  sendMessage,
  getTokenInfo,
  getTokenBalance,
  formatTokenAmount,
  AO_TOKENS,
  type AoResult,
  type AoTokenInfo,
} from "@/lib/ao";
import {
  readContractState,
  getAtomicAsset,
  getPstInfo,
  getVouchScore,
  getSonarUrl,
  KNOWN_CONTRACTS,
  type SmartWeaveState,
  type AtomicAsset,
  type PstInfo,
} from "@/lib/smartweave";
import type {
  ArweaveNetworkInfo,
  ArweaveCostEstimate,
  ArweaveGqlEdge,
  ArweaveTag,
  ArweaveBookmark,
  ArweavePoolStatus,
  ArweaveBlock,
  GqlQueryParams,
} from "@/lib/wallet-types";

const UnifiedUpload = dynamic(() => import("@/app/wallets/unified-upload"), { ssr: false });
const ArweaveHistory = dynamic(() => import("@/app/wallets/arweave-history"), { ssr: false });

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

type Tab = "network" | "blocks" | "explorer" | "browser" | "upload" | "ao" | "history" | "graphql" | "bookmarks";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "network", label: "Network", icon: "◉" },
  { id: "blocks", label: "Blocks", icon: "▦" },
  { id: "explorer", label: "Explorer", icon: "◎" },
  { id: "browser", label: "Browser", icon: "◫" },
  { id: "upload", label: "Upload", icon: "☁" },
  { id: "ao", label: "AO", icon: "⊛" },
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

  /* Self-hosted node health (populated from /api/gateway/health) */
  interface NodeHealth {
    configured: boolean;
    primary: {
      url: string;
      healthy: boolean;
      height: number | null;
      release: number | null;
      latencyMs: number;
      error?: string;
      blockList: number | null;
      syncLag: number | null;
    } | null;
    network: { height: number | null };
    pool: { url: string; healthy: boolean; height: number | null; latencyMs: number }[];
    checkedAt: number;
  }
  const [nodeHealth, setNodeHealth] = useState<NodeHealth | null>(null);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [clientPoolStats, setClientPoolStats] = useState<GatewayStat[]>([]);

  const [expQuery, setExpQuery] = useState("");
  const [expType, setExpType] = useState<"txid" | "owner" | "recipient" | "tags">("txid");
  const [expResults, setExpResults] = useState<ArweaveGqlEdge[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expExpanded, setExpExpanded] = useState<string | null>(null);

  const [browseTxId, setBrowseTxId] = useState("");
  const [browseData, setBrowseData] = useState<{ url: string; contentType: string } | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseHistory, setBrowseHistory] = useState<string[]>([]);


  const [gqlQuery, setGqlQuery] = useState("");
  const [gqlResult, setGqlResult] = useState("");
  const [gqlLoading, setGqlLoading] = useState(false);

  const [arioGateways, setArioGateways] = useState<ArioGatewayHealth[]>([]);
  const [arioNetStats, setArioNetStats] = useState<GatewayNetworkStats | null>(null);
  const [arioLoading, setArioLoading] = useState(false);

  const [arnsInput, setArnsInput] = useState("");
  const [arnsResult, setArnsResult] = useState<{ name: string; txId: string; url: string } | null>(null);
  const [arnsLoading, setArnsLoading] = useState(false);

  /* AO state */
  const [aoProcessId, setAoProcessId] = useState("");
  const [aoAction, setAoAction] = useState("");
  const [aoData, setAoData] = useState("");
  const [aoResult, setAoResult] = useState<AoResult | null>(null);
  const [aoLoading, setAoLoading] = useState(false);
  const [aoTokens, setAoTokens] = useState<(AoTokenInfo & { balance?: string; rawBalance?: string })[]>([]);
  const [aoTokensLoading, setAoTokensLoading] = useState(false);

  /* SmartWeave state */
  const [swContractId, setSwContractId] = useState("");
  const [swState, setSwState] = useState<SmartWeaveState | null>(null);
  const [swAsset, setSwAsset] = useState<AtomicAsset | null>(null);
  const [swPst, setSwPst] = useState<PstInfo | null>(null);
  const [swLoading, setSwLoading] = useState(false);
  const [swVouch, setSwVouch] = useState<{ vouched: boolean; score: number; vouchers: string[] } | null>(null);

  /* Block explorer state */
  const [blocks, setBlocks] = useState<ArweaveBlock[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blockDetail, setBlockDetail] = useState<ArweaveBlock | null>(null);
  const [blockHeightInput, setBlockHeightInput] = useState("");

  /* Browser TX metadata */
  const [browseMeta, setBrowseMeta] = useState<{
    owner: string; fee: string; quantity: string; block?: { height: number; timestamp: number };
    tags: ArweaveTag[];
  } | null>(null);

  /* Wallet balance in header */
  const [walletBal, setWalletBal] = useState<{ ar: string; turbo: string } | null>(null);

  /* AO message sending */
  const [aoSendMode, setAoSendMode] = useState<"dryrun" | "send">("dryrun");
  const [aoSendResult, setAoSendResult] = useState<string | null>(null);
  const [aoSending, setAoSending] = useState(false);

  const [bookmarks, setBookmarks] = useState<ArweaveBookmark[]>([]);
  const [bmLabel, setBmLabel] = useState("");
  const [bmTarget, setBmTarget] = useState("");
  const [bmType, setBmType] = useState<"transaction" | "address" | "content">("transaction");
  const [bmNotes, setBmNotes] = useState("");

  const loadNodeHealth = useCallback(async () => {
    setNodeLoading(true);
    try {
      const res = await fetch("/api/gateway/health", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as NodeHealth;
        setNodeHealth(data);
      }
    } catch { /* silent */ }
    finally { setNodeLoading(false); }
    setClientPoolStats(getPoolStats());
  }, []);

  const loadNetworkInfo = useCallback(async () => {
    try {
      const [info, cost] = await Promise.all([gw.getNetworkInfo(), gw.estimateCost(1024 * 1024)]);
      setNetInfo(info);
      setCostPerMb(cost);
    } catch { /* silent */ }
    try { const stats = await ArweaveGateway.getGatewayStats(); setGwStats(stats); } catch { /* silent */ }
    try { setPoolStatus(await gw.getPoolStatus()); } catch { /* silent */ }
    loadNodeHealth();
    for (const gateway of ARWEAVE_DIRECT_GATEWAYS) {
      setGwHealth((prev) => ({ ...prev, [gateway]: "checking" }));
      try {
        const res = await fetch(`${gateway}/info`, { signal: AbortSignal.timeout(5000) });
        setGwHealth((prev) => ({ ...prev, [gateway]: res.ok ? "up" : "down" }));
      } catch { setGwHealth((prev) => ({ ...prev, [gateway]: "down" })); }
    }
  }, [gw, loadNodeHealth]);

  const loadWalletBalance = useCallback(async () => {
    if (!arweaveWallet?.address) { setWalletBal(null); return; }
    try {
      const [bal, turbo] = await Promise.all([
        gw.getBalance(arweaveWallet.address),
        ArweaveGateway.getTurboBalance(arweaveWallet.address).catch(() => null),
      ]);
      setWalletBal({ ar: parseFloat(bal.ar).toFixed(6), turbo: turbo ? turbo.ar : "0" });
    } catch { setWalletBal(null); }
  }, [gw, arweaveWallet]);

  const loadRecentBlocks = useCallback(async () => {
    setBlocksLoading(true);
    try { setBlocks(await gw.getRecentBlocks(15)); }
    catch { setBlocks([]); }
    finally { setBlocksLoading(false); }
  }, [gw]);

  const loadBlockByHeight = useCallback(async () => {
    const h = parseInt(blockHeightInput, 10);
    if (isNaN(h)) return;
    setBlocksLoading(true);
    try {
      const block = await gw.getBlockByHeight(h);
      setBlockDetail(block);
    } catch { setBlockDetail(null); }
    finally { setBlocksLoading(false); }
  }, [gw, blockHeightInput]);

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

  const handleAoExecute = useCallback(async () => {
    const pid = aoProcessId.trim();
    if (!pid) return;

    if (aoSendMode === "send") {
      if (!arweaveWallet?.jwk) { setAoSendResult("No wallet connected — import a JWK first."); return; }
      setAoSending(true); setAoSendResult(null);
      try {
        const tags = aoAction.trim() ? [{ name: "Action", value: aoAction.trim() }] : [];
        const msgId = await sendMessage({ process: pid, tags, data: aoData.trim() || undefined }, arweaveWallet.jwk);
        setAoSendResult(`Message sent: ${msgId}`);
      } catch (e) { setAoSendResult(`Error: ${e instanceof Error ? e.message : String(e)}`); }
      finally { setAoSending(false); }
    } else {
      setAoLoading(true); setAoResult(null);
      try {
        const tags = aoAction.trim() ? [{ name: "Action", value: aoAction.trim() }] : [];
        const result = await dryrun(pid, tags, aoData.trim() || undefined, arweaveWallet?.address);
        setAoResult(result);
      } catch (e) {
        setAoResult({ Messages: [], Spawns: [], Output: { data: `Error: ${e instanceof Error ? e.message : String(e)}` } });
      } finally { setAoLoading(false); }
    }
  }, [aoProcessId, aoAction, aoData, arweaveWallet, aoSendMode]);

  const loadAoTokenBalances = useCallback(async () => {
    if (!arweaveWallet?.address) return;
    setAoTokensLoading(true);
    try {
      const results = await Promise.all(
        Object.entries(AO_TOKENS).map(async ([key, pid]) => {
          try {
            const [info, rawBal] = await Promise.all([
              getTokenInfo(pid),
              getTokenBalance(pid, arweaveWallet.address),
            ]);
            return {
              ...info,
              rawBalance: rawBal,
              balance: formatTokenAmount(rawBal, info.denomination),
            };
          } catch {
            return {
              name: key,
              ticker: key,
              denomination: 0,
              processId: pid,
              rawBalance: "0",
              balance: "0",
            };
          }
        }),
      );
      setAoTokens(results);
    } catch { /* silent */ }
    finally { setAoTokensLoading(false); }
  }, [arweaveWallet]);

  const handleSwRead = useCallback(async () => {
    const id = swContractId.trim();
    if (!id) return;
    setSwLoading(true);
    setSwState(null); setSwAsset(null); setSwPst(null);
    try {
      const state = await readContractState(id);
      setSwState(state);
      const s = state.state as Record<string, unknown>;
      // Auto-detect contract type
      if (s.contentType || s.claimable) {
        setSwAsset(await getAtomicAsset(id));
      }
      if (s.balances && s.ticker) {
        setSwPst(await getPstInfo(id));
      }
    } catch (e) {
      setSwState({ state: { error: e instanceof Error ? e.message : String(e) }, validity: {}, sortKey: "", contractTxId: id });
    } finally { setSwLoading(false); }
  }, [swContractId]);

  useEffect(() => {
    if (tab === "ao" && arweaveWallet) {
      loadAoTokenBalances();
      getVouchScore(arweaveWallet.address).then(setSwVouch).catch(() => setSwVouch(null));
    }
  }, [tab, arweaveWallet, loadAoTokenBalances]);
  useEffect(() => { if (tab === "network") { loadNetworkInfo(); loadArioGateways(); } }, [tab, loadNetworkInfo, loadArioGateways]);
  useEffect(() => { if (tab !== "network") return; const iv = setInterval(loadNetworkInfo, 30000); return () => clearInterval(iv); }, [tab, loadNetworkInfo]);
  useEffect(() => { if (tab === "blocks") loadRecentBlocks(); }, [tab, loadRecentBlocks]);
  useEffect(() => { loadWalletBalance(); }, [loadWalletBalance]);

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
    setBrowseLoading(true); setBrowseData(null); setBrowseMeta(null);
    try {
      const id = await resolveToTxId(input) ?? input;
      if (id !== input) setBrowseTxId(id);
      const [rawResult, txResult] = await Promise.all([
        gw.getRawData(id),
        gw.getTx(id).catch(() => null),
      ]);
      const blob = new Blob([rawResult.data], { type: rawResult.contentType });
      const url = URL.createObjectURL(blob);
      setBrowseData({ url, contentType: rawResult.contentType });
      if (txResult) {
        const decodedTags: ArweaveTag[] = (txResult.tags ?? []).map((t: { name: string; value: string }) => {
          try { return { name: atob(t.name), value: atob(t.value) }; } catch { return t; }
        });
        const status = await gw.getTxStatus(id).catch(() => null);
        setBrowseMeta({
          owner: txResult.owner || "",
          fee: winstonToAr(txResult.reward || "0"),
          quantity: winstonToAr(txResult.quantity || "0"),
          block: status?.block_height ? { height: status.block_height, timestamp: status.block_indep_hash ? 0 : 0 } : undefined,
          tags: decodedTags,
        });
      }
      setBrowseHistory((prev) => [input, ...prev.filter((h) => h !== input && h !== id)].slice(0, 20));
    } catch (e) { console.error("Browse failed:", e); }
    finally { setBrowseLoading(false); }
  }, [gw, browseTxId]);


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
      {/* Wallet status bar */}
      {arweaveWallet && (
        <div className={`${card} px-4 py-2.5 flex items-center gap-4 text-xs`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white/40 font-mono">{arweaveWallet.address.slice(0, 6)}...{arweaveWallet.address.slice(-4)}</span>
          </div>
          {walletBal && (
            <>
              <span className="h-3 w-px bg-white/10" />
              <span className="text-white/50"><span className="text-white/80 font-medium">{walletBal.ar}</span> AR</span>
              {walletBal.turbo !== "0" && (
                <>
                  <span className="h-3 w-px bg-white/10" />
                  <span className="text-white/50"><span className="text-white/80 font-medium">{walletBal.turbo}</span> Turbo</span>
                </>
              )}
            </>
          )}
          <span className="h-3 w-px bg-white/10" />
          {ARWEAVE_PRIMARY_GATEWAY ? (
            <button
              type="button"
              onClick={() => setTab("network")}
              className="inline-flex items-center gap-1.5 text-purple-300/70 hover:text-purple-300 transition-colors cursor-pointer"
              title={`Reads served by ${ARWEAVE_PRIMARY_GATEWAY}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${nodeHealth?.primary?.healthy ? "bg-emerald-400" : "bg-yellow-400"}`} />
              <span className="font-mono text-[10px]">{ARWEAVE_PRIMARY_GATEWAY.replace(/^https?:\/\//, "")}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setTab("network")}
              className="inline-flex items-center gap-1.5 text-white/30 hover:text-white/60 transition-colors cursor-pointer"
              title="Self-hosted gateway not configured"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
              <span className="text-[10px] uppercase tracking-wider">Self-host →</span>
            </button>
          )}
          <span className="ml-auto text-white/20">|</span>
          <a href="/wallets" className="text-purple-400/60 hover:text-purple-300 text-[10px] uppercase tracking-wider transition-colors">Wallet</a>
          <a href="/permawrite" className="text-purple-400/60 hover:text-purple-300 text-[10px] uppercase tracking-wider transition-colors">PermaWrite</a>
        </div>
      )}
      {!arweaveWallet && (
        <div className={`${card} px-4 py-2.5 flex items-center gap-3 text-xs`}>
          <span className="w-2 h-2 rounded-full bg-yellow-400/60" />
          <span className="text-white/40">No Arweave wallet connected</span>
          <a href="/wallets" className="ml-auto text-purple-400/60 hover:text-purple-300 text-[10px] uppercase tracking-wider transition-colors">Set Up Wallet</a>
        </div>
      )}

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
          {/* ============ MY GATEWAY NODE (self-hosted ar.io) ============ */}
          <div
            className={`${card} p-5 relative overflow-hidden`}
            style={{
              background:
                "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(255,255,255,0.03) 60%)",
              borderColor: nodeHealth?.primary?.healthy
                ? "rgba(52,211,153,0.25)"
                : ARWEAVE_PRIMARY_GATEWAY
                  ? "rgba(251,146,60,0.25)"
                  : "rgba(255,255,255,0.06)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                  My Gateway Node
                </span>
                {ARWEAVE_PRIMARY_GATEWAY ? (
                  nodeHealth?.primary ? (
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded-full font-semibold border ${
                        nodeHealth.primary.healthy
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}
                    >
                      {nodeHealth.primary.healthy
                        ? nodeHealth.primary.syncLag != null && nodeHealth.primary.syncLag > 50
                          ? "SYNCING"
                          : "LIVE"
                        : "DOWN"}
                    </span>
                  ) : (
                    <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                      CHECKING
                    </span>
                  )
                ) : (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-white/[0.04] text-white/40 border border-white/[0.08]">
                    NOT CONFIGURED
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={loadNodeHealth}
                disabled={nodeLoading}
                className={pillBtn}
              >
                {nodeLoading ? (
                  <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Refresh"
                )}
              </button>
            </div>

            {!ARWEAVE_PRIMARY_GATEWAY && (
              <div className="space-y-3">
                <p className="text-xs text-white/50 leading-relaxed">
                  Running our own Arweave gateway means nothing we care about can be
                  censored, throttled, or quietly removed by a third party. Deploy
                  the ar.io node in <code className="px-1 py-0.5 rounded bg-white/[0.06] font-mono text-[10px] text-white/70">infra/arweave-gateway/</code>,
                  then set{" "}
                  <code className="px-1 py-0.5 rounded bg-white/[0.06] font-mono text-[10px] text-white/70">
                    NEXT_PUBLIC_ARWEAVE_PRIMARY_GATEWAY
                  </code>{" "}
                  to start serving every read through it.
                </p>
                <div className="flex gap-2">
                  <a
                    href="https://github.com/shanecloonan/cloonan-group/blob/main/infra/arweave-gateway/README.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={pillBtn}
                  >
                    Deployment Guide
                  </a>
                </div>
              </div>
            )}

            {ARWEAVE_PRIMARY_GATEWAY && nodeHealth?.primary && (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-purple-400/80 shrink-0" />
                  <a
                    href={nodeHealth.primary.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-purple-300/80 hover:text-purple-300 truncate"
                  >
                    {nodeHealth.primary.url.replace(/^https?:\/\//, "")}
                  </a>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-2xl font-bold text-white tracking-tight tabular-nums">
                      {nodeHealth.primary.height != null
                        ? nodeHealth.primary.height.toLocaleString()
                        : "—"}
                    </p>
                    <p className="text-[10px] text-white/30 mt-0.5 uppercase">Node Height</p>
                  </div>
                  <div>
                    <p
                      className={`text-2xl font-bold tracking-tight tabular-nums ${
                        nodeHealth.primary.syncLag != null && nodeHealth.primary.syncLag > 50
                          ? "text-yellow-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {nodeHealth.primary.syncLag != null
                        ? nodeHealth.primary.syncLag === 0
                          ? "0"
                          : `-${nodeHealth.primary.syncLag.toLocaleString()}`
                        : "—"}
                    </p>
                    <p className="text-[10px] text-white/30 mt-0.5 uppercase">Sync Lag</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white tracking-tight tabular-nums">
                      {nodeHealth.primary.latencyMs}
                      <span className="text-sm font-semibold text-white/40">ms</span>
                    </p>
                    <p className="text-[10px] text-white/30 mt-0.5 uppercase">Latency</p>
                  </div>
                  <div>
                    <p
                      className={`text-2xl font-bold tracking-tight tabular-nums ${
                        nodeHealth.primary.blockList === 0
                          ? "text-emerald-400"
                          : nodeHealth.primary.blockList == null
                            ? "text-white/40"
                            : "text-yellow-400"
                      }`}
                    >
                      {nodeHealth.primary.blockList != null
                        ? nodeHealth.primary.blockList
                        : "—"}
                    </p>
                    <p className="text-[10px] text-white/30 mt-0.5 uppercase">Blocklist</p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/[0.04] flex items-start gap-2">
                  <span className="w-1 h-1 mt-1.5 rounded-full bg-purple-400/60 shrink-0" />
                  <p className="text-[11px] text-white/40 leading-relaxed">
                    {nodeHealth.primary.blockList === 0
                      ? "Blocklist is empty — this gateway serves every transaction on Arweave without filtering."
                      : nodeHealth.primary.blockList == null
                        ? "Admin API key not configured server-side, so the public blocklist size can't be verified from the browser. Set ARWEAVE_GATEWAY_ADMIN_KEY in Vercel to display it."
                        : `This gateway has ${nodeHealth.primary.blockList} entries on its local blocklist. Edit via /ar-io/admin/block-list.`}
                  </p>
                </div>

                {clientPoolStats.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/[0.04]">
                    <p className="text-[10px] text-white/30 uppercase mb-2">Last reads served by</p>
                    <div className="flex flex-wrap gap-1.5">
                      {clientPoolStats.slice(0, 6).map((s) => (
                        <span
                          key={s.url}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono border ${
                            s.role === "primary"
                              ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
                              : "bg-white/[0.03] text-white/40 border-white/[0.06]"
                          }`}
                          title={`${s.wins} wins / ${s.losses} losses, last ${s.lastLatencyMs}ms`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              (s.lastError ? "bg-red-400" : "bg-emerald-400")
                            }`}
                          />
                          {s.url.replace(/^https?:\/\//, "")}
                          <span className="text-white/25">·</span>
                          <span className="tabular-nums">{s.wins}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

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
            <p className="text-[10px] text-white/25 leading-relaxed">
              {ARWEAVE_PRIMARY_GATEWAY
                ? "Reads route primary node → peer pool → public gateways. The self-hosted node is hit first for every request; pool members only serve as failover."
                : "Reads currently route peer pool → public gateways. Configure NEXT_PUBLIC_ARWEAVE_PRIMARY_GATEWAY to promote our own node to the top of the waterfall."}
            </p>
          </div>
        </div>
      )}

      {/* BLOCKS */}
      {tab === "blocks" && (
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Block Explorer</span>
              <button type="button" onClick={loadRecentBlocks} disabled={blocksLoading} className={pillBtn}>
                {blocksLoading ? <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" /> : "Refresh"}
              </button>
            </div>
            <div className="flex gap-2 mb-4">
              <input value={blockHeightInput} onChange={(e) => setBlockHeightInput(e.target.value)} placeholder="Jump to block height..." className={`flex-1 ${inputCls}`} onKeyDown={(e) => e.key === "Enter" && loadBlockByHeight()} />
              <button type="button" onClick={loadBlockByHeight} disabled={blocksLoading} className={btnPrimary}>Go</button>
            </div>
          </div>

          {blockDetail && (
            <div className={`${card} p-5 space-y-3`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Block #{blockDetail.height.toLocaleString()}</span>
                <button type="button" onClick={() => setBlockDetail(null)} className={pillBtn}>Close</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-[10px] text-white/30 uppercase">Height</span><p className="text-sm font-bold text-white tabular-nums">{blockDetail.height.toLocaleString()}</p></div>
                <div><span className="text-[10px] text-white/30 uppercase">Timestamp</span><p className="text-sm text-white/60">{new Date(blockDetail.timestamp * 1000).toLocaleString()}</p></div>
                <div><span className="text-[10px] text-white/30 uppercase">Transactions</span><p className="text-sm font-bold text-white tabular-nums">{blockDetail.txs?.length ?? 0}</p></div>
                <div><span className="text-[10px] text-white/30 uppercase">Block Size</span><p className="text-sm text-white/60">{formatBytes(blockDetail.block_size)}</p></div>
                <div><span className="text-[10px] text-white/30 uppercase">Weave Size</span><p className="text-sm text-white/60">{formatBytes(blockDetail.weave_size)}</p></div>
                <div><span className="text-[10px] text-white/30 uppercase">Reward Pool</span><p className="text-sm text-white/60">{winstonToAr(String(blockDetail.reward_pool))} AR</p></div>
              </div>
              <div>
                <span className="text-[10px] text-white/30 uppercase">Miner</span>
                <p className="text-xs font-mono text-white/40 break-all mt-0.5">{blockDetail.reward_addr}</p>
              </div>
              <div>
                <span className="text-[10px] text-white/30 uppercase">Block Hash</span>
                <p className="text-xs font-mono text-white/40 break-all mt-0.5">{blockDetail.indep_hash}</p>
              </div>
              {blockDetail.txs && blockDetail.txs.length > 0 && (
                <div>
                  <span className="text-[10px] text-white/30 uppercase">Transaction IDs ({blockDetail.txs.length})</span>
                  <div className="mt-1 max-h-[200px] overflow-y-auto space-y-0.5" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                    {blockDetail.txs.map((txId) => (
                      <button key={txId} type="button" onClick={() => { setBrowseTxId(txId); setTab("browser"); loadBrowseData(txId); }} className="block w-full text-left text-[11px] font-mono text-purple-300/50 hover:text-purple-300 py-1 px-2 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer truncate">
                        {txId}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                {blockDetail.height > 0 && (
                  <button type="button" onClick={() => { setBlockHeightInput(String(blockDetail.height - 1)); gw.getBlockByHeight(blockDetail.height - 1).then(setBlockDetail).catch(() => {}); }} className={pillBtn}>Prev Block</button>
                )}
                <button type="button" onClick={() => { setBlockHeightInput(String(blockDetail.height + 1)); gw.getBlockByHeight(blockDetail.height + 1).then(setBlockDetail).catch(() => {}); }} className={pillBtn}>Next Block</button>
              </div>
            </div>
          )}

          {blocks.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider px-1">Recent Blocks</span>
              {blocks.map((block) => (
                <button key={block.indep_hash} type="button" onClick={() => { setBlockDetail(block); setBlockHeightInput(String(block.height)); }} className={`w-full text-left ${card} px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer`}>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-bold text-white tabular-nums">#{block.height.toLocaleString()}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">{relativeTime(block.timestamp)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-white/40">{block.txs?.length ?? 0} txs</span>
                        <span className="text-[10px] text-white/30">{formatBytes(block.block_size)}</span>
                      </div>
                      <p className="text-[10px] font-mono text-white/20 truncate mt-0.5">{block.indep_hash}</p>
                    </div>
                    <span className="text-white/15 text-sm shrink-0">▸</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {blocks.length === 0 && !blocksLoading && (
            <div className={`${card} p-10 text-center`}><p className="text-sm text-white/30">Click Refresh to load recent blocks.</p></div>
          )}
          {blocksLoading && blocks.length === 0 && (
            <div className={`${card} p-10 text-center`}><div className="w-5 h-5 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" /><p className="text-xs text-white/30">Loading blocks...</p></div>
          )}
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
                  <a href={`https://viewblock.io/arweave/tx/${browseTxId.trim()}`} target="_blank" rel="noopener noreferrer" className={pillBtn}>ViewBlock</a>
                </div>
              </div>
              {/* TX Metadata Panel */}
              {browseMeta && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                  <div><span className="text-[10px] text-white/25 uppercase">Owner</span><p className="text-[11px] font-mono text-white/40 truncate">{browseMeta.owner ? `${browseMeta.owner.slice(0, 10)}...` : "—"}</p></div>
                  <div><span className="text-[10px] text-white/25 uppercase">Fee</span><p className="text-[11px] text-white/50">{parseFloat(browseMeta.fee).toFixed(8)} AR</p></div>
                  <div><span className="text-[10px] text-white/25 uppercase">Quantity</span><p className="text-[11px] text-white/50">{browseMeta.quantity === "0.000000000000" ? "—" : `${browseMeta.quantity} AR`}</p></div>
                  <div><span className="text-[10px] text-white/25 uppercase">Block</span><p className="text-[11px] text-white/50">{browseMeta.block ? `#${browseMeta.block.height.toLocaleString()}` : "Pending"}</p></div>
                </div>
              )}
              {browseMeta && browseMeta.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {browseMeta.tags.map((t, i) => (
                    <span key={i} className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/35">{t.name}: {t.value.length > 40 ? t.value.slice(0, 40) + "..." : t.value}</span>
                  ))}
                </div>
              )}
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
          <div className={`${card} p-4`}>
            <p className="text-xs text-white/30 leading-relaxed">
              Upload files or text permanently to Arweave. Choose Turbo for instant confirmation via bundling, or Standard (L1) for direct on-chain posting.
            </p>
          </div>
          <UnifiedUpload />
        </div>
      )}

      {/* HISTORY */}
      {tab === "history" && <ArweaveHistory />}

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

      {/* AO (Arweave Operating System) */}
      {tab === "ao" && (
        <div className="space-y-4">
          {/* Token Balances */}
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">AO Token Balances</span>
              <button type="button" onClick={loadAoTokenBalances} disabled={aoTokensLoading || !arweaveWallet} className={pillBtn}>
                {aoTokensLoading ? <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" /> : "Refresh"}
              </button>
            </div>

            {!arweaveWallet && (
              <p className="text-xs text-white/30 text-center py-4">Connect an Arweave wallet to view AO token balances.</p>
            )}

            {arweaveWallet && aoTokens.length > 0 && (
              <div className="space-y-2">
                {aoTokens.map((token) => (
                  <div key={token.processId} className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center text-[11px] font-bold text-cyan-300/60 shrink-0">
                      {token.ticker.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-white/70">{token.name}</span>
                        <span className="text-[10px] text-white/25">{token.ticker}</span>
                      </div>
                      <p className="text-[10px] font-mono text-white/20 truncate">{token.processId}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-white tabular-nums">{token.balance}</p>
                      {token.rawBalance && token.rawBalance !== "0" && token.denomination > 0 && (
                        <p className="text-[10px] text-white/20 tabular-nums">{token.rawBalance} raw</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {arweaveWallet && aoTokens.length === 0 && !aoTokensLoading && (
              <p className="text-xs text-white/30 text-center py-4">Click Refresh to load token balances.</p>
            )}
          </div>

          {/* AO Process Console */}
          <div className={`${card} p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">AO Process Console</span>
              <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.04]">
                <button type="button" onClick={() => setAoSendMode("dryrun")} className={`px-3 py-1 rounded-md text-[10px] font-medium transition-all cursor-pointer ${aoSendMode === "dryrun" ? "bg-purple-500/20 text-purple-300" : "text-white/40 hover:text-white/60"}`}>
                  Dryrun (Read)
                </button>
                <button type="button" onClick={() => setAoSendMode("send")} className={`px-3 py-1 rounded-md text-[10px] font-medium transition-all cursor-pointer ${aoSendMode === "send" ? "bg-emerald-500/20 text-emerald-300" : "text-white/40 hover:text-white/60"}`}>
                  Send (Write)
                </button>
              </div>
            </div>
            <p className="text-[10px] text-white/20 -mt-1">
              {aoSendMode === "dryrun"
                ? "Read-only evaluation — no wallet needed, no on-chain effect."
                : "Sends a signed message on-chain via the MU. Requires a connected wallet."}
            </p>

            <div>
              <label className="block text-white/40 text-xs font-medium uppercase tracking-wider mb-1">Process ID</label>
              <input value={aoProcessId} onChange={(e) => setAoProcessId(e.target.value)} placeholder="Process ID (e.g. ARIO token address)..." className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-white/40 text-xs font-medium uppercase tracking-wider mb-1">Action Tag</label>
                <input value={aoAction} onChange={(e) => setAoAction(e.target.value)} placeholder="Info, Balance, Transfer..." className={inputCls} />
              </div>
              <div>
                <label className="block text-white/40 text-xs font-medium uppercase tracking-wider mb-1">Data (optional)</label>
                <input value={aoData} onChange={(e) => setAoData(e.target.value)} placeholder="Optional message data..." className={inputCls} />
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={handleAoExecute} disabled={(aoLoading || aoSending) || !aoProcessId.trim()} className={`flex-1 ${aoSendMode === "send" ? "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer" : btnPrimary}`}>
                {aoLoading || aoSending ? "Processing..." : aoSendMode === "dryrun" ? "Dryrun" : "Send Message"}
              </button>
              {Object.entries(AO_TOKENS).slice(0, 3).map(([key, pid]) => (
                <button key={key} type="button" onClick={() => { setAoProcessId(pid); setAoAction("Info"); }} className={pillBtn}>
                  {key}
                </button>
              ))}
            </div>

            {aoSendResult && (
              <div className={`p-3 rounded-xl text-xs font-mono break-all ${aoSendResult.startsWith("Error") ? "bg-red-500/10 border border-red-500/20 text-red-300/70" : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300/70"}`}>
                {aoSendResult}
              </div>
            )}
          </div>

          {/* Dryrun Result */}
          {aoResult && (
            <div className={`${card} p-5 space-y-3`}>
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Result</span>

              {aoResult.Output?.data && (
                <div>
                  <span className="text-[10px] text-white/20 uppercase font-medium">Output</span>
                  <pre className="mt-1 p-3 rounded-lg bg-black/20 text-xs text-white/50 font-mono overflow-auto max-h-[200px] whitespace-pre-wrap break-all" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                    {aoResult.Output.data}
                  </pre>
                </div>
              )}

              {aoResult.Messages.length > 0 && aoResult.Messages.map((msg, i) => (
                <div key={i} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-cyan-300/40 uppercase font-medium">Message {i + 1}</span>
                    {msg.Target && <span className="text-[10px] text-white/20 font-mono truncate">→ {msg.Target.slice(0, 12)}...</span>}
                  </div>
                  {msg.Tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.Tags.map((t, j) => (
                        <span key={j} className="text-[9px] px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300/50">
                          {t.name}: {t.value.length > 30 ? t.value.slice(0, 30) + "..." : t.value}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.Data && (
                    <pre className="p-2 rounded bg-black/20 text-[11px] text-white/40 font-mono overflow-auto max-h-[150px] whitespace-pre-wrap break-all" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                      {msg.Data.length > 2000 ? msg.Data.slice(0, 2000) + "\n..." : msg.Data}
                    </pre>
                  )}
                </div>
              ))}

              {aoResult.Messages.length === 0 && !aoResult.Output?.data && (
                <p className="text-xs text-white/30 text-center py-2">No output returned.</p>
              )}
            </div>
          )}

          {/* Vouch Score */}
          {swVouch && arweaveWallet && (
            <div className={`${card} p-4`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Vouch Protocol</span>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${swVouch.vouched ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/5 text-white/30 border border-white/10"}`}>
                  {swVouch.vouched ? `VOUCHED (${swVouch.score})` : "NOT VOUCHED"}
                </span>
              </div>
              {swVouch.vouched && swVouch.vouchers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {swVouch.vouchers.map((v) => (
                    <span key={v} className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/5 border border-emerald-500/10 text-emerald-400/50 font-mono">
                      {v.slice(0, 8)}...{v.slice(-4)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SmartWeave Contract Reader */}
          <div className={`${card} p-5 space-y-3`}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">SmartWeave Contract Reader</span>
            <p className="text-[10px] text-white/20 -mt-1">Read state of any SmartWeave contract via the Warp DRE network.</p>

            <div className="flex gap-2">
              <input
                value={swContractId}
                onChange={(e) => setSwContractId(e.target.value)}
                placeholder="Contract TX ID..."
                className={`flex-1 ${inputCls}`}
                onKeyDown={(e) => e.key === "Enter" && handleSwRead()}
              />
              <button type="button" onClick={handleSwRead} disabled={swLoading || !swContractId.trim()} className={btnPrimary}>
                {swLoading ? "Reading..." : "Read"}
              </button>
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(KNOWN_CONTRACTS).map(([key, id]) => (
                <button key={key} type="button" onClick={() => { setSwContractId(id); }} className={pillBtn}>
                  {key}
                </button>
              ))}
            </div>
          </div>

          {/* Atomic Asset Display */}
          {swAsset && (
            <div className={`${card} p-5 space-y-3`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Atomic Asset</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 font-semibold">NFT</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-[10px] text-white/25 uppercase">Title</span><p className="text-xs text-white/60">{swAsset.title}</p></div>
                <div><span className="text-[10px] text-white/25 uppercase">Ticker</span><p className="text-xs text-white/60">{swAsset.ticker}</p></div>
                <div><span className="text-[10px] text-white/25 uppercase">Type</span><p className="text-xs text-white/60">{swAsset.contentType || swAsset.type}</p></div>
                <div><span className="text-[10px] text-white/25 uppercase">Owner</span><p className="text-xs text-white/60 font-mono truncate">{swAsset.owner.slice(0, 12)}...</p></div>
              </div>
              {swAsset.description && <p className="text-[11px] text-white/30">{swAsset.description}</p>}
              <div className="flex gap-2">
                <a href={swAsset.contentUrl} target="_blank" rel="noopener noreferrer" className={pillBtn}>View Content</a>
                <a href={getSonarUrl(swAsset.contractTxId)} target="_blank" rel="noopener noreferrer" className={pillBtn}>Sonar</a>
              </div>
            </div>
          )}

          {/* PST Display */}
          {swPst && !swAsset && (
            <div className={`${card} p-5 space-y-3`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Profit Sharing Token</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold">PST</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><span className="text-[10px] text-white/25 uppercase">Name</span><p className="text-xs text-white/60">{swPst.name}</p></div>
                <div><span className="text-[10px] text-white/25 uppercase">Ticker</span><p className="text-xs text-white/60">{swPst.ticker}</p></div>
                <div><span className="text-[10px] text-white/25 uppercase">Supply</span><p className="text-xs text-white/60 tabular-nums">{swPst.totalSupply.toLocaleString()}</p></div>
              </div>
              {Object.keys(swPst.balances).length > 0 && (
                <div>
                  <span className="text-[10px] text-white/25 uppercase">Top Holders</span>
                  <div className="mt-1 space-y-1 max-h-[150px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                    {Object.entries(swPst.balances)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 10)
                      .map(([addr, bal]) => (
                        <div key={addr} className="flex items-center gap-2 text-[11px]">
                          <span className="font-mono text-white/30 truncate flex-1">{addr}</span>
                          <span className="text-white/50 tabular-nums shrink-0">{bal.toLocaleString()} {swPst.ticker}</span>
                          <span className="text-[10px] text-white/20 shrink-0">({(bal / swPst.totalSupply * 100).toFixed(1)}%)</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              <a href={getSonarUrl(swPst.contractTxId)} target="_blank" rel="noopener noreferrer" className={pillBtn}>View on Sonar</a>
            </div>
          )}

          {/* Raw State */}
          {swState && !swAsset && !swPst && (
            <div className={`${card} p-5 space-y-3`}>
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Contract State</span>
              <pre className="p-3 rounded-lg bg-black/20 text-[11px] text-white/40 font-mono overflow-auto max-h-[300px] whitespace-pre-wrap break-all" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                {JSON.stringify(swState.state, null, 2).slice(0, 5000)}
              </pre>
              <a href={getSonarUrl(swState.contractTxId)} target="_blank" rel="noopener noreferrer" className={pillBtn}>View on Sonar</a>
            </div>
          )}
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
