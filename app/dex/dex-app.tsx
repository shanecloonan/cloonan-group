"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { MONEYDEX_ADDRESS, MONEYDEX_ABI, PAIR_ABI, ERC20_ABI } from "./abis";
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { logTx } from "@/lib/activity";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StatusState {
  msg: string;
  state: "idle" | "pending" | "success" | "error";
  txHash?: string;
}

interface PairInfo {
  address: string;
  token0: string;
  token1: string;
  symbol0: string;
  symbol1: string;
}

import { RPC_URL as INFURA_RPC } from "@/lib/config";

function shortenAddr(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
const btnGhost = "h-10 px-5 rounded-xl font-medium text-sm border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1.5";
const sectionHeader = "text-sm font-semibold text-white/80 mb-3 pb-2 border-b border-white/[0.06]";

/* ------------------------------------------------------------------ */
/*  StatusBadge                                                        */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: StatusState }) {
  if (status.state === "idle") return null;
  const color =
    status.state === "success"
      ? "border-emerald-400/30"
      : status.state === "error"
        ? "border-red-400/30"
        : "border-indigo-400/30";
  return (
    <div
      className={`flex items-center gap-2 mt-2 px-3 py-1.5 rounded-md bg-white/[0.03] border text-xs text-white/60 ${color} animate-[slideUp_0.3s_ease]`}
    >
      {status.state === "pending" && (
        <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      )}
      {status.state === "success" && (
        <span className="w-3 h-3 bg-emerald-400 rounded-full text-[8px] text-white flex items-center justify-center">
          ✓
        </span>
      )}
      {status.state === "error" && (
        <span className="w-3 h-3 bg-red-400 rounded-full text-[8px] text-white flex items-center justify-center">
          ✗
        </span>
      )}
      <span className="truncate">
        {status.msg}
        {status.txHash && status.state === "success" && (
          <>
            {" "}
            <a
              href={`https://etherscan.io/tx/${status.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 underline"
            >
              View
            </a>
          </>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function DexApp() {
  const {
    user, vaultUnlocked, ethWallets, selectedEthWallet, selectedEthAddress,
    selectEthWallet, connectMetaMask: ctxConnectMetaMask, getSigner,
  } = useWallet();

  const account = selectedEthAddress;
  const readProvider = useMemo(() => new ethers.providers.JsonRpcProvider(INFURA_RPC), []);

  /* ---- contract refs ---- */
  const dexRef = useRef<ethers.Contract | null>(null);
  const pairRef = useRef<ethers.Contract | null>(null);
  const t0Ref = useRef<ethers.Contract | null>(null);
  const t1Ref = useRef<ethers.Contract | null>(null);

  /* ---- stats ---- */
  const [totalPairs, setTotalPairs] = useState("—");
  const [totalSwaps, setTotalSwaps] = useState("—");

  /* ---- sections ---- */
  const [openSection, setOpenSection] = useState<string | null>(null);

  /* ---- pair ---- */
  const [pairAddress, setPairAddress] = useState("");
  const [pairDetails, setPairDetails] = useState("Enter a pair address to load details.");
  const [pairLoadStatus, setPairLoadStatus] = useState<StatusState>({
    msg: "",
    state: "idle",
  });
  const [pairListHtml, setPairListHtml] = useState<PairInfo[]>([]);
  const [pairListStatus, setPairListStatus] = useState<StatusState>({
    msg: "",
    state: "idle",
  });

  /* ---- create pair ---- */
  const [cpToken0, setCpToken0] = useState("");
  const [cpToken1, setCpToken1] = useState("");
  const [cpStatus, setCpStatus] = useState<StatusState>({
    msg: "",
    state: "idle",
  });

  /* ---- add liquidity ---- */
  const [alAmt0, setAlAmt0] = useState("");
  const [alAmt1, setAlAmt1] = useState("");
  const [alStatus, setAlStatus] = useState<StatusState>({
    msg: "",
    state: "idle",
  });

  /* ---- remove liquidity ---- */
  const [rlAmt, setRlAmt] = useState("");
  const [rlStatus, setRlStatus] = useState<StatusState>({
    msg: "",
    state: "idle",
  });

  /* ---- swap ---- */
  const [swapAmt, setSwapAmt] = useState("");
  const [slippage, setSlippage] = useState("5");
  const [swapStatus, setSwapStatus] = useState<StatusState>({
    msg: "",
    state: "idle",
  });

  /* ================================================================ */
  /*  Helpers                                                          */
  /* ================================================================ */

  const updateStats = useCallback(async () => {
    try {
      const readDex = new ethers.Contract(MONEYDEX_ADDRESS, MONEYDEX_ABI, readProvider);
      const [tp, ts] = await Promise.all([
        readDex.totalPairs(),
        readDex.getTotalSwaps(),
      ]);
      setTotalPairs(tp.toString());
      setTotalSwaps(ts.toString());
    } catch {
      setTotalPairs("Error");
      setTotalSwaps("Error");
    }
  }, [readProvider]);

  useEffect(() => {
    updateStats();
  }, [updateStats]);

  useEffect(() => {
    const signer = getSigner();
    if (signer) {
      dexRef.current = new ethers.Contract(MONEYDEX_ADDRESS, MONEYDEX_ABI, signer);
    } else {
      dexRef.current = null;
    }
  }, [selectedEthWallet, getSigner]);

  /* ---- load pair ---- */
  const loadPair = useCallback(
    async (addrOverride?: string) => {
      const addr = addrOverride ?? pairAddress;
      if (!ethers.utils.isAddress(addr)) {
        setPairLoadStatus({ msg: "Invalid pair address", state: "error" });
        return;
      }
      const signer = getSigner();
      const providerOrSigner = signer || readProvider;
      const readDex = new ethers.Contract(MONEYDEX_ADDRESS, MONEYDEX_ABI, providerOrSigner);
      setPairLoadStatus({ msg: "Loading pair...", state: "pending" });
      try {
        const pair = new ethers.Contract(addr, PAIR_ABI, providerOrSigner);
        const [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);
        const t0 = new ethers.Contract(token0, ERC20_ABI, providerOrSigner);
        const t1 = new ethers.Contract(token1, ERC20_ABI, providerOrSigner);
        const [sym0, sym1, reserves] = await Promise.all([
          t0.symbol(),
          t1.symbol(),
          readDex.getReserves(token0, token1),
        ]);
        pairRef.current = pair;
        t0Ref.current = t0;
        t1Ref.current = t1;
        setPairDetails(
          `Token 1: ${sym0} (${token0})\nToken 2: ${sym1} (${token1})\n---\nReserves:\n${ethers.utils.formatEther(reserves[0])} ${sym0}\n${ethers.utils.formatEther(reserves[1])} ${sym1}`,
        );
        setPairLoadStatus({ msg: "Pair loaded", state: "success" });
      } catch (e: any) {
        setPairDetails(`Error: ${e.message}`);
        setPairLoadStatus({ msg: `Error: ${e.message}`, state: "error" });
      }
    },
    [pairAddress, getSigner, readProvider],
  );

  /* ---- list pairs ---- */
  const listPairs = useCallback(async () => {
    setPairListStatus({ msg: "Loading pairs...", state: "pending" });
    try {
      const readDex = new ethers.Contract(MONEYDEX_ADDRESS, MONEYDEX_ABI, readProvider);
      const pairs: string[] = await readDex.getAllPairs();
      const infos: PairInfo[] = [];
      const infosResult = await Promise.all(
        pairs.map(async (pa): Promise<PairInfo | null> => {
          try {
            const pc = new ethers.Contract(pa, PAIR_ABI, readProvider);
            const [tok0, tok1] = await Promise.all([pc.token0(), pc.token1()]);
            const t0c = new ethers.Contract(tok0, ERC20_ABI, readProvider);
            const t1c = new ethers.Contract(tok1, ERC20_ABI, readProvider);
            const [s0, s1] = await Promise.all([t0c.symbol(), t1c.symbol()]);
            return { address: pa, token0: tok0, token1: tok1, symbol0: s0, symbol1: s1 };
          } catch { return null; }
        }),
      );
      setPairListHtml(infosResult.filter((p): p is PairInfo => p !== null));
      setPairListStatus({ msg: "Pairs loaded", state: "success" });
    } catch (e: any) {
      setPairListStatus({ msg: `Error: ${e.message}`, state: "error" });
    }
  }, [readProvider]);

  const toggle = useCallback(
    (id: string) => {
      setOpenSection((prev) => {
        if (prev === id) return null;
        if (id === "pairList") listPairs();
        return id;
      });
    },
    [listPairs],
  );

  /* ---- create pair ---- */
  const createPair = useCallback(async () => {
    if (!dexRef.current) {
      setCpStatus({ msg: "Select a wallet first", state: "error" });
      return;
    }
    if (!ethers.utils.isAddress(cpToken0) || !ethers.utils.isAddress(cpToken1)) {
      setCpStatus({ msg: "Invalid token addresses", state: "error" });
      return;
    }
    setCpStatus({ msg: "Creating pair...", state: "pending" });
    try {
      const existing = await dexRef.current.getPair(cpToken0, cpToken1);
      if (existing !== ethers.constants.AddressZero) {
        setCpStatus({ msg: "Pair already exists", state: "error" });
        return;
      }
      const tx = await dexRef.current.createPair(cpToken0, cpToken1);
      const receipt = await tx.wait();
      setCpStatus({ msg: "Pair created", state: "success", txHash: receipt.transactionHash });
      if (account) logTx({ walletAddress: account, txHash: receipt.transactionHash, dapp: "dex", action: "create_pair", contractAddress: MONEYDEX_ADDRESS, details: { token0: cpToken0, token1: cpToken1 } });
      await updateStats();
    } catch (e: any) {
      setCpStatus({ msg: `Failed: ${e.message}`, state: "error" });
    }
  }, [cpToken0, cpToken1, updateStats]);

  /* ---- add liquidity ---- */
  const addLiquidity = useCallback(async () => {
    if (!dexRef.current || !t0Ref.current || !t1Ref.current) {
      setAlStatus({ msg: "Load a pair first", state: "error" });
      return;
    }
    if (!alAmt0 || !alAmt1 || Number(alAmt0) <= 0 || Number(alAmt1) <= 0) {
      setAlStatus({ msg: "Enter valid amounts", state: "error" });
      return;
    }
    const amt0 = ethers.utils.parseEther(alAmt0);
    const amt1 = ethers.utils.parseEther(alAmt1);
    setAlStatus({ msg: "Approving & adding liquidity...", state: "pending" });
    try {
      const signer = getSigner();
      if (!signer) { setAlStatus({ msg: "Select a wallet", state: "error" }); return; }
      const addr = await signer.getAddress();
      const allow0 = await t0Ref.current.allowance(addr, MONEYDEX_ADDRESS);
      if (allow0.lt(amt0)) {
        const txA = await t0Ref.current.approve(MONEYDEX_ADDRESS, amt0);
        await txA.wait();
      }
      const allow1 = await t1Ref.current.allowance(addr, MONEYDEX_ADDRESS);
      if (allow1.lt(amt1)) {
        const txB = await t1Ref.current.approve(MONEYDEX_ADDRESS, amt1);
        await txB.wait();
      }
      const tx = await dexRef.current.addLiquidity(
        t0Ref.current.address,
        t1Ref.current.address,
        amt0,
        amt1,
      );
      const receipt = await tx.wait();
      setAlStatus({ msg: "Liquidity added", state: "success", txHash: receipt.transactionHash });
      if (account) logTx({ walletAddress: account, txHash: receipt.transactionHash, dapp: "dex", action: "add_liquidity", amount: `${alAmt0} / ${alAmt1}`, contractAddress: MONEYDEX_ADDRESS });
      loadPair();
      await updateStats();
    } catch (e: any) {
      setAlStatus({ msg: `Failed: ${e.message}`, state: "error" });
    }
  }, [alAmt0, alAmt1, loadPair, updateStats, getSigner, account]);

  /* ---- remove liquidity ---- */
  const removeLiquidity = useCallback(async () => {
    if (!dexRef.current || !pairRef.current || !t0Ref.current || !t1Ref.current) {
      setRlStatus({ msg: "Load a pair first", state: "error" });
      return;
    }
    if (!rlAmt || Number(rlAmt) <= 0) {
      setRlStatus({ msg: "Enter a valid amount", state: "error" });
      return;
    }
    const liqWei = ethers.utils.parseEther(rlAmt);
    setRlStatus({ msg: "Removing liquidity...", state: "pending" });
    try {
      const signer = getSigner();
      if (!signer) { setRlStatus({ msg: "Select a wallet", state: "error" }); return; }
      const addr = await signer.getAddress();
      const allow = await pairRef.current.allowance(addr, MONEYDEX_ADDRESS);
      if (allow.lt(liqWei)) {
        const txA = await pairRef.current.approve(MONEYDEX_ADDRESS, liqWei);
        await txA.wait();
      }
      const tx = await dexRef.current.removeLiquidity(
        t0Ref.current.address,
        t1Ref.current.address,
        liqWei,
      );
      const receipt = await tx.wait();
      setRlStatus({ msg: "Liquidity removed", state: "success", txHash: receipt.transactionHash });
      if (account) logTx({ walletAddress: account, txHash: receipt.transactionHash, dapp: "dex", action: "remove_liquidity", amount: rlAmt, contractAddress: MONEYDEX_ADDRESS });
      loadPair();
      await updateStats();
    } catch (e: any) {
      setRlStatus({ msg: `Failed: ${e.message}`, state: "error" });
    }
  }, [rlAmt, loadPair, updateStats, getSigner, account]);

  /* ---- swap ---- */
  const doSwap = useCallback(
    async (token0ToToken1: boolean) => {
      if (!dexRef.current || !t0Ref.current || !t1Ref.current) {
        setSwapStatus({ msg: "Load a pair first", state: "error" });
        return;
      }
      if (!swapAmt || Number(swapAmt) <= 0) {
        setSwapStatus({ msg: "Enter a valid amount", state: "error" });
        return;
      }
      const slip = Number(slippage);
      if (!slip || slip <= 0 || slip > 50) {
        setSwapStatus({ msg: "Invalid slippage (0.1-50%)", state: "error" });
        return;
      }
      const amtWei = ethers.utils.parseEther(swapAmt);
      setSwapStatus({ msg: "Swapping tokens...", state: "pending" });
      try {
        const reserves = await dexRef.current.getReserves(
          t0Ref.current.address,
          t1Ref.current.address,
        );
        const rIn = token0ToToken1 ? reserves[0] : reserves[1];
        const rOut = token0ToToken1 ? reserves[1] : reserves[0];
        const amtWithFee = amtWei.mul(995).div(1000);
        const amtOut = amtWithFee.mul(rOut).div(rIn.add(amtWithFee));
        const minOut = amtOut.mul(10000 - Math.round(slip * 100)).div(10000);

        const tokenContract = token0ToToken1 ? t0Ref.current : t1Ref.current;
        const signer = getSigner();
        if (!signer) { setSwapStatus({ msg: "Select a wallet", state: "error" }); return; }
        const addr = await signer.getAddress();
        const allow = await tokenContract.allowance(addr, MONEYDEX_ADDRESS);
        if (allow.lt(amtWei)) {
          const txA = await tokenContract.approve(MONEYDEX_ADDRESS, amtWei);
          await txA.wait();
        }

        const method = token0ToToken1 ? "swapToken0ForToken1" : "swapToken1ForToken0";
        const tx = await dexRef.current[method](
          t0Ref.current.address,
          t1Ref.current.address,
          amtWei,
          minOut,
        );
        const receipt = await tx.wait();
        setSwapStatus({ msg: "Swap completed", state: "success", txHash: receipt.transactionHash });
        if (account) logTx({ walletAddress: account, txHash: receipt.transactionHash, dapp: "dex", action: "swap_token", amount: swapAmt, contractAddress: MONEYDEX_ADDRESS });
        loadPair();
        await updateStats();
      } catch (e: any) {
        setSwapStatus({ msg: `Failed: ${e.message}`, state: "error" });
      }
    },
    [swapAmt, slippage, loadPair, updateStats, getSigner, account],
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const sectionBtn = (active: boolean) => (active ? btnPrimary : btnGhost);

  if (!user || !vaultUnlocked) {
    return (
      <div className="min-h-screen flex items-start justify-center p-4 sm:p-8" style={{ background: "#08090e" }}>
        <div className="w-full max-w-[720px] mx-auto pt-12">
          <AuthPanel />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-start justify-center p-4 sm:p-8"
      style={{ background: "#08090e" }}
    >
      <div className="w-full max-w-[720px] mx-auto space-y-6 pt-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-white/90 text-center">
          MoneyFund <span className="text-indigo-400">DEX</span>
        </h1>

        {/* Wallet controls */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <select
            value={selectedEthAddress ?? ""}
            onChange={(e) => selectEthWallet(e.target.value || null)}
            className={`flex-1 min-w-0 ${inputCls} appearance-none cursor-pointer`}
          >
            <option value="">Select wallet...</option>
            {ethWallets.map((w) => (
              <option key={w.address} value={w.address}>{shortenAddr(w.address)} ({w.type})</option>
            ))}
          </select>
          <button type="button" onClick={() => ctxConnectMetaMask().catch(() => {})} className={btnGhost}>
            MetaMask
          </button>
          {account && (
            <span className="bg-white/[0.04] border border-white/[0.06] text-indigo-400 rounded-lg px-4 py-2 text-xs font-mono hidden sm:inline">
              {shortenAddr(account)}
            </span>
          )}
        </div>

        {/* Main section */}
        {account && (
          <div className={`${card} p-6 space-y-6`}>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className={`${card} px-5 py-4 text-center`}>
                <div className={labelCls}>Total Pairs</div>
                <div className="text-lg font-bold text-white/90">{totalPairs}</div>
              </div>
              <div className={`${card} px-5 py-4 text-center`}>
                <div className={labelCls}>Total Swaps</div>
                <div className="text-lg font-bold text-white/90">{totalSwaps}</div>
              </div>
            </div>

            {/* Pair address input */}
            <div className="space-y-1.5">
              <label className={labelCls}>Pair Address</label>
              <input
                type="text"
                value={pairAddress}
                onChange={(e) => setPairAddress(e.target.value)}
                placeholder="0x..."
                className={inputCls}
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => toggle("createPair")} className={sectionBtn(openSection === "createPair")}>
                Create New Pair
              </button>
              <button type="button" onClick={() => loadPair()} className={btnPrimary}>
                Load Pair
              </button>
              <button type="button" onClick={() => toggle("pairList")} className={sectionBtn(openSection === "pairList")}>
                See All Pairs
              </button>
              <button type="button" onClick={() => toggle("addLiq")} className={sectionBtn(openSection === "addLiq")}>
                Add Liquidity
              </button>
              <button type="button" onClick={() => toggle("removeLiq")} className={sectionBtn(openSection === "removeLiq")}>
                Remove Liquidity
              </button>
              <button type="button" onClick={() => toggle("swap")} className={sectionBtn(openSection === "swap")}>
                Swap Tokens
              </button>
            </div>

            <StatusBadge status={pairLoadStatus} />

            {/* ── Create Pair ── */}
            {openSection === "createPair" && (
              <div className={`${card} p-5 space-y-4`}>
                <h3 className={sectionHeader}>Create New Pair</h3>
                <div className="space-y-1.5">
                  <label className={labelCls}>Token 1 Address</label>
                  <input
                    type="text"
                    value={cpToken0}
                    onChange={(e) => setCpToken0(e.target.value)}
                    placeholder="0x..."
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>Token 2 Address</label>
                  <input
                    type="text"
                    value={cpToken1}
                    onChange={(e) => setCpToken1(e.target.value)}
                    placeholder="0x..."
                    className={inputCls}
                  />
                </div>
                <button type="button" onClick={createPair} className={btnPrimary}>
                  Create Pair
                </button>
                <StatusBadge status={cpStatus} />
              </div>
            )}

            {/* ── Pair List ── */}
            {openSection === "pairList" && (
              <div className={`${card} p-5 max-h-60 overflow-y-auto overflow-x-hidden space-y-0 text-sm text-left`}>
                {pairListHtml.length === 0 && pairListStatus.state !== "pending" && (
                  <p className="text-white/30 text-center py-3">No pairs found.</p>
                )}
                {pairListHtml.map((p) => (
                  <div
                    key={p.address}
                    className="flex items-center justify-between gap-3 py-2.5 px-2 bg-white/[0.02] border-b border-white/[0.04] last:border-b-0"
                  >
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <span className="text-white/90 font-semibold">
                        {p.symbol0}/{p.symbol1}
                      </span>
                      <br />
                      <span className="text-xs font-mono text-white/30 block truncate">
                        {p.address}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPairAddress(p.address);
                        loadPair(p.address);
                      }}
                      className={`${btnGhost} shrink-0`}
                    >
                      Load
                    </button>
                  </div>
                ))}
                <StatusBadge status={pairListStatus} />
              </div>
            )}

            {/* ── Add Liquidity ── */}
            {openSection === "addLiq" && (
              <div className={`${card} p-5 space-y-4`}>
                <h3 className={sectionHeader}>Add Liquidity</h3>
                <div className="space-y-1.5">
                  <label className={labelCls}>Amount of Token 1</label>
                  <input
                    type="number"
                    value={alAmt0}
                    onChange={(e) => setAlAmt0(e.target.value)}
                    placeholder="e.g., 10"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>Amount of Token 2</label>
                  <input
                    type="number"
                    value={alAmt1}
                    onChange={(e) => setAlAmt1(e.target.value)}
                    placeholder="e.g., 10"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <button type="button" onClick={addLiquidity} className={btnPrimary}>
                  Approve & Add Liquidity
                </button>
                <StatusBadge status={alStatus} />
              </div>
            )}

            {/* ── Remove Liquidity ── */}
            {openSection === "removeLiq" && (
              <div className={`${card} p-5 space-y-4`}>
                <h3 className={sectionHeader}>Remove Liquidity</h3>
                <div className="space-y-1.5">
                  <label className={labelCls}>LP Tokens to Burn</label>
                  <input
                    type="number"
                    value={rlAmt}
                    onChange={(e) => setRlAmt(e.target.value)}
                    placeholder="e.g., 100"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <button type="button" onClick={removeLiquidity} className={btnPrimary}>
                  Remove Liquidity
                </button>
                <StatusBadge status={rlStatus} />
              </div>
            )}

            {/* ── Swap ── */}
            {openSection === "swap" && (
              <div className={`${card} p-5 space-y-4`}>
                <h3 className={sectionHeader}>Swap Tokens</h3>
                <div className="space-y-1.5">
                  <label className={labelCls}>Amount to Swap</label>
                  <input
                    type="number"
                    value={swapAmt}
                    onChange={(e) => setSwapAmt(e.target.value)}
                    placeholder="e.g., 5"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>Slippage Tolerance (%)</label>
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    placeholder="e.g., 5"
                    step="0.1"
                    min="0.1"
                    max="50"
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button type="button" onClick={() => doSwap(true)} className={btnPrimary}>
                    Swap Token 1 → 2
                  </button>
                  <button type="button" onClick={() => doSwap(false)} className={btnPrimary}>
                    Swap Token 2 → 1
                  </button>
                </div>
                <StatusBadge status={swapStatus} />
              </div>
            )}

            {/* Pair details */}
            <div className={`${card} px-5 py-4 text-sm text-white/60 whitespace-pre-wrap text-center`}>
              {pairDetails}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
