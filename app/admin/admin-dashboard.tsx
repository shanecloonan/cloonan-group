"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet-context";
import { supabase } from "@/lib/supabase";
import { ethers } from "ethers";
import { RPC_URL } from "@/lib/config";
import {
  DAPP_META,
  ACTION_LABELS,
  type DApp,
  type TxRecord,
} from "@/lib/activity";

/* ------------------------------------------------------------------ */
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls =
  "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-blue-400/60 focus:ring-1 focus:ring-blue-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary =
  "h-11 px-5 rounded-xl font-semibold text-sm bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center";

/* ------------------------------------------------------------------ */
/*  Platform contracts                                                 */
/* ------------------------------------------------------------------ */

const CONTRACTS = [
  { name: "MONEY Token", address: "0x100DB67F41A2dF3c32cC7c0955694b98339B7311", category: "Token" },
  { name: "Fund Launcher (ETF)", address: "0x6B440ADBA6085b68e2677Ce77dC65bbAc39005d8", category: "Factory" },
  { name: "Dividends Launcher", address: "0x5ef0404f344e9c0ff2ab83b44d8827a78db7128a", category: "Factory" },
  { name: "Coin Launcher", address: "0x059490a29e7059f30bac2350a46f9d49ff3800b5", category: "Factory" },
  { name: "DAO Launcher", address: "0xc346ecabc9d5c6fb943231c4b9d73ca91178545a", category: "Factory" },
  { name: "Multiswap Launcher", address: "0x40af76d95100372232a9fe2ddd92de7e103eb2db", category: "Factory" },
  { name: "Ad-space Launcher", address: "0xE01FE1C2A22736da756BDc2C9144464E8A73fCd7", category: "Factory" },
  { name: "Multisig Launcher", address: "0x9eb611624425239ac6f41e3a55c8f1cce8bde32d", category: "Factory" },
  { name: "Storefront Launcher", address: "0x15a3c66121b927f38bffef5d8017370aaf46ab68", category: "Factory" },
  { name: "MoneyFund Multiswap", address: "0xDfEa3460341A5D3e8B034607dd60D10bcEE4cFc9", category: "Live" },
  { name: "MoneyFund DAO", address: "0x8cf5e3797aabb62698f9c4a3f0234667fd981754", category: "Live" },
  { name: "MoneyFund DEX", address: "0xc79c7dbf7ac78fd5307a4631131b0a4e98e902c7", category: "Live" },
  { name: "MoneyFund Dividends", address: "0xab18bbaf4e7e04a120d031129a47e27be04b86bf", category: "Live" },
  { name: "MoneyFund Airdropper", address: "0x6785cd86a65f3d8336fdc3b0e54c78215501dca2", category: "Live" },
  { name: "Arweave", address: "eS5YbYQhuDOjDttzgM2YP7_26q37k_Me5czIoMwVlfw", category: "Arweave" },
  { name: "Solana Wormhole", address: "Hi3w7Niu46dxwk8not3LihcFT4Aa4yMvLSGECykE9iEp", category: "Solana" },
];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

interface AdminWallet {
  user_id: string;
  chain: string;
  address: string;
  wallet_type: string;
  created_at: string;
}

interface WalletBalance {
  address: string;
  balance: string;
  loading: boolean;
}

interface TxStat {
  dapp: string;
  action: string;
  status: string;
  cnt: number;
}

interface ForumSummary {
  total_categories: number;
  total_threads: number;
  total_replies: number;
  total_likes: number;
  total_reports: number;
}

interface ForumThread {
  id: string;
  category_name: string;
  author_email: string;
  title: string;
  status: string;
  likes_count: number;
  replies_count: number;
  reports_count: number;
  created_at: string;
}

interface SupportMsg {
  id: string;
  user_email: string | null;
  name: string;
  email: string;
  subject: string;
  body: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
}

interface ContactMsg {
  id: string;
  user_email: string | null;
  message: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
}

interface UserEngagement {
  user_id: string;
  user_email: string;
  username: string;
  forum_threads: number;
  forum_replies: number;
  forum_likes: number;
  forum_tier: string;
  current_points: number;
  lifetime_points: number;
  store_credits_cents: number;
  referrals_made: number;
}

interface ContractBalance {
  address: string;
  balance: string;
  loading: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const TIER_COLORS: Record<string, string> = {
  bronze: "text-orange-400/70",
  silver: "text-gray-300",
  gold: "text-amber-400",
  platinum: "text-cyan-300",
  diamond: "text-purple-300",
};

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

type Tab = "overview" | "users" | "activity" | "contracts" | "forum" | "support";

export default function AdminDashboard() {
  const { user, isAdmin, isLoading } = useWallet();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("overview");

  // Core data
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [wallets, setWallets] = useState<AdminWallet[]>([]);
  const [balances, setBalances] = useState<Record<string, WalletBalance>>({});
  const [txStats, setTxStats] = useState<TxStat[]>([]);
  const [engagement, setEngagement] = useState<UserEngagement[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Forum data
  const [forumSummary, setForumSummary] = useState<ForumSummary | null>(null);
  const [forumThreads, setForumThreads] = useState<ForumThread[]>([]);
  const [forumLoading, setForumLoading] = useState(true);

  // Support data
  const [supportMsgs, setSupportMsgs] = useState<SupportMsg[]>([]);
  const [contactMsgs, setContactMsgs] = useState<ContactMsg[]>([]);
  const [supportLoading, setSupportLoading] = useState(true);

  // Contract balances
  const [contractBalances, setContractBalances] = useState<Record<string, ContractBalance>>({});

  // Activity state
  const [activities, setActivities] = useState<TxRecord[]>([]);
  const [actTotal, setActTotal] = useState(0);
  const [actLoading, setActLoading] = useState(false);
  const [actDapp, setActDapp] = useState<DApp | "">("");
  const [actSearch, setActSearch] = useState("");
  const [actFrom, setActFrom] = useState("");
  const [actTo, setActTo] = useState("");
  const [actUser, setActUser] = useState("");
  const [actPage, setActPage] = useState(0);
  const ACT_PER_PAGE = 25;

  const provider = useMemo(
    () => new ethers.providers.JsonRpcProvider(RPC_URL),
    [],
  );

  /* ------------------------------------------------------------------ */
  /*  Load core admin data                                               */
  /* ------------------------------------------------------------------ */

  const loadAdminData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [usersRes, walletsRes, txStatsRes, engageRes] = await Promise.all([
        supabase.rpc("admin_get_users"),
        supabase.rpc("admin_get_wallets"),
        supabase.rpc("admin_get_tx_stats"),
        supabase.rpc("admin_get_user_engagement"),
      ]);
      if (usersRes.data) setUsers(usersRes.data as AdminUser[]);
      if (walletsRes.data) setWallets(walletsRes.data as AdminWallet[]);
      if (txStatsRes.data) setTxStats(txStatsRes.data as TxStat[]);
      if (engageRes.data) setEngagement(engageRes.data as UserEngagement[]);
    } catch {
      /* silent */
    } finally {
      setLoadingData(false);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Load forum data                                                    */
  /* ------------------------------------------------------------------ */

  const loadForumData = useCallback(async () => {
    setForumLoading(true);
    try {
      const [sumRes, threadsRes] = await Promise.all([
        supabase.rpc("admin_get_forum_summary"),
        supabase.rpc("admin_get_forum_threads"),
      ]);
      if (sumRes.data && sumRes.data.length > 0)
        setForumSummary(sumRes.data[0] as ForumSummary);
      if (threadsRes.data) setForumThreads(threadsRes.data as ForumThread[]);
    } catch {
      /* silent */
    } finally {
      setForumLoading(false);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Load support data                                                  */
  /* ------------------------------------------------------------------ */

  const loadSupportData = useCallback(async () => {
    setSupportLoading(true);
    try {
      const [supRes, conRes] = await Promise.all([
        supabase.rpc("admin_get_support_messages"),
        supabase.rpc("admin_get_contact_messages"),
      ]);
      if (supRes.data) setSupportMsgs(supRes.data as SupportMsg[]);
      if (conRes.data) setContactMsgs(conRes.data as ContactMsg[]);
    } catch {
      /* silent */
    } finally {
      setSupportLoading(false);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Load ETH balances for user wallets                                 */
  /* ------------------------------------------------------------------ */

  const loadBalances = useCallback(
    async (wList: AdminWallet[]) => {
      const ethWallets = wList.filter((w) => w.chain === "ethereum");
      const unique = [...new Set(ethWallets.map((w) => w.address))];

      const initial: Record<string, WalletBalance> = {};
      for (const addr of unique)
        initial[addr] = { address: addr, balance: "0", loading: true };
      setBalances(initial);

      const batchSize = 5;
      for (let i = 0; i < unique.length; i += batchSize) {
        const batch = unique.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (addr) => {
            const bal = await provider.getBalance(addr);
            return { addr, balance: ethers.utils.formatEther(bal) };
          }),
        );
        setBalances((prev) => {
          const next = { ...prev };
          for (const r of results) {
            if (r.status === "fulfilled") {
              next[r.value.addr] = {
                address: r.value.addr,
                balance: r.value.balance,
                loading: false,
              };
            }
          }
          return next;
        });
      }
    },
    [provider],
  );

  /* ------------------------------------------------------------------ */
  /*  Load contract balances                                             */
  /* ------------------------------------------------------------------ */

  const loadContractBalances = useCallback(async () => {
    const ethContracts = CONTRACTS.filter(
      (c) => c.address.startsWith("0x"),
    );

    const initial: Record<string, ContractBalance> = {};
    for (const c of ethContracts)
      initial[c.address] = { address: c.address, balance: "0", loading: true };
    setContractBalances(initial);

    const batchSize = 4;
    for (let i = 0; i < ethContracts.length; i += batchSize) {
      const batch = ethContracts.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (c) => {
          const bal = await provider.getBalance(c.address);
          return { addr: c.address, balance: ethers.utils.formatEther(bal) };
        }),
      );
      setContractBalances((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.status === "fulfilled") {
            next[r.value.addr] = {
              address: r.value.addr,
              balance: r.value.balance,
              loading: false,
            };
          }
        }
        return next;
      });
    }
  }, [provider]);

  /* ------------------------------------------------------------------ */
  /*  Load all activity                                                  */
  /* ------------------------------------------------------------------ */

  const loadActivity = useCallback(
    async (page = 0) => {
      setActLoading(true);
      try {
        const { data } = await supabase.rpc("admin_get_all_activity", {
          p_dapp: actDapp || null,
          p_search: actSearch || null,
          p_from: actFrom || null,
          p_to: actTo ? actTo + "T23:59:59Z" : null,
          p_user_id: actUser || null,
          p_limit: ACT_PER_PAGE,
          p_offset: page * ACT_PER_PAGE,
        });
        if (data && data.length > 0) {
          setActivities(data as TxRecord[]);
          setActTotal(
            (data as { total_count: number }[])[0]?.total_count ?? 0,
          );
        } else {
          setActivities([]);
          setActTotal(0);
        }
        setActPage(page);
      } catch {
        /* silent */
      } finally {
        setActLoading(false);
      }
    },
    [actDapp, actSearch, actFrom, actTo, actUser],
  );

  /* ------------------------------------------------------------------ */
  /*  Effects                                                            */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!isLoading && (!user || !isAdmin)) router.replace("/");
  }, [user, isAdmin, isLoading, router]);

  useEffect(() => {
    if (user && isAdmin) loadAdminData();
  }, [user, isAdmin, loadAdminData]);

  useEffect(() => {
    if (wallets.length > 0) loadBalances(wallets);
  }, [wallets, loadBalances]);

  useEffect(() => {
    if (user && isAdmin && tab === "activity") loadActivity(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, tab]);

  useEffect(() => {
    if (user && isAdmin && tab === "forum") loadForumData();
  }, [user, isAdmin, tab, loadForumData]);

  useEffect(() => {
    if (user && isAdmin && tab === "support") loadSupportData();
  }, [user, isAdmin, tab, loadSupportData]);

  useEffect(() => {
    if (user && isAdmin && tab === "contracts") loadContractBalances();
  }, [user, isAdmin, tab, loadContractBalances]);

  /* ------------------------------------------------------------------ */
  /*  Computed stats                                                     */
  /* ------------------------------------------------------------------ */

  const ethWallets = wallets.filter((w) => w.chain === "ethereum");
  const arWallets = wallets.filter((w) => w.chain === "arweave");
  const vanityWallets = ethWallets.filter((w) =>
    w.address.toLowerCase().startsWith("0x100"),
  );
  const vanityPct =
    ethWallets.length > 0
      ? ((vanityWallets.length / ethWallets.length) * 100).toFixed(1)
      : "0.0";

  const totalEthBalance = Object.values(balances).reduce(
    (sum, b) => sum + parseFloat(b.balance || "0"),
    0,
  );
  const balancesLoading = Object.values(balances).some((b) => b.loading);

  const totalTxCount = txStats.reduce((s, t) => s + t.cnt, 0);
  const successTxCount = txStats
    .filter((t) => t.status === "success")
    .reduce((s, t) => s + t.cnt, 0);
  const failedTxCount = txStats
    .filter((t) => t.status === "error")
    .reduce((s, t) => s + t.cnt, 0);

  const dappTxCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of txStats) {
      map[t.dapp] = (map[t.dapp] || 0) + t.cnt;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1]);
  }, [txStats]);

  const actionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of txStats) {
      map[t.action] = (map[t.action] || 0) + t.cnt;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
  }, [txStats]);

  const walletsByUser = useMemo(() => {
    const map: Record<string, AdminWallet[]> = {};
    for (const w of wallets) {
      if (!map[w.user_id]) map[w.user_id] = [];
      map[w.user_id].push(w);
    }
    return map;
  }, [wallets]);

  const userEmail = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of users) map[u.id] = u.email;
    return map;
  }, [users]);

  const engagementMap = useMemo(() => {
    const map: Record<string, UserEngagement> = {};
    for (const e of engagement) map[e.user_id] = e;
    return map;
  }, [engagement]);

  const totalContractEth = useMemo(() => {
    return Object.values(contractBalances).reduce(
      (s, b) => s + parseFloat(b.balance || "0"),
      0,
    );
  }, [contractBalances]);
  const contractBalancesLoading = Object.values(contractBalances).some(
    (b) => b.loading,
  );

  /* ------------------------------------------------------------------ */
  /*  Render guards                                                      */
  /* ------------------------------------------------------------------ */

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#08090e" }}
      >
        <p className="text-white/30 text-sm animate-pulse">Loading...</p>
      </div>
    );
  }
  if (!user || !isAdmin) return null;

  /* ------------------------------------------------------------------ */
  /*  Tab config                                                         */
  /* ------------------------------------------------------------------ */

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "◎" },
    { id: "users", label: "Users", icon: "◉" },
    { id: "activity", label: "Activity", icon: "◫" },
    { id: "contracts", label: "Contracts", icon: "⬡" },
    { id: "forum", label: "Forum", icon: "💬" },
    { id: "support", label: "Support", icon: "✉" },
  ];

  const actTotalPages = Math.max(1, Math.ceil(actTotal / ACT_PER_PAGE));

  const dappOptions: { value: DApp | ""; label: string }[] = [
    { value: "", label: "All dApps" },
    ...Object.entries(DAPP_META).map(([key, meta]) => ({
      value: key as DApp,
      label: `${meta.icon} ${meta.label}`,
    })),
  ];

  /* ================================================================== */
  /*  RENDER                                                             */
  /* ================================================================== */

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
            Admin <span className="text-gold">Godview</span>
          </h1>
          <p className="text-xs text-white/30 mt-1">
            Platform-wide analytics &bull; {users.length} user{users.length !== 1 ? "s" : ""} &bull; {ethWallets.length} wallet{ethWallets.length !== 1 ? "s" : ""} &bull; {totalTxCount} tx{totalTxCount !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Tab bar */}
        <div className={`${card} p-1.5 flex gap-1 overflow-x-auto`}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[80px] h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                tab === t.id
                  ? "bg-blue-500/15 text-blue-400 shadow-[inset_0_1px_0_rgba(59,130,246,0.2)]"
                  : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
              }`}
            >
              <span className="text-xs opacity-60">{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* ============================================================ */}
        {/*  OVERVIEW TAB                                                 */}
        {/* ============================================================ */}
        {tab === "overview" && (
          <div className="space-y-4">
            {loadingData ? (
              <LoadingCard text="Loading platform data..." />
            ) : (
              <>
                {/* Top-level stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <StatCard label="Users" value={users.length.toString()} icon="👥" />
                  <StatCard label="ETH Wallets" value={ethWallets.length.toString()} icon="⬡" sub={`${arWallets.length} Arweave`} />
                  <StatCard label="Total ETH" value={balancesLoading ? "..." : totalEthBalance.toFixed(6)} icon="Ξ" sub="user wallets" />
                  <StatCard label="0x100 Mode" value={`${vanityPct}%`} icon="✦" sub={`${vanityWallets.length} / ${ethWallets.length}`} />
                  <StatCard label="Transactions" value={totalTxCount.toString()} icon="◎" sub={`${successTxCount} ok · ${failedTxCount} fail`} />
                  <StatCard label="Contracts" value={CONTRACTS.length.toString()} icon="📜" sub={`${CONTRACTS.filter((c) => c.category === "Live").length} live`} />
                </div>

                {/* dApp breakdown + action breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Per-dApp tx counts */}
                  <div className={`${card} p-5 space-y-3`}>
                    <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                      Transactions by dApp
                    </h3>
                    {dappTxCounts.length === 0 ? (
                      <p className="text-sm text-white/20">No transactions yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {dappTxCounts.map(([dapp, cnt]) => {
                          const meta = DAPP_META[dapp as DApp];
                          const pct = totalTxCount > 0 ? (cnt / totalTxCount) * 100 : 0;
                          return (
                            <div key={dapp} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-white/60 flex items-center gap-1.5">
                                  <span className={meta?.color ?? "text-white/30"}>
                                    {meta?.icon ?? "·"}
                                  </span>
                                  {meta?.label ?? dapp}
                                </span>
                                <span className="text-xs text-white/40 font-mono">
                                  {cnt}
                                </span>
                              </div>
                              <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500/50 rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Top actions */}
                  <div className={`${card} p-5 space-y-3`}>
                    <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                      Top Actions
                    </h3>
                    {actionCounts.length === 0 ? (
                      <p className="text-sm text-white/20">No actions yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {actionCounts.map(([action, cnt]) => (
                          <div
                            key={action}
                            className="flex items-center justify-between py-1 border-b border-white/[0.03] last:border-0"
                          >
                            <span className="text-xs text-white/50">
                              {ACTION_LABELS[action] ?? action.replace(/_/g, " ")}
                            </span>
                            <span className="text-xs text-white/30 font-mono">{cnt}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Engagement + Forum stats */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* User engagement summary */}
                  <div className={`${card} p-5 space-y-3`}>
                    <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                      User Engagement
                    </h3>
                    {engagement.length === 0 ? (
                      <p className="text-sm text-white/20">No engagement data.</p>
                    ) : (
                      <div className="space-y-2">
                        {engagement.map((e) => (
                          <div
                            key={e.user_id}
                            className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0"
                          >
                            <div>
                              <span className="text-xs text-white/60">{e.user_email}</span>
                              {e.username && (
                                <span className="text-[10px] text-white/25 ml-1.5">
                                  @{e.username}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px]">
                              <span className={TIER_COLORS[e.forum_tier] ?? "text-white/30"}>
                                {e.forum_tier}
                              </span>
                              <span className="text-white/25">{e.lifetime_points} pts</span>
                              <span className="text-emerald-400/50">
                                ${(e.store_credits_cents / 100).toFixed(2)}
                              </span>
                              {e.referrals_made > 0 && (
                                <span className="text-amber-400/50">
                                  {e.referrals_made} ref
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Platform health / quick numbers */}
                  <div className={`${card} p-5 space-y-3`}>
                    <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                      Platform Health
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <MiniStat label="Wallet Types" value={`${ethWallets.filter((w) => w.wallet_type === "moneyfund").length} moneyfund / ${ethWallets.filter((w) => w.wallet_type === "metamask").length} metamask`} />
                      <MiniStat label="Avg Wallets/User" value={users.length > 0 ? (ethWallets.length / users.length).toFixed(1) : "0"} />
                      <MiniStat label="Success Rate" value={totalTxCount > 0 ? `${((successTxCount / totalTxCount) * 100).toFixed(1)}%` : "N/A"} />
                      <MiniStat label="Avg ETH/Wallet" value={balancesLoading ? "..." : ethWallets.length > 0 ? (totalEthBalance / ethWallets.length).toFixed(6) : "0"} />
                      <MiniStat label="Total Points Issued" value={engagement.reduce((s, e) => s + e.lifetime_points, 0).toString()} />
                      <MiniStat label="Store Credits" value={`$${(engagement.reduce((s, e) => s + e.store_credits_cents, 0) / 100).toFixed(2)}`} />
                    </div>
                  </div>
                </div>

                {/* Per-user breakdown */}
                <div className={`${card} p-5 space-y-3`}>
                  <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                    User Breakdown
                  </h3>
                  {users.map((u) => {
                    const uWallets = walletsByUser[u.id] ?? [];
                    const uEth = uWallets.filter((w) => w.chain === "ethereum");
                    const uVanity = uEth.filter((w) =>
                      w.address.toLowerCase().startsWith("0x100"),
                    );
                    const uBal = uEth.reduce(
                      (s, w) => s + parseFloat(balances[w.address]?.balance || "0"),
                      0,
                    );
                    const eng = engagementMap[u.id];

                    return (
                      <div key={u.id} className={`${card} px-4 py-3 space-y-2`}>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <span className="text-sm font-medium text-white/80">{u.email}</span>
                            {eng?.username && (
                              <span className="text-[10px] text-white/20 ml-2">@{eng.username}</span>
                            )}
                            <span className="text-[10px] text-white/20 ml-2">
                              joined {new Date(u.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <span className="text-sm text-white/60">
                            {balancesLoading ? "..." : uBal.toFixed(6)} ETH
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-white/30 flex-wrap">
                          <span>{uEth.length} wallet{uEth.length !== 1 ? "s" : ""}</span>
                          <span className="text-white/10">·</span>
                          <span>{uVanity.length} vanity</span>
                          {eng && (
                            <>
                              <span className="text-white/10">·</span>
                              <span className={TIER_COLORS[eng.forum_tier] ?? "text-white/30"}>
                                {eng.forum_tier}
                              </span>
                              <span className="text-white/10">·</span>
                              <span>{eng.forum_threads} threads · {eng.forum_replies} replies · {eng.forum_likes} likes</span>
                              <span className="text-white/10">·</span>
                              <span>{eng.lifetime_points} pts</span>
                            </>
                          )}
                          {u.last_sign_in_at && (
                            <>
                              <span className="text-white/10">·</span>
                              <span>last seen {relativeTime(u.last_sign_in_at)}</span>
                            </>
                          )}
                        </div>
                        {uEth.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {uEth.map((w) => (
                              <a
                                key={w.address}
                                href={`https://etherscan.io/address/${w.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[10px] font-mono text-white/40 hover:text-blue-400 transition-colors"
                              >
                                {w.address.toLowerCase().startsWith("0x100") && (
                                  <span className="text-blue-400">✦</span>
                                )}
                                {shorten(w.address)}
                                <span className="text-white/15">{w.wallet_type}</span>
                                <span className="text-white/25">
                                  {balances[w.address]?.loading
                                    ? "..."
                                    : `${parseFloat(balances[w.address]?.balance || "0").toFixed(4)} Ξ`}
                                </span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/*  USERS TAB                                                    */}
        {/* ============================================================ */}
        {tab === "users" && (
          <div className="space-y-4">
            {loadingData ? (
              <LoadingCard text="Loading users..." />
            ) : users.length === 0 ? (
              <EmptyCard text="No users yet" />
            ) : (
              users.map((u) => {
                const uWallets = walletsByUser[u.id] ?? [];
                const uEth = uWallets.filter((w) => w.chain === "ethereum");
                const uAr = uWallets.filter((w) => w.chain === "arweave");
                const eng = engagementMap[u.id];

                return (
                  <div key={u.id} className={`${card} p-5 space-y-4`}>
                    {/* Header */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-white/80">{u.email}</h3>
                        <p className="text-[10px] text-white/25 font-mono mt-0.5">{u.id}</p>
                      </div>
                      <div className="text-right text-[11px] text-white/30">
                        <p>Joined {new Date(u.created_at).toLocaleDateString()}</p>
                        {u.last_sign_in_at && <p>Last seen {relativeTime(u.last_sign_in_at)}</p>}
                      </div>
                    </div>

                    {/* Engagement stats */}
                    {eng && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                        <MiniStatPill label="Username" value={eng.username || "—"} />
                        <MiniStatPill label="Tier" value={eng.forum_tier} color={TIER_COLORS[eng.forum_tier]} />
                        <MiniStatPill label="Points" value={eng.current_points.toString()} sub={`${eng.lifetime_points} lifetime`} />
                        <MiniStatPill label="Store Credit" value={`$${(eng.store_credits_cents / 100).toFixed(2)}`} />
                        <MiniStatPill label="Threads" value={eng.forum_threads.toString()} />
                        <MiniStatPill label="Replies" value={eng.forum_replies.toString()} />
                        <MiniStatPill label="Referrals" value={eng.referrals_made.toString()} />
                      </div>
                    )}

                    {/* Ethereum wallets table */}
                    {uEth.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-medium text-white/25 uppercase tracking-wider">
                          Ethereum ({uEth.length})
                        </span>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px]">
                            <thead>
                              <tr className="text-white/20 border-b border-white/[0.04]">
                                <th className="pb-1.5 pr-3 font-medium">Address</th>
                                <th className="pb-1.5 pr-3 font-medium">Type</th>
                                <th className="pb-1.5 pr-3 font-medium">Balance</th>
                                <th className="pb-1.5 font-medium">Created</th>
                              </tr>
                            </thead>
                            <tbody>
                              {uEth.map((w) => (
                                <tr key={w.address} className="border-b border-white/[0.03]">
                                  <td className="py-2 pr-3 font-mono text-white/50">
                                    <div className="flex items-center gap-1">
                                      {w.address.toLowerCase().startsWith("0x100") && (
                                        <span className="text-blue-400 text-[9px]">✦</span>
                                      )}
                                      <a
                                        href={`https://etherscan.io/address/${w.address}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-blue-400 transition-colors"
                                      >
                                        {shorten(w.address)}
                                      </a>
                                    </div>
                                  </td>
                                  <td className="py-2 pr-3 text-white/30">{w.wallet_type}</td>
                                  <td className="py-2 pr-3 text-white/60">
                                    {balances[w.address]?.loading
                                      ? "..."
                                      : `${parseFloat(balances[w.address]?.balance || "0").toFixed(6)} ETH`}
                                  </td>
                                  <td className="py-2 text-white/25">
                                    {new Date(w.created_at).toLocaleDateString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {uAr.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-medium text-white/25 uppercase tracking-wider">
                          Arweave ({uAr.length})
                        </span>
                        {uAr.map((w) => (
                          <div key={w.address} className="text-[11px] font-mono text-white/40 py-1">
                            {shorten(w.address)}
                          </div>
                        ))}
                      </div>
                    )}

                    {uWallets.length === 0 && (
                      <p className="text-[11px] text-white/20">No wallets created yet.</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/*  ACTIVITY TAB                                                 */}
        {/* ============================================================ */}
        {tab === "activity" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className={`${card} p-4 space-y-3`}>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={actDapp}
                  onChange={(e) => setActDapp(e.target.value as DApp | "")}
                  className={`sm:w-48 ${selectCls}`}
                >
                  {dappOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  value={actUser}
                  onChange={(e) => setActUser(e.target.value)}
                  className={`sm:w-56 ${selectCls}`}
                >
                  <option value="">All Users</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.email}</option>
                  ))}
                </select>
                <input
                  value={actSearch}
                  onChange={(e) => setActSearch(e.target.value)}
                  placeholder="Search tx hash, address, action…"
                  className={`flex-1 ${inputCls}`}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[10px] text-white/30 uppercase tracking-wider font-semibold shrink-0">From</span>
                  <input type="date" value={actFrom} onChange={(e) => setActFrom(e.target.value)} className={`flex-1 ${inputCls}`} />
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[10px] text-white/30 uppercase tracking-wider font-semibold shrink-0">To</span>
                  <input type="date" value={actTo} onChange={(e) => setActTo(e.target.value)} className={`flex-1 ${inputCls}`} />
                </div>
                <button type="button" onClick={() => loadActivity(0)} className={btnPrimary}>
                  {actLoading ? <Spinner /> : "Search"}
                </button>
              </div>
            </div>

            {/* Results */}
            {actLoading && activities.length === 0 ? (
              <LoadingCard text="Loading activity..." />
            ) : activities.length === 0 ? (
              <EmptyCard text="No activity yet" sub="Transactions across all users and dApps will appear here." />
            ) : (
              <div className="space-y-1.5">
                {activities.map((tx) => {
                  const meta = DAPP_META[tx.dapp as DApp] ?? { label: tx.dapp, icon: "·", color: "text-white/40" };
                  const actionLabel = ACTION_LABELS[tx.action] ?? tx.action.replace(/_/g, " ");
                  return (
                    <div key={tx.id} className={`${card} px-4 py-3 flex items-center gap-3`}>
                      <span className={`text-lg shrink-0 ${meta.color}`} title={meta.label}>{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-white/80 truncate">{actionLabel}</span>
                          {tx.status === "error" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 font-semibold">FAILED</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] text-indigo-400/50 font-medium">{userEmail[tx.user_id] ?? shorten(tx.user_id)}</span>
                          <span className="text-white/10">·</span>
                          <span className="text-[10px] text-white/25 font-mono">{meta.label}</span>
                          {tx.amount && (
                            <>
                              <span className="text-white/10">·</span>
                              <span className="text-[10px] text-white/40">{tx.amount}</span>
                            </>
                          )}
                          {tx.tx_hash && (
                            <>
                              <span className="text-white/10">·</span>
                              <a
                                href={`https://etherscan.io/tx/${tx.tx_hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-indigo-400/60 hover:text-indigo-400 font-mono transition-colors"
                              >
                                {tx.tx_hash.slice(0, 10)}…
                              </a>
                            </>
                          )}
                          <span className="text-white/10">·</span>
                          <span className="text-[10px] text-white/20 font-mono">{shorten(tx.wallet_address)}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-white/20 shrink-0">{relativeTime(tx.created_at)}</span>
                    </div>
                  );
                })}
                {actTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button type="button" onClick={() => loadActivity(actPage - 1)} disabled={actPage === 0} className="text-xs text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed">← Prev</button>
                    <span className="text-[10px] text-white/20">{actPage + 1} / {actTotalPages}</span>
                    <button type="button" onClick={() => loadActivity(actPage + 1)} disabled={actPage >= actTotalPages - 1} className="text-xs text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed">Next →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/*  CONTRACTS TAB                                                */}
        {/* ============================================================ */}
        {tab === "contracts" && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Ethereum Contracts" value={CONTRACTS.filter((c) => c.address.startsWith("0x")).length.toString()} icon="⬡" />
              <StatCard label="Factories" value={CONTRACTS.filter((c) => c.category === "Factory").length.toString()} icon="🏭" />
              <StatCard label="Live dApps" value={CONTRACTS.filter((c) => c.category === "Live").length.toString()} icon="🟢" />
              <StatCard label="Total Contract ETH" value={contractBalancesLoading ? "..." : totalContractEth.toFixed(6)} icon="Ξ" />
            </div>

            {/* Contract list by category */}
            {(["Token", "Factory", "Live", "Arweave", "Solana"] as const).map((cat) => {
              const group = CONTRACTS.filter((c) => c.category === cat);
              if (group.length === 0) return null;
              return (
                <div key={cat} className={`${card} p-5 space-y-3`}>
                  <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">{cat}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="text-white/20 border-b border-white/[0.04]">
                          <th className="pb-1.5 pr-3 font-medium">Contract</th>
                          <th className="pb-1.5 pr-3 font-medium">Address</th>
                          {cat !== "Arweave" && cat !== "Solana" && (
                            <th className="pb-1.5 pr-3 font-medium">Balance</th>
                          )}
                          <th className="pb-1.5 font-medium">Explorer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((c) => (
                          <tr key={c.address} className="border-b border-white/[0.03]">
                            <td className="py-2 pr-3 text-white/60 font-medium whitespace-nowrap">
                              {c.name}
                            </td>
                            <td className="py-2 pr-3 font-mono text-white/40">
                              {c.address.length > 20 ? shorten(c.address) : c.address}
                            </td>
                            {cat !== "Arweave" && cat !== "Solana" && (
                              <td className="py-2 pr-3 text-white/50">
                                {contractBalances[c.address]?.loading
                                  ? "..."
                                  : `${parseFloat(contractBalances[c.address]?.balance || "0").toFixed(6)} ETH`}
                              </td>
                            )}
                            <td className="py-2">
                              <a
                                href={
                                  c.category === "Arweave"
                                    ? `https://viewblock.io/arweave/address/${c.address}`
                                    : c.category === "Solana"
                                      ? `https://solscan.io/account/${c.address}`
                                      : `https://etherscan.io/address/${c.address}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400/60 hover:text-blue-400 transition-colors"
                              >
                                View ↗
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ============================================================ */}
        {/*  FORUM TAB                                                    */}
        {/* ============================================================ */}
        {tab === "forum" && (
          <div className="space-y-4">
            {forumLoading ? (
              <LoadingCard text="Loading forum data..." />
            ) : (
              <>
                {/* Forum stats */}
                {forumSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <StatCard label="Categories" value={forumSummary.total_categories.toString()} icon="📂" />
                    <StatCard label="Threads" value={forumSummary.total_threads.toString()} icon="💬" />
                    <StatCard label="Replies" value={forumSummary.total_replies.toString()} icon="↩" />
                    <StatCard label="Total Likes" value={forumSummary.total_likes.toString()} icon="❤" />
                    <StatCard label="Reports" value={forumSummary.total_reports.toString()} icon="⚠" />
                  </div>
                )}

                {/* Thread list */}
                <div className={`${card} p-5 space-y-3`}>
                  <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                    All Threads ({forumThreads.length})
                  </h3>
                  {forumThreads.length === 0 ? (
                    <p className="text-sm text-white/20">No threads yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {forumThreads.map((t) => (
                        <div key={t.id} className={`${card} px-4 py-3 flex items-center gap-3`}>
                          <span className="text-lg shrink-0 text-blue-400/60">💬</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-white/80 truncate">
                                {t.title}
                              </span>
                              {t.status !== "active" && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 font-semibold">
                                  {t.status.toUpperCase()}
                                </span>
                              )}
                              {t.reports_count > 0 && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold">
                                  {t.reports_count} report{t.reports_count !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-[10px] text-indigo-400/50">{t.author_email}</span>
                              <span className="text-white/10">·</span>
                              <span className="text-[10px] text-white/25">{t.category_name}</span>
                              <span className="text-white/10">·</span>
                              <span className="text-[10px] text-white/25">
                                {t.replies_count} repl{t.replies_count !== 1 ? "ies" : "y"} · {t.likes_count} like{t.likes_count !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] text-white/20 shrink-0">{relativeTime(t.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/*  SUPPORT TAB                                                  */}
        {/* ============================================================ */}
        {tab === "support" && (
          <div className="space-y-4">
            {supportLoading ? (
              <LoadingCard text="Loading messages..." />
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Support Tickets" value={supportMsgs.length.toString()} icon="✉" sub={`${supportMsgs.filter((m) => m.status === "open" || m.status === "new").length} open`} />
                  <StatCard label="Contact Messages" value={contactMsgs.length.toString()} icon="📩" sub={`${contactMsgs.filter((m) => m.status === "new" || m.status === "pending").length} pending`} />
                  <StatCard label="Replied" value={(supportMsgs.filter((m) => m.admin_reply).length + contactMsgs.filter((m) => m.admin_reply).length).toString()} icon="✓" />
                  <StatCard label="Unresolved" value={(supportMsgs.filter((m) => !m.admin_reply).length + contactMsgs.filter((m) => !m.admin_reply).length).toString()} icon="⏳" />
                </div>

                {/* Support messages */}
                {supportMsgs.length > 0 && (
                  <div className={`${card} p-5 space-y-3`}>
                    <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                      Support Tickets ({supportMsgs.length})
                    </h3>
                    <div className="space-y-2">
                      {supportMsgs.map((m) => (
                        <div key={m.id} className={`${card} px-4 py-3 space-y-2`}>
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-white/70">{m.subject}</span>
                              <StatusBadge status={m.status} />
                            </div>
                            <span className="text-[10px] text-white/20">{relativeTime(m.created_at)}</span>
                          </div>
                          <div className="text-[11px] text-white/30">
                            <span className="text-indigo-400/50">{m.user_email || m.email}</span>
                            {m.name && <span className="text-white/20"> · {m.name}</span>}
                          </div>
                          <p className="text-xs text-white/50 leading-relaxed">{m.body}</p>
                          {m.admin_reply && (
                            <div className="mt-2 pl-3 border-l-2 border-blue-400/30">
                              <span className="text-[10px] text-blue-400/50 font-medium">Admin reply:</span>
                              <p className="text-xs text-white/40 mt-0.5">{m.admin_reply}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Contact messages */}
                {contactMsgs.length > 0 && (
                  <div className={`${card} p-5 space-y-3`}>
                    <h3 className="text-xs font-medium text-white/30 uppercase tracking-wider">
                      Contact Messages ({contactMsgs.length})
                    </h3>
                    <div className="space-y-2">
                      {contactMsgs.map((m) => (
                        <div key={m.id} className={`${card} px-4 py-3 space-y-2`}>
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-indigo-400/50">{m.user_email || "Anonymous"}</span>
                              <StatusBadge status={m.status} />
                            </div>
                            <span className="text-[10px] text-white/20">{relativeTime(m.created_at)}</span>
                          </div>
                          <p className="text-xs text-white/50 leading-relaxed">{m.message}</p>
                          {m.admin_reply && (
                            <div className="mt-2 pl-3 border-l-2 border-blue-400/30">
                              <span className="text-[10px] text-blue-400/50 font-medium">Admin reply:</span>
                              <p className="text-xs text-white/40 mt-0.5">{m.admin_reply}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {supportMsgs.length === 0 && contactMsgs.length === 0 && (
                  <EmptyCard text="No messages" sub="Support tickets and contact messages will appear here." />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Shared sub-components                                              */
/* ================================================================== */

function StatCard({ label, value, icon, sub }: { label: string; value: string; icon: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-white tracking-tight">{value}</p>
      {sub && <p className="text-[10px] text-white/20 mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
      <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xs text-white/60 font-medium">{value}</p>
    </div>
  );
}

function MiniStatPill({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-2.5">
      <p className="text-[9px] text-white/20 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-xs font-medium ${color ?? "text-white/60"}`}>{value}</p>
      {sub && <p className="text-[9px] text-white/15 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "new" || s === "open" || s === "pending"
      ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
      : s === "resolved" || s === "closed" || s === "replied"
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        : "bg-white/[0.04] border-white/[0.08] text-white/30";
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${cls}`}>
      {status.toUpperCase()}
    </span>
  );
}

function LoadingCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm p-10 text-center">
      <div className="w-6 h-6 border-2 border-white/10 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-xs text-white/30">{text}</p>
    </div>
  );
}

function EmptyCard({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm p-10 text-center">
      <p className="text-2xl mb-2 opacity-20">◉</p>
      <p className="text-sm text-white/30">{text}</p>
      {sub && <p className="text-xs text-white/20 mt-1">{sub}</p>}
    </div>
  );
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />;
}
