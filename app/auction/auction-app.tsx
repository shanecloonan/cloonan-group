"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { FACTORY_ADDRESS, RPC_URL, factoryAbi, auctionAbi, erc20Abi } from "./abis";
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

interface AuctionInfo {
  contractAddress: string;
  bidder: string;
  bid: string;
  adURI: string;
  totalBids: string;
  signFee: string;
  maxSignerLen: string;
  signerCount: number;
  adlockDuration: string;
  paymentToken: string;
  paymentLabel: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}


async function toTokenWei(amount: string, tokenAddr: string, provider: ethers.providers.Provider): Promise<ethers.BigNumber> {
  if (!amount || parseFloat(amount) <= 0) return ethers.BigNumber.from(0);
  if (tokenAddr === ZERO_ADDR || tokenAddr === "0x0") return ethers.utils.parseEther(amount);
  const tok = new ethers.Contract(tokenAddr, erc20Abi, provider);
  const dec: number = await tok.decimals();
  return ethers.utils.parseUnits(amount, dec);
}

async function fromTokenWei(wei: ethers.BigNumber, tokenAddr: string, provider: ethers.providers.Provider): Promise<string> {
  if (wei.isZero()) return "0";
  if (tokenAddr === ZERO_ADDR || tokenAddr === "0x0") return ethers.utils.formatEther(wei);
  const tok = new ethers.Contract(tokenAddr, erc20Abi, provider);
  const dec: number = await tok.decimals();
  return ethers.utils.formatUnits(wei, dec);
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function AuctionApp() {
  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC_URL), []);

  /* wallet */
  const { user, vaultUnlocked, ethWallets, selectedEthWallet, selectedEthAddress, selectEthWallet, connectMetaMask, isLoading } = useWallet();

  /* deploy form */
  const [showCustomize, setShowCustomize] = useState(false);
  const [refundPct, setRefundPct] = useState("80");
  const [feeRows, setFeeRows] = useState<FeeRow[]>([{ address: "", percent: "20" }]);
  const [startingBid, setStartingBid] = useState("");
  const [minIncrement, setMinIncrement] = useState("");
  const [signFee, setSignFee] = useState("");
  const [maxSignerLen, setMaxSignerLen] = useState("32");
  const [bidToken, setBidToken] = useState("0x0");
  const [adlockDur, setAdlockDur] = useState("3600");

  /* bid/sign form */
  const [auctionAddr, setAuctionAddr] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [adURI, setAdURI] = useState("");
  const [signerName, setSignerName] = useState("");
  const [newSignFee, setNewSignFee] = useState("");
  const [newMaxLen, setNewMaxLen] = useState("");
  const [newSignToken, setNewSignToken] = useState("");

  /* auctions list */
  const [auctions, setAuctions] = useState<AuctionInfo[]>([]);

  /* log */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const log = useCallback((msg: string, type: LogEntry["type"] = "pending") => {
    const ts = new Date().toLocaleTimeString();
    setLogs((p) => [...p, { msg, type, ts }]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);


  /* ---- refresh auctions on mount ---- */
  useEffect(() => {
    refreshAuctions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- fee total ---- */
  const feeTotal = feeRows.reduce((s, r) => s + (parseInt(r.percent) || 0), 0) + (parseInt(refundPct) || 0);


  /* ---- add fee row ---- */
  const addFeeRow = useCallback(() => {
    setFeeRows((p) => [...p, { address: "", percent: "" }]);
  }, []);

  /* ---- deploy ---- */
  const handleDeploy = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    setBusy(true);
    try {
      const signer = new ethers.Wallet(selectedEthWallet.privateKey!, provider);
      const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, signer);

      const receivers: string[] = [];
      const percentages: number[] = [];
      feeRows.forEach((r) => {
        const addr = r.address.trim();
        const pct = parseInt(r.percent) || 0;
        if (ethers.utils.isAddress(addr) && addr !== ZERO_ADDR && pct > 0) {
          receivers.push(addr);
          percentages.push(pct);
        }
      });

      const refund = parseInt(refundPct) || 0;
      if (refund + percentages.reduce((a, b) => a + b, 0) !== 100) {
        log("Refund % + fee %s must equal 100.", "error");
        setBusy(false);
        return;
      }
      if (receivers.length === 0) {
        log("At least one fee receiver required.", "error");
        setBusy(false);
        return;
      }

      const tokenAddr = bidToken.trim() === "0x0" ? ZERO_ADDR : bidToken.trim();
      const startWei = await toTokenWei(startingBid, tokenAddr, provider);
      const incWei = await toTokenWei(minIncrement, tokenAddr, provider);
      const sfWei = await toTokenWei(signFee, tokenAddr, provider);
      const msl = parseInt(maxSignerLen) || 32;
      const adlock = parseInt(adlockDur) || 0;

      log("Estimating gas...");
      const gasEst = await factory.estimateGas.deployAuctionContract(
        refund, receivers, percentages, startWei, incWei, sfWei, msl, tokenAddr, adlock,
      );
      log(`Gas estimate: ${gasEst.toString()}`);

      log("Deploying auction contract...");
      const tx = await factory.deployAuctionContract(
        refund, receivers, percentages, startWei, incWei, sfWei, msl, tokenAddr, adlock,
        { gasLimit: gasEst.mul(120).div(100) },
      );
      log(`Tx sent: ${shorten(tx.hash)}`);
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        const evt = receipt.events?.find((e: any) => e.event === "AuctionContractDeployed");
        const addr = evt?.args?.contractAddress;
        log(`Auction deployed at: ${addr || "check logs"}`, "success");
        if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "auction", action: "deploy_auction" });
        await refreshAuctions();
      } else {
        log("Deploy reverted.", "error");
      }
    } catch (e: any) {
      log(`Deploy failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, provider, refundPct, feeRows, startingBid, minIncrement, signFee, maxSignerLen, bidToken, adlockDur, log]);

  /* ---- place bid ---- */
  const handlePlaceBid = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    if (!ethers.utils.isAddress(auctionAddr)) { log("Invalid auction address.", "error"); return; }
    if (!bidAmount || parseFloat(bidAmount) <= 0) { log("Invalid bid amount.", "error"); return; }
    if (!adURI || adURI.length > 280) { log("Ad URI required (max 280 chars).", "error"); return; }
    setBusy(true);
    try {
      const signer = new ethers.Wallet(selectedEthWallet.privateKey!, provider);
      const auction = new ethers.Contract(auctionAddr, auctionAbi, signer);
      const payToken: string = await auction.bidPaymentToken();
      const bidWei = await toTokenWei(bidAmount, payToken, provider);

      if (payToken === ZERO_ADDR) {
        log("Placing bid (ETH)...");
        const tx = await auction.placeBid(adURI, bidWei, { value: bidWei, gasLimit: 500000 });
        log(`Tx: ${shorten(tx.hash)}`);
        const r = await tx.wait();
        if (r.status === 1) {
          log("Bid placed!", "success");
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "auction", action: "place_bid" });
        } else {
          log("Bid reverted.", "error");
        }
      } else {
        const tok = new ethers.Contract(payToken, erc20Abi, signer);
        const allowance: ethers.BigNumber = await tok.allowance(selectedEthAddress!, auctionAddr);
        if (allowance.lt(bidWei)) {
          log("Approving token...");
          const appTx = await tok.approve(auctionAddr, bidWei);
          await appTx.wait();
          log("Approved.", "success");
        }
        log("Placing bid (token)...");
        const tx = await auction.placeBid(adURI, bidWei, { gasLimit: 500000 });
        log(`Tx: ${shorten(tx.hash)}`);
        const r = await tx.wait();
        if (r.status === 1) {
          log("Bid placed!", "success");
          if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "auction", action: "place_bid" });
        } else {
          log("Bid reverted.", "error");
        }
      }
      await refreshAuctions();
    } catch (e: any) {
      log(`Bid failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, selectedEthAddress, busy, provider, auctionAddr, bidAmount, adURI, log]);

  /* ---- sign ad ---- */
  const handleSignAd = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    if (!ethers.utils.isAddress(auctionAddr)) { log("Invalid auction address.", "error"); return; }
    if (!signerName.trim()) { log("Signer name required.", "error"); return; }
    setBusy(true);
    try {
      const signer = new ethers.Wallet(selectedEthWallet.privateKey!, provider);
      const auction = new ethers.Contract(auctionAddr, auctionAbi, signer);
      const sfWei: ethers.BigNumber = await auction.signFeeWei();
      const spToken: string = await auction.signPaymentToken();

      if (spToken === ZERO_ADDR) {
        log("Signing ad (ETH)...");
        const tx = await auction.signAd(signerName, { value: sfWei, gasLimit: 300000 });
        const r = await tx.wait();
        r.status === 1 ? log("Ad signed!", "success") : log("Sign reverted.", "error");
      } else {
        const tok = new ethers.Contract(spToken, erc20Abi, signer);
        const allowance: ethers.BigNumber = await tok.allowance(selectedEthAddress!, auctionAddr);
        if (allowance.lt(sfWei)) {
          log("Approving token...");
          const appTx = await tok.approve(auctionAddr, sfWei);
          await appTx.wait();
        }
        log("Signing ad (token)...");
        const tx = await auction.signAd(signerName, { gasLimit: 300000 });
        const r = await tx.wait();
        r.status === 1 ? log("Ad signed!", "success") : log("Sign reverted.", "error");
      }
      await refreshAuctions();
    } catch (e: any) {
      log(`Sign failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, selectedEthAddress, busy, provider, auctionAddr, signerName, log]);

  /* ---- update sign params ---- */
  const handleUpdateSignParams = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    if (!ethers.utils.isAddress(auctionAddr)) { log("Invalid auction address.", "error"); return; }
    setBusy(true);
    try {
      const signer = new ethers.Wallet(selectedEthWallet.privateKey!, provider);
      const auction = new ethers.Contract(auctionAddr, auctionAbi, signer);
      const spToken: string = await auction.signPaymentToken();
      const feeWei = await toTokenWei(newSignFee, spToken, provider);
      const ml = parseInt(newMaxLen) || 32;
      log("Updating sign parameters...");
      const tx = await auction.updateSignParameters(feeWei, ml, { gasLimit: 200000 });
      const r = await tx.wait();
      r.status === 1 ? log("Sign params updated!", "success") : log("Update reverted.", "error");
      await refreshAuctions();
    } catch (e: any) {
      log(`Update failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, provider, auctionAddr, newSignFee, newMaxLen, log]);

  /* ---- update sign payment token ---- */
  const handleUpdateSignToken = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    if (!ethers.utils.isAddress(auctionAddr)) { log("Invalid auction address.", "error"); return; }
    const tokenVal = newSignToken.trim() === "0x0" ? ZERO_ADDR : newSignToken.trim();
    if (tokenVal !== ZERO_ADDR && !ethers.utils.isAddress(tokenVal)) { log("Invalid token address.", "error"); return; }
    setBusy(true);
    try {
      const signer = new ethers.Wallet(selectedEthWallet.privateKey!, provider);
      const auction = new ethers.Contract(auctionAddr, auctionAbi, signer);
      log("Updating sign payment token...");
      const tx = await auction.updateSignPaymentToken(tokenVal, { gasLimit: 200000 });
      const r = await tx.wait();
      r.status === 1 ? log("Token updated!", "success") : log("Update reverted.", "error");
      await refreshAuctions();
    } catch (e: any) {
      log(`Update failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, provider, auctionAddr, newSignToken, log]);

  /* ---- delete all signers ---- */
  const handleDeleteSigners = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    if (!ethers.utils.isAddress(auctionAddr)) { log("Invalid auction address.", "error"); return; }
    setBusy(true);
    try {
      const signer = new ethers.Wallet(selectedEthWallet.privateKey!, provider);
      const auction = new ethers.Contract(auctionAddr, auctionAbi, signer);
      log("Deleting all signers...");
      const tx = await auction.deleteAllSigners({ gasLimit: 300000 });
      const r = await tx.wait();
      r.status === 1 ? log("All signers deleted!", "success") : log("Delete reverted.", "error");
      await refreshAuctions();
    } catch (e: any) {
      log(`Delete failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, provider, auctionAddr, log]);

  /* ---- refresh auctions ---- */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refreshAuctions = useCallback(async () => {
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, provider);
      const overview = await factory.getFactoryOverview();
      const list: AuctionInfo[] = [];
      for (const a of overview) {
        try {
          const ac = new ethers.Contract(a.contractAddress, auctionAbi, provider);
          const d = await ac.getAuctionDetails();
          const signers = await ac.getSigners();
          const payToken = a.bidPaymentToken;
          const payLabel = payToken === ZERO_ADDR ? "ETH" : shorten(payToken);
          const bidStr = await fromTokenWei(d.bid, payToken, provider);
          const sfStr = await fromTokenWei(d.signFee, payToken, provider);
          list.push({
            contractAddress: a.contractAddress,
            bidder: d.bidder,
            bid: bidStr,
            adURI: d.adURI,
            totalBids: d.totalBidsCount.toString(),
            signFee: sfStr,
            maxSignerLen: d.maxSignerLen.toString(),
            signerCount: signers.length,
            adlockDuration: a.adlockDuration.toString(),
            paymentToken: payToken,
            paymentLabel: payLabel,
          });
        } catch {
          /* skip broken */
        }
      }
      setAuctions(list);
    } catch (e: any) {
      log(`Refresh failed: ${e.message}`, "error");
    }
  }, [provider, log]);

  /* ================================================================ */
  /*  Shared design tokens                                             */
  /* ================================================================ */

  const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
  const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
  const selectCls = `${inputCls} appearance-none cursor-pointer`;
  const btnPrimary = "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2";
  const btnGhost = "h-11 px-5 rounded-xl font-medium text-sm border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";
  const labelCls = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";
  const sectionTitle = "text-sm font-semibold text-white/80 mb-3 pb-2 border-b border-white/[0.06]";

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[720px] mx-auto space-y-5">

        {/* Title */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">Ad Auction Platform</h1>
          <p className="text-xs text-white/30 mt-1">Deploy, bid, and manage ad auction contracts</p>
        </div>

        {/* ── Wallet ── */}
        <div className={`${card} p-5 space-y-3`}>
          <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Wallet</span>
          <div className="flex gap-2">
            <select
              value={selectedEthAddress ?? ""}
              onChange={(e) => selectEthWallet(e.target.value)}
              className={`flex-1 ${selectCls}`}
            >
              <option value="">Select a wallet...</option>
              {ethWallets.map((w) => (
                <option key={w.address} value={w.address}>{shorten(w.address)}</option>
              ))}
            </select>
            <button type="button" onClick={connectMetaMask} className={btnGhost}>MetaMask</button>
          </div>
        </div>

        {/* ── Deploy Auction ── */}
        <div className={`${card} p-5 space-y-4`}>
          <h2 className={sectionTitle}>Launch Ad Auction Contract</h2>

          <button
            type="button"
            onClick={() => setShowCustomize(!showCustomize)}
            className={`${btnGhost} w-full flex items-center justify-center gap-2`}
          >
            {showCustomize ? "Hide" : "Customize"} Configuration
          </button>

          {showCustomize && (
            <div className="space-y-4 pt-2">
              <div>
                <label className={labelCls}>Refund Percentage</label>
                <input type="number" value={refundPct} onChange={(e) => setRefundPct(e.target.value)} placeholder="80" min="0" max="100" className={inputCls} />
              </div>

              <div className="space-y-2">
                <span className="text-xs font-medium text-white/40 uppercase tracking-wider">Fee Receivers</span>
                {feeRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px] gap-2">
                    <input
                      value={row.address}
                      onChange={(e) => { const n = [...feeRows]; n[i].address = e.target.value; setFeeRows(n); }}
                      placeholder={`Receiver ${i + 1} address`}
                      className={inputCls}
                    />
                    <input
                      type="number"
                      value={row.percent}
                      onChange={(e) => { const n = [...feeRows]; n[i].percent = e.target.value; setFeeRows(n); }}
                      placeholder="%"
                      min="0" max="100"
                      className={inputCls}
                    />
                  </div>
                ))}
                <button type="button" onClick={addFeeRow} className={`${btnGhost} w-full text-xs`}>+ Add Receiver</button>
                <p className={`text-xs ${feeTotal === 100 ? "text-emerald-400" : feeTotal > 100 ? "text-red-400" : "text-white/40"}`}>
                  Total: {feeTotal} / 100
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Starting Bid</label>
                  <input type="number" value={startingBid} onChange={(e) => setStartingBid(e.target.value)} placeholder="1" step="0.0001" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Min Bid Increment</label>
                  <input type="number" value={minIncrement} onChange={(e) => setMinIncrement(e.target.value)} placeholder="0.1" step="0.0001" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Sign Fee</label>
                  <input type="number" value={signFee} onChange={(e) => setSignFee(e.target.value)} placeholder="0.01" step="0.0001" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Max Signer Length</label>
                  <input type="number" value={maxSignerLen} onChange={(e) => setMaxSignerLen(e.target.value)} placeholder="32" min="1" className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Bid Payment Token (0x0 for ETH)</label>
                <input value={bidToken} onChange={(e) => setBidToken(e.target.value)} placeholder="0x0 for ETH" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Adlock Duration (seconds)</label>
                <input type="number" value={adlockDur} onChange={(e) => setAdlockDur(e.target.value)} placeholder="3600" min="0" className={inputCls} />
              </div>
            </div>
          )}

          <button type="button" onClick={handleDeploy} disabled={!selectedEthWallet || busy} className={btnPrimary}>
            Deploy Auction
          </button>
        </div>

        {/* ── Bid or Sign ── */}
        <div className={`${card} p-5 space-y-4`}>
          <h2 className={sectionTitle}>Bid or Sign Ad</h2>

          <div>
            <label className={labelCls}>Auction Contract Address</label>
            <input value={auctionAddr} onChange={(e) => setAuctionAddr(e.target.value)} placeholder="0x..." className={inputCls} />
          </div>

          {/* Place Bid */}
          <div className="space-y-3 pt-2">
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Place Bid</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Bid Amount</label>
                <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} placeholder="1.1" step="0.0001" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ad URI (max 280)</label>
                <input value={adURI} onChange={(e) => setAdURI(e.target.value)} placeholder="https://..." maxLength={280} className={inputCls} />
              </div>
            </div>
            <button type="button" onClick={handlePlaceBid} disabled={!selectedEthWallet || busy} className={btnPrimary}>
              Place Bid
            </button>
          </div>

          {/* Sign Ad */}
          <div className="space-y-3 pt-2">
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Sign Ad</span>
            <div>
              <label className={labelCls}>Signer Name</label>
              <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Your name" className={inputCls} />
            </div>
            <button type="button" onClick={handleSignAd} disabled={!selectedEthWallet || busy} className={btnPrimary}>
              Sign Ad
            </button>
          </div>

          {/* Manage (Highest Bidder) */}
          <div className="space-y-3 pt-2">
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Manage (Highest Bidder Only)</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>New Sign Fee</label>
                <input type="number" value={newSignFee} onChange={(e) => setNewSignFee(e.target.value)} placeholder="0.01" step="0.0001" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>New Max Signer Length</label>
                <input type="number" value={newMaxLen} onChange={(e) => setNewMaxLen(e.target.value)} placeholder="32" min="1" className={inputCls} />
              </div>
            </div>
            <button type="button" onClick={handleUpdateSignParams} disabled={!selectedEthWallet || busy} className={btnPrimary}>
              Update Sign Parameters
            </button>

            <div>
              <label className={labelCls}>New Sign Payment Token (0x0 for ETH)</label>
              <input value={newSignToken} onChange={(e) => setNewSignToken(e.target.value)} placeholder="0x0 for ETH" className={inputCls} />
            </div>
            <button type="button" onClick={handleUpdateSignToken} disabled={!selectedEthWallet || busy} className={btnPrimary}>
              Update Sign Payment Token
            </button>

            <button type="button" onClick={handleDeleteSigners} disabled={!selectedEthWallet || busy} className={`${btnPrimary} !from-red-600 !to-red-700`}>
              Delete All Signers
            </button>
          </div>
        </div>

        {/* ── All Auctions ── */}
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">All Auctions</h2>
            <button type="button" onClick={refreshAuctions} className="text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
              Refresh
            </button>
          </div>
          {auctions.length === 0 ? (
            <p className="text-xs text-white/25 py-4 text-center">No auctions found.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
              {auctions.map((a, i) => (
                <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div>
                    <span className="text-white/30">Contract</span>
                    <p className="text-white/70 font-mono">{shorten(a.contractAddress)}</p>
                  </div>
                  <div>
                    <span className="text-white/30">Highest Bid</span>
                    <p className="text-white/70">{a.bid} {a.paymentLabel}</p>
                  </div>
                  <div>
                    <span className="text-white/30">Bidder</span>
                    <p className="text-white/70 font-mono">{shorten(a.bidder)}</p>
                  </div>
                  <div>
                    <span className="text-white/30">Bids</span>
                    <p className="text-white/70">{a.totalBids}</p>
                  </div>
                  <div>
                    <span className="text-white/30">Sign Fee</span>
                    <p className="text-white/70">{a.signFee} {a.paymentLabel}</p>
                  </div>
                  <div>
                    <span className="text-white/30">Signers</span>
                    <p className="text-white/70">{a.signerCount}</p>
                  </div>
                  <div>
                    <span className="text-white/30">Max Name Len</span>
                    <p className="text-white/70">{a.maxSignerLen}</p>
                  </div>
                  <div>
                    <span className="text-white/30">Adlock</span>
                    <p className="text-white/70">{a.adlockDuration}s</p>
                  </div>
                  {a.adURI && (
                    <div className="col-span-2">
                      <span className="text-white/30">Ad URI</span>
                      <p className="text-white/50 break-all">{a.adURI}</p>
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
            className="max-h-[200px] overflow-y-auto space-y-1 pr-1"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}
          >
            {logs.length === 0 ? (
              <p className="text-xs text-white/25 py-2 text-center">Waiting for activity...</p>
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
                  <span className="text-white/20 mr-2">[{l.ts}]</span>
                  {l.msg}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── About ── */}
        <div className={`${card} p-5 space-y-3`}>
          <h2 className="text-sm font-semibold text-white/80">About Ad Auction Platform</h2>
          <div className="text-xs text-white/40 leading-relaxed space-y-2">
            <p>Deploy custom ad auction contracts, bid to display advertisements, or sign the current ad for visibility.</p>
            <ul className="list-disc pl-5 space-y-1 text-white/35">
              <li>Supports payments in ETH or ERC20 tokens for bids and signing fees.</li>
              <li>Charges a 0.4% platform fee on each bid and sign, split between two fee recipients.</li>
              <li>Refunds a configurable percentage (0-100%) to the previous bidder.</li>
              <li>Distributes the non-refunded portion to custom fee receivers.</li>
              <li>Allows users to sign the current ad, with fees paid to the highest bidder.</li>
              <li>Enables the highest bidder to update sign fees, max signer name length, and sign payment token.</li>
              <li>Enforces an adlock duration, preventing new bids until the specified time has passed.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
