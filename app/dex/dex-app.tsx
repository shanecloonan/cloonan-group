"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { MONEYDEX_ADDRESS, MONEYDEX_ABI, PAIR_ABI, ERC20_ABI } from "./abis";

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

/* ------------------------------------------------------------------ */
/*  Globals / Ethereum helpers                                         */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    ethereum?: any;
  }
}

const INFURA_RPC = "https://mainnet.infura.io/v3/cf2916fb6dbc47ae824d6f36db817b73";

function shortenAddr(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/*  StatusBadge                                                        */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: StatusState }) {
  if (status.state === "idle") return null;
  const color =
    status.state === "success"
      ? "border-indigo-500"
      : status.state === "error"
        ? "border-red-500"
        : "border-indigo-500/30";
  return (
    <div
      className={`flex items-center gap-2 mt-2 px-3 py-1.5 rounded-md bg-slate-900/90 border text-xs ${color} animate-[slideUp_0.3s_ease]`}
    >
      {status.state === "pending" && (
        <span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      )}
      {status.state === "success" && (
        <span className="w-3 h-3 bg-indigo-500 rounded-full text-[8px] text-white flex items-center justify-center">
          ✓
        </span>
      )}
      {status.state === "error" && (
        <span className="w-3 h-3 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center">
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
  /* ---- wallet state ---- */
  const [account, setAccount] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState<StatusState>({
    msg: "",
    state: "idle",
  });

  /* ---- contract refs ---- */
  const signerRef = useRef<ethers.Signer | null>(null);
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
      const readProvider = new ethers.providers.JsonRpcProvider(INFURA_RPC);
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
  }, []);

  useEffect(() => {
    updateStats();
  }, [updateStats]);

  /* ---- connect MetaMask ---- */
  const connectMetaMask = useCallback(async () => {
    if (!window.ethereum) {
      setWalletStatus({ msg: "Install MetaMask!", state: "error" });
      return;
    }
    setWalletStatus({ msg: "Connecting MetaMask...", state: "pending" });
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const net = await provider.getNetwork();
      if (net.chainId !== 1) throw new Error("Switch to Ethereum Mainnet");
      const signer = provider.getSigner();
      const addr = await signer.getAddress();
      signerRef.current = signer;
      dexRef.current = new ethers.Contract(MONEYDEX_ADDRESS, MONEYDEX_ABI, signer);
      setAccount(addr);
      setWalletStatus({ msg: "MetaMask connected", state: "success" });
      await updateStats();
    } catch (e: any) {
      setWalletStatus({
        msg: `Connection failed: ${e.message}`,
        state: "error",
      });
    }
  }, [updateStats]);

  /* ---- toggle section ---- */
  const toggle = useCallback(
    (id: string) => {
      setOpenSection((prev) => (prev === id ? null : id));
      if (id === "pairList" && openSection !== "pairList") listPairs();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openSection],
  );

  /* ---- load pair ---- */
  const loadPair = useCallback(
    async (addrOverride?: string) => {
      const addr = addrOverride ?? pairAddress;
      if (!ethers.utils.isAddress(addr)) {
        setPairLoadStatus({ msg: "Invalid pair address", state: "error" });
        return;
      }
      if (!dexRef.current || !signerRef.current) {
        setPairLoadStatus({ msg: "Connect wallet first", state: "error" });
        return;
      }
      setPairLoadStatus({ msg: "Loading pair...", state: "pending" });
      try {
        const pair = new ethers.Contract(addr, PAIR_ABI, signerRef.current);
        const [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);
        const t0 = new ethers.Contract(token0, ERC20_ABI, signerRef.current);
        const t1 = new ethers.Contract(token1, ERC20_ABI, signerRef.current);
        const [sym0, sym1, reserves] = await Promise.all([
          t0.symbol(),
          t1.symbol(),
          dexRef.current.getReserves(token0, token1),
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
    [pairAddress],
  );

  /* ---- list pairs ---- */
  const listPairs = useCallback(async () => {
    if (!dexRef.current) {
      setPairListStatus({ msg: "Connect wallet first", state: "error" });
      return;
    }
    setPairListStatus({ msg: "Loading pairs...", state: "pending" });
    try {
      const readProvider = new ethers.providers.JsonRpcProvider(INFURA_RPC);
      const pairs: string[] = await dexRef.current.getAllPairs();
      const infos: PairInfo[] = [];
      for (const pa of pairs) {
        const pc = new ethers.Contract(pa, PAIR_ABI, readProvider);
        const [tok0, tok1] = await Promise.all([pc.token0(), pc.token1()]);
        const t0c = new ethers.Contract(tok0, ERC20_ABI, readProvider);
        const t1c = new ethers.Contract(tok1, ERC20_ABI, readProvider);
        const [s0, s1] = await Promise.all([t0c.symbol(), t1c.symbol()]);
        infos.push({ address: pa, token0: tok0, token1: tok1, symbol0: s0, symbol1: s1 });
      }
      setPairListHtml(infos);
      setPairListStatus({ msg: "Pairs loaded", state: "success" });
    } catch (e: any) {
      setPairListStatus({ msg: `Error: ${e.message}`, state: "error" });
    }
  }, []);

  /* ---- create pair ---- */
  const createPair = useCallback(async () => {
    if (!dexRef.current || !signerRef.current) {
      setCpStatus({ msg: "Connect wallet first", state: "error" });
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
      const addr = await signerRef.current!.getAddress();
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
      loadPair();
      await updateStats();
    } catch (e: any) {
      setAlStatus({ msg: `Failed: ${e.message}`, state: "error" });
    }
  }, [alAmt0, alAmt1, loadPair, updateStats]);

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
      const addr = await signerRef.current!.getAddress();
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
      loadPair();
      await updateStats();
    } catch (e: any) {
      setRlStatus({ msg: `Failed: ${e.message}`, state: "error" });
    }
  }, [rlAmt, loadPair, updateStats]);

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
        const addr = await signerRef.current!.getAddress();
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
        loadPair();
        await updateStats();
      } catch (e: any) {
        setSwapStatus({ msg: `Failed: ${e.message}`, state: "error" });
      }
    },
    [swapAmt, slippage, loadPair, updateStats],
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const inputCls =
    "w-full max-w-xs px-4 py-3 rounded-lg bg-white text-black text-sm border border-indigo-500/20 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none shadow-inner transition-all placeholder:text-gray-400";
  const btnCls =
    "px-4 py-2.5 rounded-lg text-white text-xs sm:text-sm font-semibold bg-gradient-to-r from-indigo-600 to-purple-500 hover:from-indigo-500 hover:to-purple-400 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-indigo-500/30 whitespace-nowrap";
  const sectionBtnCls = (active: boolean) =>
    `${btnCls} ${active ? "ring-2 ring-indigo-400" : ""}`;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6"
      style={{ background: "#0A0C1E" }}
    >
      <div className="w-full max-w-3xl mx-auto text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-5">
          MoneyFund <span className="text-indigo-400">DEX</span>
        </h1>

        {/* Wallet controls */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
          {account && (
            <span className="text-xs sm:text-sm font-mono text-indigo-300 bg-slate-800/80 px-4 py-2 rounded-lg border border-indigo-500/20">
              {shortenAddr(account)}
            </span>
          )}
          <button type="button" onClick={connectMetaMask} className={`${btnCls} !bg-gray-600 hover:!bg-gray-500`}>
            {account ? "Reconnect MetaMask" : "Connect MetaMask"}
          </button>
          <StatusBadge status={walletStatus} />
        </div>

        {/* Main section */}
        {account && (
          <div className="rounded-2xl p-5 sm:p-8 border-2 border-yellow-500/70 bg-slate-800/60 backdrop-blur-xl shadow-[0_5px_18px_rgba(0,0,0,0.2)] space-y-6">
            {/* Stats */}
            <div className="flex justify-center gap-6">
              <div className="flex-1 max-w-[220px] bg-slate-900/90 px-5 py-4 rounded-lg border border-indigo-500/15 text-center">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                  Total Pairs
                </div>
                <div className="text-lg font-bold text-white">{totalPairs}</div>
              </div>
              <div className="flex-1 max-w-[220px] bg-slate-900/90 px-5 py-4 rounded-lg border border-indigo-500/15 text-center">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                  Total Swaps
                </div>
                <div className="text-lg font-bold text-white">{totalSwaps}</div>
              </div>
            </div>

            {/* Pair address input */}
            <div className="flex flex-col items-center gap-2">
              <label className="text-sm text-gray-300">Pair Address</label>
              <input
                type="text"
                value={pairAddress}
                onChange={(e) => setPairAddress(e.target.value)}
                placeholder="0x..."
                className={inputCls}
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => toggle("createPair")} className={sectionBtnCls(openSection === "createPair")}>
                Create New Pair
              </button>
              <button type="button" onClick={() => loadPair()} className={btnCls}>
                Load Pair
              </button>
              <button type="button" onClick={() => toggle("pairList")} className={sectionBtnCls(openSection === "pairList")}>
                See All Pairs
              </button>
              <button type="button" onClick={() => toggle("addLiq")} className={sectionBtnCls(openSection === "addLiq")}>
                Add Liquidity
              </button>
              <button type="button" onClick={() => toggle("removeLiq")} className={sectionBtnCls(openSection === "removeLiq")}>
                Remove Liquidity
              </button>
              <button type="button" onClick={() => toggle("swap")} className={sectionBtnCls(openSection === "swap")}>
                Swap Tokens
              </button>
            </div>

            <StatusBadge status={pairLoadStatus} />

            {/* ── Create Pair ── */}
            {openSection === "createPair" && (
              <div className="bg-slate-900/90 rounded-lg p-5 border border-indigo-500/15 space-y-4 max-w-sm mx-auto">
                <h3 className="text-base font-bold text-white border-b border-indigo-500 pb-2 inline-block">
                  Create New Pair
                </h3>
                <div className="flex flex-col items-center gap-2">
                  <label className="text-sm text-gray-300">Token 1 Address</label>
                  <input
                    type="text"
                    value={cpToken0}
                    onChange={(e) => setCpToken0(e.target.value)}
                    placeholder="0x..."
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <label className="text-sm text-gray-300">Token 2 Address</label>
                  <input
                    type="text"
                    value={cpToken1}
                    onChange={(e) => setCpToken1(e.target.value)}
                    placeholder="0x..."
                    className={inputCls}
                  />
                </div>
                <button type="button" onClick={createPair} className={btnCls}>
                  Create Pair
                </button>
                <StatusBadge status={cpStatus} />
              </div>
            )}

            {/* ── Pair List ── */}
            {openSection === "pairList" && (
              <div className="bg-slate-900/90 rounded-lg p-5 border border-indigo-500/15 max-w-sm mx-auto max-h-60 overflow-y-auto space-y-2 text-sm text-left">
                {pairListHtml.length === 0 && pairListStatus.state !== "pending" && (
                  <p className="text-gray-500 text-center">No pairs found.</p>
                )}
                {pairListHtml.map((p) => (
                  <div
                    key={p.address}
                    className="flex items-center justify-between gap-3 py-2 border-b border-indigo-500/10 last:border-b-0"
                  >
                    <div className="text-gray-300 truncate flex-1 min-w-0">
                      <span className="text-white font-semibold">
                        {p.symbol0}/{p.symbol1}
                      </span>
                      <br />
                      <span className="text-xs font-mono text-gray-500 break-all">
                        {p.address}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPairAddress(p.address);
                        loadPair(p.address);
                      }}
                      className={`${btnCls} text-xs !px-3 !py-1.5`}
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
              <div className="bg-slate-900/90 rounded-lg p-5 border border-indigo-500/15 space-y-4 max-w-sm mx-auto">
                <h3 className="text-base font-bold text-white border-b border-indigo-500 pb-2 inline-block">
                  Add Liquidity
                </h3>
                <div className="flex flex-col items-center gap-2">
                  <label className="text-sm text-gray-300">Amount of Token 1</label>
                  <input
                    type="number"
                    value={alAmt0}
                    onChange={(e) => setAlAmt0(e.target.value)}
                    placeholder="e.g., 10"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <label className="text-sm text-gray-300">Amount of Token 2</label>
                  <input
                    type="number"
                    value={alAmt1}
                    onChange={(e) => setAlAmt1(e.target.value)}
                    placeholder="e.g., 10"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <button type="button" onClick={addLiquidity} className={btnCls}>
                  Approve & Add Liquidity
                </button>
                <StatusBadge status={alStatus} />
              </div>
            )}

            {/* ── Remove Liquidity ── */}
            {openSection === "removeLiq" && (
              <div className="bg-slate-900/90 rounded-lg p-5 border border-indigo-500/15 space-y-4 max-w-sm mx-auto">
                <h3 className="text-base font-bold text-white border-b border-indigo-500 pb-2 inline-block">
                  Remove Liquidity
                </h3>
                <div className="flex flex-col items-center gap-2">
                  <label className="text-sm text-gray-300">LP Tokens to Burn</label>
                  <input
                    type="number"
                    value={rlAmt}
                    onChange={(e) => setRlAmt(e.target.value)}
                    placeholder="e.g., 100"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <button type="button" onClick={removeLiquidity} className={btnCls}>
                  Remove Liquidity
                </button>
                <StatusBadge status={rlStatus} />
              </div>
            )}

            {/* ── Swap ── */}
            {openSection === "swap" && (
              <div className="bg-slate-900/90 rounded-lg p-5 border border-indigo-500/15 space-y-4 max-w-sm mx-auto">
                <h3 className="text-base font-bold text-white border-b border-indigo-500 pb-2 inline-block">
                  Swap Tokens
                </h3>
                <div className="flex flex-col items-center gap-2">
                  <label className="text-sm text-gray-300">Amount to Swap</label>
                  <input
                    type="number"
                    value={swapAmt}
                    onChange={(e) => setSwapAmt(e.target.value)}
                    placeholder="e.g., 5"
                    step="any"
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <label className="text-sm text-gray-300">Slippage Tolerance (%)</label>
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
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button type="button" onClick={() => doSwap(true)} className={btnCls}>
                    Swap Token 1 → 2
                  </button>
                  <button type="button" onClick={() => doSwap(false)} className={btnCls}>
                    Swap Token 2 → 1
                  </button>
                </div>
                <StatusBadge status={swapStatus} />
              </div>
            )}

            {/* Pair details */}
            <div className="bg-slate-900/90 px-5 py-4 rounded-lg border border-indigo-500/15 text-sm text-gray-300 whitespace-pre-wrap text-center max-w-md mx-auto">
              {pairDetails}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
