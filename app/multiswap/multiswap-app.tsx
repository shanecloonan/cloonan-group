"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { FACTORY_ADDRESS, RPC_URL, factoryAbi } from "./abis";
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { logTransaction } from "@/lib/activity";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

interface LogEntry {
  msg: string;
  type: "pending" | "success" | "error";
  ts: string;
}

interface FeeRow {
  address: string;
  percent: string;
}

interface DeployedContract {
  contractAddress: string;
  swapReceivers: string[];
  swapBps: number[];
  distReceivers: string[];
  distBps: number[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/* ================================================================== */
/*  Design tokens                                                      */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary = "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
const btnGhost = "h-11 px-5 rounded-xl font-medium text-sm border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";
const sectionTitle = "text-sm font-semibold text-white/80 mb-3 pb-2 border-b border-white/[0.06]";

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function MultiswapApp() {
  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC_URL), []);

  /* wallet */
  const { user, vaultUnlocked, ethWallets, selectedEthWallet, selectedEthAddress, selectEthWallet, connectMetaMask, isLoading } = useWallet();

  /* deploy form */
  const [showCustomize, setShowCustomize] = useState(false);
  const [swapFees, setSwapFees] = useState<FeeRow[]>([{ address: "", percent: "" }]);
  const [airdropFees, setAirdropFees] = useState<FeeRow[]>([{ address: "", percent: "" }]);

  /* deployed contracts */
  const [deployed, setDeployed] = useState<DeployedContract[]>([]);

  /* log */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const log = useCallback((msg: string, type: LogEntry["type"] = "pending") => {
    const ts = new Date().toLocaleTimeString();
    setLogs((p) => [...p, { msg, type, ts }].slice(-200));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  /* ---- refresh deployed contracts ---- */
  const refreshContracts = useCallback(async () => {
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, provider);
      const all = await factory.getAllDeployedContracts();
      const list: DeployedContract[] = all.map((c: any) => ({
        contractAddress: c.contractAddress,
        swapReceivers: [...c.swapFeeReceivers],
        swapBps: c.swapFeeBps.map((b: any) => Number(b)),
        distReceivers: [...c.distributeFeeReceivers],
        distBps: c.distributeFeeBps.map((b: any) => Number(b)),
      }));
      setDeployed(list);
    } catch (e: any) {
      log(`Failed to fetch contracts: ${e.message}`, "error");
    }
  }, [provider, log]);

  useEffect(() => {
    refreshContracts();
  }, [refreshContracts]);

  /* ---- deploy ---- */
  const handleDeploy = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    setBusy(true);
    try {
      const swapReceivers: string[] = [];
      const swapBps: number[] = [];
      swapFees.forEach((r) => {
        const addr = r.address.trim();
        const pct = parseFloat(r.percent) || 0;
        if (ethers.utils.isAddress(addr) && addr !== ZERO_ADDR && pct > 0) {
          swapReceivers.push(addr);
          swapBps.push(Math.floor(pct * 100));
        }
      });

      const distReceivers: string[] = [];
      const distBps: number[] = [];
      airdropFees.forEach((r) => {
        const addr = r.address.trim();
        const pct = parseFloat(r.percent) || 0;
        if (ethers.utils.isAddress(addr) && addr !== ZERO_ADDR && pct > 0) {
          distReceivers.push(addr);
          distBps.push(Math.floor(pct * 100));
        }
      });

      const totalSwap = swapBps.reduce((a, b) => a + b, 0);
      const totalDist = distBps.reduce((a, b) => a + b, 0);
      if (totalSwap > 300) { log("Total swap fees cannot exceed 3%.", "error"); setBusy(false); return; }
      if (totalDist > 300) { log("Total airdrop fees cannot exceed 3%.", "error"); setBusy(false); return; }

      if (selectedEthWallet.type === "metamask") {
        const mmProvider = new ethers.providers.Web3Provider((window as any).ethereum);
        const mmSigner = mmProvider.getSigner();
        const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, mmSigner);
        log("Deploying via MetaMask...");
        const tx = await factory.deploySwapAirdropSendContract(swapReceivers, swapBps, distReceivers, distBps);
        log(`Tx: ${shorten(tx.hash)}`);
        const receipt = await tx.wait();
        if (receipt.status === 1) {
          const evt = receipt.events?.find((e: any) => e.event === "SwapAirdropSendContractDeployed");
          log(`Contract deployed at: ${evt?.args?.contractAddress || "check logs"}`, "success");
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "multiswap", action: "deploy_multiswap" });
          await refreshContracts();
        } else {
          log("Deploy reverted.", "error");
        }
      } else if (selectedEthWallet.privateKey) {
        const signer = new ethers.Wallet(selectedEthWallet.privateKey, provider);
        const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, signer);
        log("Estimating gas...");
        const gasEst = await factory.estimateGas.deploySwapAirdropSendContract(swapReceivers, swapBps, distReceivers, distBps);
        log(`Gas estimate: ${gasEst.toString()}`);
        log("Deploying...");
        const tx = await factory.deploySwapAirdropSendContract(swapReceivers, swapBps, distReceivers, distBps, {
          gasLimit: gasEst.mul(120).div(100),
        });
        log(`Tx: ${shorten(tx.hash)}`);
        const receipt = await tx.wait();
        if (receipt.status === 1) {
          const evt = receipt.events?.find((e: any) => e.event === "SwapAirdropSendContractDeployed");
          log(`Contract deployed at: ${evt?.args?.contractAddress || "check logs"}`, "success");
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "multiswap", action: "deploy_multiswap" });
          await refreshContracts();
        } else {
          log("Deploy reverted.", "error");
        }
      } else {
        log("Selected wallet has no private key and is not MetaMask.", "error");
      }
    } catch (e: any) {
      log(`Deploy failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, provider, swapFees, airdropFees, log, refreshContracts]);

  /* ---- copy embed code ---- */
  const copyEmbed = useCallback(() => {
    const addr = deployed.length > 0 ? deployed[deployed.length - 1].contractAddress : FACTORY_ADDRESS;
    const code = `<div id="moneyfund-multiswap-widget"></div>
<script src="https://moneyfund.com/smc.js"></script>
<script>
  window.initMoneyFundMultiswap('moneyfund-multiswap-widget', {
    contractAddress: '${addr}'
  });
</script>`;
    navigator.clipboard.writeText(code).then(() => {
      log(`Embed code copied (${addr.slice(0, 6)}...${addr.slice(-4)})!`, "success");
    }).catch((e) => {
      log(`Copy failed: ${e.message}`, "error");
    });
  }, [log, deployed]);

  /* ---- fee totals ---- */
  const totalSwapPct = swapFees.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0);
  const totalAirdropPct = airdropFees.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  if (!user || !vaultUnlocked) {
    return (
      <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
        <div className="w-full max-w-[720px] mx-auto pt-12">
          <AuthPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[720px] mx-auto space-y-5">

        {/* Title */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">Multiswap Factory</h1>
          <p className="text-xs text-white/30 mt-1">Deploy custom swap and airdrop contracts</p>
        </div>

        {/* ── Wallet ── */}
        <div className={`${card} p-5 space-y-3`}>
          <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Wallet</span>
          <div className="flex gap-2">
            <select
              value={selectedEthAddress ?? ""}
              onChange={(e) => selectEthWallet(e.target.value || null)}
              className={`flex-1 ${selectCls}`}
            >
              <option value="">Select a wallet...</option>
              {ethWallets.map((w) => (
                <option key={w.address} value={w.address}>{w.type ? `${w.type}: ` : ""}{shorten(w.address)}</option>
              ))}
            </select>
            <button type="button" onClick={() => connectMetaMask().catch(() => {})} className={btnGhost}>MetaMask</button>
          </div>
        </div>

        {/* ── Deploy ── */}
        <div className={`${card} p-5 space-y-4`}>
          <h2 className={sectionTitle}>Deploy Multiswap Contract</h2>

          <button
            type="button"
            onClick={() => setShowCustomize(!showCustomize)}
            className={`${btnGhost} w-full flex items-center justify-center gap-2`}
          >
            {showCustomize ? "Hide" : "Customize"} Fees
          </button>

          {showCustomize && (
            <div className="space-y-5 pt-2">
              {/* Swap Fees */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Swap Fees</span>
                {swapFees.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px] gap-2">
                    <input
                      value={row.address}
                      onChange={(e) => { const v = e.target.value; setSwapFees((p) => p.map((r, j) => j === i ? { ...r, address: v } : r)); }}
                      placeholder={`Receiver ${i + 1} address`}
                      className={inputCls}
                    />
                    <input
                      type="number"
                      value={row.percent}
                      onChange={(e) => { const v = e.target.value; setSwapFees((p) => p.map((r, j) => j === i ? { ...r, percent: v } : r)); }}
                      placeholder="%"
                      min="0" max="3" step="0.01"
                      className={inputCls}
                    />
                  </div>
                ))}
                <button type="button" onClick={() => setSwapFees((p) => [...p, { address: "", percent: "" }])} className={`${btnGhost} w-full text-xs`}>+ Add Swap Receiver</button>
                <p className={`text-xs ${totalSwapPct > 3 ? "text-red-400" : "text-white/40"}`}>
                  Total: {totalSwapPct.toFixed(2)}% / 3% max
                </p>
              </div>

              {/* Airdrop Fees */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Airdrop Fees</span>
                {airdropFees.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px] gap-2">
                    <input
                      value={row.address}
                      onChange={(e) => { const v = e.target.value; setAirdropFees((p) => p.map((r, j) => j === i ? { ...r, address: v } : r)); }}
                      placeholder={`Receiver ${i + 1} address`}
                      className={inputCls}
                    />
                    <input
                      type="number"
                      value={row.percent}
                      onChange={(e) => { const v = e.target.value; setAirdropFees((p) => p.map((r, j) => j === i ? { ...r, percent: v } : r)); }}
                      placeholder="%"
                      min="0" max="3" step="0.01"
                      className={inputCls}
                    />
                  </div>
                ))}
                <button type="button" onClick={() => setAirdropFees((p) => [...p, { address: "", percent: "" }])} className={`${btnGhost} w-full text-xs`}>+ Add Airdrop Receiver</button>
                <p className={`text-xs ${totalAirdropPct > 3 ? "text-red-400" : "text-white/40"}`}>
                  Total: {totalAirdropPct.toFixed(2)}% / 3% max
                </p>
              </div>
            </div>
          )}

          <button type="button" onClick={handleDeploy} disabled={!selectedEthWallet || busy} className={btnPrimary}>
            Deploy Multiswap
          </button>

          <button type="button" onClick={copyEmbed} className={`${btnGhost} w-full flex items-center justify-center gap-2`}>
            Copy Embed Widget Code
          </button>

          <div className="flex justify-end">
            <a
              href="https://moneyfund.com/multiswap"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-indigo-400/60 hover:text-indigo-400 transition-colors"
            >
              View Example Widget &rarr;
            </a>
          </div>
        </div>

        {/* ── Deployed Contracts ── */}
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Deployed Contracts</h2>
            <button type="button" onClick={refreshContracts} className="text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
              Refresh
            </button>
          </div>
          {deployed.length === 0 ? (
            <p className="text-xs text-white/40 py-4 text-center">No contracts found.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
              {deployed.map((c, i) => (
                <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white/30">Contract</span>
                    <span className="text-white/70 font-mono">{shorten(c.contractAddress)}</span>
                  </div>
                  {c.swapReceivers.length > 0 && (
                    <div>
                      <span className="text-white/30">Swap Fees</span>
                      {c.swapReceivers.map((r, j) => (
                        <p key={j} className="text-white/50 font-mono">
                          {shorten(r)} — {(c.swapBps[j] / 100).toFixed(2)}%
                        </p>
                      ))}
                    </div>
                  )}
                  {c.distReceivers.length > 0 && (
                    <div>
                      <span className="text-white/30">Airdrop Fees</span>
                      {c.distReceivers.map((r, j) => (
                        <p key={j} className="text-white/50 font-mono">
                          {shorten(r)} — {(c.distBps[j] / 100).toFixed(2)}%
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Status Log ── */}
        <div className={`${card} p-5 space-y-3`}>
          <h2 className="text-sm font-semibold text-white/80">Status Log</h2>
          <div
            ref={logRef}
            className="max-h-[160px] overflow-y-auto space-y-1 pr-1"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}
          >
            {logs.length === 0 ? (
              <p className="text-xs text-white/40 py-2 text-center">Waiting for activity...</p>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={`text-xs py-1.5 px-3 rounded-lg ${
                    l.type === "success" ? "text-emerald-400 bg-emerald-500/5"
                      : l.type === "error" ? "text-red-400 bg-red-500/5"
                        : "text-white/50 bg-white/[0.02]"
                  }`}
                >
                  <span className="text-white/40 mr-2">[{l.ts}]</span>
                  {l.msg}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Powered by ── */}
        <p className="text-center text-[11px] text-white/40 pb-4">Powered by MoneyFund</p>
      </div>
    </div>
  );
}
