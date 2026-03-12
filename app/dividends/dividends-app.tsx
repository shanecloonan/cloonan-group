"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import {
  FACTORY_ADDRESS,
  FACTORY_ABI,
  POOL_ABI,
  ERC20_ABI,
  INFURA_RPC,
} from "./abis";

declare global {
  interface Window {
    ethereum?: any;
  }
}

interface PoolInfo {
  address: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  hardLockDays: number;
  initialPenalty: number;
  penaltyDecay: number;
  totalStaked: string;
  userStake: number;
  userTokenIds: { id: string; amount: string }[];
}

interface LogEntry {
  time: string;
  msg: string;
  error?: boolean;
}

function ts() {
  return new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function shorten(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export default function DividendsApp() {
  const [account, setAccount] = useState<string | null>(null);
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState("");

  /* launch form */
  const [tokenAddr, setTokenAddr] = useState("");
  const [hardLock, setHardLock] = useState("");
  const [initPenalty, setInitPenalty] = useState("");
  const [decayPct, setDecayPct] = useState("");

  /* breakeven calc */
  const [beH, setBeH] = useState("");
  const [beP, setBeP] = useState("");
  const [beD, setBeD] = useState("");

  /* per-pool UI state */
  const [stakeAmts, setStakeAmts] = useState<Record<string, string>>({});
  const [unstakeIds, setUnstakeIds] = useState<Record<string, string>>({});
  const [claimIds, setClaimIds] = useState<Record<string, string>>({});
  const [regTokens, setRegTokens] = useState<Record<string, string>>({});
  const [unregTokens, setUnregTokens] = useState<Record<string, string>>({});
  const [showRewards, setShowRewards] = useState<Record<string, boolean>>({});

  const signerRef = useRef<ethers.Signer | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const log = useCallback((msg: string, error = false) => {
    setLogs((p) => [...p, { time: ts(), msg, error }]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  const readProvider = useMemo(
    () => new ethers.providers.JsonRpcProvider(INFURA_RPC),
    [],
  );

  const breakeven = useMemo(() => {
    const h = parseFloat(beH);
    const p = parseFloat(beP);
    const d = parseFloat(beD);
    if (!isNaN(h) && !isNaN(p) && !isNaN(d) && d > 0)
      return (h + p / d).toFixed(2);
    return "0";
  }, [beH, beP, beD]);

  /* ---- connect ---- */
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      log("Install MetaMask!", true);
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
      log(`Connection failed: ${e.message}`, true);
    }
  }, [log]);

  /* ---- refresh pools ---- */
  const refreshPools = useCallback(async () => {
    setLoading(true);
    log("Refreshing pools...");
    try {
      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        readProvider,
      );
      const addresses: string[] = await factory.getAllPools();
      log(`Found ${addresses.length} pools`);

      const results: PoolInfo[] = [];
      for (const addr of addresses) {
        if (addr === ethers.constants.AddressZero) continue;
        try {
          const pool = new ethers.Contract(addr, POOL_ABI, readProvider);
          const tokenAddress = await pool.token();
          const tok = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider);

          let name = "Unknown",
            symbol = "UNK",
            decimals = 18;
          try {
            [name, symbol, decimals] = await Promise.all([
              tok.name(),
              tok.symbol(),
              tok.decimals(),
            ]);
          } catch {
            /* skip */
          }

          const [lockDur, initPct, decayDay, totalStaked] = await Promise.all([
            pool.LOCK_DUR(),
            pool.INIT_PCT(),
            pool.DECAY_PCT_DAY(),
            pool.totalStaked(),
          ]);

          const userTokenIds: { id: string; amount: string }[] = [];
          let userStake = 0;
          if (account) {
            try {
              const bal = await pool.balanceOf(account);
              for (let i = 0; i < Number(bal); i++) {
                const tid = await pool.tokenOfOwnerByIndex(account, i);
                const stakeInfo = await pool.stakesByTokenId(tid);
                if (stakeInfo.amount.gt(0)) {
                  const amt = ethers.utils.formatUnits(
                    stakeInfo.amount,
                    decimals,
                  );
                  userTokenIds.push({ id: tid.toString(), amount: amt });
                  userStake += parseFloat(amt);
                }
              }
            } catch {
              /* skip */
            }
          }

          results.push({
            address: addr,
            tokenAddress,
            tokenName: name,
            tokenSymbol: symbol,
            decimals,
            hardLockDays: Number(lockDur) / 86400,
            initialPenalty: Number(initPct) / 100,
            penaltyDecay: Number(ethers.utils.formatUnits(decayDay, 2)),
            totalStaked: ethers.utils.formatUnits(totalStaked, decimals),
            userStake,
            userTokenIds,
          });
        } catch (e: any) {
          log(`Error loading pool ${shorten(addr)}: ${e.message}`, true);
        }
      }
      setPools(results);
      log("Pools refreshed");
    } catch (e: any) {
      log(`Refresh failed: ${e.message}`, true);
    } finally {
      setLoading(false);
    }
  }, [account, readProvider, log]);

  useEffect(() => {
    refreshPools();
  }, [refreshPools]);

  /* ---- create pool ---- */
  const createPool = useCallback(async () => {
    if (!signerRef.current) {
      log("Connect wallet first", true);
      return;
    }
    if (!tokenAddr || !hardLock || !initPenalty || !decayPct) {
      log("Fill in all fields", true);
      return;
    }
    setStatus("Deploying pool...");
    log("Creating dividend pool...");
    try {
      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        signerRef.current,
      );
      const lockSec = ethers.BigNumber.from(parseInt(hardLock) * 86400);
      const initBps = ethers.BigNumber.from(parseInt(initPenalty));
      const decayBps = ethers.utils.parseUnits(decayPct, 2);
      const tx = await factory.createPool(
        tokenAddr,
        lockSec,
        initBps,
        decayBps,
      );
      log("Waiting for confirmation...");
      const receipt = await tx.wait();
      log(`Pool created! Tx: ${receipt.transactionHash}`);
      setStatus(`Pool deployed! Tx: ${shorten(receipt.transactionHash)}`);
      await refreshPools();
    } catch (e: any) {
      log(`Pool creation failed: ${e.message}`, true);
      setStatus(`Failed: ${e.message}`);
    }
  }, [tokenAddr, hardLock, initPenalty, decayPct, log, refreshPools]);

  /* ---- stake ---- */
  const doStake = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current) {
        log("Connect wallet first", true);
        return;
      }
      const amt = stakeAmts[poolAddr];
      if (!amt || parseFloat(amt) <= 0) {
        log("Enter a valid amount", true);
        return;
      }
      log(`Staking ${amt} tokens...`);
      try {
        const pool = new ethers.Contract(poolAddr, POOL_ABI, signerRef.current);
        const tokAddr = await pool.token();
        const tok = new ethers.Contract(tokAddr, ERC20_ABI, signerRef.current);
        const dec = await tok.decimals();
        const wei = ethers.utils.parseUnits(amt, dec);
        const addr = await signerRef.current.getAddress();
        const allowance = await tok.allowance(addr, poolAddr);
        if (allowance.lt(wei)) {
          log("Approving tokens...");
          const txA = await tok.approve(poolAddr, wei);
          await txA.wait();
        }
        const tx = await pool.stake(wei);
        await tx.wait();
        log("Staked successfully!");
        await refreshPools();
      } catch (e: any) {
        log(`Stake failed: ${e.message}`, true);
      }
    },
    [stakeAmts, log, refreshPools],
  );

  /* ---- unstake ---- */
  const doUnstake = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current) {
        log("Connect wallet first", true);
        return;
      }
      const tid = unstakeIds[poolAddr];
      if (!tid) {
        log("Select a token ID", true);
        return;
      }
      log(`Unstaking token ID ${tid}...`);
      try {
        const pool = new ethers.Contract(poolAddr, POOL_ABI, signerRef.current);
        const tx = await pool.unstake(tid);
        await tx.wait();
        log("Unstaked successfully!");
        await refreshPools();
      } catch (e: any) {
        log(`Unstake failed: ${e.message}`, true);
      }
    },
    [unstakeIds, log, refreshPools],
  );

  /* ---- claim ---- */
  const doClaim = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current) {
        log("Connect wallet first", true);
        return;
      }
      const tid = claimIds[poolAddr];
      if (!tid) {
        log("Select a token ID", true);
        return;
      }
      log(`Claiming dividends for token ID ${tid}...`);
      try {
        const pool = new ethers.Contract(poolAddr, POOL_ABI, signerRef.current);
        const tx = await pool.claimAllRewards(tid);
        await tx.wait();
        log("Dividends claimed!");
        await refreshPools();
      } catch (e: any) {
        log(`Claim failed: ${e.message}`, true);
      }
    },
    [claimIds, log, refreshPools],
  );

  /* ---- register reward ---- */
  const doRegister = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current) {
        log("Connect wallet first", true);
        return;
      }
      const rt = regTokens[poolAddr];
      if (!rt || !ethers.utils.isAddress(rt)) {
        log("Enter a valid reward token address", true);
        return;
      }
      log(`Registering reward token ${shorten(rt)}...`);
      try {
        const pool = new ethers.Contract(poolAddr, POOL_ABI, signerRef.current);
        const tx = await pool.registerRewardToken(rt);
        await tx.wait();
        log("Reward token registered!");
        await refreshPools();
      } catch (e: any) {
        log(`Register failed: ${e.message}`, true);
      }
    },
    [regTokens, log, refreshPools],
  );

  /* ---- unregister reward ---- */
  const doUnregister = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current) {
        log("Connect wallet first", true);
        return;
      }
      const rt = unregTokens[poolAddr];
      if (!rt || !ethers.utils.isAddress(rt)) {
        log("Enter a valid reward token address", true);
        return;
      }
      log(`Unregistering reward token ${shorten(rt)}...`);
      try {
        const pool = new ethers.Contract(poolAddr, POOL_ABI, signerRef.current);
        const tx = await pool.unregisterRewardToken(rt);
        await tx.wait();
        log("Reward token unregistered!");
        await refreshPools();
      } catch (e: any) {
        log(`Unregister failed: ${e.message}`, true);
      }
    },
    [unregTokens, log, refreshPools],
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const inputCls =
    "w-full max-w-lg px-3 py-2.5 rounded-lg bg-gray-200 text-gray-900 text-sm border border-transparent focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50 outline-none shadow-inner transition-all placeholder:text-gray-500";
  const selectCls =
    "w-full max-w-lg px-3 py-2.5 rounded-lg bg-gradient-to-r from-slate-600 to-slate-500 text-white text-sm border border-transparent focus:border-violet-400 outline-none shadow-inner transition-all appearance-none pr-8";
  const btnCls =
    "w-full px-4 py-3 rounded-lg text-white font-semibold text-sm bg-gradient-to-r from-violet-700 to-purple-500 hover:from-purple-600 hover:to-violet-400 hover:-translate-y-0.5 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed transition-all shadow-md";
  const btnSmCls =
    "px-3 py-2 rounded-lg text-white font-medium text-xs bg-gradient-to-r from-violet-700 to-purple-500 hover:from-purple-600 hover:to-violet-400 transition-all shadow-sm whitespace-nowrap";
  const claimBtnCls =
    "px-3 py-2 rounded-lg text-gray-900 font-semibold text-xs bg-gradient-to-r from-yellow-500 to-amber-400 hover:from-yellow-400 hover:to-amber-300 hover:-translate-y-0.5 transition-all shadow-md whitespace-nowrap";

  return (
    <div className="min-h-screen p-4 sm:p-10" style={{ background: "#1E293B" }}>
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-8">
        {/* ── LEFT: Launch form ── */}
        <div className="flex-1 min-w-0">
          {/* Wallet */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <button type="button" onClick={connect} className={`${btnCls} !bg-gradient-to-r !from-gray-600 !to-gray-500 hover:!from-gray-500 hover:!to-gray-400 !w-auto !px-6`}>
              {account ? "Reconnect" : "Connect Wallet"}
            </button>
            {account && (
              <span className="text-xs font-mono text-gray-300 bg-slate-800 px-4 py-2.5 rounded-lg self-center truncate">
                {account}
              </span>
            )}
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-6">
            Launch a <span className="text-yellow-500">Dividend Pool</span>
          </h2>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-200 mb-1 block">Staking Token Address</label>
              <input value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} placeholder="0x..." className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-200 mb-1 block">Hard Lock Duration (days)</label>
              <input type="number" value={hardLock} onChange={(e) => { setHardLock(e.target.value); setBeH(e.target.value); }} placeholder="e.g., 7" min="0" className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-200 mb-1 block">Initial Penalty (%)</label>
              <input type="number" value={initPenalty} onChange={(e) => { setInitPenalty(e.target.value); setBeP(e.target.value); }} placeholder="e.g., 30" min="0" className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-200 mb-1 block">Penalty Decay (% per day)</label>
              <input type="number" value={decayPct} onChange={(e) => { setDecayPct(e.target.value); setBeD(e.target.value); }} placeholder="e.g., 1" min="0" step="0.01" className={inputCls} />
            </div>

            <button type="button" onClick={createPool} disabled={!account} className={`${btnCls} !bg-gradient-to-r !from-yellow-600 !to-amber-400 !text-gray-900 hover:!from-yellow-500 hover:!to-amber-300`}>
              Launch Dividends
            </button>
            {status && <p className="text-sm text-gray-300 mt-2">{status}</p>}
          </div>

          {/* Breakeven calculator */}
          <div className="mt-6 bg-slate-800/80 p-4 rounded-xl border border-violet-500/20">
            <label className="text-sm font-medium text-gray-200 mb-2 block">Staking Formula</label>
            <p className="text-[10px] text-gray-500 mb-2">
              Hard Lock + (Initial Penalty / Decay per Day) = Days Til Breakeven
            </p>
            <div className="flex flex-wrap items-center gap-1 text-sm text-gray-200">
              <input type="number" value={beH} onChange={(e) => setBeH(e.target.value)} placeholder="H" className="w-14 px-2 py-1.5 rounded bg-gray-200 text-gray-900 text-sm border-none outline-none" />
              <span>+ (</span>
              <input type="number" value={beP} onChange={(e) => setBeP(e.target.value)} placeholder="P" className="w-14 px-2 py-1.5 rounded bg-gray-200 text-gray-900 text-sm border-none outline-none" />
              <span>/</span>
              <input type="number" value={beD} onChange={(e) => setBeD(e.target.value)} placeholder="D" className="w-14 px-2 py-1.5 rounded bg-gray-200 text-gray-900 text-sm border-none outline-none" />
              <span>) =</span>
              <span className="font-bold text-yellow-400">{breakeven}</span>
              <span>days</span>
            </div>
          </div>

          {/* Transaction log */}
          <div className="mt-6 bg-slate-800/80 p-4 rounded-xl border border-violet-500/20">
            <h3 className="text-sm font-bold text-white mb-2">Transaction Details</h3>
            <div
              ref={logRef}
              className="max-h-48 overflow-y-auto text-xs text-gray-300 space-y-1"
              style={{ scrollbarWidth: "thin", scrollbarColor: "#E4A11B #1E293B" }}
            >
              {logs.map((l, i) => (
                <p key={i} className={`py-0.5 border-b border-violet-500/10 ${l.error ? "text-red-400" : ""}`}>
                  <span className="text-gray-500 mr-1">[{l.time}]</span>
                  {l.msg}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: All Pools ── */}
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-6">
            All <span className="text-emerald-400">Dividend Pools</span>
          </h2>

          {loading && <p className="text-gray-400 text-center animate-pulse">Loading pools...</p>}

          <div className="space-y-5 max-h-[700px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "#E4A11B #1E293B" }}>
            {pools.length === 0 && !loading && (
              <p className="text-gray-500 text-center py-10">
                {account ? "No pools found." : "Connect wallet to view pools."}
              </p>
            )}
            {pools.map((p) => (
              <div
                key={p.address}
                className="rounded-xl p-4 sm:p-5 border border-violet-500/20 shadow-[0_0_12px_rgba(91,33,182,0.3)]"
                style={{ background: "linear-gradient(135deg, #1E6F5C, #34A79A)" }}
              >
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-violet-500/30">
                  <h3 className="text-lg font-bold text-yellow-400">{p.tokenName} ({p.tokenSymbol})</h3>
                  <span className="text-sm font-semibold text-white">{shorten(p.address)}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs mb-4 bg-slate-800/30 p-3 rounded-lg">
                  {[
                    { label: "Token", val: shorten(p.tokenAddress) },
                    { label: "Hard Lock", val: `${p.hardLockDays} days` },
                    { label: "Initial Penalty", val: `${p.initialPenalty.toFixed(2)}%` },
                    { label: "Decay/Day", val: `${p.penaltyDecay.toFixed(4)}%` },
                    { label: "Total Staked", val: `${parseFloat(p.totalStaked).toFixed(4)} ${p.tokenSymbol}` },
                    { label: "Your Stake", val: `${p.userStake.toFixed(4)} ${p.tokenSymbol}` },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="text-gray-300 text-[10px] uppercase mb-0.5">{item.label}</div>
                      <div className="text-white text-xs truncate">{item.val}</div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Stake */}
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Amount"
                      value={stakeAmts[p.address] ?? ""}
                      onChange={(e) => setStakeAmts((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-gray-200 text-gray-900 text-xs border-none outline-none"
                    />
                    <button type="button" onClick={() => doStake(p.address)} className={btnSmCls}>Stake</button>
                  </div>

                  {/* Unstake */}
                  <div className="flex items-center gap-2">
                    <select
                      value={unstakeIds[p.address] ?? ""}
                      onChange={(e) => setUnstakeIds((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-gradient-to-r from-slate-600 to-slate-500 text-white text-xs border-none outline-none appearance-none"
                    >
                      <option value="">Select ID</option>
                      {p.userTokenIds.map((t) => (
                        <option key={t.id} value={t.id}>{t.id} ({t.amount} {p.tokenSymbol})</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => doUnstake(p.address)} className={btnSmCls}>Unstake</button>
                  </div>

                  {/* Register reward */}
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Reward Token CA"
                      value={regTokens[p.address] ?? ""}
                      onChange={(e) => setRegTokens((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-gray-200 text-gray-900 text-xs border-none outline-none"
                    />
                    <button type="button" onClick={() => doRegister(p.address)} className={btnSmCls}>Register</button>
                  </div>

                  {/* Unregister reward */}
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Reward Token CA"
                      value={unregTokens[p.address] ?? ""}
                      onChange={(e) => setUnregTokens((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-gray-200 text-gray-900 text-xs border-none outline-none"
                    />
                    <button type="button" onClick={() => doUnregister(p.address)} className={btnSmCls}>Unregister</button>
                  </div>

                  {/* Claim dividends */}
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <select
                      value={claimIds[p.address] ?? ""}
                      onChange={(e) => setClaimIds((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-gradient-to-r from-slate-600 to-slate-500 text-white text-xs border-none outline-none appearance-none"
                    >
                      <option value="">Select ID</option>
                      {p.userTokenIds.map((t) => (
                        <option key={t.id} value={t.id}>{t.id} ({t.amount} {p.tokenSymbol})</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => doClaim(p.address)} className={claimBtnCls}>
                      Claim Dividends
                    </button>
                  </div>
                </div>

                {/* Copy buttons */}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" onClick={() => navigator.clipboard.writeText(p.address)} className="px-2 py-1 rounded text-[10px] font-medium text-gray-300 bg-slate-700 hover:bg-slate-600 transition-colors">
                    Copy Pool Addr
                  </button>
                  <button type="button" onClick={() => navigator.clipboard.writeText(p.tokenAddress)} className="px-2 py-1 rounded text-[10px] font-medium text-gray-300 bg-slate-700 hover:bg-slate-600 transition-colors">
                    Copy Token Addr
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
