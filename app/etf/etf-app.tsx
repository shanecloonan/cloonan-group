"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import {
  MANAGER_ADDRESS,
  RPC_ENDPOINTS,
  TOKEN_COLORS,
  managerAbi,
  tokenAbi,
} from "./abis";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StoredWallet {
  address: string;
  privateKey?: string;
  type: string;
  isMetaMask?: boolean;
}

interface StatusEntry {
  msg: string;
  status: "pending" | "success" | "error";
  time: string;
}

interface TokenRow {
  address: string;
  weight: string;
}

interface TokenInfo {
  address: string;
  symbol: string;
  weight: number;
  color: string;
}

interface EtfData {
  etfToken: string;
  tokens: string[];
  weights: number[];
  currentPrice: ethers.BigNumber;
  percentAppreciation: ethers.BigNumber;
  thirdFeeReceiver: string;
  thirdFeeBps: ethers.BigNumber;
  name: string;
  symbol: string;
  balance: string;
  tokenInfo: TokenInfo[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function storageGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function timestamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ------------------------------------------------------------------ */
/*  Pie chart via conic-gradient                                       */
/* ------------------------------------------------------------------ */

function PieChart({ tokens }: { tokens: TokenInfo[] }) {
  const gradient = useMemo(() => {
    if (tokens.length === 0) return "conic-gradient(#333 0% 100%)";
    const parts: string[] = [];
    let cum = 0;
    tokens.forEach((t) => {
      parts.push(`${t.color} ${cum}% ${cum + t.weight}%`);
      cum += t.weight;
    });
    return `conic-gradient(${parts.join(", ")})`;
  }, [tokens]);
  return <div className="rounded-full flex-shrink-0" style={{ width: 60, height: 60, background: gradient }} />;
}

/* ------------------------------------------------------------------ */
/*  Help icon                                                          */
/* ------------------------------------------------------------------ */

function HelpIcon({ id, active, toggle }: { id: string; active: string | null; toggle: (id: string) => void }) {
  return (
    <span
      onClick={() => toggle(id)}
      className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full text-[0.6em] cursor-pointer text-[#E5E7EB] transition-all hover:scale-110"
      style={{ background: "linear-gradient(45deg, #5B21B6, #7C3AED)" }}
    >
      ?
    </span>
  );
}

function HelpNote({ id, active, text }: { id: string; active: string | null; text: string }) {
  if (active !== id) return null;
  return (
    <div className="text-xs text-[#E5E7EB] bg-[#1E293B] p-1.5 rounded-md mt-1 shadow-lg animate-[slideDown_0.3s_ease-out]">
      {text}
    </div>
  );
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function EtfApp() {
  const rpcIdx = useRef(0);
  const getProvider = useCallback(() => new ethers.providers.JsonRpcProvider(RPC_ENDPOINTS[rpcIdx.current]), []);

  /* wallet state */
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const selected = selIdx !== null && wallets[selIdx] ? wallets[selIdx] : null;
  const [metaSigner, setMetaSigner] = useState<ethers.Signer | null>(null);

  /* etf form state */
  const [etfName, setEtfName] = useState("");
  const [etfSymbol, setEtfSymbol] = useState("");
  const [tokenRows, setTokenRows] = useState<TokenRow[]>([{ address: "", weight: "" }]);
  const [feeReceiver, setFeeReceiver] = useState("");
  const [feeBps, setFeeBps] = useState("");

  /* etf list */
  const [etfs, setEtfs] = useState<EtfData[]>([]);
  const [etfAmounts, setEtfAmounts] = useState<Record<string, string>>({});

  /* ui */
  const [statuses, setStatuses] = useState<StatusEntry[]>([]);
  const [activeHelp, setActiveHelp] = useState<string | null>(null);
  const [busyBtns, setBusyBtns] = useState<Record<string, boolean>>({});
  const [expandedToken, setExpandedToken] = useState<Record<string, string | null>>({});

  const logRef = useRef<HTMLDivElement>(null);

  /* ---- status log ---- */
  const log = useCallback((msg: string, status: StatusEntry["status"] = "pending") => {
    setStatuses((p) => [...p.slice(-4), { msg, status, time: timestamp() }]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  }, []);

  /* ---- busy helpers ---- */
  const setBusy = useCallback((key: string, v: boolean) => setBusyBtns((p) => ({ ...p, [key]: v })), []);

  /* ---- retry with RPC switch ---- */
  const withRetry = useCallback(
    async <T,>(fn: (prov: ethers.providers.JsonRpcProvider) => Promise<T>, retries = 3): Promise<T> => {
      for (let i = 0; i < retries; i++) {
        try {
          return await fn(getProvider());
        } catch (e) {
          if (i === retries - 1) throw e;
          rpcIdx.current = (rpcIdx.current + 1) % RPC_ENDPOINTS.length;
        }
      }
      throw new Error("All retries failed");
    },
    [getProvider],
  );

  /* ---- help toggle ---- */
  const toggleHelp = useCallback((id: string) => setActiveHelp((p) => (p === id ? null : id)), []);

  /* ---- remaining weight ---- */
  const remaining = useMemo(() => {
    const total = tokenRows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
    return Math.max(0, 100 - total).toFixed(2);
  }, [tokenRows]);

  /* ================================================================ */
  /*  Initialize wallets                                               */
  /* ================================================================ */

  useEffect(() => {
    const w: StoredWallet[] = storageGet("wallets", []);
    setWallets(w);
    const idx = parseInt(localStorage.getItem("selectedWalletIndex") || "");
    if (!isNaN(idx) && idx >= 0 && idx < w.length) setSelIdx(idx);
  }, []);

  /* fetch ETFs when wallet changes */
  useEffect(() => {
    refreshETFs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.address]);

  /* ================================================================ */
  /*  Connect wallet (MetaMask)                                        */
  /* ================================================================ */

  const connectWallet = useCallback(async () => {
    setBusy("connect", true);
    log("Connecting wallet...");
    try {
      const w = window as any;
      if (!w.ethereum) { log("Please install MetaMask.", "error"); return; }
      await w.ethereum.request({ method: "eth_requestAccounts" });
      const p = new ethers.providers.Web3Provider(w.ethereum);
      const s = p.getSigner();
      const addr = await s.getAddress();
      setMetaSigner(s);

      let wList: StoredWallet[] = storageGet("wallets", []);
      wList = wList.filter((wl) => wl.type !== "MetaMask");
      wList.push({ address: addr, type: "MetaMask", isMetaMask: true });
      setWallets(wList);
      localStorage.setItem("wallets", JSON.stringify(wList));
      const idx = wList.length - 1;
      setSelIdx(idx);
      localStorage.setItem("selectedWalletIndex", String(idx));
      log(`Wallet connected: ${shorten(addr)}`, "success");
    } catch (e: any) {
      log(`Failed: ${e.message}`, "error");
    } finally {
      setBusy("connect", false);
    }
  }, [log, setBusy]);

  const selectWallet = useCallback(
    (idx: number | null) => {
      if (idx === null) {
        setSelIdx(null);
        setMetaSigner(null);
        localStorage.removeItem("selectedWalletIndex");
        return;
      }
      setSelIdx(idx);
      localStorage.setItem("selectedWalletIndex", String(idx));
      const w = wallets[idx];
      if (w?.isMetaMask) {
        connectWallet();
      } else {
        setMetaSigner(null);
      }
    },
    [wallets, connectWallet],
  );

  /* ================================================================ */
  /*  Refresh ETFs                                                     */
  /* ================================================================ */

  const refreshETFs = useCallback(async () => {
    log("Refreshing ETFs...");
    try {
      const allEtfs = await withRetry(async (prov) => {
        const mgr = new ethers.Contract(MANAGER_ADDRESS, managerAbi, prov);
        return mgr.getAllETFs();
      });
      if (allEtfs.length === 0) { log("No ETFs found.", "error"); setEtfs([]); return; }

      const results: EtfData[] = [];
      for (const etf of allEtfs) {
        const prov = getProvider();
        const tok = new ethers.Contract(etf.etfToken, tokenAbi, prov);
        let name = "Unknown", symbol = "Unknown", balance = "0";
        try { name = await tok.name(); } catch {}
        try { symbol = await tok.symbol(); } catch {}
        if (selected?.address) {
          try { balance = (await tok.balanceOf(selected.address)).toString(); } catch {}
        }
        const tokenInfo: TokenInfo[] = [];
        for (let i = 0; i < etf.tokens.length; i++) {
          const t = new ethers.Contract(etf.tokens[i], tokenAbi, prov);
          let sym = "Unknown";
          try { sym = await t.symbol(); } catch {}
          tokenInfo.push({
            address: etf.tokens[i],
            symbol: sym,
            weight: ethers.BigNumber.from(etf.weights[i]).toNumber() / 100,
            color: TOKEN_COLORS[i % TOKEN_COLORS.length],
          });
        }
        results.push({
          etfToken: etf.etfToken,
          tokens: etf.tokens,
          weights: etf.weights.map((w: any) => ethers.BigNumber.from(w).toNumber()),
          currentPrice: ethers.BigNumber.from(etf.currentPrice),
          percentAppreciation: ethers.BigNumber.from(etf.percentAppreciation),
          thirdFeeReceiver: etf.thirdFeeReceiver,
          thirdFeeBps: ethers.BigNumber.from(etf.thirdFeeBps),
          name,
          symbol,
          balance,
          tokenInfo,
        });
      }
      setEtfs(results);
      log("ETFs refreshed.", "success");
    } catch (e: any) {
      log(`Failed to refresh: ${e.message}`, "error");
    }
  }, [log, withRetry, selected?.address, getProvider]);

  /* ================================================================ */
  /*  Get signer for transactions                                      */
  /* ================================================================ */

  const getSigner = useCallback((): ethers.Signer | null => {
    if (!selected) return null;
    if (selected.isMetaMask && metaSigner) return metaSigner;
    if (selected.privateKey) return new ethers.Wallet(selected.privateKey, getProvider());
    return null;
  }, [selected, metaSigner, getProvider]);

  /* ================================================================ */
  /*  Create ETF                                                       */
  /* ================================================================ */

  const createETF = useCallback(async () => {
    setBusy("launch", true);
    log("Creating ETF...");
    try {
      if (!selected) { log("Select a wallet first.", "error"); return; }
      if (!etfName || !etfSymbol) { log("Name and ticker required.", "error"); return; }
      const tokens: string[] = [];
      const weights: number[] = [];
      for (const row of tokenRows) {
        if (!row.address || !row.weight) continue;
        if (!ethers.utils.isAddress(row.address)) { log(`Invalid address: ${row.address}`, "error"); return; }
        tokens.push(row.address);
        weights.push(Math.round(parseFloat(row.weight) * 100));
      }
      if (tokens.length === 0) { log("Add at least one token.", "error"); return; }
      const totalPct = tokenRows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
      if (Math.abs(totalPct - 100) > 0.01) { log(`Weights must sum to 100%. Current: ${totalPct.toFixed(2)}%`, "error"); return; }
      if (!ethers.utils.isAddress(feeReceiver)) { log("Invalid fee receiver address.", "error"); return; }
      const feePct = parseFloat(feeBps);
      if (isNaN(feePct) || feePct < 0 || feePct > 100) { log("Fee must be 0-100%.", "error"); return; }
      const feeBpsNum = Math.round(feePct * 100);

      const signer = getSigner();
      if (!signer) { log("No signer available.", "error"); return; }

      const mgr = new ethers.Contract(MANAGER_ADDRESS, managerAbi, signer);
      log(selected.isMetaMask ? "Confirm in MetaMask..." : "Signing...");
      const tx = await mgr.createETF(etfName, etfSymbol.toUpperCase(), tokens, weights, feeReceiver, feeBpsNum, { gasLimit: 1500000 });
      await tx.wait();
      log(`ETF ${etfName} (${etfSymbol}) created! Tx: ${shorten(tx.hash)}`, "success");
      setEtfName("");
      setEtfSymbol("");
      setTokenRows([{ address: "", weight: "" }]);
      setFeeReceiver("");
      setFeeBps("");
      await refreshETFs();
    } catch (e: any) {
      log(`Failed: ${e.message}`, "error");
    } finally {
      setBusy("launch", false);
    }
  }, [selected, etfName, etfSymbol, tokenRows, feeReceiver, feeBps, getSigner, log, setBusy, refreshETFs]);

  /* ================================================================ */
  /*  Mint                                                             */
  /* ================================================================ */

  const mintETF = useCallback(
    async (etfToken: string) => {
      const amt = etfAmounts[etfToken];
      const key = `mint-${etfToken}`;
      setBusy(key, true);
      log(`Minting ${amt} ETF tokens...`);
      try {
        if (!selected || !amt || parseFloat(amt) <= 0) { log("Invalid amount or wallet.", "error"); return; }
        const signer = getSigner();
        if (!signer) { log("No signer.", "error"); return; }
        const prov = getProvider();
        const mgr = new ethers.Contract(MANAGER_ADDRESS, managerAbi, prov);
        const etfAmountWei = ethers.utils.parseEther(amt);
        const weiPerEtf = await mgr.getWeiPerEtf(etfToken);
        const totalWei = etfAmountWei.mul(weiPerEtf);

        const mgrSigned = new ethers.Contract(MANAGER_ADDRESS, managerAbi, signer);
        const tx = await mgrSigned.mintWithEth(etfToken, etfAmountWei, { value: totalWei, gasLimit: 500000 });
        await tx.wait();
        log(`Minted ${amt}! Tx: ${shorten(tx.hash)}`, "success");
        await refreshETFs();
      } catch (e: any) {
        log(`Mint failed: ${e.message}`, "error");
      } finally {
        setBusy(key, false);
      }
    },
    [etfAmounts, selected, getSigner, getProvider, log, setBusy, refreshETFs],
  );

  /* ================================================================ */
  /*  Burn                                                             */
  /* ================================================================ */

  const burnETF = useCallback(
    async (etfToken: string) => {
      const amt = etfAmounts[etfToken];
      const key = `burn-${etfToken}`;
      setBusy(key, true);
      log(`Burning ${amt} ETF tokens...`);
      try {
        if (!selected || !amt || parseFloat(amt) <= 0) { log("Invalid amount or wallet.", "error"); return; }
        const signer = getSigner();
        if (!signer) { log("No signer.", "error"); return; }

        const etfAmountWei = ethers.utils.parseEther(amt);
        const tokContract = new ethers.Contract(etfToken, tokenAbi, signer);
        const allowance = await tokContract.allowance(selected.address, MANAGER_ADDRESS);
        if (allowance.lt(etfAmountWei)) {
          log("Approving...");
          const approveTx = await tokContract.approve(MANAGER_ADDRESS, etfAmountWei);
          await approveTx.wait();
          log("Approved.", "success");
        }

        const mgr = new ethers.Contract(MANAGER_ADDRESS, managerAbi, signer);
        const tx = await mgr.burn(etfToken, etfAmountWei, { gasLimit: 500000 });
        await tx.wait();
        log(`Burned ${amt}! Tx: ${shorten(tx.hash)}`, "success");
        await refreshETFs();
      } catch (e: any) {
        log(`Burn failed: ${e.message}`, "error");
      } finally {
        setBusy(key, false);
      }
    },
    [etfAmounts, selected, getSigner, log, setBusy, refreshETFs],
  );

  /* ================================================================ */
  /*  Withdraw                                                         */
  /* ================================================================ */

  const withdrawETF = useCallback(
    async (etfToken: string) => {
      const amt = etfAmounts[etfToken];
      const key = `withdraw-${etfToken}`;
      setBusy(key, true);
      log(`Withdrawing ${amt} ETF tokens...`);
      try {
        if (!selected || !amt || parseFloat(amt) <= 0) { log("Invalid amount or wallet.", "error"); return; }
        const signer = getSigner();
        if (!signer) { log("No signer.", "error"); return; }

        const etfAmountWei = ethers.utils.parseEther(amt);
        const tokContract = new ethers.Contract(etfToken, tokenAbi, signer);
        const allowance = await tokContract.allowance(selected.address, MANAGER_ADDRESS);
        if (allowance.lt(etfAmountWei)) {
          log("Approving...");
          const approveTx = await tokContract.approve(MANAGER_ADDRESS, etfAmountWei);
          await approveTx.wait();
          log("Approved.", "success");
        }

        const mgr = new ethers.Contract(MANAGER_ADDRESS, managerAbi, signer);
        const tx = await mgr.withdraw(etfToken, etfAmountWei, { gasLimit: 500000 });
        await tx.wait();
        log(`Withdrawn ${amt}! Tx: ${shorten(tx.hash)}`, "success");
        await refreshETFs();
      } catch (e: any) {
        log(`Withdraw failed: ${e.message}`, "error");
      } finally {
        setBusy(key, false);
      }
    },
    [etfAmounts, selected, getSigner, log, setBusy, refreshETFs],
  );

  /* ================================================================ */
  /*  Update price                                                     */
  /* ================================================================ */

  const updatePrice = useCallback(
    async (etfToken: string) => {
      const key = `price-${etfToken}`;
      setBusy(key, true);
      log(`Updating price for ${shorten(etfToken)}...`);
      try {
        const prov = getProvider();
        const mgr = new ethers.Contract(MANAGER_ADDRESS, managerAbi, prov);
        const price = await mgr.getPriceOrGain(etfToken, true);
        const gain = await mgr.getPriceOrGain(etfToken, false);
        setEtfs((prev) =>
          prev.map((e) =>
            e.etfToken === etfToken ? { ...e, currentPrice: price, percentAppreciation: gain } : e,
          ),
        );
        log(`Price updated: ${parseFloat(ethers.utils.formatEther(price)).toFixed(6)} ETH`, "success");
      } catch (e: any) {
        log(`Price update failed: ${e.message}`, "error");
      } finally {
        setBusy(key, false);
      }
    },
    [getProvider, log, setBusy],
  );

  /* ================================================================ */
  /*  Token row management                                             */
  /* ================================================================ */

  const addTokenRow = useCallback(() => {
    if (parseFloat(remaining) <= 0) { log("100% allocated.", "error"); return; }
    setTokenRows((p) => [...p, { address: "", weight: "" }]);
  }, [remaining, log]);

  const removeTokenRow = useCallback((idx: number) => {
    setTokenRows((p) => p.filter((_, i) => i !== idx));
  }, []);

  const updateTokenRow = useCallback((idx: number, field: "address" | "weight", val: string) => {
    setTokenRows((p) => p.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }, []);

  /* ================================================================ */
  /*  CSS classes                                                      */
  /* ================================================================ */

  const inputCls = "w-full max-w-[600px] py-2.5 px-2.5 rounded-[10px] bg-[#E5E7EB] text-[#1F2937] text-sm border-none outline-none transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus:shadow-[0_0_12px_rgba(91,33,182,0.5)] hover:bg-[#D1D5DB] placeholder:text-[#9CA3AF] placeholder:opacity-70 my-0.5";
  const labelCls = "text-sm font-medium text-[#E5E7EB] mb-1.5 block";
  const btnPurple = "w-full py-4 my-3 rounded-[10px] text-lg font-semibold text-[#E5E7EB] border-none cursor-pointer transition-all overflow-hidden relative flex justify-center items-center disabled:bg-gray-600/70 disabled:cursor-not-allowed disabled:transform-none";
  const btnPurpleGrad = "bg-gradient-to-r from-[#5B21B6] to-[#7C3AED] hover:from-[#7C3AED] hover:to-[#A5B4FC] hover:-translate-y-0.5 hover:shadow-[0_0_12px_rgba(91,33,182,0.5)]";
  const goldBtn = "bg-gradient-to-r from-[#E4A11B] to-[#F4B85C] text-[#1F2937] hover:from-[#D97706] hover:to-[#FBCF8B] hover:-translate-y-0.5 hover:shadow-[0_0_16px_rgba(228,161,27,0.6)]";
  const smallGoldBtn = "inline-flex items-center justify-center py-1.5 px-3 text-xs min-h-[28px] rounded-[10px] font-semibold border border-[rgba(228,161,27,0.6)] cursor-pointer transition-all bg-gradient-to-r from-[#E4A11B] to-[#F4B85C] text-[#1F2937] hover:from-[#D97706] hover:to-[#FBCF8B] hover:-translate-y-0.5 disabled:bg-gray-600/70 disabled:cursor-not-allowed";
  const smallPurpleBtn = "inline-flex items-center justify-center py-1.5 px-3 text-xs min-h-[28px] rounded-[10px] font-semibold border border-[rgba(91,33,182,0.6)] cursor-pointer transition-all bg-gradient-to-br from-[#5B21B6] to-[#7C3AED] text-[#E5E7EB] hover:from-[#7C3AED] hover:to-[#A5B4FC] hover:-translate-y-0.5 disabled:bg-gray-600/70 disabled:cursor-not-allowed";

  const Spinner = () => (
    <span className="inline-block w-4 h-4 border-2 border-[#E5E7EB] border-t-transparent rounded-full animate-spin" />
  );

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen p-5 sm:p-10" style={{ background: "#1E293B", fontFamily: "'Manrope', sans-serif", color: "#E5E7EB" }}>
      <div className="max-w-[1400px] mx-auto flex flex-wrap gap-6">
        {/* ============================================================ */}
        {/*  LEFT: Launch ETF                                            */}
        {/* ============================================================ */}
        <div className="flex-1 min-w-[45%] p-4 sm:p-8">
          {/* Wallet selector */}
          <div className="flex gap-4 max-w-[600px] mb-6">
            <select
              value={selIdx ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                selectWallet(v === "" ? null : parseInt(v));
              }}
              className="flex-1 min-w-0 py-3.5 px-3.5 rounded-[10px] text-base text-center text-[#E5E7EB] border-none transition-all outline-none"
              style={{ background: "linear-gradient(45deg, #475569, #64748B)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)" }}
            >
              <option value="">-- Select Wallet --</option>
              {wallets.map((w, i) => (
                <option key={i} value={i}>{w.type}: {shorten(w.address)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={connectWallet}
              disabled={busyBtns["connect"]}
              className="flex-1 min-w-0 py-3.5 px-3.5 rounded-[10px] text-base font-semibold text-[#E5E7EB] border-none cursor-pointer transition-all hover:-translate-y-0.5 disabled:bg-gray-600/70 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(45deg, #5B21B6, #7C3AED)" }}
            >
              {busyBtns["connect"] ? <Spinner /> : "Connect Wallet"}
            </button>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold text-center text-[#E5E7EB] mb-5">Launch an ETF</h2>

          {/* Name */}
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <label className={labelCls}>Name</label>
              <HelpIcon id="name" active={activeHelp} toggle={toggleHelp} />
            </div>
            <input value={etfName} onChange={(e) => setEtfName(e.target.value)} placeholder="e.g., MoneyFund ETF" className={inputCls} />
            <HelpNote id="name" active={activeHelp} text="The full name of the ETF (e.g., MoneyFund ETF)." />
          </div>

          {/* Symbol */}
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <label className={labelCls}>Ticker</label>
              <HelpIcon id="symbol" active={activeHelp} toggle={toggleHelp} />
            </div>
            <input value={etfSymbol} onChange={(e) => setEtfSymbol(e.target.value)} placeholder="e.g., METF" className={inputCls} />
            <HelpNote id="symbol" active={activeHelp} text="The ticker symbol for the ETF (e.g., METF)." />
          </div>

          {/* Token rows */}
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <label className={labelCls}>Token Addresses &amp; Weights (Sum to 100%)</label>
              <HelpIcon id="tokens" active={activeHelp} toggle={toggleHelp} />
            </div>
            {tokenRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center mb-2 max-w-[600px]">
                <input
                  value={row.address}
                  onChange={(e) => updateTokenRow(i, "address", e.target.value)}
                  placeholder="e.g., 0xToken"
                  className={`flex-[3] max-w-[400px] ${inputCls}`}
                />
                <input
                  type="number"
                  value={row.weight}
                  onChange={(e) => updateTokenRow(i, "weight", e.target.value)}
                  placeholder="e.g., 50"
                  min="0"
                  max="100"
                  step="0.01"
                  className={`flex-[1.5] max-w-[150px] ${inputCls}`}
                />
                {tokenRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTokenRow(i)}
                    className="w-10 h-10 p-0 text-xl rounded-lg flex items-center justify-center border-none cursor-pointer text-[#E5E7EB] transition-all hover:-translate-y-0.5"
                    style={{ background: "linear-gradient(45deg, #5B21B6, #7C3AED)" }}
                  >
                    X
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2 mb-3 max-w-[600px]">
              <button
                type="button"
                onClick={addTokenRow}
                className="w-6 h-6 p-0 text-sm rounded-md flex items-center justify-center border-none cursor-pointer text-[#E5E7EB] transition-all hover:-translate-y-0.5"
                style={{ background: "linear-gradient(45deg, #5B21B6, #7C3AED)" }}
              >
                +
              </button>
              <span className="text-xs text-[#E4A11B]">Remaining: {remaining}%</span>
            </div>
            <HelpNote id="tokens" active={activeHelp} text="Enter ERC20 token addresses and their percentage weights, summing to 100%." />
          </div>

          {/* Fee */}
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <label className={labelCls}>Fee Receiver Address &amp; Fee Amount (%)</label>
              <HelpIcon id="fee" active={activeHelp} toggle={toggleHelp} />
            </div>
            <div className="flex gap-2 max-w-[600px]">
              <input value={feeReceiver} onChange={(e) => setFeeReceiver(e.target.value)} placeholder="e.g., 0xFeeReceiver" className={`flex-1 ${inputCls}`} />
              <input type="number" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} placeholder="e.g., 1" min="0" max="100" step="0.01" className={`flex-1 ${inputCls}`} />
            </div>
            <HelpNote id="fee" active={activeHelp} text="Enter the address to receive ETF management fees and the percentage fee (0-100%)." />
          </div>

          {/* Launch button */}
          <div className="flex gap-3 max-w-[600px]">
            <button
              type="button"
              onClick={createETF}
              disabled={busyBtns["launch"]}
              className={`${btnPurple} ${goldBtn} max-w-[180px] py-3 text-base`}
            >
              {busyBtns["launch"] ? <Spinner /> : "Launch ETF"}
            </button>
          </div>
        </div>

        {/* ============================================================ */}
        {/*  RIGHT: All ETFs                                             */}
        {/* ============================================================ */}
        <div className="flex-1 min-w-[45%] p-4 sm:p-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-[#E5E7EB] mb-5">All ETFs</h2>

          {/* ETF list */}
          <div
            className="max-h-[600px] overflow-y-auto p-3 rounded-[10px] flex flex-col gap-2 relative"
            style={{
              background: "rgba(10,14,43,0.9)",
              boxShadow: "0 0 15px rgba(128,90,213,0.4), 0 0 10px rgba(255,255,255,0.2)",
              border: "2px solid #E4A11B",
              scrollbarWidth: "thin",
              scrollbarColor: "#E4A11B rgba(10,14,43,0.5)",
            }}
          >
            {etfs.length === 0 ? (
              <p className="text-center text-sm text-[#9CA3AF] py-8">No ETFs found. Connect a wallet or launch one.</p>
            ) : (
              etfs.map((etf) => {
                const price = parseFloat(ethers.utils.formatEther(etf.currentPrice)).toFixed(6);
                const appreciation = (etf.percentAppreciation.toNumber() / 100).toFixed(2);
                const fee = (etf.thirdFeeBps.toNumber() / 100).toFixed(2);
                const balance = parseFloat(ethers.utils.formatEther(etf.balance)).toFixed(6);
                const expanded = expandedToken[etf.etfToken];

                return (
                  <div
                    key={etf.etfToken}
                    className="rounded-[10px] p-2.5 flex flex-col gap-1.5 transition-all hover:scale-[1.02] hover:shadow-[0_0_15px_rgba(91,33,182,0.6),0_0_10px_rgba(255,215,0,0.4)]"
                    style={{ background: "rgba(10,14,43,0.9)", border: "1px solid #ffd700" }}
                  >
                    {/* Header */}
                    <div className="flex justify-between items-center pb-1 border-b border-[rgba(91,33,182,0.2)]">
                      <h3 className="text-[0.95rem] font-semibold text-[#E5E7EB] m-0">{etf.name} ({etf.symbol})</h3>
                      <span className="text-xs text-[#9F7AEA] font-medium">{shorten(etf.etfToken)}</span>
                    </div>

                    {/* Details */}
                    <div
                      className="flex flex-wrap gap-2 text-[0.7rem] my-1 rounded-md p-1.5"
                      style={{ background: "rgba(30,41,59,0.6)", border: "1px solid rgba(255,215,0,0.3)" }}
                    >
                      <div className="flex-1 basis-[45%] flex flex-col gap-0.5">
                        <label className="font-medium text-[#9CA3AF] text-[0.6rem]">Price</label>
                        <span className="text-[#e6e6fa] text-[0.65rem] flex items-center gap-1">
                          {price} ETH
                          <button
                            type="button"
                            onClick={() => updatePrice(etf.etfToken)}
                            disabled={busyBtns[`price-${etf.etfToken}`]}
                            className={smallPurpleBtn}
                          >
                            {busyBtns[`price-${etf.etfToken}`] ? <Spinner /> : "Update Price"}
                          </button>
                        </span>
                      </div>
                      <div className="flex-1 basis-[45%] flex flex-col gap-0.5">
                        <label className="font-medium text-[#9CA3AF] text-[0.6rem]">% Appreciation</label>
                        <span className="text-[#e6e6fa] text-[0.65rem]">{appreciation}%</span>
                      </div>
                      <div className="flex-1 basis-[45%] flex flex-col gap-0.5">
                        <label className="font-medium text-[#9CA3AF] text-[0.6rem]">Your Balance</label>
                        <span className="text-[#e6e6fa] text-[0.65rem]">{balance} {etf.symbol}</span>
                      </div>
                      <div className="flex-1 basis-[45%] flex flex-col gap-0.5">
                        <label className="font-medium text-[#9CA3AF] text-[0.6rem]">Fee Receiver</label>
                        <span className="text-[#e6e6fa] text-[0.65rem] break-all">{shorten(etf.thirdFeeReceiver)}</span>
                      </div>
                      <div className="flex-1 basis-[45%] flex flex-col gap-0.5">
                        <label className="font-medium text-[#9CA3AF] text-[0.6rem]">Fee</label>
                        <span className="text-[#e6e6fa] text-[0.65rem]">{fee}%</span>
                      </div>
                    </div>

                    {/* Token distribution + pie chart */}
                    <div className="flex gap-2 items-start my-1">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-[#E5E7EB] m-0 mb-1">Token Distribution</h3>
                        <div
                          className="p-1 rounded-md flex flex-wrap gap-[3px] max-h-[200px] overflow-y-auto"
                          style={{ background: "rgba(10,14,43,0.9)", border: "1px solid #ffd700", scrollbarWidth: "thin", scrollbarColor: "#7C3AED rgba(10,14,43,0.5)" }}
                        >
                          {etf.tokenInfo.map((t) => (
                            <button
                              key={t.address}
                              type="button"
                              onClick={() =>
                                setExpandedToken((prev) => ({
                                  ...prev,
                                  [etf.etfToken]: prev[etf.etfToken] === t.address ? null : t.address,
                                }))
                              }
                              className="flex items-center py-0.5 px-1 rounded text-[0.65rem] text-[#E5E7EB] hover:bg-[rgba(91,33,182,0.1)] transition-colors bg-transparent border-none cursor-pointer text-left"
                            >
                              <span className="w-[5px] h-[5px] rounded-full mr-1 flex-shrink-0" style={{ background: t.color }} />
                              <a
                                href={`https://etherscan.io/address/${t.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#9F7AEA] no-underline hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {expanded === t.address ? shorten(t.address) : t.symbol}
                              </a>
                              <span className="ml-1 text-[#7C3AED] font-medium">({t.weight}%)</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <PieChart tokens={etf.tokenInfo} />
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1 mt-1">
                      <div className="flex gap-1 items-center w-full">
                        <input
                          type="number"
                          value={etfAmounts[etf.etfToken] || ""}
                          onChange={(e) => setEtfAmounts((p) => ({ ...p, [etf.etfToken]: e.target.value }))}
                          placeholder="Amount"
                          min="0"
                          step="0.00000001"
                          className="flex-1 py-1.5 px-1.5 rounded-[10px] bg-[#E5E7EB] text-[#1F2937] text-xs border-none outline-none min-h-[28px]"
                        />
                        <button type="button" onClick={() => mintETF(etf.etfToken)} disabled={busyBtns[`mint-${etf.etfToken}`]} className={smallGoldBtn}>
                          {busyBtns[`mint-${etf.etfToken}`] ? <Spinner /> : "Mint"}
                        </button>
                        <button type="button" onClick={() => burnETF(etf.etfToken)} disabled={busyBtns[`burn-${etf.etfToken}`]} className={smallGoldBtn}>
                          {busyBtns[`burn-${etf.etfToken}`] ? <Spinner /> : "Burn"}
                        </button>
                        <button type="button" onClick={() => withdrawETF(etf.etfToken)} disabled={busyBtns[`withdraw-${etf.etfToken}`]} className={smallGoldBtn}>
                          {busyBtns[`withdraw-${etf.etfToken}`] ? <Spinner /> : "Withdraw"}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(etf.etfToken); log(`Copied: ${shorten(etf.etfToken)}`, "success"); }}
                        className={smallPurpleBtn}
                      >
                        Copy Contract Address
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Status log */}
          <div
            ref={logRef}
            className="w-full mt-4 rounded-lg p-2 max-h-[120px] overflow-y-auto"
            style={{
              background: "rgba(10,14,43,0.95)",
              border: "1px solid #E4A11B",
              boxShadow: "0 0 10px rgba(128,90,213,0.3)",
              scrollbarWidth: "thin",
              scrollbarColor: "#E4A11B rgba(10,14,43,0.5)",
            }}
          >
            {statuses.map((s, i) => (
              <div
                key={i}
                className={`text-[0.7rem] mb-1.5 flex items-center gap-1.5 ${
                  s.status === "success" ? "text-[#34D399]" : s.status === "error" ? "text-[#F87171]" : "text-[#FBBF24]"
                }`}
              >
                <span className="text-[#9CA3AF] text-[0.65rem] min-w-[60px]">[{s.time}]</span>
                <span>{s.status === "success" ? "🚀" : s.status === "error" ? "🌈" : ""} {s.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
