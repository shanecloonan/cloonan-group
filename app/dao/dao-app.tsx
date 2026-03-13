"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { FACTORY_ADDRESS, FACTORY_ABI, DAO_ABI, TOKEN_ABI, INFURA_RPC } from "./abis";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    ethereum?: any;
  }
}

interface Proposal {
  id: number;
  proposer: string;
  proposalType: number;
  destination: string;
  amount: ethers.BigNumber;
  tokenAddress: string;
  yesWeight: ethers.BigNumber;
  noWeight: ethers.BigNumber;
  startTime: ethers.BigNumber;
  endTime: ethers.BigNumber;
  totalVotedTokens: ethers.BigNumber;
  executed: boolean;
  hasReclaimed?: boolean;
  lockedTokens?: number;
}

interface DaoInfo {
  address: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  ethBalance: string;
  tokenBalance: number;
  votingWeight: number;
  votingPeriodDays: number;
  countNonRespondersAsYes: boolean;
  voteLockPct: number;
  majorityThreshold: number;
  maxProposalsPerDay: number;
  slippage: number;
  proposals: Proposal[];
}

interface LogEntry {
  time: string;
  msg: string;
}

function ts() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shorten(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DaoApp() {
  const [account, setAccount] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [daos, setDaos] = useState<DaoInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  /* launch form */
  const [tokenAddr, setTokenAddr] = useState("");
  const [votingDays, setVotingDays] = useState("");
  const [silence, setSilence] = useState("true");
  const [lockPct, setLockPct] = useState("");
  const [majority, setMajority] = useState("");
  const [maxProp, setMaxProp] = useState("");
  const [slip, setSlip] = useState("");

  /* expanded sections per DAO */
  const [openForms, setOpenForms] = useState<Record<string, string | null>>({});

  /* proposal form state per DAO */
  const [propType, setPropType] = useState<Record<string, string>>({});
  const [propDest, setPropDest] = useState<Record<string, string>>({});
  const [propAmt, setPropAmt] = useState<Record<string, string>>({});
  const [propToken, setPropToken] = useState<Record<string, string>>({});

  const signerRef = useRef<ethers.Signer | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const log = useCallback((msg: string) => {
    setLogs((p) => [...p, { time: ts(), msg }]);
  }, []);

  useEffect(() => {
    logBoxRef.current?.scrollTo(0, logBoxRef.current.scrollHeight);
  }, [logs]);

  /* ---- read provider ---- */
  const getReadProvider = useCallback(() => new ethers.providers.JsonRpcProvider(INFURA_RPC), []);

  /* ---- connect wallet ---- */
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      log("Install MetaMask!");
      return;
    }
    log("Connecting MetaMask...");
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const net = await provider.getNetwork();
      if (net.chainId !== 1) throw new Error("Switch to Ethereum Mainnet");
      const signer = provider.getSigner();
      const addr = await signer.getAddress();
      signerRef.current = signer;
      setAccount(addr);
      log(`Connected: ${shorten(addr)}`);
    } catch (e: any) {
      log(`Connection failed: ${e.message}`);
    }
  }, [log]);

  /* ---- refresh DAOs ---- */
  const refreshDAOs = useCallback(async () => {
    setLoading(true);
    log("Refreshing DAO list...");
    try {
      const rp = getReadProvider();
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, rp);
      const addresses: string[] = await factory.getAllDAOs();
      log(`Found ${addresses.length} DAOs`);

      const results: DaoInfo[] = [];
      for (const addr of addresses) {
        if (addr === ethers.constants.AddressZero) continue;
        try {
          const dao = new ethers.Contract(addr, DAO_ABI, rp);
          const info = await dao.getDAOInfoBasic();
          const tok = new ethers.Contract(info.tokenAddress, TOKEN_ABI, rp);
          let name = "Unknown", symbol = "UNK", decimals = 18;
          try {
            [name, symbol, decimals] = await Promise.all([tok.name(), tok.symbol(), tok.decimals()]);
          } catch { /* skip */ }

          const vpDays = Number(info.votingPeriod) / 86400;
          const vlp = Number(info.voteLockPercentage) / 100;
          const mt = Number(info.majorityThreshold);
          const mppd = Number(info.maxProposalsPerDay);
          const sl = Number(info.slippage) / 100;
          const ethBal = ethers.utils.formatEther(info.ethBalance);
          const tokBal = Number(info.tokenBalance) / 10 ** decimals;

          let vw = 0;
          if (account) {
            try {
              const w = await dao.getVotingWeight(account);
              vw = Number(w) / 10 ** decimals;
            } catch { /* skip */ }
          }

          const pCount = Number(await dao.proposalCount());
          const proposals: Proposal[] = [];
          for (let i = 0; i < pCount; i++) {
            try {
              const p = await dao.getProposal(i);
              let hasReclaimed = false;
              let locked = 0;
              if (account) {
                try { hasReclaimed = await dao.hasReclaimed(i, account); } catch { /* skip */ }
                try { locked = Number(await dao.lockedTokens(i, account)) / 10 ** decimals; } catch { /* skip */ }
              }
              proposals.push({ ...p, hasReclaimed, lockedTokens: locked });
            } catch { /* skip proposal */ }
          }

          results.push({
            address: addr,
            tokenAddress: info.tokenAddress,
            tokenName: name,
            tokenSymbol: symbol,
            tokenDecimals: decimals,
            ethBalance: ethBal,
            tokenBalance: tokBal,
            votingWeight: vw,
            votingPeriodDays: vpDays,
            countNonRespondersAsYes: info.countNonRespondersAsYes,
            voteLockPct: vlp,
            majorityThreshold: mt,
            maxProposalsPerDay: mppd,
            slippage: sl,
            proposals,
          });
        } catch (e: any) {
          log(`Error loading DAO ${shorten(addr)}: ${e.message}`);
        }
      }
      setDaos(results);
      log("DAO list refreshed");
    } catch (e: any) {
      log(`Refresh failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [account, getReadProvider, log]);

  useEffect(() => {
    refreshDAOs();
  }, [refreshDAOs]);

  /* ---- create DAO ---- */
  const createDAO = useCallback(async () => {
    if (!signerRef.current) { log("Connect wallet first"); return; }
    if (!tokenAddr || !votingDays || !lockPct || !majority || maxProp === "" || slip === "") {
      log("Fill in all fields"); return;
    }
    setStatus("Deploying DAO...");
    log("Creating DAO...");
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signerRef.current);
      const vpSec = parseInt(votingDays) * 86400;
      const slBips = Math.round(parseFloat(slip) * 100);
      const tx = await factory.createDAO(
        tokenAddr, vpSec, silence === "true",
        Math.round(parseFloat(lockPct) * 100),
        parseInt(majority), parseInt(maxProp), slBips,
      );
      log("Waiting for confirmation...");
      const receipt = await tx.wait();
      log(`DAO created! Tx: ${receipt.transactionHash}`);
      setStatus(`DAO deployed! Tx: ${shorten(receipt.transactionHash)}`);
      await refreshDAOs();
    } catch (e: any) {
      log(`DAO creation failed: ${e.message}`);
      setStatus(`Failed: ${e.message}`);
    }
  }, [tokenAddr, votingDays, silence, lockPct, majority, maxProp, slip, log, refreshDAOs]);

  /* ---- proposal actions ---- */
  const submitProposal = useCallback(async (daoAddr: string) => {
    if (!signerRef.current) { log("Connect wallet first"); return; }
    const pT = propType[daoAddr] ?? "0";
    const dest = propDest[daoAddr] || ethers.constants.AddressZero;
    const amt = propAmt[daoAddr] || "0";
    const tok = propToken[daoAddr] || "";
    if (!tok) { log("Fill in token address"); return; }
    log(`Creating proposal for ${shorten(daoAddr)}...`);
    try {
      const dao = new ethers.Contract(daoAddr, DAO_ABI, signerRef.current);
      const tx = await dao.createProposal(parseInt(pT), dest, ethers.utils.parseEther(amt), tok);
      await tx.wait();
      log("Proposal created!");
      await refreshDAOs();
    } catch (e: any) {
      log(`Proposal failed: ${e.message}`);
    }
  }, [propType, propDest, propAmt, propToken, log, refreshDAOs]);

  const doVote = useCallback(async (daoAddr: string, pId: number, support: boolean) => {
    if (!signerRef.current) { log("Connect wallet first"); return; }
    log(`Voting ${support ? "Yes" : "No"} on proposal ${pId}...`);
    try {
      const dao = new ethers.Contract(daoAddr, DAO_ABI, signerRef.current);
      const tx = await dao.vote(pId, support);
      await tx.wait();
      log(`Voted ${support ? "Yes" : "No"}!`);
      await refreshDAOs();
    } catch (e: any) {
      log(`Vote failed: ${e.message}`);
    }
  }, [log, refreshDAOs]);

  const doExecute = useCallback(async (daoAddr: string, pId: number) => {
    if (!signerRef.current) { log("Connect wallet first"); return; }
    log(`Executing proposal ${pId}...`);
    try {
      const dao = new ethers.Contract(daoAddr, DAO_ABI, signerRef.current);
      const tx = await dao.executeProposal(pId);
      await tx.wait();
      log("Proposal executed!");
      await refreshDAOs();
    } catch (e: any) {
      log(`Execute failed: ${e.message}`);
    }
  }, [log, refreshDAOs]);

  const doReclaim = useCallback(async (daoAddr: string, pId: number) => {
    if (!signerRef.current) { log("Connect wallet first"); return; }
    log(`Reclaiming tokens for proposal ${pId}...`);
    try {
      const dao = new ethers.Contract(daoAddr, DAO_ABI, signerRef.current);
      const tx = await dao.reclaimTokens(pId);
      await tx.wait();
      log("Tokens reclaimed!");
      await refreshDAOs();
    } catch (e: any) {
      log(`Reclaim failed: ${e.message}`);
    }
  }, [log, refreshDAOs]);

  /* ================================================================ */
  /*  Design tokens                                                    */
  /* ================================================================ */

  const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
  const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
  const selectCls = `${inputCls} appearance-none cursor-pointer`;
  const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
  const btnGold = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
  const btnGhost = "h-9 px-4 rounded-lg font-medium text-xs border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";
  const labelCls = "block text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1.5";

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen p-4 sm:p-10" style={{ background: "#08090e" }}>
      {/* ── Top bar: wallet connect ── */}
      <div className="max-w-[1100px] mx-auto mb-8 flex items-center gap-4">
        <button type="button" onClick={connect} className={btnPrimary}>
          {account ? "Reconnect" : "Connect Wallet"}
        </button>
        {account && (
          <span className="text-sm font-mono text-white/50 truncate">
            {account}
          </span>
        )}
      </div>

      <div className="max-w-[1100px] mx-auto flex flex-col lg:flex-row gap-8">
        {/* ── LEFT: Launch form ── */}
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-white/90 text-center mb-6">
            Launch a <span className="text-amber-400">DAO</span>
          </h2>

          <div className={`${card} p-6 space-y-4`}>
            <div>
              <label className={labelCls}>Token Address</label>
              <input value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} placeholder="0x..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Voting Period (days)</label>
              <input type="number" value={votingDays} onChange={(e) => setVotingDays(e.target.value)} placeholder="e.g., 1" min="1" step="1" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Silence = Consent</label>
              <select value={silence} onChange={(e) => setSilence(e.target.value)} className={selectCls}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Vote Lock % (0-100)</label>
              <input type="number" value={lockPct} onChange={(e) => setLockPct(e.target.value)} placeholder="e.g., 10" min="0" max="100" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Majority Threshold (1-100)</label>
              <input type="number" value={majority} onChange={(e) => setMajority(e.target.value)} placeholder="e.g., 51" min="1" max="100" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Max Proposals Per Day (0 = unlimited)</label>
              <input type="number" value={maxProp} onChange={(e) => setMaxProp(e.target.value)} placeholder="e.g., 5" min="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Slippage (0-10%)</label>
              <input type="number" value={slip} onChange={(e) => setSlip(e.target.value)} placeholder="e.g., 0.5" min="0" max="10" step="0.1" className={inputCls} />
            </div>

            <button type="button" onClick={createDAO} disabled={!account} className={`w-full ${btnGold}`}>
              Launch DAO
            </button>
            {status && <p className="text-sm text-white/50 mt-2">{status}</p>}
          </div>
        </div>

        {/* ── RIGHT: All DAOs ── */}
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-white/90 text-center mb-6">
            All <span className="text-indigo-400">DAOs</span>
          </h2>

          {loading && <p className="text-white/30 text-center animate-pulse">Loading DAOs...</p>}

          <div className="space-y-5 max-h-[600px] overflow-y-auto pr-1">
            {daos.length === 0 && !loading && (
              <p className="text-white/20 text-center py-10">No DAOs found.</p>
            )}
            {daos.map((d) => {
              const now = Math.floor(Date.now() / 1000);
              return (
                <div key={d.address} className={`${card} p-5`}>
                  {/* Header */}
                  <div className="flex justify-between items-center mb-3 pb-2 border-b border-white/[0.06]">
                    <h3 className="text-lg font-bold text-white/90">
                      {d.tokenName} ({d.tokenSymbol})
                    </h3>
                    <span className="text-sm font-mono text-white/40">{shorten(d.address)}</span>
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-xs mb-4">
                    {[
                      { label: "DAO", val: shorten(d.address) },
                      { label: "Token", val: shorten(d.tokenAddress) },
                      { label: "ETH Balance", val: `${parseFloat(d.ethBalance).toFixed(4)} ETH` },
                      { label: "Token Balance", val: `${d.tokenBalance.toFixed(2)} ${d.tokenSymbol}` },
                      { label: "Your Weight", val: `${d.votingWeight.toFixed(2)} ${d.tokenSymbol}` },
                      { label: "Voting Period", val: `${d.votingPeriodDays.toFixed(2)} days` },
                      { label: "Silence=Consent", val: d.countNonRespondersAsYes ? "Yes" : "No" },
                      { label: "Vote Lock", val: `${d.voteLockPct.toFixed(2)}%` },
                      { label: "Majority", val: `${d.majorityThreshold}%` },
                      { label: "Max Props/Day", val: String(d.maxProposalsPerDay) },
                      { label: "Slippage", val: `${d.slippage.toFixed(2)}%` },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="text-white/30 text-[10px] uppercase mb-0.5">{item.label}</div>
                        <div className="text-white/70 text-xs truncate">{item.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <button type="button" onClick={() => navigator.clipboard.writeText(d.address)} className={btnGhost}>
                      Copy DAO Addr
                    </button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(d.tokenAddress)} className={btnGhost}>
                      Copy Token Addr
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenForms((p) => ({ ...p, [d.address]: p[d.address] === "proposal" ? null : "proposal" }))}
                      className={btnGhost}
                    >
                      {openForms[d.address] === "proposal" ? "Hide" : "Create Proposal"}
                    </button>
                  </div>

                  {/* Proposal form */}
                  {openForms[d.address] === "proposal" && (
                    <div className={`${card} p-4 space-y-3 mb-4`}>
                      <h4 className="text-sm font-bold text-white/80 mb-2">Create Proposal</h4>
                      <select
                        value={propType[d.address] ?? "0"}
                        onChange={(e) => setPropType((p) => ({ ...p, [d.address]: e.target.value }))}
                        className={selectCls}
                      >
                        <option value="0">Send ETH</option>
                        <option value="1">Send Tokens</option>
                      </select>
                      <input
                        placeholder="Destination (0x...)"
                        value={propDest[d.address] ?? ""}
                        onChange={(e) => setPropDest((p) => ({ ...p, [d.address]: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        placeholder="Amount (e.g., 1.0)"
                        value={propAmt[d.address] ?? ""}
                        onChange={(e) => setPropAmt((p) => ({ ...p, [d.address]: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        placeholder="Token Address (0x...)"
                        value={propToken[d.address] ?? ""}
                        onChange={(e) => setPropToken((p) => ({ ...p, [d.address]: e.target.value }))}
                        className={inputCls}
                      />
                      <button type="button" onClick={() => submitProposal(d.address)} className={`w-full ${btnPrimary}`}>
                        Submit Proposal
                      </button>
                    </div>
                  )}

                  {/* Proposals list */}
                  <div>
                    <h4 className="text-sm font-bold text-white/80 mb-2">Proposals</h4>
                    {d.proposals.length === 0 ? (
                      <p className="text-white/30 text-xs">No proposals yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {d.proposals.map((p) => {
                          const ended = Number(p.endTime) <= now;
                          return (
                            <div
                              key={p.id}
                              className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-3 text-xs text-white/60"
                            >
                              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
                                <span>ID: {p.id}</span>
                                <span>{p.proposalType === 0 ? "Send ETH" : "Send Tokens"}</span>
                                <span>To: {shorten(p.destination)}</span>
                                <span>Amt: {ethers.utils.formatEther(p.amount)}</span>
                                <span className="text-emerald-400">
                                  Yes: {ethers.utils.formatEther(p.yesWeight)}
                                </span>
                                <span className="text-red-400">
                                  No: {ethers.utils.formatEther(p.noWeight)}
                                </span>
                                <span>
                                  Ends: {new Date(Number(p.endTime) * 1000).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {!p.executed && !ended && (
                                  <>
                                    <button type="button" onClick={() => doVote(d.address, p.id, true)} className={`${btnGhost} text-emerald-400 border-emerald-400/20`}>
                                      Vote Yes
                                    </button>
                                    <button type="button" onClick={() => doVote(d.address, p.id, false)} className={`${btnGhost} text-red-400 border-red-400/20`}>
                                      Vote No
                                    </button>
                                  </>
                                )}
                                {!p.executed && ended && (
                                  <button type="button" onClick={() => doExecute(d.address, p.id)} className={btnGold}>
                                    Execute
                                  </button>
                                )}
                                {(p.lockedTokens ?? 0) > 0 && !p.hasReclaimed && (
                                  <button type="button" onClick={() => doReclaim(d.address, p.id)} className={btnGhost}>
                                    Reclaim ({p.lockedTokens} {d.tokenSymbol})
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Log box below DAO list ── */}
      <div className="max-w-[1100px] mx-auto mt-8">
        <div
          ref={logBoxRef}
          className={`${card} p-4 max-h-32 overflow-y-auto text-xs text-white/50`}
        >
          {logs.map((l, i) => (
            <p key={i} className="py-0.5 border-b border-white/[0.04] last:border-b-0">
              <span className="text-white/25 mr-2">[{l.time}]</span>
              {l.msg}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
