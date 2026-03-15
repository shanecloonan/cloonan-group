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
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { logTransaction } from "@/lib/activity";

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
  /* wallet context */
  const { user, vaultUnlocked, ethWallets, selectedEthWallet, selectedEthAddress, selectEthWallet, connectMetaMask, isLoading } = useWallet();
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

  /* ---- signer setup ---- */
  useEffect(() => {
    async function setupSigner() {
      if (!selectedEthWallet) {
        signerRef.current = null;
        return;
      }
      if (selectedEthWallet.type === "metamask" && window.ethereum) {
        try {
          const provider = new ethers.providers.Web3Provider(window.ethereum);
          const accounts: string[] = await window.ethereum.request({ method: "eth_accounts" });
          if (accounts?.length && accounts[0].toLowerCase() === selectedEthWallet.address.toLowerCase()) {
            signerRef.current = provider.getSigner();
          } else {
            signerRef.current = null;
          }
        } catch {
          signerRef.current = null;
        }
      } else if (selectedEthWallet.privateKey) {
        signerRef.current = new ethers.Wallet(selectedEthWallet.privateKey, readProvider);
      } else {
        signerRef.current = null;
      }
    }
    setupSigner();
  }, [selectedEthWallet, readProvider]);

  /* listen for MetaMask events */
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        signerRef.current = null;
        log("MetaMask disconnected.", true);
      } else if (selectedEthWallet?.type === "metamask" && accounts[0].toLowerCase() !== selectedEthAddress?.toLowerCase()) {
        signerRef.current = null;
        log(`MetaMask account changed to ${shorten(accounts[0])}`);
      }
    };
    const onChainChanged = (chainId: string) => {
      const id = parseInt(chainId, 16);
      if (id !== 1) {
        log(`Wrong network (chainId: ${id}). Switch to Ethereum Mainnet.`, true);
        signerRef.current = null;
      }
    };
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener("chainChanged", onChainChanged);
    };
  }, [selectedEthAddress, selectedEthWallet, log]);

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
          if (selectedEthAddress) {
            try {
              const bal = await pool.balanceOf(selectedEthAddress);
              for (let i = 0; i < Number(bal); i++) {
                const tid = await pool.tokenOfOwnerByIndex(selectedEthAddress, i);
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
  }, [selectedEthAddress, readProvider, log, fetchRewardTokens]);

  useEffect(() => {
    refreshPools();
  }, [refreshPools]);

  /* ================================================================ */
  /*  Create pool                                                      */
  /* ================================================================ */

  const createPool = useCallback(async () => {
    if (!signerRef.current || !selectedEthAddress) {
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
      const initBps = ethers.BigNumber.from(Math.round(parseFloat(initPenalty)));
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
        if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: receipt.transactionHash, dapp: "dividends", action: "create_pool", gasUsed: receipt.gasUsed.toString(), contractAddress: poolAddress, details: { tokenAddress: tokenAddr } });
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
  }, [tokenAddr, hardLock, initPenalty, decayPct, selectedEthAddress, log, refreshPools]);

  /* ================================================================ */
  /*  Stake                                                            */
  /* ================================================================ */

  const doStake = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !selectedEthAddress) { log("Connect wallet first.", true); return; }
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

          const balance = await tok.balanceOf(selectedEthAddress);
          if (balance.lt(wei)) {
            throw new Error(`Insufficient balance: have ${ethers.utils.formatUnits(balance, dec)}, need ${amt}`);
          }

          const allowance = await tok.allowance(selectedEthAddress, poolAddr);
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
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: receipt.transactionHash, dapp: "dividends", action: "stake", amount: amt, gasUsed: receipt.gasUsed.toString(), contractAddress: poolAddr });
          await refreshPools();
        } catch (e: any) {
          log(`Stake failed: ${e.message}`, true);
        }
      });
    },
    [stakeAmts, selectedEthAddress, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Unstake                                                          */
  /* ================================================================ */

  const doUnstake = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !selectedEthAddress) { log("Connect wallet first.", true); return; }
      const tid = unstakeIds[poolAddr];
      if (!tid) { log("Select a token ID.", true); return; }

      await withBusy(`unstake-${poolAddr}`, async () => {
        log(`Unstaking token ID ${tid} from pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.unstake(tid);
          const receipt = await tx.wait();
          log(`Unstaked successfully! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: receipt.transactionHash, dapp: "dividends", action: "unstake", gasUsed: receipt.gasUsed.toString(), contractAddress: poolAddr });
          await refreshPools();
        } catch (e: any) {
          log(`Unstake failed: ${e.message}`, true);
        }
      });
    },
    [unstakeIds, selectedEthAddress, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Claim all rewards                                                */
  /* ================================================================ */

  const doClaim = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !selectedEthAddress) { log("Connect wallet first.", true); return; }
      const tid = claimIds[poolAddr];
      if (!tid) { log("Select a token ID.", true); return; }

      await withBusy(`claim-${poolAddr}`, async () => {
        log(`Claiming all rewards for token ID ${tid} from pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.claimAllRewards(tid);
          const receipt = await tx.wait();
          log(`Rewards claimed! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: receipt.transactionHash, dapp: "dividends", action: "claim_rewards", gasUsed: receipt.gasUsed.toString(), contractAddress: poolAddr });
          await refreshPools();
        } catch (e: any) {
          log(`Claim failed: ${e.message}`, true);
        }
      });
    },
    [claimIds, selectedEthAddress, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Register reward token                                            */
  /* ================================================================ */

  const doRegister = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !selectedEthAddress) { log("Connect wallet first.", true); return; }
      const rt = regTokens[poolAddr];
      if (!rt || !ethers.utils.isAddress(rt)) { log("Enter a valid reward token address.", true); return; }

      await withBusy(`register-${poolAddr}`, async () => {
        log(`Registering reward token ${shorten(rt)} for pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.registerRewardToken(rt);
          const receipt = await tx.wait();
          log(`Reward token registered! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: receipt.transactionHash, dapp: "dividends", action: "register_reward_token", gasUsed: receipt.gasUsed.toString(), contractAddress: poolAddr, tokenAddress: rt });
          await refreshPools();
        } catch (e: any) {
          log(`Register failed: ${e.message}`, true);
        }
      });
    },
    [regTokens, selectedEthAddress, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  Unregister reward token                                          */
  /* ================================================================ */

  const doUnregister = useCallback(
    async (poolAddr: string) => {
      if (!signerRef.current || !selectedEthAddress) { log("Connect wallet first.", true); return; }
      const rt = unregTokens[poolAddr];
      if (!rt || !ethers.utils.isAddress(rt)) { log("Enter a valid reward token address.", true); return; }

      await withBusy(`unregister-${poolAddr}`, async () => {
        log(`Unregistering reward token ${shorten(rt)} from pool ${shorten(poolAddr)}...`);
        try {
          const pool = new ethers.Contract(poolAddr, poolAbi, signerRef.current!);
          const tx = await pool.unregisterRewardToken(rt);
          const receipt = await tx.wait();
          log(`Reward token unregistered! Gas used: ${receipt.gasUsed.toString()}. Tx: ${receipt.transactionHash}`);
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: receipt.transactionHash, dapp: "dividends", action: "unregister_reward_token", gasUsed: receipt.gasUsed.toString(), contractAddress: poolAddr, tokenAddress: rt });
          await refreshPools();
        } catch (e: any) {
          log(`Unregister failed: ${e.message}`, true);
        }
      });
    },
    [unregTokens, selectedEthAddress, log, refreshPools, withBusy],
  );

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
  const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
  const selectCls = `${inputCls} appearance-none cursor-pointer`;
  const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
  const btnGold = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
  const btnGhost = "h-10 px-4 rounded-xl font-medium text-xs border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";
  const labelCls = "block text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1.5";

  const Spinner = () => (
    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
  );

  const HelpIcon = ({ id, text }: { id: string; text: string }) => (
    <>
      <button
        type="button"
        onClick={() => toggleHelp(id)}
        className="bg-indigo-500/20 text-indigo-400 rounded-full w-4 h-4 text-[10px] leading-4 text-center hover:bg-indigo-500/30 transition-all cursor-pointer"
      >
        ?
      </button>
      {activeHelp === id && (
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-lg p-2 text-xs text-white/70 mt-1 max-w-[300px]">
          {text}
        </div>
      )}
    </>
  );

  return (
    <div
      className="min-h-screen p-4 sm:p-10"
      style={{ background: "#08090e" }}
    >
      <div className="max-w-[1100px] mx-auto flex flex-col gap-8">

        {/* ────────────────────────────────────────────────── */}
        {/*  WALLET BAR                                        */}
        {/* ────────────────────────────────────────────────── */}
        {!user || !vaultUnlocked ? (
          <AuthPanel inline />
        ) : (
          <div className={`${card} p-5`}>
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <button
                type="button"
                onClick={() =>
                  connectMetaMask()
                    .then((addr) => log(`MetaMask connected: ${shorten(addr)}`))
                    .catch((e: any) => log(e.message, true))
                }
                className={btnGhost}
              >
                Connect MetaMask
              </button>
              <select
                value={selectedEthAddress ?? ""}
                onChange={(e) => selectEthWallet(e.target.value || null)}
                className={selectCls}
              >
                <option value="">-- Select Wallet --</option>
                {ethWallets.map((w) => (
                  <option key={w.address} value={w.address}>
                    {w.type}: {shorten(w.address)}
                  </option>
                ))}
              </select>
              {selectedEthAddress && (
                <span className="text-white/50 text-xs truncate">
                  {shorten(selectedEthAddress)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/*  LAUNCH FORM                                       */}
        {/* ────────────────────────────────────────────────── */}
        <div className={`${card} p-6`}>
          <h2 className="text-xl font-bold text-white/90 mb-6">
            Launch a Dividend Pool
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className={labelCls}>Staking Token Address</label>
                <HelpIcon id="pool-token" text="The token address that the dividend pool is built around." />
              </div>
              <input
                value={tokenAddr}
                onChange={(e) => setTokenAddr(e.target.value)}
                placeholder="e.g., 0xYourCoinCA"
                className={inputCls}
              />
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className={labelCls}>Hard Lock Duration (days)</label>
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

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className={labelCls}>Initial Penalty (%)</label>
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

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className={labelCls}>Penalty Decay (% per day)</label>
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
          </div>

          <div className="flex items-center justify-between">
            {launchStatus && <p className="text-sm text-white/50">{launchStatus}</p>}
            <button type="button" onClick={createPool} disabled={!selectedEthAddress || launching} className={`${btnGold} ml-auto`}>
              {launching ? <Spinner /> : "Launch Dividends"}
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────────── */}
        {/*  BREAKEVEN FORMULA                                 */}
        {/* ────────────────────────────────────────────────── */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-1.5 mb-3">
            <label className={labelCls}>Staking Formula</label>
            <HelpIcon id="breakeven" text="Number of days until the withdrawal penalty reaches zero." />
          </div>
          <p className="text-[10px] text-white/30 mb-3">
            Hard Lock Duration + (Initial Penalty % / Penalty Decay % per Day) = Days Til Breakeven
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
            <input
              type="text"
              value={beH}
              onChange={(e) => { setBeH(e.target.value); setHardLock(e.target.value); }}
              placeholder="H"
              inputMode="numeric"
              pattern="[0-9]*"
              className="w-[60px] h-9 px-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm outline-none focus:border-indigo-400/60 transition-all text-center"
            />
            <span>+ (</span>
            <input
              type="text"
              value={beP}
              onChange={(e) => { setBeP(e.target.value); setInitPenalty(e.target.value); }}
              placeholder="P"
              inputMode="numeric"
              pattern="[0-9]*"
              className="w-[60px] h-9 px-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm outline-none focus:border-indigo-400/60 transition-all text-center"
            />
            <span>/</span>
            <input
              type="text"
              value={beD}
              onChange={(e) => { setBeD(e.target.value); setDecayPct(e.target.value); }}
              placeholder="D"
              inputMode="decimal"
              className="w-[60px] h-9 px-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm outline-none focus:border-indigo-400/60 transition-all text-center"
            />
            <span>) =</span>
            <span className="font-bold text-amber-400">{breakeven}</span>
            <span>days</span>
          </div>
        </div>

        {/* ────────────────────────────────────────────────── */}
        {/*  TRANSACTION LOG                                   */}
        {/* ────────────────────────────────────────────────── */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-semibold text-white/70 mb-3">
            Transaction Details
          </h3>
          <div
            ref={logRef}
            className="max-h-[200px] overflow-y-auto space-y-1"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
          >
            {logs.map((l, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 py-1.5 border-b border-white/[0.04] text-xs ${l.error ? "text-red-400" : "text-emerald-400"}`}
              >
                <span className="text-white/30 text-[11px] flex-shrink-0">[{l.time}]</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ────────────────────────────────────────────────── */}
        {/*  ALL DIVIDEND POOLS                                */}
        {/* ────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-xl font-bold text-white/90 mb-4">
            All Dividend Pools
          </h2>

          {loading && <p className="text-center text-white/40 animate-pulse py-6">Loading pools...</p>}

          {pools.length === 0 && !loading && (
            <div className={`${card} p-10`}>
              <p className="text-center text-white/40">
                {selectedEthAddress ? "No pools found." : "Please connect a wallet to view pools."}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {pools.map((p) => (
              <div key={p.address} className={`${card} p-5`}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 pb-3 border-b border-white/[0.06]">
                  <h3 className="text-lg font-bold text-white/90">
                    {p.tokenName} ({p.tokenSymbol})
                  </h3>
                  <span className="text-xs text-white/40 font-mono">
                    {shorten(p.address)}
                  </span>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                  {[
                    { label: "Token Address", val: shorten(p.tokenAddress) },
                    { label: "Hard Lock Duration", val: `${p.hardLockDays} days` },
                    { label: "Initial Penalty", val: `${p.initialPenalty.toFixed(2)}%` },
                    { label: "Penalty Decay/Day", val: `${p.penaltyDecay.toFixed(4)}%` },
                    { label: "Total Staked", val: `${parseFloat(p.totalStaked).toFixed(4)} ${p.tokenSymbol}` },
                    { label: "Your Stake", val: `${p.userStake.toFixed(4)} ${p.tokenSymbol}` },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col">
                      <span className="text-white/40 text-xs mb-0.5">{item.label}</span>
                      <span className="text-white/70 text-xs break-all">{item.val}</span>
                    </div>
                  ))}
                </div>

                {/* Action sections */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

                  {/* Staking */}
                  <div className={`${card} p-4`}>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-3">Staking</h4>
                    <div className="space-y-2">
                      <input
                        placeholder="Amount to stake"
                        inputMode="decimal"
                        value={stakeAmts[p.address] ?? ""}
                        onChange={(e) => setStakeAmts((s) => ({ ...s, [p.address]: e.target.value }))}
                        className={inputCls}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => doStake(p.address)}
                          disabled={busyButtons[`stake-${p.address}`]}
                          className={`flex-1 ${btnPrimary}`}
                        >
                          {busyButtons[`stake-${p.address}`] ? <Spinner /> : "Stake"}
                        </button>
                        <button
                          type="button"
                          onClick={() => doUnstake(p.address)}
                          disabled={busyButtons[`unstake-${p.address}`]}
                          className={`flex-1 ${btnPrimary}`}
                        >
                          {busyButtons[`unstake-${p.address}`] ? <Spinner /> : "Unstake"}
                        </button>
                      </div>
                      <select
                        value={unstakeIds[p.address] ?? ""}
                        onChange={(e) => setUnstakeIds((s) => ({ ...s, [p.address]: e.target.value }))}
                        className={selectCls}
                      >
                        <option value="">-- Token ID (unstake) --</option>
                        {p.userTokenIds.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.id} ({t.amount} {p.tokenSymbol})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Rewards */}
                  <div className={`${card} p-4`}>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-3">Rewards</h4>
                    <div className="space-y-2">
                      <input
                        placeholder="Register reward token CA"
                        value={regTokens[p.address] ?? ""}
                        onChange={(e) => setRegTokens((s) => ({ ...s, [p.address]: e.target.value }))}
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={() => doRegister(p.address)}
                        disabled={busyButtons[`register-${p.address}`]}
                        className={`w-full ${btnPrimary}`}
                      >
                        {busyButtons[`register-${p.address}`] ? <Spinner /> : "Register"}
                      </button>
                      <input
                        placeholder="Unregister reward token CA"
                        value={unregTokens[p.address] ?? ""}
                        onChange={(e) => setUnregTokens((s) => ({ ...s, [p.address]: e.target.value }))}
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={() => doUnregister(p.address)}
                        disabled={busyButtons[`unregister-${p.address}`]}
                        className={`w-full ${btnPrimary}`}
                      >
                        {busyButtons[`unregister-${p.address}`] ? <Spinner /> : "Unregister"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRewards((s) => ({ ...s, [p.address]: !s[p.address] }))}
                        className={`w-full ${btnGhost}`}
                      >
                        {showRewards[p.address] ? "Hide Rewards" : "Show Rewards"}
                      </button>
                    </div>
                  </div>

                  {/* Claim */}
                  <div className={`${card} p-4`}>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-3">Claim</h4>
                    <div className="space-y-2">
                      <select
                        value={claimIds[p.address] ?? ""}
                        onChange={(e) => setClaimIds((s) => ({ ...s, [p.address]: e.target.value }))}
                        className={selectCls}
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
                        className={`w-full ${btnGold}`}
                      >
                        {busyButtons[`claim-${p.address}`] ? <Spinner /> : "Claim Dividends"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Rewards list */}
                {showRewards[p.address] && (
                  <div className={`${card} p-4 mt-3 max-h-[150px] overflow-y-auto`}>
                    {p.rewardTokens.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        {p.rewardTokens.map((rt) => (
                          <div
                            key={rt.address}
                            className="flex justify-between py-1 border-b border-white/[0.04] last:border-b-0 text-xs"
                          >
                            <span className="text-white/60 break-all">
                              {rt.name} ({rt.symbol}): {shorten(rt.address)}
                            </span>
                            <span className="text-white/70 flex-shrink-0 ml-3">
                              {parseFloat(rt.balance).toFixed(4)} {rt.symbol}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-white/30 text-xs">No reward tokens registered.</p>
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
