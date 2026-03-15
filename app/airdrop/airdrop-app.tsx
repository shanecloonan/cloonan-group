"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, RPC_URL, airdropAbi, erc20Abi } from "./abis";
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { logTransaction } from "@/lib/activity";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LogEntry {
  msg: string;
  type: "pending" | "success" | "error" | "info";
  ts: string;
}

interface AirdropLog {
  sender: string;
  token: string;
  amount: string;
  to: string;
  timestamp: string;
  txHash: string;
}

interface CustomList {
  listName: string;
  addresses: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function storageGet<T>(key: string, fb: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fb;
  } catch {
    return fb;
  }
}

function storageSet(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* ignore */ }
}

function now() {
  return new Date().toLocaleTimeString();
}

/* ================================================================== */
/*  Design tokens                                                      */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const textareaCls = "w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all resize-vertical font-mono";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary = "w-full h-12 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
const btnSecondary = "h-10 px-5 rounded-xl font-medium text-sm bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1.5";
const tabBtn = "px-4 py-2 text-xs font-semibold uppercase tracking-wide rounded-lg transition-all cursor-pointer whitespace-nowrap";
const tabActive = "text-amber-400 bg-amber-400/10";
const tabInactive = "text-white/30 hover:text-white/60 hover:bg-white/[0.03]";

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function AirdropApp() {
  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC_URL), []);
  const { user, vaultUnlocked, ethWallets, selectedEthWallet, selectedEthAddress, selectEthWallet, connectMetaMask } = useWallet();

  /* form */
  const [tokenAddress, setTokenAddress] = useState("");
  const [recipients, setRecipients] = useState("");
  const [amountMode, setAmountMode] = useState<"uniform" | "individual">("uniform");
  const [uniformAmount, setUniformAmount] = useState("");
  const [individualAmounts, setIndividualAmounts] = useState("");

  /* tabs */
  const [activeTab, setActiveTab] = useState("master");

  /* master contacts */
  const [masterContacts, setMasterContacts] = useState<string[]>([]);
  const [masterInput, setMasterInput] = useState("");

  /* custom lists */
  const [customLists, setCustomLists] = useState<Record<string, CustomList>>({});
  const [newListName, setNewListName] = useState("");
  const [newListAddrs, setNewListAddrs] = useState("");

  /* airdrop logs */
  const [airdropLogs, setAirdropLogs] = useState<AirdropLog[]>([]);

  /* status */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLogs((p) => [{ msg, type, ts: now() }, ...p].slice(0, 50));
  }, []);

  /* ---- load persisted data ---- */
  useEffect(() => {
    setMasterContacts(storageGet("masterContacts", []));
    setCustomLists(storageGet("airdrop_customLists", {}));
    setAirdropLogs(storageGet("airdrop_logs", []));
  }, []);

  /* ---- get signer ---- */
  const getSigner = useCallback(async () => {
    if (!selectedEthWallet) throw new Error("No wallet selected");
    if (selectedEthWallet.type === "metamask") {
      const ethereum = (window as unknown as { ethereum: ethers.providers.ExternalProvider }).ethereum;
      const p = new ethers.providers.Web3Provider(ethereum);
      return p.getSigner();
    }
    if (!selectedEthWallet.privateKey) throw new Error("Wallet has no private key");
    return new ethers.Wallet(selectedEthWallet.privateKey, provider);
  }, [selectedEthWallet, provider]);

  /* ---- recipient count ---- */
  const recipientList = useMemo(() => recipients.split("\n").map((r) => r.trim()).filter(Boolean), [recipients]);
  const recipientCount = recipientList.length;

  /* ---- gas estimate (rough display only; actual tx uses estimateGas) ---- */
  const estimatedGas = useMemo(() => {
    const base = 60000;
    const per = 65000;
    return base + recipientCount * per + 20000;
  }, [recipientCount]);

  /* ---- amounts ---- */
  const getAmounts = useCallback((): string[] => {
    if (amountMode === "uniform" && uniformAmount) {
      return recipientList.map(() => uniformAmount);
    }
    return individualAmounts.split("\n").map((a) => a.trim()).filter(Boolean);
  }, [amountMode, uniformAmount, individualAmounts, recipientList]);

  /* ---- execute airdrop ---- */
  const executeAirdrop = useCallback(async () => {
    if (!selectedEthWallet) { addLog("Select a wallet first", "error"); return; }
    if (!ethers.utils.isAddress(tokenAddress)) { addLog("Invalid token address", "error"); return; }

    const addrs = recipientList;
    const amounts = getAmounts();

    if (addrs.length === 0) { addLog("No recipients entered", "error"); return; }
    if (addrs.length !== amounts.length) { addLog(`Recipients (${addrs.length}) and amounts (${amounts.length}) count mismatch`, "error"); return; }
    if (!addrs.every((a) => ethers.utils.isAddress(a))) { addLog("One or more invalid recipient addresses", "error"); return; }
    if (!amounts.every((a) => parseFloat(a) > 0)) { addLog("All amounts must be > 0", "error"); return; }

    setBusy(true);
    try {
      const signer = await getSigner();
      const signerAddr = selectedEthWallet.address;
      const token = new ethers.Contract(tokenAddress, erc20Abi, signer);
      const decimals = await token.decimals();
      const amountsWei = amounts.map((a) => ethers.utils.parseUnits(a, decimals));
      const totalWei = amountsWei.reduce((s, a) => s.add(a), ethers.BigNumber.from(0));
      const feeWei = totalWei.mul(2).div(1000);
      const totalWithFee = totalWei.add(feeWei);
      const totalWithBuffer = totalWithFee.mul(110).div(100);

      const balance = await token.balanceOf(signerAddr);
      addLog(`Balance: ${ethers.utils.formatUnits(balance, decimals)}, Required (incl. 0.2% fee): ${ethers.utils.formatUnits(totalWithFee, decimals)}`);

      if (balance.lt(totalWithFee)) {
        addLog("Insufficient token balance (including fees)", "error");
        setBusy(false);
        return;
      }

      const allowance = await token.allowance(signerAddr, CONTRACT_ADDRESS);
      if (allowance.lt(totalWithFee)) {
        addLog("Approving tokens...", "pending");
        const approveTx = await token.approve(CONTRACT_ADDRESS, totalWithBuffer);
        await approveTx.wait();
        addLog("Approval confirmed", "success");
      }

      const contract = new ethers.Contract(CONTRACT_ADDRESS, airdropAbi, signer);
      let gasLimit: ethers.BigNumber;
      try {
        const estimate = await contract.estimateGas.airdropTokens(tokenAddress, addrs, amountsWei);
        gasLimit = estimate.mul(120).div(100);
      } catch {
        gasLimit = ethers.BigNumber.from(estimatedGas);
      }
      addLog(`Sending airdrop to ${addrs.length} recipients (gas limit: ${gasLimit.toString()})...`, "pending");

      const tx = await contract.airdropTokens(tokenAddress, addrs, amountsWei, { gasLimit });
      addLog(`Tx submitted: ${shorten(tx.hash)}`, "pending");
      const receipt = await tx.wait();
      addLog(`Airdrop successful! Gas used: ${receipt.gasUsed.toString()}`, "success");
      if (user) logTransaction({ userId: user.id, walletAddress: signerAddr, txHash: receipt.transactionHash, dapp: "airdrop", action: "airdrop", amount: `${addrs.length} recipients`, gasUsed: receipt.gasUsed.toString(), contractAddress: CONTRACT_ADDRESS, tokenAddress: tokenAddress });

      const newLogs: AirdropLog[] = addrs.map((addr, i) => ({
        sender: signerAddr,
        token: tokenAddress,
        amount: amounts[i],
        to: addr,
        timestamp: new Date().toISOString(),
        txHash: receipt.transactionHash,
      }));
      setAirdropLogs((prev) => {
        const updated = [...newLogs, ...prev];
        storageSet("airdrop_logs", updated);
        return updated;
      });
    } catch (e: unknown) {
      const err = e as { code?: string; reason?: string; message?: string };
      let msg = err.message || "Unknown error";
      if (err.code === "ACTION_REJECTED") msg = "Transaction rejected by wallet";
      else if (err.reason) msg = `Reverted: ${err.reason}`;
      addLog(msg, "error");
    } finally {
      setBusy(false);
    }
  }, [selectedEthWallet, tokenAddress, recipientList, getAmounts, getSigner, estimatedGas, addLog]);

  /* ---- master contacts ---- */
  const addToMaster = useCallback(() => {
    const newAddrs = masterInput.split("\n").map((a) => a.trim()).filter(Boolean);
    if (newAddrs.length === 0) { addLog("Enter at least one address", "error"); return; }
    if (!newAddrs.every((a) => ethers.utils.isAddress(a))) { addLog("Invalid address format", "error"); return; }
    setMasterContacts((prev) => {
      const merged = [...new Set([...prev, ...newAddrs])];
      storageSet("masterContacts", merged);
      return merged;
    });
    setMasterInput("");
    addLog(`Added ${newAddrs.length} address(es) to master list`, "success");
  }, [masterInput, addLog]);

  const removeMaster = useCallback((addr: string) => {
    setMasterContacts((prev) => {
      const updated = prev.filter((a) => a !== addr);
      storageSet("masterContacts", updated);
      return updated;
    });
  }, []);

  const pushMasterToRecipients = useCallback(() => {
    if (masterContacts.length === 0) { addLog("Master list is empty", "error"); return; }
    setRecipients(masterContacts.join("\n"));
    addLog(`${masterContacts.length} addresses loaded into recipients`, "success");
  }, [masterContacts, addLog]);

  /* ---- custom lists ---- */
  const saveCustomList = useCallback(() => {
    if (!newListName.trim()) { addLog("Enter a list name", "error"); return; }
    const addrs = newListAddrs.split("\n").map((a) => a.trim()).filter(Boolean);
    if (addrs.length === 0) { addLog("Enter at least one address", "error"); return; }
    if (!addrs.every((a) => ethers.utils.isAddress(a))) { addLog("Invalid address format", "error"); return; }
    const id = `list_${Date.now()}`;
    setCustomLists((prev) => {
      const updated = { ...prev, [id]: { listName: newListName.trim(), addresses: addrs } };
      storageSet("airdrop_customLists", updated);
      return updated;
    });
    setNewListName("");
    setNewListAddrs("");
    addLog(`Custom list "${newListName.trim()}" created with ${addrs.length} addresses`, "success");
  }, [newListName, newListAddrs, addLog]);

  const loadCustomList = useCallback((id: string) => {
    const list = customLists[id];
    if (!list) return;
    setRecipients(list.addresses.join("\n"));
    addLog(`Loaded "${list.listName}" into recipients`, "success");
  }, [customLists, addLog]);

  const deleteCustomList = useCallback((id: string) => {
    setCustomLists((prev) => {
      const updated = { ...prev };
      delete updated[id];
      storageSet("airdrop_customLists", updated);
      return updated;
    });
  }, []);

  /* ---- airdrop leaderboard ---- */
  const leaderboard = useMemo(() => {
    const counts: Record<string, number> = {};
    airdropLogs.forEach((l) => { counts[l.sender] = (counts[l.sender] || 0) + 1; });
    return Object.entries(counts).sort(([, a], [, b]) => b - a).map(([addr, count]) => ({ addr, count }));
  }, [airdropLogs]);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  if (!user || !vaultUnlocked) {
    return (
      <div className="min-h-screen" style={{ background: "#08090e" }}>
        <div className="w-full max-w-[680px] mx-auto px-4 sm:px-6 py-10">
          <AuthPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[680px] mx-auto px-4 sm:px-6 py-10 space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">MoneyFund Airdrop</h1>
          <p className="text-xs text-white/30">Batch-send ERC-20 tokens to multiple wallets in one transaction</p>
        </div>

        {/* ═══ Wallet ═══ */}
        <div className={`${card} p-5 space-y-3`}>
          <p className={labelCls}>Wallet</p>
          <div className="flex gap-3">
            <select
              value={selectedEthAddress ?? ""}
              onChange={(e) => selectEthWallet(e.target.value || null)}
              className={`${selectCls} flex-1`}
            >
              <option value="">-- Select Wallet --</option>
              {ethWallets.map((w) => (
                <option key={w.address} value={w.address}>{w.type}: {shorten(w.address)}</option>
              ))}
            </select>
            <button type="button" onClick={() => connectMetaMask().catch(() => {})} className={btnSecondary}>MetaMask</button>
          </div>
          {selectedEthWallet && (
            <p className="text-xs text-white/30 font-mono text-center">{selectedEthWallet.address}</p>
          )}
        </div>

        {/* ═══ Token ═══ */}
        <div className={`${card} p-5 space-y-3`}>
          <p className={labelCls}>Token Address</p>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="0x..."
            className={inputCls}
          />
        </div>

        {/* ═══ Recipients ═══ */}
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <p className={labelCls}>Recipients</p>
            <span className="text-[10px] text-white/20 font-mono">{recipientCount} address{recipientCount !== 1 ? "es" : ""}</span>
          </div>
          <textarea
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="One address per line&#10;0x1234...&#10;0xABCD..."
            rows={6}
            className={textareaCls}
          />
        </div>

        {/* ═══ Amount ═══ */}
        <div className={`${card} p-5 space-y-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className={labelCls}>Amount Mode</p>
              <select
                value={amountMode}
                onChange={(e) => setAmountMode(e.target.value as "uniform" | "individual")}
                className={selectCls}
              >
                <option value="uniform">Uniform (same for all)</option>
                <option value="individual">Individual (per line)</option>
              </select>
            </div>
            <div>
              <p className={labelCls}>{amountMode === "uniform" ? "Amount" : "Amounts (one per line)"}</p>
              {amountMode === "uniform" ? (
                <input
                  type="number"
                  value={uniformAmount}
                  onChange={(e) => setUniformAmount(e.target.value)}
                  placeholder="e.g., 100"
                  min={0}
                  step="any"
                  className={inputCls}
                />
              ) : (
                <textarea
                  value={individualAmounts}
                  onChange={(e) => setIndividualAmounts(e.target.value)}
                  placeholder="100&#10;200&#10;50"
                  rows={4}
                  className={textareaCls}
                />
              )}
            </div>
          </div>
          {recipientCount > 0 && (
            <p className="text-[10px] text-white/20 text-center">Estimated gas: ~{estimatedGas.toLocaleString()} units</p>
          )}
        </div>

        {/* ═══ Send Button ═══ */}
        <button
          type="button"
          onClick={executeAirdrop}
          disabled={busy || !selectedEthWallet || !tokenAddress || recipientCount === 0}
          className={btnPrimary}
        >
          {busy ? "Sending..." : "Send Airdrop"}
        </button>

        {/* ═══ Tabs ═══ */}
        <div className={`${card} overflow-hidden`}>
          <div className="flex overflow-x-auto border-b border-white/[0.06] px-3 pt-2 gap-1 scrollbar-none">
            {([
              { id: "master", label: "Master List" },
              { id: "custom", label: "Custom Lists" },
              { id: "leaderboard", label: "Leaderboard" },
              { id: "history", label: "History" },
              { id: "log", label: "Log" },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`${tabBtn} ${activeTab === t.id ? tabActive : tabInactive}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* ---- Master List ---- */}
            {activeTab === "master" && (
              <div className="space-y-3">
                <textarea
                  value={masterInput}
                  onChange={(e) => setMasterInput(e.target.value)}
                  placeholder="0xAddress (one per line)"
                  rows={3}
                  className={textareaCls}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={addToMaster} className={`${btnSecondary} flex-1 text-xs`}>Add to Master</button>
                  <button type="button" onClick={pushMasterToRecipients} className={`${btnSecondary} flex-1 text-xs`}>Push to Recipients</button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-amber-600/30 scrollbar-track-transparent">
                  {masterContacts.length === 0 ? (
                    <p className="text-xs text-white/20 text-center py-3">No addresses yet</p>
                  ) : masterContacts.map((addr, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <span className="text-xs text-white/60 font-mono">{shorten(addr)}</span>
                      <button type="button" onClick={() => removeMaster(addr)} className="text-[10px] text-red-400/60 hover:text-red-400 cursor-pointer transition-colors">Remove</button>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-white/20 text-center">{masterContacts.length} total</p>
              </div>
            )}

            {/* ---- Custom Lists ---- */}
            {activeTab === "custom" && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="List name"
                  className={inputCls}
                />
                <textarea
                  value={newListAddrs}
                  onChange={(e) => setNewListAddrs(e.target.value)}
                  placeholder="0xAddress (one per line)"
                  rows={3}
                  className={textareaCls}
                />
                <button type="button" onClick={saveCustomList} className={`${btnSecondary} w-full text-xs`}>Create List</button>
                <div className="max-h-40 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-amber-600/30 scrollbar-track-transparent">
                  {Object.keys(customLists).length === 0 ? (
                    <p className="text-xs text-white/20 text-center py-3">No custom lists</p>
                  ) : Object.entries(customLists).map(([id, list]) => (
                    <div key={id} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <span className="text-xs text-white/60">{list.listName} <span className="text-white/20">({list.addresses.length})</span></span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => loadCustomList(id)} className="text-[10px] text-amber-400/60 hover:text-amber-400 cursor-pointer transition-colors">Load</button>
                        <button type="button" onClick={() => deleteCustomList(id)} className="text-[10px] text-red-400/60 hover:text-red-400 cursor-pointer transition-colors">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Leaderboard ---- */}
            {activeTab === "leaderboard" && (
              <div className="max-h-48 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-amber-600/30 scrollbar-track-transparent">
                {leaderboard.length === 0 ? (
                  <p className="text-xs text-white/20 text-center py-3">No airdrops recorded yet</p>
                ) : leaderboard.map((entry, i) => (
                  <div key={entry.addr} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold ${i === 0 ? "text-amber-400" : i === 1 ? "text-gray-300" : i === 2 ? "text-orange-400" : "text-white/30"}`}>#{i + 1}</span>
                      <span className="text-xs text-white/60 font-mono">{shorten(entry.addr)}</span>
                    </div>
                    <span className="text-xs text-white/40">{entry.count} airdrop{entry.count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ---- History ---- */}
            {activeTab === "history" && (
              <div className="max-h-64 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-amber-600/30 scrollbar-track-transparent">
                {airdropLogs.length === 0 ? (
                  <p className="text-xs text-white/20 text-center py-3">No airdrops logged yet</p>
                ) : airdropLogs.slice(0, 50).map((log, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs text-white/50 space-y-0.5">
                    <div className="flex justify-between">
                      <span className="font-mono text-white/40">{shorten(log.sender)} → {shorten(log.to)}</span>
                      <span className="text-white/20">{log.amount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/20 font-mono">{shorten(log.txHash)}</span>
                      <span className="text-white/15">{new Date(log.timestamp).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ---- Log ---- */}
            {activeTab === "log" && (
              <div className="max-h-48 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-amber-600/30 scrollbar-track-transparent">
                {logs.length === 0 ? (
                  <p className="text-xs text-white/20 text-center py-3">No activity yet</p>
                ) : logs.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02]">
                    <span className={`text-[10px] mt-0.5 ${
                      l.type === "success" ? "text-emerald-400" :
                      l.type === "error" ? "text-red-400" :
                      l.type === "pending" ? "text-amber-400" :
                      "text-white/30"
                    }`}>{l.type === "success" ? "✓" : l.type === "error" ? "✗" : l.type === "pending" ? "⋯" : "·"}</span>
                    <span className="text-xs text-white/50 flex-1 break-all">{l.msg}</span>
                    <span className="text-[9px] text-white/15 shrink-0">{l.ts}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[10px] text-white/10 pt-4">0.2% fee per airdrop</p>
      </div>
    </div>
  );
}
