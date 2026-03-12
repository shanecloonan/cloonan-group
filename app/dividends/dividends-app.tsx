"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import {
  FACTORY_ADDRESS,
  INFURA_RPC,
  factoryAbi,
  poolAbi,
  erc20Abi,
} from "./abis";

declare global {
  interface Window {
    ethereum?: any;
  }
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RewardToken {
  address: string;
  name: string;
  symbol: string;
  balance: string;
  decimals: number;
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
  rewardTokens: RewardToken[];
}

interface LogEntry {
  time: string;
  msg: string;
  error?: boolean;
}

interface StoredWallet {
  address: string;
  type: "MetaMask" | "MoneyFund";
  isMetaMask: boolean;
  privateKey?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DividendsApp() {
  /* wallet state */
  const [account, setAccount] = useState<string | null>(null);
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selectedWalletIdx, setSelectedWalletIdx] = useState<number | null>(null);
  const signerRef = useRef<ethers.Signer | null>(null);

  /* pool state */
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [loading, setLoading] = useState(false);

  /* logs */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  /* launch form */
  const [tokenAddr, setTokenAddr] = useState("");
  const [hardLock, setHardLock] = useState("");
  const [initPenalty, setInitPenalty] = useState("");
  const [decayPct, setDecayPct] = useState("");
  const [launchStatus, setLaunchStatus] = useState("");
  const [launching, setLaunching] = useState(false);

  /* breakeven calculator */
  const [beH, setBeH] = useState("");
  const [beP, setBeP] = useState("");
  const [beD, setBeD] = useState("");

  /* help tooltips */
  const [activeHelp, setActiveHelp] = useState<string | null>(null);

  /* per-pool UI state */
  const [stakeAmts, setStakeAmts] = useState<Record<string, string>>({});
  const [unstakeIds, setUnstakeIds] = useState<Record<string, string>>({});
  const [claimIds, setClaimIds] = useState<Record<string, string>>({});
  const [regTokens, setRegTokens] = useState<Record<string, string>>({});
  const [unregTokens, setUnregTokens] = useState<Record<string, string>>({});
  const [showRewards, setShowRewards] = useState<Record<string, boolean>>({});
  const [busyButtons, setBusyButtons] = useState<Record<string, boolean>>({});

  /* ---- read-only provider ---- */
  const readProvider = useMemo(
    () => new ethers.providers.JsonRpcProvider(INFURA_RPC),
    [],
  );

  /* ---- logging ---- */
  const log = useCallback((msg: string, error = false) => {
    setLogs((p) => [...p.slice(-99), { time: ts(), msg, error }]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  /* ---- breakeven formula ---- */
  const breakeven = useMemo(() => {
    const h = parseFloat(beH);
    const p = parseFloat(beP);
    const d = parseFloat(beD);
    if (!isNaN(h) && !isNaN(p) && !isNaN(d) && d > 0)
      return (h + p / d).toFixed(2);
    return "0";
  }, [beH, beP, beD]);

  /* ---- help tooltip toggle ---- */
  const toggleHelp = useCallback(
    (id: string) => setActiveHelp((prev) => (prev === id ? null : id)),
    [],
  );

  /* ---- busy helper ---- */
  const withBusy = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusyButtons((p) => ({ ...p, [key]: true }));
      try {
        await fn();
      } finally {
        setBusyButtons((p) => ({ ...p, [key]: false }));
      }
    },
    [],
  );

  /* ---- selected wallet ---- */
  const selectedWallet = useMemo(
    () =>
      selectedWalletIdx !== null && wallets[selectedWalletIdx]
        ? wallets[selectedWalletIdx]
        : null,
    [wallets, selectedWalletIdx],
  );

  /* ================================================================ */
  /*  Wallet management                                                */
  /* ================================================================ */

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      log("Please install MetaMask to use this feature.", true);
      return;
    }
    log("Connecting MetaMask...");
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const net = await provider.getNetwork();
      if (net.chainId !== 1) throw new Error("Switch to Ethereum Mainnet (chainId: 1)");
      const signer = provider.getSigner();
      const addr = await signer.getAddress();
      signerRef.current = signer;
      setAccount(addr);
      log(`Wallet connected: ${shorten(addr)}`);

      setWallets((prev) => {
        const filtered = prev.filter(
          (w) => !(w.type === "MetaMask" && w.address.toLowerCase() !== addr.toLowerCase()),
        );
        if (!filtered.some((w) => w.address.toLowerCase() === addr.toLowerCase() && w.type === "MetaMask")) {
          return [...filtered, { address: addr, type: "MetaMask", isMetaMask: true }];
        }
        return filtered;
      });
    } catch (e: any) {
      log(`Connection failed: ${e.message}`, true);
    }
  }, [log]);

  const selectWallet = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= wallets.length) {
        setSelectedWalletIdx(null);
        setAccount(null);
        signerRef.current = null;
        localStorage.removeItem("selectedWalletIndex");
        return;
      }
      const w = wallets[idx];
      setSelectedWalletIdx(idx);
      localStorage.setItem("selectedWalletIndex", String(idx));
      setAccount(w.address);
      log(`Selected wallet: ${shorten(w.address)} (${w.type})`);

      if (w.isMetaMask && window.ethereum) {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (!accounts?.length || accounts[0].toLowerCase() !== w.address.toLowerCase()) {
          await connectWallet();
        } else {
          const provider = new ethers.providers.Web3Provider(window.ethereum);
          signerRef.current = provider.getSigner();
        }
      } else {
        signerRef.current = null;
      }
    },
    [wallets, connectWallet, log],
  );

  /* persist wallets */
  useEffect(() => {
    if (wallets.length > 0) {
      localStorage.setItem("wallets", JSON.stringify(wallets));
    }
  }, [wallets]);

  /* initialize wallets on mount */
  useEffect(() => {
    const stored: StoredWallet[] = JSON.parse(localStorage.getItem("wallets") || "[]");
    if (stored.length > 0) setWallets(stored);
    const idx = parseInt(localStorage.getItem("selectedWalletIndex") || "");
    if (!isNaN(idx) && idx >= 0 && idx < stored.length) {
      setSelectedWalletIdx(idx);
      setAccount(stored[idx].address);
    }
  }, []);

  /* listen for MetaMask events */
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(null);
        signerRef.current = null;
        setSelectedWalletIdx(null);
        log("MetaMask disconnected.", true);
      } else if (selectedWallet?.isMetaMask && accounts[0].toLowerCase() !== account?.toLowerCase()) {
        setAccount(accounts[0]);
        log(`MetaMask account changed to ${shorten(accounts[0])}`);
      }
    };
    const onChainChanged = (chainId: string) => {
      const id = parseInt(chainId, 16);
      if (id !== 1) {
        log(`Wrong network (chainId: ${id}). Switch to Ethereum Mainnet.`, true);
        setAccount(null);
        signerRef.current = null;
        setSelectedWalletIdx(null);
      }
    };
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener("chainChanged", onChainChanged);
    };
  }, [account, selectedWallet, log]);

  /* ================================================================ */
  /*  Fetch reward tokens for a pool                                   */
  /* ================================================================ */

  const fetchRewardTokens = useCallback(
    async (poolAddr: string): Promise<RewardToken[]> => {
      const pool = new ethers.Contract(poolAddr, poolAbi, readProvider);
      const tokens: RewardToken[] = [];
      for (let i = 0; ; i++) {
        try {
          const addr: string = await pool.registeredRewardTokens(i);
          if (!addr || addr === ADDRESS_ZERO) continue;
          const tok = new ethers.Contract(addr, erc20Abi, readProvider);
          let name = "Unknown",
            symbol = "UNK",
            decimals = 18,
            balance = "0";
          try {
            [name, symbol, decimals] = await Promise.all([tok.name(), tok.symbol(), tok.decimals()]);
            const bal = await pool.tokenBalance(addr);
            balance = ethers.utils.formatUnits(bal, decimals);
          } catch { /* skip */ }
          tokens.push({ address: addr, name, symbol, balance, decimals });
        } catch {
          break;
        }
      }
      return tokens;
    },
    [readProvider],
  );

  /* ================================================================ */
  /*  Refresh pools                                                    */
  /* ================================================================ */

  const refreshPools = useCallback(async () => {
    setLoading(true);
    log("Refreshing pools...");
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, readProvider);
      const addresses: string[] = await factory.getAllPools();
      log(`Found ${addresses.length} pools`);

      const results: PoolInfo[] = [];
      for (const addr of addresses) {
        if (addr === ADDRESS_ZERO) continue;
        try {
          const pool = new ethers.Contract(addr, poolAbi, readProvider);
          const tokenAddress = await pool.token();
          const tok = new ethers.Contract(tokenAddress, erc20Abi, readProvider);

          let tokenName = "Unknown",
            tokenSymbol = "UNK",
            decimals = 18;
          try {
            [tokenName, tokenSymbol, decimals] = await Promise.all([
              tok.name(),
              tok.symbol(),
              tok.decimals(),
            ]);
          } catch { /* skip */ }

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
                const info = await pool.stakesByTokenId(tid);
                if (info.amount.gt(0)) {
                  const amt = ethers.utils.formatUnits(info.amount, decimals);
                  userTokenIds.push({ id: tid.toString(), amount: amt });
                  userStake += parseFloat(amt);
                }
              }
            } catch { /* skip */ }
          }

          const rewardTokens = await fetchRewardTokens(addr);

          results.push({
            address: addr,
            tokenAddress,
            tokenName,
            tokenSymbol,
            decimals,
            hardLockDays: Number(lockDur) / 86400,
            initialPenalty: Number(initPct) / 100,
            penaltyDecay: Number(ethers.utils.formatUnits(decayDay, 2)),
            totalStaked: ethers.utils.formatUnits(totalStaked, decimals),
            userStake,
            userTokenIds,
            rewardTokens,
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
  }, [account, readProvider, log, fetchRewardTokens]);

  useEffect(() => {
    refreshPools();
  }, [refreshPools]);

  /* ================================================================ */
  /*  Create pool                                                      */
  /* ================================================================ */

  const createPool = useCallback(async () => {
    if (!signerRef.current || !account) {
      log("Connect and select a wallet first.", true);
      return;
    }
    if (!tokenAddr || !hardLock || !initPenalty || !decayPct) {
      log("Fill in all fields.", true);
      return;
    }
    if (!ethers.utils.isAddress(tokenAddr)) {
      log("Invalid token address.", true);
      return;
    }
    setLaunching(true);
    setLaunchStatus("Deploying pool...");
    log(`Creating dividend pool for token ${shorten(tokenAddr)}...`);
    log(`Parameters: hardLock=${hardLock} days, initPenalty=${initPenalty}%, decay=${decayPct}%/day`);
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, signerRef.current);
      const lockSec = ethers.BigNumber.from(Math.floor(parseFloat(hardLock) * 86400));
      const initBps = ethers.BigNumber.from(parseInt(initPenalty));
      const decayBps = ethers.utils.parseUnits(decayPct, 2);

      log("Estimating gas...");
      let gasLimit;
      try {
        gasLimit = await factory.estimateGas.createPool(tokenAddr, lockSec, initBps, decayBps);
        gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${gasLimit.toString()}`);
      } catch {
        gasLimit = ethers.BigNumber.from(800000);
        log("Gas estimation failed, using default 800000", true);
      }

      log("Sending transaction... Please confirm in MetaMask.");
      const tx = await factory.createPool(tokenAddr, lockSec, initBps, decayBps, { gasLimit });
      log("Waiting for confirmation...");
      const receipt = await tx.wait();
      log(`Pool created! Gas used: ${receipt.gasUsed.toString()}`);

      const iface = new ethers.utils.Interface(factoryAbi);
      let poolAddress = "";
      for (const l of receipt.logs) {
        try {
          const parsed = iface.parseLog(l);
          if (parsed.name === "StakingPoolCreated") {
            poolAddress = parsed.args.poolAddress;
            break;
          }
        } catch { /* skip */ }
      }
      if (poolAddress) {
        log(`Dividend pool deployed at: ${poolAddress}`);
        setLaunchStatus(`Pool deployed at ${shorten(poolAddress)}! Tx: ${shorten(receipt.transactionHash)}`);
      } else {
        setLaunchStatus(`Pool deployed! Tx: ${shorten(receipt.transactionHash)}`);
      }
      await refreshPools();
    } catch (e: any) {
      log(`Pool creation failed: ${e.message}`, true);
      setLaunchStatus(`Failed: ${e.message}`);
    } finally {
      setLaunching(false);
    }
  }, [tokenAddr, hardLock, initPenalty, decayPct, account, log, refreshPools]);

  /* ================================================================ */
  /*  Stake                                                            */
  /* ================================================================ */

  const doStake = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !account) { log("Connect wallet first.", true); return; }
      const amt = stakeAmts[poolAddr];
      if (!amt || parseFloat(amt) <= 0) { log("Enter a valid amount.", true); return; }

      await withBusy(`stake-${poolAddr}`, async () => {
        log(`Staking ${amt} tokens in pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tokAddr = await pool.token();
          const tok = new ethers.Contract(tokAddr, erc20Abi, signerRef.current!);
          const dec = await tok.decimals();
          const wei = ethers.utils.parseUnits(amt, dec);

          const balance = await tok.balanceOf(account);
          if (balance.lt(wei)) {
            throw new Error(`Insufficient balance: have ${ethers.utils.formatUnits(balance, dec)}, need ${amt}`);
          }

          const allowance = await tok.allowance(account, poolAddr);
          if (allowance.lt(wei)) {
            log("Approving tokens...");
            const txA = await tok.approve(poolAddr, wei);
            await txA.wait();
            log("Approval confirmed.");
          }

          log("Sending stake transaction...");
          const tx = await pool.stake(wei);
          const receipt = await tx.wait();
          log(`Staked successfully! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          await refreshPools();
        } catch (e: any) {
          log(`Stake failed: ${e.message}`, true);
        }
      });
    },
    [stakeAmts, account, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Unstake                                                          */
  /* ================================================================ */

  const doUnstake = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !account) { log("Connect wallet first.", true); return; }
      const tid = unstakeIds[poolAddr];
      if (!tid) { log("Select a token ID.", true); return; }

      await withBusy(`unstake-${poolAddr}`, async () => {
        log(`Unstaking token ID ${tid} from pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.unstake(tid);
          const receipt = await tx.wait();
          log(`Unstaked successfully! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          await refreshPools();
        } catch (e: any) {
          log(`Unstake failed: ${e.message}`, true);
        }
      });
    },
    [unstakeIds, account, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Claim all rewards                                                */
  /* ================================================================ */

  const doClaim = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !account) { log("Connect wallet first.", true); return; }
      const tid = claimIds[poolAddr];
      if (!tid) { log("Select a token ID.", true); return; }

      await withBusy(`claim-${poolAddr}`, async () => {
        log(`Claiming all rewards for token ID ${tid} from pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.claimAllRewards(tid);
          const receipt = await tx.wait();
          log(`Rewards claimed! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          await refreshPools();
        } catch (e: any) {
          log(`Claim failed: ${e.message}`, true);
        }
      });
    },
    [claimIds, account, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Register reward token                                            */
  /* ================================================================ */

  const doRegister = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !account) { log("Connect wallet first.", true); return; }
      const rt = regTokens[poolAddr];
      if (!rt || !ethers.utils.isAddress(rt)) { log("Enter a valid reward token address.", true); return; }

      await withBusy(`register-${poolAddr}`, async () => {
        log(`Registering reward token ${shorten(rt)} for pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.registerRewardToken(rt);
          const receipt = await tx.wait();
          log(`Reward token registered! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          await refreshPools();
        } catch (e: any) {
          log(`Register failed: ${e.message}`, true);
        }
      });
    },
    [regTokens, account, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Unregister reward token                                          */
  /* ================================================================ */

  const doUnregister = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !account) { log("Connect wallet first.", true); return; }
      const rt = unregTokens[poolAddr];
      if (!rt || !ethers.utils.isAddress(rt)) { log("Enter a valid reward token address.", true); return; }

      await withBusy(`unregister-${poolAddr}`, async () => {
        log(`Unregistering reward token ${shorten(rt)} from pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.unregisterRewardToken(rt);
          const receipt = await tx.wait();
          log(`Reward token unregistered! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          await refreshPools();
        } catch (e: any) {
          log(`Unregister failed: ${e.message}`, true);
        }
      });
    },
    [unregTokens, account, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  const inputCls =
    "w-full max-w-[600px] px-3 py-2.5 rounded-[10px] bg-[#E5E7EB] text-[#1F2937] text-sm border border-transparent focus:border-violet-500 focus:shadow-[0_0_12px_rgba(91,33,182,0.6)] outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] transition-all placeholder:text-[#9CA3AF] placeholder:opacity-80 hover:bg-[#D1D5DB] hover:shadow-[0_0_10px_rgba(91,33,182,0.5)]";
  const selectCls =
    "w-full max-w-[600px] px-3 py-2.5 pr-8 rounded-[10px] bg-gradient-to-r from-[#475569] to-[#64748B] text-[#E5E7EB] text-sm border border-transparent focus:border-violet-500 outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] transition-all appearance-none hover:from-[#64748B] hover:to-[#94A3B8]";
  const btnPurple =
    "px-4 py-2.5 rounded-[10px] text-[#E5E7EB] font-semibold text-sm bg-gradient-to-r from-[#5B21B6] to-[#7C3AED] hover:from-[#7C3AED] hover:to-[#A5B4FC] hover:-translate-y-0.5 hover:shadow-[0_0_12px_rgba(91,33,182,0.5)] disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed disabled:transform-none transition-all";
  const btnGold =
    "px-4 py-3 rounded-[10px] text-[#1F2937] font-semibold text-sm bg-gradient-to-r from-[#E4A11B] to-[#F4B85C] hover:from-[#D97706] hover:to-[#FBCF8B] hover:-translate-y-0.5 hover:shadow-[0_0_16px_rgba(228,161,27,0.6)] disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed disabled:transform-none transition-all";
  const btnWallet =
    "px-4 py-3.5 rounded-[10px] text-[#E5E7EB] font-semibold text-base bg-gradient-to-r from-[#4B5563] to-[#6B7280] hover:from-[#6B7280] hover:to-[#9CA3AF] hover:-translate-y-0.5 hover:shadow-[0_0_12px_rgba(107,114,128,0.5)] transition-all text-center";
  const walletSelectCls =
    "px-4 py-3.5 rounded-[10px] bg-gradient-to-r from-[#4B5563] to-[#6B7280] text-[#E5E7EB] text-base border-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] hover:from-[#6B7280] hover:to-[#9CA3AF] hover:shadow-[0_0_10px_rgba(107,114,128,0.5)] focus:shadow-[0_0_12px_rgba(107,114,128,0.5)] outline-none appearance-none transition-all text-center";

  const Spinner = () => (
    <span className="inline-block w-4 h-4 border-2 border-[#E5E7EB] border-t-transparent rounded-full animate-spin" />
  );

  const HelpIcon = ({ id, text }: { id: string; text: string }) => (
    <>
      <button
        type="button"
        onClick={() => toggleHelp(id)}
        className="w-4 h-4 leading-4 text-center text-[10px] rounded-full bg-gradient-to-r from-[#5B21B6] to-[#7C3AED] text-[#E5E7EB] hover:from-[#7C3AED] hover:to-[#A5B4FC] hover:shadow-[0_0_10px_rgba(91,33,182,0.5)] transition-all cursor-pointer"
      >
        ?
      </button>
      {activeHelp === id && (
        <div className="text-xs text-[#E5E7EB] bg-[#1E293B] p-2 rounded-[10px] mt-1 border border-[#E4A11B] max-w-[300px] animate-[slideDown_0.3s_ease-out]">
          {text}
        </div>
      )}
    </>
  );

  return (
    <div
      className="min-h-screen p-4 sm:p-10"
      style={{ background: "#1E293B", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
    >
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="max-w-[1400px] mx-auto flex flex-col lg:flex-row flex-wrap gap-8">
        {/* ────────────────────────────────────────────────── */}
        {/*  LEFT PANEL: Wallet + Launch Form                  */}
        {/* ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 p-4 sm:p-8">
          {/* Wallet container */}
          <div className="flex flex-col sm:flex-row gap-4 max-w-[600px] w-full mb-6">
            <button type="button" onClick={connectWallet} className={`flex-1 min-w-0 ${btnWallet}`}>
              Connect Wallet
            </button>
            <select
              value={selectedWalletIdx ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setSelectedWalletIdx(null);
                  setAccount(null);
                  signerRef.current = null;
                  localStorage.removeItem("selectedWalletIndex");
                } else {
                  selectWallet(parseInt(v));
                }
              }}
              className={`flex-1 min-w-0 ${walletSelectCls}`}
            >
              <option value="">-- Select Wallet --</option>
              {wallets.map((w, i) => (
                <option key={i} value={i}>
                  {w.type}: {shorten(w.address)}
                </option>
              ))}
            </select>
          </div>

          <h2 className="text-[2.2rem] font-bold text-[#E5E7EB] text-center mb-4" style={{ textShadow: "0 0 8px rgba(91,33,182,0.5)" }}>
            Launch a Dividend Pool
          </h2>

          {/* Staking Token Address */}
          <div className="relative mb-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <label className="text-[#E5E7EB] text-sm font-medium">Staking Token Address</label>
              <HelpIcon id="pool-token" text="The token address that the dividend pool is built around." />
            </div>
            <input
              value={tokenAddr}
              onChange={(e) => setTokenAddr(e.target.value)}
              placeholder="e.g., 0xYourCoinCA"
              className={inputCls}
            />
          </div>

          {/* Hard Lock Duration */}
          <div className="relative mb-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <label className="text-[#E5E7EB] text-sm font-medium">Hard Lock Duration (days)</label>
              <HelpIcon id="hard-lock" text="Amount of days staked tokens must remain locked in the contract, unable to be withdrawn." />
            </div>
            <input
              value={hardLock}
              onChange={(e) => { setHardLock(e.target.value); setBeH(e.target.value); }}
              placeholder="e.g., 7"
              inputMode="numeric"
              pattern="[0-9]*"
              className={inputCls}
            />
          </div>

          {/* Initial Penalty */}
          <div className="relative mb-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <label className="text-[#E5E7EB] text-sm font-medium">Initial Penalty (%)</label>
              <HelpIcon id="init-penalty" text="Percentage penalty for early withdrawal at the end of the hard lock period." />
            </div>
            <input
              value={initPenalty}
              onChange={(e) => { setInitPenalty(e.target.value); setBeP(e.target.value); }}
              placeholder="e.g., 30"
              inputMode="numeric"
              pattern="[0-9]*"
              className={inputCls}
            />
          </div>

          {/* Penalty Decay */}
          <div className="relative mb-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <label className="text-[#E5E7EB] text-sm font-medium">Penalty Decay (% per day)</label>
              <HelpIcon id="decay-pct" text="Daily reduction in penalty percentage for early withdrawal." />
            </div>
            <input
              value={decayPct}
              onChange={(e) => { setDecayPct(e.target.value); setBeD(e.target.value); }}
              placeholder="e.g., 1"
              inputMode="decimal"
              className={inputCls}
            />
          </div>

          {/* Launch button */}
          <div className="flex justify-end mb-6">
            <button type="button" onClick={createPool} disabled={!account || launching} className={btnGold}>
              {launching ? <Spinner /> : "Launch Dividends"}
            </button>
          </div>
          {launchStatus && <p className="text-sm text-[#E5E7EB] mb-4">{launchStatus}</p>}

          {/* Breakeven Formula */}
          <div className="relative mb-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <label className="text-[#E5E7EB] text-sm font-medium">Staking Formula</label>
              <HelpIcon id="breakeven" text="Number of days until the withdrawal penalty reaches zero." />
            </div>
            <div className="bg-[rgba(30,41,59,0.8)] p-2.5 rounded-lg border border-[rgba(91,33,182,0.2)]">
              <p className="text-[10px] text-[#9CA3AF] mb-2">
                Hard Lock Duration + (Initial Penalty % / Penalty Decay % per Day) = Days Til Breakeven
              </p>
              <div className="flex flex-wrap items-center gap-1 text-sm text-[#E5E7EB]">
                <input
                  type="text"
                  value={beH}
                  onChange={(e) => { setBeH(e.target.value); setHardLock(e.target.value); }}
                  placeholder="H"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-[60px] px-2 py-1.5 rounded bg-[#E5E7EB] text-[#1F2937] text-sm border-none outline-none inline-block mx-1"
                />
                <span> + ( </span>
                <input
                  type="text"
                  value={beP}
                  onChange={(e) => { setBeP(e.target.value); setInitPenalty(e.target.value); }}
                  placeholder="P"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-[60px] px-2 py-1.5 rounded bg-[#E5E7EB] text-[#1F2937] text-sm border-none outline-none inline-block mx-1"
                />
                <span> / </span>
                <input
                  type="text"
                  value={beD}
                  onChange={(e) => { setBeD(e.target.value); setDecayPct(e.target.value); }}
                  placeholder="D"
                  inputMode="decimal"
                  className="w-[60px] px-2 py-1.5 rounded bg-[#E5E7EB] text-[#1F2937] text-sm border-none outline-none inline-block mx-1"
                />
                <span> ) = </span>
                <span className="font-bold text-[#E4A11B]">{breakeven}</span>
                <span> days</span>
              </div>
            </div>
          </div>

          {/* Transaction Details */}
          <div className="mt-6 bg-[rgba(30,41,59,0.8)] p-4 rounded-xl border border-[rgba(91,33,182,0.2)]">
            <h3 className="text-[1.4rem] font-semibold text-[#E5E7EB] mb-3" style={{ textShadow: "0 0 8px rgba(91,33,182,0.5)" }}>
              Transaction Details
            </h3>
            <div
              ref={logRef}
              className="max-h-[200px] overflow-y-auto p-2.5 text-[0.85rem] bg-[#1E293B] text-[#E5E7EB] rounded-[10px]"
              style={{ scrollbarWidth: "thin", scrollbarColor: "#E4A11B #1E293B" }}
            >
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 py-2 border-b border-[rgba(91,33,182,0.3)] text-[0.8rem] ${l.error ? "text-[#F87171]" : "text-[#E5E7EB]"}`}
                >
                  <span className="text-[#9CA3AF] text-[0.75rem] flex-shrink-0">[{l.time}]</span>
                  <span>{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ────────────────────────────────────────────────── */}
        {/*  RIGHT PANEL: All Dividend Pools                   */}
        {/* ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 p-4 sm:p-8">
          <h2 className="text-[2.2rem] font-bold text-[#E5E7EB] text-center mb-4" style={{ textShadow: "0 0 8px rgba(91,33,182,0.5)" }}>
            All Dividend Pools
          </h2>

          <div
            className="mt-3 max-h-[600px] overflow-y-auto p-4 bg-[#1E293B] rounded-xl"
            style={{ scrollbarWidth: "thin", scrollbarColor: "#E4A11B #1E293B" }}
          >
            {loading && <p className="text-center text-[#D1D5DB] animate-pulse">Loading pools...</p>}

            {pools.length === 0 && !loading && (
              <p className="text-center text-[#D1D5DB] py-10">
                {account ? "No pools found." : "Please connect a wallet to view pools."}
              </p>
            )}

            {pools.map((p) => (
              <div
                key={p.address}
                className="rounded-xl p-4 mb-4 border-none shadow-[0_0_12px_rgba(91,33,182,0.4)] hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(91,33,182,0.6)] transition-all"
                style={{ background: "linear-gradient(135deg, #1E6F5C, #34A79A)" }}
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 pb-2 border-b border-[rgba(91,33,182,0.3)]">
                  <h3 className="text-[1.6rem] font-bold text-[#E4A11B] m-0">
                    {p.tokenName} ({p.tokenSymbol})
                  </h3>
                  <span className="text-[1.28rem] font-semibold text-[#E5E7EB]">
                    Pool: {shorten(p.address)}
                  </span>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[0.85rem] mb-3 bg-[rgba(30,41,59,0.3)] p-2 rounded-md">
                  {[
                    { label: "Token Address", val: shorten(p.tokenAddress) },
                    { label: "Hard Lock Duration", val: `${p.hardLockDays} days` },
                    { label: "Initial Penalty", val: `${p.initialPenalty.toFixed(2)}%` },
                    { label: "Penalty Decay/Day", val: `${p.penaltyDecay.toFixed(4)}%` },
                    { label: "Total Staked", val: `${parseFloat(p.totalStaked).toFixed(4)} ${p.tokenSymbol}` },
                    { label: "Your Stake", val: `${p.userStake.toFixed(4)} ${p.tokenSymbol}` },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col">
                      <span className="font-medium text-[#E5E7EB] mb-0.5 text-[0.76rem]">{item.label}</span>
                      <span className="text-[#E5E7EB] text-[0.9rem] break-all">{item.val}</span>
                    </div>
                  ))}
                </div>

                {/* Actions grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  {/* Stake */}
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Amount"
                      inputMode="decimal"
                      value={stakeAmts[p.address] ?? ""}
                      onChange={(e) => setStakeAmts((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 max-w-[300px] mr-2 px-2.5 py-2.5 rounded-[10px] bg-[#E5E7EB] text-[#1F2937] text-sm border-none outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] hover:shadow-[0_0_10px_rgba(91,33,182,0.5)]"
                    />
                    <button
                      type="button"
                      onClick={() => doStake(p.address)}
                      disabled={busyButtons[`stake-${p.address}`]}
                      className={`${btnPurple} !text-[0.95rem] !py-2.5`}
                    >
                      {busyButtons[`stake-${p.address}`] ? <Spinner /> : "Stake"}
                    </button>
                  </div>

                  {/* Unstake */}
                  <div className="flex items-center gap-2">
                    <select
                      value={unstakeIds[p.address] ?? ""}
                      onChange={(e) => setUnstakeIds((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 max-w-[300px] mr-2 px-2.5 py-2.5 rounded-[10px] bg-gradient-to-r from-[#475569] to-[#64748B] text-[#E5E7EB] text-sm border-none outline-none appearance-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
                    >
                      <option value="">-- Select Token ID --</option>
                      {p.userTokenIds.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id} ({t.amount} {p.tokenSymbol})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => doUnstake(p.address)}
                      disabled={busyButtons[`unstake-${p.address}`]}
                      className={`${btnPurple} !text-[0.95rem] !py-2.5`}
                    >
                      {busyButtons[`unstake-${p.address}`] ? <Spinner /> : "Unstake"}
                    </button>
                  </div>

                  {/* Register reward */}
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Reward Token CA"
                      value={regTokens[p.address] ?? ""}
                      onChange={(e) => setRegTokens((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 max-w-[300px] mr-2 px-2.5 py-2.5 rounded-[10px] bg-[#E5E7EB] text-[#1F2937] text-sm border-none outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] hover:shadow-[0_0_10px_rgba(91,33,182,0.5)]"
                    />
                    <button
                      type="button"
                      onClick={() => doRegister(p.address)}
                      disabled={busyButtons[`register-${p.address}`]}
                      className={`${btnPurple} !text-[0.95rem] !py-2.5`}
                    >
                      {busyButtons[`register-${p.address}`] ? <Spinner /> : "Register"}
                    </button>
                  </div>

                  {/* Unregister reward */}
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Reward Token CA"
                      value={unregTokens[p.address] ?? ""}
                      onChange={(e) => setUnregTokens((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 max-w-[300px] mr-2 px-2.5 py-2.5 rounded-[10px] bg-[#E5E7EB] text-[#1F2937] text-sm border-none outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] hover:shadow-[0_0_10px_rgba(91,33,182,0.5)]"
                    />
                    <button
                      type="button"
                      onClick={() => doUnregister(p.address)}
                      disabled={busyButtons[`unregister-${p.address}`]}
                      className={`${btnPurple} !text-[0.95rem] !py-2.5`}
                    >
                      {busyButtons[`unregister-${p.address}`] ? <Spinner /> : "Unregister"}
                    </button>
                  </div>

                  {/* Show/Hide Rewards */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowRewards((s) => ({ ...s, [p.address]: !s[p.address] }))}
                      className={`${btnPurple} !text-[0.95rem] !py-2.5`}
                    >
                      Show/Hide Rewards
                    </button>
                  </div>

                  {/* Claim Dividends */}
                  <div className="flex items-center gap-2">
                    <select
                      value={claimIds[p.address] ?? ""}
                      onChange={(e) => setClaimIds((s) => ({ ...s, [p.address]: e.target.value }))}
                      className="flex-1 min-w-0 max-w-[300px] mr-2 px-2.5 py-2.5 rounded-[10px] bg-gradient-to-r from-[#475569] to-[#64748B] text-[#E5E7EB] text-sm border-none outline-none appearance-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
                    >
                      <option value="">-- Select Token ID --</option>
                      {p.userTokenIds.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id} ({t.amount} {p.tokenSymbol})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => doClaim(p.address)}
                      disabled={busyButtons[`claim-${p.address}`]}
                      className={`${btnGold} !text-[0.95rem] !py-2.5 whitespace-nowrap`}
                    >
                      {busyButtons[`claim-${p.address}`] ? <Spinner /> : "Claim Dividends"}
                    </button>
                  </div>
                </div>

                {/* Rewards container */}
                {showRewards[p.address] && (
                  <div
                    className="mt-3 p-2.5 bg-[#1E293B] rounded-[10px] border border-[#E4A11B] max-h-[150px] overflow-y-auto"
                    style={{ scrollbarWidth: "thin", scrollbarColor: "#E4A11B #1E293B" }}
                  >
                    {p.rewardTokens.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {p.rewardTokens.map((rt) => (
                          <div
                            key={rt.address}
                            className="flex justify-between p-1.5 border-b border-[rgba(91,33,182,0.2)] last:border-b-0 text-[0.85rem] text-[#E5E7EB]"
                          >
                            <span className="break-all">
                              {rt.name} ({rt.symbol}): {shorten(rt.address)}
                            </span>
                            <span>
                              {parseFloat(rt.balance).toFixed(4)} {rt.symbol}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-[#D1D5DB]">No reward tokens registered.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
