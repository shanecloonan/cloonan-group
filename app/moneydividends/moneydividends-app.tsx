"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, MONEY_ADDRESS, RPC_URL, dividendsAbi, erc20Abi } from "./abis";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StoredWallet {
  address: string;
  privateKey?: string;
  type?: string;
  isMetaMask?: boolean;
}

interface LogEntry {
  msg: string;
  type: "pending" | "success" | "error" | "info";
  ts: string;
}

interface StakeInfo {
  amount: string;
  stakeTimestamp: number;
}

interface PoolInfo {
  totalStaked: string;
  ethBalance: string;
  stakingToken: string;
  factoryAddress: string;
  poolCreator: string;
  owner: string;
  feePercent: string;
  feeDenominator: string;
  feeRecipient: string;
  hardLockDuration: string;
  initialPenaltyPercent: string;
  penaltyDecayPerDay: string;
  minStake: string;
}

interface RewardInfo {
  token: string;
  balance: string;
  reward: string;
  rptPaid: string;
  rptStored: string;
  isRegistered: boolean;
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
  } catch { return fb; }
}

function now() {
  return new Date().toLocaleTimeString();
}

/* ================================================================== */
/*  Design tokens                                                      */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-blue-400/60 focus:ring-1 focus:ring-blue-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
const btnGold = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
const btnGhost = "h-11 px-5 rounded-xl font-medium text-sm bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1.5";

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function MoneyDividendsApp() {
  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC_URL), []);

  /* wallet */
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const selected = selIdx !== null && wallets[selIdx] ? wallets[selIdx] : null;

  /* form */
  const [stakeAmount, setStakeAmount] = useState("");
  const [rewardTokenAddr, setRewardTokenAddr] = useState("");

  /* info */
  const [stakeInfo, setStakeInfo] = useState<StakeInfo | null>(null);
  const [moneyBalance, setMoneyBalance] = useState("0");
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [ethReward, setEthReward] = useState("0");
  const [tokenRewards, setTokenRewards] = useState<RewardInfo[]>([]);

  /* status */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [infoTab, setInfoTab] = useState<"user" | "pool">("user");

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLogs((p) => [{ msg, type, ts: now() }, ...p].slice(0, 50));
  }, []);

  /* ---- load wallets ---- */
  useEffect(() => {
    const stored: StoredWallet[] = storageGet("wallets", []);
    setWallets(stored);
    const savedIdx = parseInt(localStorage.getItem("selectedWalletIndex") || "0");
    if (stored.length > 0 && savedIdx >= 0 && savedIdx < stored.length) {
      setSelIdx(savedIdx);
    }
  }, []);

  const selectWallet = useCallback((idx: number) => {
    setSelIdx(idx);
    localStorage.setItem("selectedWalletIndex", String(idx));
  }, []);

  /* ---- connect MetaMask ---- */
  const connectMetaMask = useCallback(async () => {
    const w = window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<string[]> } };
    if (!w.ethereum) { addLog("Please install MetaMask!", "error"); return; }
    try {
      const p = new ethers.providers.Web3Provider(w.ethereum as unknown as ethers.providers.ExternalProvider);
      await w.ethereum.request({ method: "eth_requestAccounts" });
      const net = await p.getNetwork();
      if (net.chainId !== 1) throw new Error("Switch to Ethereum Mainnet");
      const s = p.getSigner();
      const addr = await s.getAddress();
      const mmWallet: StoredWallet = { address: addr, type: "MetaMask", isMetaMask: true };
      setWallets((prev) => {
        const exists = prev.some((wl) => wl.address.toLowerCase() === addr.toLowerCase());
        const next = exists ? prev : [...prev, mmWallet];
        localStorage.setItem("wallets", JSON.stringify(next));
        const newIdx = exists ? prev.findIndex((wl) => wl.address.toLowerCase() === addr.toLowerCase()) : next.length - 1;
        setSelIdx(newIdx);
        localStorage.setItem("selectedWalletIndex", String(newIdx));
        return next;
      });
      addLog(`MetaMask connected: ${shorten(addr)}`, "success");
    } catch (e: unknown) {
      addLog(`MetaMask error: ${(e as Error).message}`, "error");
    }
  }, [addLog]);

  /* ---- get signer ---- */
  const getSigner = useCallback(async () => {
    if (!selected) throw new Error("No wallet selected");
    if (selected.isMetaMask) {
      const w = window as unknown as { ethereum: ethers.providers.ExternalProvider };
      return new ethers.providers.Web3Provider(w.ethereum).getSigner();
    }
    if (!selected.privateKey) throw new Error("Wallet has no private key");
    return new ethers.Wallet(selected.privateKey, provider);
  }, [selected, provider]);

  /* ---- fetch info ---- */
  const fetchInfo = useCallback(async () => {
    if (!selected) return;
    try {
      const readContract = new ethers.Contract(CONTRACT_ADDRESS, dividendsAbi, provider);
      const moneyToken = new ethers.Contract(MONEY_ADDRESS, erc20Abi, provider);
      const addr = selected.address;

      const [stake, bal, total, ethBal, token, factory, creator, owner, feePct, feeDen, feeRec, lockDur, initPen, penDecay, minStk] = await Promise.all([
        readContract.stakes(addr),
        moneyToken.balanceOf(addr),
        readContract.totalStaked(),
        provider.getBalance(CONTRACT_ADDRESS),
        readContract.token(),
        readContract.factoryAddress(),
        readContract.poolCreator(),
        readContract.owner(),
        readContract.FEE_PERCENT(),
        readContract.FEE_DENOMINATOR(),
        readContract.FEE_RECIPIENT(),
        readContract.HARD_LOCK_DURATION(),
        readContract.INITIAL_PENALTY_PERCENT(),
        readContract.PENALTY_DECAY_PERCENT_PER_DAY(),
        readContract.MIN_STAKE(),
      ]);

      setStakeInfo({ amount: ethers.utils.formatEther(stake.amount), stakeTimestamp: stake.stakeTimestamp.toNumber() });
      setMoneyBalance(ethers.utils.formatEther(bal));
      setPoolInfo({
        totalStaked: ethers.utils.formatEther(total),
        ethBalance: ethers.utils.formatEther(ethBal),
        stakingToken: token,
        factoryAddress: factory,
        poolCreator: creator,
        owner,
        feePercent: `${feePct.toString()} bps (${(feePct.toNumber() / feeDen.toNumber() * 100).toFixed(2)}%)`,
        feeDenominator: feeDen.toString(),
        feeRecipient: feeRec,
        hardLockDuration: `${lockDur.toString()} seconds`,
        initialPenaltyPercent: `${initPen.toString()} bps`,
        penaltyDecayPerDay: `${penDecay.toString()} bps`,
        minStake: ethers.utils.formatEther(minStk),
      });

      const ethRw = await readContract.rewards(addr, ethers.constants.AddressZero);
      setEthReward(ethers.utils.formatEther(ethRw));

      const [tokens, balances] = await readContract.getRegisteredTokensAndBalances();
      const rewardInfos: RewardInfo[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const [reward, rptPaid, rptStored, isReg, tokenBal] = await Promise.all([
          readContract.rewards(addr, tokens[i]),
          readContract.userRewardPerTokenPaid(addr, tokens[i]),
          readContract.rewardPerTokenStored(tokens[i]),
          readContract.isRegisteredRewardToken(tokens[i]),
          readContract.tokenBalance(tokens[i]),
        ]);
        rewardInfos.push({
          token: tokens[i],
          balance: ethers.utils.formatEther(tokenBal),
          reward: ethers.utils.formatEther(reward),
          rptPaid: ethers.utils.formatEther(rptPaid),
          rptStored: ethers.utils.formatEther(rptStored),
          isRegistered: isReg,
        });
      }
      setTokenRewards(rewardInfos);
    } catch (e: unknown) {
      addLog(`Failed to fetch info: ${(e as Error).message}`, "error");
    }
  }, [selected, provider, addLog]);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  /* ---- stake ---- */
  const handleStake = useCallback(async () => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) { addLog("Enter a valid amount", "error"); return; }
    setBusy(true);
    try {
      const signer = await getSigner();
      const amountWei = ethers.utils.parseEther(stakeAmount);
      const moneyToken = new ethers.Contract(MONEY_ADDRESS, erc20Abi, signer);

      addLog("Checking allowance...", "pending");
      const allowance = await moneyToken.allowance(selected!.address, CONTRACT_ADDRESS);
      if (allowance.lt(amountWei)) {
        addLog("Approving MONEY tokens...", "pending");
        const approveTx = await moneyToken.approve(CONTRACT_ADDRESS, amountWei.mul(110).div(100));
        await approveTx.wait();
        addLog("Approval confirmed", "success");
      }

      addLog("Staking...", "pending");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, dividendsAbi, signer);
      const tx = await contract.stake(amountWei);
      await tx.wait();
      addLog(`Staked ${stakeAmount} MONEY successfully`, "success");
      setStakeAmount("");
      await fetchInfo();
    } catch (e: unknown) {
      addLog(`Stake failed: ${(e as Error).message}`, "error");
    } finally { setBusy(false); }
  }, [stakeAmount, getSigner, selected, fetchInfo, addLog]);

  /* ---- unstake ---- */
  const handleUnstake = useCallback(async () => {
    setBusy(true);
    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, dividendsAbi, signer);
      addLog("Unstaking...", "pending");
      const tx = await contract.unstake();
      await tx.wait();
      addLog("Unstaked successfully", "success");
      await fetchInfo();
    } catch (e: unknown) {
      addLog(`Unstake failed: ${(e as Error).message}`, "error");
    } finally { setBusy(false); }
  }, [getSigner, fetchInfo, addLog]);

  /* ---- claim ---- */
  const handleClaim = useCallback(async () => {
    setBusy(true);
    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, dividendsAbi, signer);
      addLog("Claiming all rewards...", "pending");
      const tx = await contract.claimAllRewards();
      await tx.wait();
      addLog("Dividends claimed successfully", "success");
      await fetchInfo();
    } catch (e: unknown) {
      addLog(`Claim failed: ${(e as Error).message}`, "error");
    } finally { setBusy(false); }
  }, [getSigner, fetchInfo, addLog]);

  /* ---- register reward token ---- */
  const handleRegister = useCallback(async () => {
    if (!ethers.utils.isAddress(rewardTokenAddr)) { addLog("Invalid token address", "error"); return; }
    setBusy(true);
    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, dividendsAbi, signer);
      addLog("Registering reward token...", "pending");
      const tx = await contract.registerRewardToken(rewardTokenAddr);
      await tx.wait();
      addLog("Reward token registered", "success");
      setRewardTokenAddr("");
      await fetchInfo();
    } catch (e: unknown) {
      addLog(`Register failed: ${(e as Error).message}`, "error");
    } finally { setBusy(false); }
  }, [rewardTokenAddr, getSigner, fetchInfo, addLog]);

  /* ---- unregister reward token ---- */
  const handleUnregister = useCallback(async () => {
    if (!ethers.utils.isAddress(rewardTokenAddr)) { addLog("Invalid token address", "error"); return; }
    setBusy(true);
    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, dividendsAbi, signer);
      addLog("Unregistering reward token...", "pending");
      const tx = await contract.unregisterRewardToken(rewardTokenAddr);
      await tx.wait();
      addLog("Reward token unregistered", "success");
      setRewardTokenAddr("");
      await fetchInfo();
    } catch (e: unknown) {
      addLog(`Unregister failed: ${(e as Error).message}`, "error");
    } finally { setBusy(false); }
  }, [rewardTokenAddr, getSigner, fetchInfo, addLog]);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[680px] mx-auto px-4 sm:px-6 py-10 space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">MoneyFund Dividends</h1>
          <p className="text-xs text-white/30">Stake MONEY, earn ETH and token rewards</p>
        </div>

        {/* ═══ Wallet ═══ */}
        <div className={`${card} p-5 space-y-3`}>
          <p className={labelCls}>Wallet</p>
          <div className="flex gap-3">
            <select value={selIdx ?? ""} onChange={(e) => selectWallet(parseInt(e.target.value))} className={`${selectCls} flex-1`}>
              <option value="">-- Select Wallet --</option>
              {wallets.map((w, i) => (
                <option key={i} value={i}>{w.type}: {shorten(w.address)}</option>
              ))}
            </select>
            <button type="button" onClick={connectMetaMask} className={btnGhost}>MetaMask</button>
          </div>
          {selected && <p className="text-xs text-white/30 font-mono text-center">{selected.address}</p>}
        </div>

        {/* ═══ Staking Actions ═══ */}
        <div className={`${card} p-5 space-y-4`}>
          <p className={labelCls}>Stake / Unstake / Claim</p>
          <input
            type="number"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            placeholder="Amount to stake (MONEY)"
            step="any"
            min={0}
            className={inputCls}
          />
          <div className="flex gap-3 flex-wrap justify-center">
            <button type="button" onClick={handleStake} disabled={busy || !selected} className={btnPrimary}>Stake</button>
            <button type="button" onClick={handleUnstake} disabled={busy || !selected} className={btnPrimary}>Unstake</button>
            <button type="button" onClick={handleClaim} disabled={busy || !selected} className={btnGold}>Claim Dividends</button>
          </div>
        </div>

        {/* ═══ Information ═══ */}
        <div className={`${card} overflow-hidden`}>
          <div className="flex border-b border-white/[0.06]">
            <button
              type="button"
              onClick={() => setInfoTab("user")}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${infoTab === "user" ? "text-blue-400 bg-blue-400/10 border-b-2 border-blue-400" : "text-white/30 hover:text-white/50"}`}
            >Your Stake</button>
            <button
              type="button"
              onClick={() => setInfoTab("pool")}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${infoTab === "pool" ? "text-blue-400 bg-blue-400/10 border-b-2 border-blue-400" : "text-white/30 hover:text-white/50"}`}
            >Pool Info</button>
          </div>

          <div className="p-5 space-y-3">
            {!selected ? (
              <p className="text-xs text-white/20 text-center py-4">Connect wallet to see information</p>
            ) : infoTab === "user" ? (
              <>
                <InfoRow label="Staked Amount" value={stakeInfo ? `${stakeInfo.amount} MONEY` : "—"} />
                <InfoRow label="Stake Time" value={stakeInfo && stakeInfo.stakeTimestamp > 0 ? new Date(stakeInfo.stakeTimestamp * 1000).toLocaleString() : "Not staked"} />
                <InfoRow label="MONEY Balance" value={`${moneyBalance} MONEY`} />
                <InfoRow label="Accumulated ETH Reward" value={`${ethReward} ETH`} highlight />
                {tokenRewards.length > 0 && (
                  <>
                    <div className="border-t border-white/[0.06] pt-3 mt-3">
                      <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-2">Token Rewards</p>
                    </div>
                    {tokenRewards.map((r) => (
                      <div key={r.token} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 space-y-1">
                        <p className="text-[10px] text-white/30 font-mono break-all">{r.token}</p>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/40">Reward</span>
                          <span className="text-emerald-400/80 font-medium">{r.reward}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/40">Pool Balance</span>
                          <span className="text-white/60">{r.balance}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/40">Registered</span>
                          <span className={r.isRegistered ? "text-emerald-400/80" : "text-red-400/60"}>{r.isRegistered ? "Yes" : "No"}</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : poolInfo ? (
              <>
                <InfoRow label="Total Staked" value={`${poolInfo.totalStaked} MONEY`} />
                <InfoRow label="Pool ETH Balance" value={`${poolInfo.ethBalance} ETH`} />
                <InfoRow label="Staking Token" value={poolInfo.stakingToken} mono />
                <InfoRow label="Factory" value={poolInfo.factoryAddress} mono />
                <InfoRow label="Pool Creator" value={poolInfo.poolCreator} mono />
                <InfoRow label="Owner" value={poolInfo.owner} mono />
                <InfoRow label="Fee" value={poolInfo.feePercent} />
                <InfoRow label="Fee Recipient" value={poolInfo.feeRecipient} mono />
                <InfoRow label="Hard Lock Duration" value={poolInfo.hardLockDuration} />
                <InfoRow label="Initial Penalty" value={poolInfo.initialPenaltyPercent} />
                <InfoRow label="Penalty Decay/Day" value={poolInfo.penaltyDecayPerDay} />
                <InfoRow label="Min Stake" value={`${poolInfo.minStake} MONEY`} />
              </>
            ) : (
              <p className="text-xs text-white/20 text-center py-4">Loading...</p>
            )}
          </div>
        </div>

        {/* ═══ Reward Token Management ═══ */}
        <div className={`${card} p-5 space-y-3`}>
          <p className={labelCls}>Reward Token Management</p>
          <input
            type="text"
            value={rewardTokenAddr}
            onChange={(e) => setRewardTokenAddr(e.target.value)}
            placeholder="Reward Token Address (0x...)"
            className={inputCls}
          />
          <div className="flex gap-3 justify-center">
            <button type="button" onClick={handleRegister} disabled={busy || !selected} className={btnPrimary}>Register</button>
            <button type="button" onClick={handleUnregister} disabled={busy || !selected} className={`${btnPrimary} !from-red-600 !to-red-500`}>Unregister</button>
          </div>
        </div>

        {/* ═══ Activity Log ═══ */}
        {logs.length > 0 && (
          <div className={`${card} p-4`}>
            <p className={`${labelCls} mb-2`}>Activity</p>
            <div className="max-h-36 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-blue-600/30 scrollbar-track-transparent">
              {logs.map((l, i) => (
                <div key={i} className="flex items-start gap-2 px-2 py-1 rounded-lg bg-white/[0.02]">
                  <span className={`text-[10px] mt-0.5 ${l.type === "success" ? "text-emerald-400" : l.type === "error" ? "text-red-400" : l.type === "pending" ? "text-amber-400" : "text-white/30"}`}>
                    {l.type === "success" ? "✓" : l.type === "error" ? "✗" : l.type === "pending" ? "⋯" : "·"}
                  </span>
                  <span className="text-xs text-white/50 flex-1 break-all">{l.msg}</span>
                  <span className="text-[9px] text-white/15 shrink-0">{l.ts}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[10px] text-white/10 pt-4">0.5% fee on stake/unstake/claim</p>
      </div>
    </div>
  );
}

/* ---- Info Row ---- */
function InfoRow({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-xs text-white/40 shrink-0">{label}</span>
      <span className={`text-xs text-right break-all ${highlight ? "text-amber-400 font-semibold" : "text-white/70"} ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
  );
}
