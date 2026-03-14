"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { FACTORY_ADDRESS, RPC_URL, factoryAbi, lockerAbi, erc721Abi, erc20Abi } from "./abis";
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { logTransaction } from "@/lib/activity";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const REQUIRED_SHARES = 9960;

interface LogEntry {
  msg: string;
  type: "pending" | "success" | "error";
  ts: string;
}

interface ShareholderRow {
  address: string;
  shares: string;
}

interface ListingInfo {
  id: number;
  nftContract: string;
  tokenId: string;
  price: string;
  isActive: boolean;
  timelockEnd: string;
  tokenContract: string;
  payees: string[];
  shares: number[];
}

interface LockerData {
  address: string;
  owner: string;
  payees: { address: string; share: number }[];
  listings: ListingInfo[];
  stats: {
    totalSales: number;
    totalEthProfit: string;
    avgEthSale: string;
    highestEthSale: string;
  };
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
const btnSmall = "h-9 px-4 rounded-lg font-medium text-xs border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const btnDanger = "h-9 px-4 rounded-lg font-medium text-xs bg-red-500/10 border border-red-400/20 text-red-400 hover:bg-red-500/20 hover:text-red-300 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const btnSuccess = "h-9 px-4 rounded-lg font-medium text-xs bg-emerald-500/10 border border-emerald-400/20 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const labelCls = "block text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1.5";
const sectionTitle = "text-sm font-semibold text-white/80 mb-3 pb-2 border-b border-white/[0.06]";

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function StorefrontApp() {
  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC_URL), []);

  /* wallet */
  const { user, vaultUnlocked, ethWallets, selectedEthWallet, selectedEthAddress, selectEthWallet, connectMetaMask, isLoading } = useWallet();

  /* create storefront form */
  const [shareholders, setShareholders] = useState<ShareholderRow[]>([
    { address: "", shares: "" },
  ]);

  /* storefronts */
  const [lockers, setLockers] = useState<LockerData[]>([]);
  const [expandedLocker, setExpandedLocker] = useState<string | null>(null);

  /* per-locker action forms */
  const [depositForms, setDepositForms] = useState<Record<string, { nftContract: string; tokenId: string }>>({});
  const [listForms, setListForms] = useState<Record<string, {
    nftContract: string; tokenId: string; price: string; timelockDays: string;
    tokenContract: string; customPayees: ShareholderRow[];
  }>>({});

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

  /* ---- getSigner ---- */
  const getSigner = useCallback(() => {
    if (!selectedEthWallet) return null;
    if (selectedEthWallet.type === "metamask" && typeof window !== "undefined" && (window as any).ethereum) {
      return new ethers.providers.Web3Provider((window as any).ethereum).getSigner();
    }
    if (selectedEthWallet.privateKey) {
      return new ethers.Wallet(selectedEthWallet.privateKey, provider);
    }
    return null;
  }, [selectedEthWallet, provider]);

  /* ---- refresh lockers when wallet changes ---- */
  useEffect(() => {
    if (selectedEthWallet) refreshLockers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEthAddress]);

  /* ---- total shares ---- */
  const totalShares = shareholders.reduce((s, r) => s + (parseInt(r.shares) || 0), 0);

  /* ---- create storefront ---- */
  const handleCreate = useCallback(async () => {
    if (!selectedEthWallet || busy) return;
    setBusy(true);
    try {
      const payees: string[] = [];
      const shares: number[] = [];
      let total = 0;
      for (const row of shareholders) {
        const addr = row.address.trim();
        const share = parseInt(row.shares);
        if (!ethers.utils.isAddress(addr)) { log(`Invalid address: ${addr}`, "error"); setBusy(false); return; }
        if (!share || share <= 0) { log("Share must be a positive integer.", "error"); setBusy(false); return; }
        payees.push(addr);
        shares.push(share);
        total += share;
      }
      if (total !== REQUIRED_SHARES) {
        log(`Shares must sum to exactly ${REQUIRED_SHARES}. Current: ${total}`, "error");
        setBusy(false);
        return;
      }

      const signer = getSigner();
      if (!signer) { log("No signer available.", "error"); setBusy(false); return; }

      const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, signer);
      log("Estimating gas...");
      let gasEst: ethers.BigNumber;
      try {
        gasEst = await factory.estimateGas.createNFTLocker(payees, shares);
      } catch {
        gasEst = ethers.BigNumber.from(800000);
      }
      log("Creating storefront...");
      const tx = await factory.createNFTLocker(payees, shares, { gasLimit: gasEst.mul(120).div(100) });
      log(`Tx: ${shorten(tx.hash)}`);
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        const iface = new ethers.utils.Interface(factoryAbi as any);
        for (const l of receipt.logs) {
          try {
            const parsed = iface.parseLog(l);
            if (parsed.name === "NFTLockerCreated") {
              log(`Storefront created: ${shorten(parsed.args.lockerAddress)}`, "success");
              if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "storefront", action: "create_storefront" });
              break;
            }
          } catch { /* skip */ }
        }
        await refreshLockers();
      } else {
        log("Transaction reverted.", "error");
      }
    } catch (e: any) {
      log(`Create failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, shareholders, getSigner, log]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- refresh lockers ---- */
  const refreshLockers = useCallback(async () => {
    if (!selectedEthWallet) return;
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, provider);
      const addrs: string[] = await factory.getUserLockers(selectedEthAddress);
      if (addrs.length === 0) { setLockers([]); return; }
      const results: LockerData[] = [];
      for (const addr of addrs) {
        try {
          const locker = new ethers.Contract(addr, lockerAbi, provider);
          const owner: string = await locker.owner();
          const [payeeAddrs, payeeShares] = await locker.getDefaultPayees();
          const listingCount: ethers.BigNumber = await locker.listingCount();
          const lc = listingCount.toNumber();
          const listings: ListingInfo[] = [];
          for (let i = 1; i <= lc; i++) {
            try {
              const l = await locker.getListing(i);
              if (l.isActive) {
                listings.push({
                  id: i,
                  nftContract: l.nftContract,
                  tokenId: l.tokenId.toString(),
                  price: ethers.utils.formatEther(l.price),
                  isActive: l.isActive,
                  timelockEnd: new Date(l.timelockEnd.toNumber() * 1000).toLocaleString(),
                  tokenContract: l.tokenContract,
                  payees: [...l.payees],
                  shares: l.shares.map((s: any) => Number(s)),
                });
              }
            } catch { /* skip bad listing */ }
          }
          const stats = await locker.getSalesStats();
          results.push({
            address: addr,
            owner,
            payees: payeeAddrs.map((a: string, i: number) => ({ address: a, share: Number(payeeShares[i]) })),
            listings,
            stats: {
              totalSales: Number(stats._totalSales),
              totalEthProfit: ethers.utils.formatEther(stats._totalEthProfit),
              avgEthSale: ethers.utils.formatEther(stats._averageEthSalePrice),
              highestEthSale: ethers.utils.formatEther(stats._highestEthSalePrice),
            },
          });
        } catch { /* skip bad locker */ }
      }
      setLockers(results);
    } catch (e: any) {
      log(`Failed to load storefronts: ${e.message}`, "error");
    }
  }, [selectedEthWallet, provider, log]);

  /* ---- deposit NFT ---- */
  const handleDeposit = useCallback(async (lockerAddr: string) => {
    if (!selectedEthWallet || busy) return;
    const form = depositForms[lockerAddr];
    if (!form) return;
    setBusy(true);
    try {
      const { nftContract, tokenId } = form;
      if (!ethers.utils.isAddress(nftContract)) { log("Invalid NFT contract address.", "error"); setBusy(false); return; }

      const signer = getSigner();
      if (!signer) { log("No signer available.", "error"); setBusy(false); return; }
      const signerAddr = selectedEthAddress!;

      const nft = new ethers.Contract(nftContract, erc721Abi, signer);
      const owner = await nft.ownerOf(tokenId);
      if (owner.toLowerCase() !== signerAddr.toLowerCase()) {
        log("You do not own this NFT.", "error");
        setBusy(false);
        return;
      }

      const isApprovedForAll = await nft.isApprovedForAll(signerAddr, lockerAddr);
      const approved = await nft.getApproved(tokenId);
      if (!isApprovedForAll && approved.toLowerCase() !== lockerAddr.toLowerCase()) {
        log("Approving NFT...");
        const appTx = await nft.setApprovalForAll(lockerAddr, true);
        await appTx.wait();
        log("NFT approved.", "success");
      }

      const locker = new ethers.Contract(lockerAddr, lockerAbi, signer);
      log(`Depositing NFT ${tokenId}...`);
      const tx = await locker.depositNFT(nftContract, tokenId);
      log(`Tx: ${shorten(tx.hash)}`);
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        log(`NFT ${tokenId} deposited.`, "success");
        if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "storefront", action: "deposit_nft" });
        await refreshLockers();
      } else {
        log("Deposit reverted.", "error");
      }
    } catch (e: any) {
      log(`Deposit failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, depositForms, getSigner, log, refreshLockers]);

  /* ---- list NFT ---- */
  const handleList = useCallback(async (lockerAddr: string) => {
    if (!selectedEthWallet || busy) return;
    const form = listForms[lockerAddr];
    if (!form) return;
    setBusy(true);
    try {
      const { nftContract, tokenId, price, timelockDays, tokenContract, customPayees } = form;
      if (!ethers.utils.isAddress(nftContract)) { log("Invalid NFT contract.", "error"); setBusy(false); return; }
      const priceParsed = parseFloat(price);
      if (!priceParsed || priceParsed <= 0) { log("Invalid price.", "error"); setBusy(false); return; }
      const tlDays = parseInt(timelockDays);
      if (!tlDays || tlDays < 1) { log("Timelock must be at least 1 day.", "error"); setBusy(false); return; }
      const tc = tokenContract.trim() || ZERO_ADDR;
      if (tc !== ZERO_ADDR && !ethers.utils.isAddress(tc)) { log("Invalid token contract.", "error"); setBusy(false); return; }

      const cpAddrs: string[] = [];
      const cpShares: number[] = [];
      if (customPayees && customPayees.length > 0) {
        let cTotal = 0;
        for (const r of customPayees) {
          if (!r.address.trim() && !r.shares.trim()) continue;
          if (!ethers.utils.isAddress(r.address.trim())) { log("Invalid custom payee address.", "error"); setBusy(false); return; }
          const s = parseInt(r.shares);
          if (!s || s <= 0) { log("Invalid custom share.", "error"); setBusy(false); return; }
          cpAddrs.push(r.address.trim());
          cpShares.push(s);
          cTotal += s;
        }
        if (cpAddrs.length > 0 && cTotal !== REQUIRED_SHARES) {
          log(`Custom shares must sum to ${REQUIRED_SHARES}. Current: ${cTotal}`, "error");
          setBusy(false);
          return;
        }
      }

      const signer = getSigner();
      if (!signer) { log("No signer available.", "error"); setBusy(false); return; }

      const priceWei = ethers.utils.parseEther(price);
      const locker = new ethers.Contract(lockerAddr, lockerAbi, signer);
      log(`Listing NFT ${tokenId}...`);
      const tx = await locker.listNFT(nftContract, tokenId, priceWei, tlDays, tc, cpAddrs, cpShares);
      log(`Tx: ${shorten(tx.hash)}`);
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        log(`NFT ${tokenId} listed for ${price} ${tc === ZERO_ADDR ? "ETH" : "tokens"}.`, "success");
        if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "storefront", action: "list_nft" });
        await refreshLockers();
      } else {
        log("List reverted.", "error");
      }
    } catch (e: any) {
      log(`List failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, listForms, getSigner, log, refreshLockers]);

  /* ---- cancel listing ---- */
  const handleCancel = useCallback(async (lockerAddr: string, listingId: number) => {
    if (!selectedEthWallet || busy) return;
    setBusy(true);
    try {
      const signer = getSigner();
      if (!signer) { log("No signer available.", "error"); setBusy(false); return; }
      const locker = new ethers.Contract(lockerAddr, lockerAbi, signer);
      log(`Cancelling listing ${listingId}...`);
      const tx = await locker.cancelListingAndWithdrawNFT(listingId);
      await tx.wait();
      log(`Listing ${listingId} cancelled.`, "success");
      if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "storefront", action: "cancel_listing" });
      await refreshLockers();
    } catch (e: any) {
      log(`Cancel failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, getSigner, log, refreshLockers]);

  /* ---- buy NFT ---- */
  const handleBuy = useCallback(async (lockerAddr: string, listingId: number) => {
    if (!selectedEthWallet || busy) return;
    setBusy(true);
    try {
      const locker = new ethers.Contract(lockerAddr, lockerAbi, provider);
      const listing = await locker.getListing(listingId);
      if (!listing.isActive) { log("Listing is not active.", "error"); setBusy(false); return; }

      const signer = getSigner();
      if (!signer) { log("No signer available.", "error"); setBusy(false); return; }

      if (listing.tokenContract !== ZERO_ADDR) {
        const token = new ethers.Contract(listing.tokenContract, erc20Abi, signer);
        const allowance = await token.allowance(selectedEthAddress, lockerAddr);
        if (allowance.lt(listing.price)) {
          log("Approving token...");
          const appTx = await token.approve(lockerAddr, listing.price);
          await appTx.wait();
          log("Token approved.", "success");
        }
      }

      const lockerSigned = new ethers.Contract(lockerAddr, lockerAbi, signer);
      log(`Buying NFT from listing ${listingId}...`);
      const overrides: any = {};
      if (listing.tokenContract === ZERO_ADDR) overrides.value = listing.price;
      const tx = await lockerSigned.buyNFT(listingId, overrides);
      await tx.wait();
      log(`Purchased NFT from listing ${listingId}.`, "success");
      if (user) logTransaction({ userId: user.id, walletAddress: selectedEthAddress!, txHash: tx.hash, dapp: "storefront", action: "buy_nft" });
      await refreshLockers();
    } catch (e: any) {
      log(`Buy failed: ${e.reason || e.message}`, "error");
    }
    setBusy(false);
  }, [selectedEthWallet, busy, provider, getSigner, log, refreshLockers]);

  /* ---- deposit form helpers ---- */
  const getDepositForm = (addr: string) => depositForms[addr] || { nftContract: "", tokenId: "" };
  const updateDeposit = (addr: string, field: string, value: string) => {
    setDepositForms((p) => ({ ...p, [addr]: { ...getDepositForm(addr), [field]: value } }));
  };

  /* ---- list form helpers ---- */
  const getListForm = (addr: string) => listForms[addr] || { nftContract: "", tokenId: "", price: "", timelockDays: "", tokenContract: "", customPayees: [] as ShareholderRow[] };
  const updateList = (addr: string, field: string, value: any) => {
    setListForms((p) => ({ ...p, [addr]: { ...getListForm(addr), [field]: value } }));
  };

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  if (!user || !vaultUnlocked) {
    return (
      <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
        <div className="w-full max-w-[900px] mx-auto pt-12">
          <AuthPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[900px] mx-auto space-y-5">

        {/* Title */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">NFT Storefront Launchpad</h1>
          <p className="text-xs text-white/30 mt-1">Deploy and manage NFT storefronts with revenue sharing</p>
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
            <button type="button" onClick={connectMetaMask} className={btnGhost}>MetaMask</button>
          </div>
        </div>

        {/* ── Create Storefront ── */}
        <div className={`${card} p-5 space-y-4`}>
          <h2 className={sectionTitle}>Create Storefront</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Shareholders</span>
              <span className="text-[10px] text-white/25">0.4% fee deducted — shares must sum to {REQUIRED_SHARES}</span>
            </div>
            {shareholders.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px] gap-2">
                <input
                  value={row.address}
                  onChange={(e) => { const n = [...shareholders]; n[i].address = e.target.value; setShareholders(n); }}
                  placeholder={`Shareholder ${i + 1} address`}
                  className={inputCls}
                />
                <input
                  type="number"
                  value={row.shares}
                  onChange={(e) => { const n = [...shareholders]; n[i].shares = e.target.value; setShareholders(n); }}
                  placeholder="BP"
                  min="0"
                  max={REQUIRED_SHARES}
                  className={inputCls}
                />
              </div>
            ))}
            <button type="button" onClick={() => setShareholders((p) => [...p, { address: "", shares: "" }])} className={`${btnGhost} w-full text-xs`}>
              + Add Shareholder
            </button>
            <p className={`text-xs ${totalShares === REQUIRED_SHARES ? "text-emerald-400" : totalShares > REQUIRED_SHARES ? "text-red-400" : "text-white/40"}`}>
              Total: {totalShares} / {REQUIRED_SHARES}
            </p>
          </div>

          <button type="button" onClick={handleCreate} disabled={!selectedEthWallet || busy || totalShares !== REQUIRED_SHARES} className={btnPrimary}>
            Launch Storefront
          </button>
        </div>

        {/* ── Storefronts ── */}
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Your Storefronts</h2>
            <button type="button" onClick={refreshLockers} disabled={!selectedEthWallet} className="text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">Refresh</button>
          </div>

          {!selectedEthWallet ? (
            <p className="text-xs text-white/25 py-4 text-center">Connect a wallet to view storefronts.</p>
          ) : lockers.length === 0 ? (
            <p className="text-xs text-white/25 py-4 text-center">No storefronts found. Create one to get started.</p>
          ) : (
            <div className="space-y-3">
              {lockers.map((lk) => {
                const isOwner = lk.owner.toLowerCase() === selectedEthAddress!.toLowerCase();
                const isExpanded = expandedLocker === lk.address;
                const df = getDepositForm(lk.address);
                const lf = getListForm(lk.address);

                return (
                  <div key={lk.address} className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                    {/* header */}
                    <button
                      type="button"
                      onClick={() => setExpandedLocker(isExpanded ? null : lk.address)}
                      className="w-full p-4 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                    >
                      <div>
                        <span className="text-sm font-semibold text-amber-400">{shorten(lk.address)}</span>
                        <span className="text-[10px] text-white/30 ml-2">{isOwner ? "Owner" : "Viewer"}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-white/40">
                        <span>{lk.stats.totalSales} sales</span>
                        <span>{parseFloat(lk.stats.totalEthProfit).toFixed(4)} ETH profit</span>
                        <span className="text-white/20">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-white/[0.04]">
                        {/* Stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                          {[
                            { label: "Total Sales", value: lk.stats.totalSales },
                            { label: "ETH Profit", value: `${parseFloat(lk.stats.totalEthProfit).toFixed(4)} ETH` },
                            { label: "Avg Sale", value: `${parseFloat(lk.stats.avgEthSale).toFixed(4)} ETH` },
                            { label: "Highest Sale", value: `${parseFloat(lk.stats.highestEthSale).toFixed(4)} ETH` },
                          ].map((s) => (
                            <div key={s.label} className="rounded-lg bg-white/[0.03] p-3 text-center">
                              <p className="text-[10px] text-white/30 uppercase tracking-wider">{s.label}</p>
                              <p className="text-sm font-semibold text-white/70 mt-0.5">{s.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Details */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div><span className="text-white/30">Address: </span><span className="font-mono text-white/60 break-all">{lk.address}</span></div>
                          <div><span className="text-white/30">Owner: </span><span className="font-mono text-white/60">{shorten(lk.owner)}</span></div>
                        </div>

                        {/* Default Shareholders */}
                        <div>
                          <p className="text-xs font-medium text-white/40 mb-1">Default Shareholders</p>
                          <div className="space-y-1">
                            {lk.payees.map((p, i) => (
                              <div key={i} className="flex justify-between text-xs rounded-lg bg-white/[0.02] px-3 py-1.5">
                                <span className="font-mono text-white/50">{shorten(p.address)}</span>
                                <span className="text-white/40">{p.share} BP</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Active Listings */}
                        <div>
                          <p className="text-xs font-medium text-white/40 mb-1">Active Listings ({lk.listings.length})</p>
                          {lk.listings.length === 0 ? (
                            <p className="text-[11px] text-white/20 py-2">No active listings.</p>
                          ) : (
                            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                              {lk.listings.map((l) => (
                                <div key={l.id} className="rounded-lg bg-white/[0.03] p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="text-xs space-y-0.5">
                                      <p className="text-white/60">
                                        <span className="text-white/30">ID {l.id} — </span>
                                        Token {l.tokenId} @ {parseFloat(l.price).toFixed(4)} {l.tokenContract === ZERO_ADDR ? "ETH" : "Tokens"}
                                      </p>
                                      {l.tokenContract !== ZERO_ADDR && (
                                        <p className="text-white/30 font-mono text-[10px]">Token: {shorten(l.tokenContract)}</p>
                                      )}
                                      <p className="text-white/30 text-[10px]">Timelock until: {l.timelockEnd}</p>
                                    </div>
                                    <div className="flex gap-1.5 flex-shrink-0">
                                      {isOwner && (
                                        <button type="button" onClick={() => handleCancel(lk.address, l.id)} disabled={busy} className={btnDanger}>Cancel</button>
                                      )}
                                      <button type="button" onClick={() => handleBuy(lk.address, l.id)} disabled={busy} className={btnSuccess}>Buy</button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Owner Actions */}
                        {isOwner && (
                          <div className="space-y-4 pt-2 border-t border-white/[0.04]">
                            {/* Deposit NFT */}
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-white/50">Deposit NFT</p>
                              <div className="grid grid-cols-[1fr_100px] gap-2">
                                <input
                                  value={df.nftContract}
                                  onChange={(e) => updateDeposit(lk.address, "nftContract", e.target.value)}
                                  placeholder="NFT contract address"
                                  className={inputCls}
                                />
                                <input
                                  value={df.tokenId}
                                  onChange={(e) => updateDeposit(lk.address, "tokenId", e.target.value)}
                                  placeholder="Token ID"
                                  className={inputCls}
                                />
                              </div>
                              <button type="button" onClick={() => handleDeposit(lk.address)} disabled={busy} className={`${btnSmall} w-full`}>Deposit</button>
                            </div>

                            {/* List NFT */}
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-white/50">List NFT for Sale</p>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  value={lf.nftContract}
                                  onChange={(e) => updateList(lk.address, "nftContract", e.target.value)}
                                  placeholder="NFT contract address"
                                  className={inputCls}
                                />
                                <input
                                  value={lf.tokenId}
                                  onChange={(e) => updateList(lk.address, "tokenId", e.target.value)}
                                  placeholder="Token ID"
                                  className={inputCls}
                                />
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <input
                                  value={lf.price}
                                  onChange={(e) => updateList(lk.address, "price", e.target.value)}
                                  placeholder="Price"
                                  className={inputCls}
                                />
                                <input
                                  value={lf.timelockDays}
                                  onChange={(e) => updateList(lk.address, "timelockDays", e.target.value)}
                                  placeholder="Lock (days)"
                                  className={inputCls}
                                />
                                <input
                                  value={lf.tokenContract}
                                  onChange={(e) => updateList(lk.address, "tokenContract", e.target.value)}
                                  placeholder="Token (0x0=ETH)"
                                  className={inputCls}
                                />
                              </div>

                              {/* Custom payees */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] text-white/30">Custom Shareholders (optional, must sum to {REQUIRED_SHARES})</p>
                                </div>
                                {(lf.customPayees || []).map((cp: ShareholderRow, ci: number) => (
                                  <div key={ci} className="grid grid-cols-[1fr_80px] gap-2">
                                    <input
                                      value={cp.address}
                                      onChange={(e) => {
                                        const n = [...(lf.customPayees || [])];
                                        n[ci] = { ...n[ci], address: e.target.value };
                                        updateList(lk.address, "customPayees", n);
                                      }}
                                      placeholder="Address"
                                      className={`${inputCls} text-xs h-9`}
                                    />
                                    <input
                                      type="number"
                                      value={cp.shares}
                                      onChange={(e) => {
                                        const n = [...(lf.customPayees || [])];
                                        n[ci] = { ...n[ci], shares: e.target.value };
                                        updateList(lk.address, "customPayees", n);
                                      }}
                                      placeholder="BP"
                                      className={`${inputCls} text-xs h-9`}
                                    />
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const curr = lf.customPayees || [];
                                    updateList(lk.address, "customPayees", [...curr, { address: "", shares: "" }]);
                                  }}
                                  className={`${btnGhost} w-full text-[10px] h-8`}
                                >
                                  + Add Custom Shareholder
                                </button>
                              </div>

                              <button type="button" onClick={() => handleList(lk.address)} disabled={busy} className={`${btnSmall} w-full`}>List NFT</button>
                            </div>

                            {/* Copy Address */}
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(lk.address);
                                log(`Copied ${shorten(lk.address)}`, "success");
                              }}
                              className={`${btnGhost} w-full text-xs`}
                            >
                              Copy Storefront Address
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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

        <p className="text-center text-[11px] text-white/20 pb-4">Powered by MoneyFund</p>
      </div>
    </div>
  );
}
