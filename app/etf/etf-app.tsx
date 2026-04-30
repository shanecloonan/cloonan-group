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
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { logTransaction } from "@/lib/activity";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
const btnGold = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
const btnGhost = "h-10 px-4 rounded-xl font-medium text-xs border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1.5";

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

function Spinner() {
  return <span className="inline-block w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />;
}

export default function EtfApp() {
  const rpcIdx = useRef(0);
  const getProvider = useCallback(() => new ethers.providers.JsonRpcProvider(RPC_ENDPOINTS[rpcIdx.current]), []);

  /* wallet (shared context) */
  const { user, vaultUnlocked, ethWallets, selectedEthWallet, selectedEthAddress, selectEthWallet, connectMetaMask, isLoading } = useWallet();
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

  /* fetch ETFs when wallet changes */
  useEffect(() => {
    refreshETFs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEthWallet?.address]);

  /* set up MetaMask signer when a MetaMask wallet is selected */
  useEffect(() => {
    if (selectedEthWallet?.type === "metamask" && (window as any).ethereum) {
      const p = new ethers.providers.Web3Provider((window as any).ethereum);
      setMetaSigner(p.getSigner());
    } else {
      setMetaSigner(null);
    }
  }, [selectedEthWallet]);

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
        if (selectedEthWallet?.address) {
          try { balance = (await tok.balanceOf(selectedEthWallet.address)).toString(); } catch {}
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
  }, [log, withRetry, selectedEthWallet?.address, getProvider]);

  /* ================================================================ */
  /*  Get signer for transactions                                      */
  /* ================================================================ */

  const getSigner = useCallback((): ethers.Signer | null => {
    if (!selectedEthWallet) return null;
    if (selectedEthWallet.type === "metamask" && metaSigner) return metaSigner;
    if (selectedEthWallet.privateKey) return new ethers.Wallet(selectedEthWallet.privateKey, getProvider());
    return null;
  }, [selectedEthWallet, metaSigner, getProvider]);

  /* ================================================================ */
  /*  Create ETF                                                       */
  /* ================================================================ */

  const createETF = useCallback(async () => {
    setBusy("launch", true);
    log("Creating ETF...");
    try {
      if (!selectedEthWallet) { log("Select a wallet first.", "error"); return; }
      if (!etfName || !etfSymbol) { log("Name and ticker required.", "error"); return; }
      const tokens: string[] = [];
      const weights: number[] = [];
      for (const row of tokenRows) {
        if (!row.address || !row.weight) continue;
        if (!ethers.utils.isAddress(row.address)) { log(`Invalid address: ${row.address}`, "error"); return; }
        const w = parseFloat(row.weight);
        if (!isFinite(w) || w <= 0 || w > 100) { log(`Weight must be between 0 and 100%. Got: ${row.weight}%`, "error"); return; }
        tokens.push(row.address);
        weights.push(Math.round(w * 100));
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
      log(selectedEthWallet?.type === "metamask" ? "Confirm in MetaMask..." : "Signing...");
      const tx = await mgr.createETF(etfName, etfSymbol.toUpperCase(), tokens, weights, feeReceiver, feeBpsNum, { gasLimit: 1500000 });
      await tx.wait();
      log(`ETF ${etfName} (${etfSymbol}) created! Tx: ${shorten(tx.hash)}`, "success");
      if (user) logTransaction({ userId: user.id, walletAddress: selectedEthWallet.address, txHash: tx.hash, dapp: "etf", action: "create_etf", contractAddress: MANAGER_ADDRESS, details: { name: etfName, symbol: etfSymbol } });
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
  }, [selectedEthWallet, etfName, etfSymbol, tokenRows, feeReceiver, feeBps, getSigner, log, setBusy, refreshETFs]);

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
        if (!selectedEthWallet || !amt || parseFloat(amt) <= 0) { log("Invalid amount or wallet.", "error"); return; }
        const signer = getSigner();
        if (!signer) { log("No signer.", "error"); return; }
        const prov = getProvider();
        const mgr = new ethers.Contract(MANAGER_ADDRESS, managerAbi, prov);
        const etfAmountWei = ethers.utils.parseEther(amt);
        const weiPerEtf = await mgr.getWeiPerEtf(etfToken);
        const totalWei = etfAmountWei.mul(weiPerEtf).div(ethers.constants.WeiPerEther);

        const mgrSigned = new ethers.Contract(MANAGER_ADDRESS, managerAbi, signer);
        const tx = await mgrSigned.mintWithEth(etfToken, etfAmountWei, { value: totalWei, gasLimit: 500000 });
        await tx.wait();
        log(`Minted ${amt}! Tx: ${shorten(tx.hash)}`, "success");
        if (user) logTransaction({ userId: user.id, walletAddress: selectedEthWallet!.address, txHash: tx.hash, dapp: "etf", action: "mint_etf", amount: `${amt} ETF`, contractAddress: etfToken });
        await refreshETFs();
      } catch (e: any) {
        log(`Mint failed: ${e.message}`, "error");
      } finally {
        setBusy(key, false);
      }
    },
    [etfAmounts, selectedEthWallet, getSigner, getProvider, log, setBusy, refreshETFs],
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
        if (!selectedEthWallet || !amt || parseFloat(amt) <= 0) { log("Invalid amount or wallet.", "error"); return; }
        const signer = getSigner();
        if (!signer) { log("No signer.", "error"); return; }

        const etfAmountWei = ethers.utils.parseEther(amt);
        const tokContract = new ethers.Contract(etfToken, tokenAbi, signer);
        const allowance = await tokContract.allowance(selectedEthWallet.address, MANAGER_ADDRESS);
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
        if (user) logTransaction({ userId: user.id, walletAddress: selectedEthWallet!.address, txHash: tx.hash, dapp: "etf", action: "burn_etf", amount: `${amt} ETF`, contractAddress: etfToken });
        await refreshETFs();
      } catch (e: any) {
        log(`Burn failed: ${e.message}`, "error");
      } finally {
        setBusy(key, false);
      }
    },
    [etfAmounts, selectedEthWallet, getSigner, log, setBusy, refreshETFs],
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
        if (!selectedEthWallet || !amt || parseFloat(amt) <= 0) { log("Invalid amount or wallet.", "error"); return; }
        const signer = getSigner();
        if (!signer) { log("No signer.", "error"); return; }

        const etfAmountWei = ethers.utils.parseEther(amt);
        const tokContract = new ethers.Contract(etfToken, tokenAbi, signer);
        const allowance = await tokContract.allowance(selectedEthWallet.address, MANAGER_ADDRESS);
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
        if (user) logTransaction({ userId: user.id, walletAddress: selectedEthWallet!.address, txHash: tx.hash, dapp: "etf", action: "withdraw_etf", amount: `${amt} ETF`, contractAddress: etfToken });
        await refreshETFs();
      } catch (e: any) {
        log(`Withdraw failed: ${e.message}`, "error");
      } finally {
        setBusy(key, false);
      }
    },
    [etfAmounts, selectedEthWallet, getSigner, log, setBusy, refreshETFs],
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
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen px-4 py-6 sm:p-10 text-white/90" style={{ fontFamily: "'Manrope', sans-serif" }}>
      <div className="max-w-[1100px] mx-auto flex flex-col gap-8">
        {/* ============================================================ */}
        {/*  Launch ETF                                                  */}
        {/* ============================================================ */}
        <div>
          {/* Wallet selector */}
          {!user || !vaultUnlocked ? (
            <div className="mb-8"><AuthPanel /></div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <select
                value={selectedEthAddress ?? ""}
                onChange={(e) => selectEthWallet(e.target.value || null)}
                className={`flex-1 min-w-0 ${selectCls}`}
              >
                <option value="">Select wallet...</option>
                {ethWallets.map((w) => (
                  <option key={w.address} value={w.address}>{shorten(w.address)} ({w.type})</option>
                ))}
              </select>
              <button
                type="button"
                onClick={connectMetaMask}
                disabled={isLoading}
                className={btnPrimary}
              >
                {isLoading ? <Spinner /> : "Connect Wallet"}
              </button>
            </div>
          )}

          <h2 className="text-2xl font-bold text-white/90 mb-6">Launch an ETF</h2>

          <div className={`${card} p-6 space-y-5`}>
            {/* Name */}
            <div>
              <div className="flex items-center gap-2">
                <label className={labelCls}>Name</label>
                <span
                  onClick={() => toggleHelp("name")}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] cursor-pointer bg-indigo-500/20 text-indigo-400 hover:scale-110 transition-transform"
                >?</span>
              </div>
              <input value={etfName} onChange={(e) => setEtfName(e.target.value)} placeholder="e.g., MoneyFund ETF" className={inputCls} />
              {activeHelp === "name" && (
                <div className="text-xs text-white/60 bg-white/[0.04] border border-white/[0.06] p-2 rounded-lg mt-2">
                  The full name of the ETF (e.g., MoneyFund ETF).
                </div>
              )}
            </div>

            {/* Symbol */}
            <div>
              <div className="flex items-center gap-2">
                <label className={labelCls}>Ticker</label>
                <span
                  onClick={() => toggleHelp("symbol")}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] cursor-pointer bg-indigo-500/20 text-indigo-400 hover:scale-110 transition-transform"
                >?</span>
              </div>
              <input value={etfSymbol} onChange={(e) => setEtfSymbol(e.target.value)} placeholder="e.g., METF" className={inputCls} />
              {activeHelp === "symbol" && (
                <div className="text-xs text-white/60 bg-white/[0.04] border border-white/[0.06] p-2 rounded-lg mt-2">
                  The ticker symbol for the ETF (e.g., METF).
                </div>
              )}
            </div>

            {/* Token rows */}
            <div>
              <div className="flex items-center gap-2">
                <label className={labelCls}>Token Addresses &amp; Weights (Sum to 100%)</label>
                <span
                  onClick={() => toggleHelp("tokens")}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] cursor-pointer bg-indigo-500/20 text-indigo-400 hover:scale-110 transition-transform"
                >?</span>
              </div>
              {tokenRows.map((row, i) => (
                <div key={i} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center mb-2">
                  <input
                    value={row.address}
                    onChange={(e) => updateTokenRow(i, "address", e.target.value)}
                    placeholder="0xToken..."
                    className={`sm:flex-[3] ${inputCls}`}
                  />
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      value={row.weight}
                      onChange={(e) => updateTokenRow(i, "weight", e.target.value)}
                      placeholder="Weight %"
                      min="0"
                      max="100"
                      step="0.01"
                      className={`flex-1 sm:w-24 ${inputCls}`}
                    />
                    {tokenRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTokenRow(i)}
                        className={btnGhost}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3 mt-2">
                <button type="button" onClick={addTokenRow} className={btnGhost}>+ Add</button>
                <span className="text-xs text-amber-400/80">Remaining: {remaining}%</span>
              </div>
              {activeHelp === "tokens" && (
                <div className="text-xs text-white/60 bg-white/[0.04] border border-white/[0.06] p-2 rounded-lg mt-2">
                  Enter ERC20 token addresses and their percentage weights, summing to 100%.
                </div>
              )}
            </div>

            {/* Fee */}
            <div>
              <div className="flex items-center gap-2">
                <label className={labelCls}>Fee Receiver Address &amp; Fee Amount (%)</label>
                <span
                  onClick={() => toggleHelp("fee")}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] cursor-pointer bg-indigo-500/20 text-indigo-400 hover:scale-110 transition-transform"
                >?</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={feeReceiver} onChange={(e) => setFeeReceiver(e.target.value)} placeholder="0xFeeReceiver..." className={`sm:flex-[2] ${inputCls}`} />
                <input type="number" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} placeholder="Fee %" min="0" max="100" step="0.01" className={`sm:flex-[1] ${inputCls}`} />
              </div>
              {activeHelp === "fee" && (
                <div className="text-xs text-white/60 bg-white/[0.04] border border-white/[0.06] p-2 rounded-lg mt-2">
                  Enter the address to receive ETF management fees and the percentage fee (0-100%).
                </div>
              )}
            </div>

            {/* Launch button */}
            <button
              type="button"
              onClick={createETF}
              disabled={busyBtns["launch"]}
              className={`w-full ${btnGold}`}
            >
              {busyBtns["launch"] ? <Spinner /> : "Launch ETF"}
            </button>
          </div>
        </div>

        {/* ============================================================ */}
        {/*  All ETFs                                                    */}
        {/* ============================================================ */}
        <div>
          <h2 className="text-2xl font-bold text-white/90 mb-6">All ETFs</h2>

          {/* ETF list */}
          <div className={`${card} p-4 flex flex-col gap-3`}>
            {etfs.length === 0 ? (
              <p className="text-center text-sm text-white/30 py-8">No ETFs found. Connect a wallet or launch one.</p>
            ) : (
              etfs.map((etf) => {
                const price = parseFloat(ethers.utils.formatEther(etf.currentPrice)).toFixed(6);
                const appreciation = (parseFloat(etf.percentAppreciation.toString()) / 100).toFixed(2);
                const fee = (etf.thirdFeeBps.toNumber() / 100).toFixed(2);
                const balance = parseFloat(ethers.utils.formatEther(etf.balance)).toFixed(6);
                const expanded = expandedToken[etf.etfToken];

                return (
                  <div key={etf.etfToken} className={`${card} p-4`}>
                    {/* Header */}
                    <div className="flex justify-between items-center pb-3 mb-3 border-b border-white/[0.06]">
                      <h3 className="text-sm font-semibold text-white/90">{etf.name} ({etf.symbol})</h3>
                      <span className="text-xs text-indigo-400/80 font-mono">{shorten(etf.etfToken)}</span>
                    </div>

                    {/* Details grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                      <div>
                        <span className={labelCls}>Price</span>
                        <div className="text-xs text-white/90 flex items-center gap-1.5">
                          {price} ETH
                          <button
                            type="button"
                            onClick={() => updatePrice(etf.etfToken)}
                            disabled={busyBtns[`price-${etf.etfToken}`]}
                            className={btnGhost}
                          >
                            {busyBtns[`price-${etf.etfToken}`] ? <Spinner /> : "Update"}
                          </button>
                        </div>
                      </div>
                      <div>
                        <span className={labelCls}>Appreciation</span>
                        <div className="text-xs text-white/90">{appreciation}%</div>
                      </div>
                      <div>
                        <span className={labelCls}>Your Balance</span>
                        <div className="text-xs text-white/90">{balance} {etf.symbol}</div>
                      </div>
                      <div>
                        <span className={labelCls}>Fee Receiver</span>
                        <div className="text-xs text-white/60 break-all">{shorten(etf.thirdFeeReceiver)}</div>
                      </div>
                      <div>
                        <span className={labelCls}>Fee</span>
                        <div className="text-xs text-white/90">{fee}%</div>
                      </div>
                    </div>

                    {/* Token distribution + pie chart */}
                    <div className="flex flex-col-reverse sm:flex-row gap-3 items-start mb-3">
                      <div className="flex-1 min-w-0">
                        <span className={labelCls}>Token Distribution</span>
                        <div className="flex flex-wrap gap-1 max-h-[160px] overflow-y-auto">
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
                              className="flex items-center py-1 px-2 rounded-lg text-xs text-white/60 hover:bg-white/[0.06] transition-colors bg-transparent border-none cursor-pointer text-left"
                            >
                              <span className="w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0" style={{ background: t.color }} />
                              <a
                                href={`https://etherscan.io/address/${t.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-400 no-underline hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {expanded === t.address ? shorten(t.address) : t.symbol}
                              </a>
                              <span className="ml-1 text-white/30 font-medium">({t.weight}%)</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <PieChart tokens={etf.tokenInfo} />
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      <input
                        type="number"
                        value={etfAmounts[etf.etfToken] || ""}
                        onChange={(e) => setEtfAmounts((p) => ({ ...p, [etf.etfToken]: e.target.value }))}
                        placeholder="Amount"
                        min="0"
                        step="0.00000001"
                        className={inputCls}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => mintETF(etf.etfToken)} disabled={busyBtns[`mint-${etf.etfToken}`]} className={`flex-1 min-w-[80px] ${btnGold}`}>
                          {busyBtns[`mint-${etf.etfToken}`] ? <Spinner /> : "Mint"}
                        </button>
                        <button type="button" onClick={() => burnETF(etf.etfToken)} disabled={busyBtns[`burn-${etf.etfToken}`]} className={`flex-1 min-w-[80px] ${btnGold}`}>
                          {busyBtns[`burn-${etf.etfToken}`] ? <Spinner /> : "Burn"}
                        </button>
                        <button type="button" onClick={() => withdrawETF(etf.etfToken)} disabled={busyBtns[`withdraw-${etf.etfToken}`]} className={`flex-1 min-w-[80px] ${btnGold}`}>
                          {busyBtns[`withdraw-${etf.etfToken}`] ? <Spinner /> : "Withdraw"}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(etf.etfToken); log(`Copied: ${shorten(etf.etfToken)}`, "success"); }}
                        className={btnGhost}
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
            className={`${card} mt-4 p-3 max-h-[140px] overflow-y-auto`}
          >
            {statuses.length === 0 && (
              <p className="text-xs text-white/30 text-center py-2">No activity yet.</p>
            )}
            {statuses.map((s, i) => (
              <div
                key={i}
                className={`text-xs mb-1.5 flex items-center gap-2 ${
                  s.status === "success" ? "text-emerald-400" : s.status === "error" ? "text-red-400" : "text-amber-400"
                }`}
              >
                <span className="text-white/30 text-[11px] font-mono min-w-[60px]">[{s.time}]</span>
                <span>{s.status === "success" ? "✓" : s.status === "error" ? "✗" : "⋯"} {s.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
