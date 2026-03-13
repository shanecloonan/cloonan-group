"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import ArweaveWallet from "./arweave-wallet";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const RPC = "https://mainnet.infura.io/v3/cf2916fb6dbc47ae824d6f36db817b73";
const MONEY_ADDRESS = "0x100DB67F41A2dF3c32cC7c0955694b98339B7311";
const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ETHERSCAN_KEY = "MB89VXUF27QJHA7QYJMPE9W55UGYZNV39C";
const ETHERSCAN_API = "https://api.etherscan.io/api";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin,address[] path,address to,uint deadline) payable returns (uint[])",
  "function swapExactTokensForETH(uint amountIn,uint amountOutMin,address[] path,address to,uint deadline) returns (uint[])",
  "function getAmountsOut(uint amountIn,address[] path) view returns (uint[])",
];

/* ------------------------------------------------------------------ */
/*  Apps grid data                                                     */
/* ------------------------------------------------------------------ */

interface AppTile { icon: string; title: string; url: string; }

const APPS: AppTile[] = [
  { icon: "🐙", title: "Multiswap", url: "https://moneyfund.com/moneyswap" },
  { icon: "🚀", title: "Fund Launcher", url: "https://moneyfund.com/launcher/" },
  { icon: "🪙", title: "Coin Launcher", url: "https://moneyfund.com/deploy/" },
  { icon: "⚙️", title: "Multiswap Launcher", url: "https://moneyfund.com/widget" },
  { icon: "🥩", title: "Dividends Launcher", url: "https://moneyfund.com/stake" },
  { icon: "🗳️", title: "DAO Launcher", url: "https://moneyfund.com/voter" },
  { icon: "🛒", title: "Storefront Launcher", url: "https://moneyfund.com/locker" },
  { icon: "🔐", title: "Multisig Launcher", url: "https://moneyfund.com/multisig" },
  { icon: "🖼️", title: "Ad-space Launcher", url: "https://moneyfund.com/auction" },
  { icon: "📈", title: "MONEY Dividends", url: "https://moneyfund.com/dividends" },
  { icon: "🍒", title: "MONEY DEX", url: "https://moneyfund.com/dex/" },
  { icon: "📊", title: "MONEY DAO", url: "https://moneyfund.com/vote/" },
  { icon: "🎁", title: "Airdropper", url: "https://moneyfund.com/airdrop" },
  { icon: "🤖", title: "Volume Runner", url: "https://moneyfund.com/volume" },
  { icon: "🔍", title: "Block Explorer", url: "https://moneyfund.com/explorer" },
  { icon: "🌐", title: "ENS Registrar", url: "https://moneyfund.com/etf/" },
  { icon: "🃏", title: "Blackjack", url: "https://moneyfund.com/blackjack" },
  { icon: "✉️", title: "DMs", url: "https://moneyfund.com/dm" },
  { icon: "💬", title: "Chat", url: "https://moneyfund.com/chat" },
];

/* ------------------------------------------------------------------ */
/*  Explorer actions                                                   */
/* ------------------------------------------------------------------ */

const EXPLORER_ACTIONS = [
  { value: "", label: "Choose an action..." },
  { value: "balance", label: "Get ETH Balance" },
  { value: "txlist", label: "List Transactions" },
  { value: "tokentx", label: "List Token Transactions" },
  { value: "tokennfttx", label: "List NFT Transactions" },
  { value: "txlistinternal", label: "List Internal Transactions" },
  { value: "gettxreceiptstatus", label: "Get Transaction Status" },
  { value: "getblockbytime", label: "Get Block by Timestamp" },
  { value: "getabi", label: "Get Contract ABI" },
  { value: "tokensupply", label: "Get Token Supply" },
  { value: "tokenbalance", label: "Get Token Balance" },
  { value: "gasoracle", label: "Get Gas Prices" },
  { value: "ethsupply", label: "Get ETH Supply" },
  { value: "ethprice", label: "Get ETH Price" },
  { value: "getlogs", label: "Get Event Logs" },
];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StoredWallet { address: string; privateKey: string; type: string; }
interface StatusEntry { msg: string; status: "pending" | "success" | "error"; }
interface CoinEntry { address: string; balance: string; }

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function storageGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

/* ================================================================== */
/*  Shared design tokens                                               */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-blue-400/60 focus:ring-1 focus:ring-blue-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary = "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center";
const btnSmall = "h-9 px-4 rounded-xl font-medium text-xs bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";
const pillBtn = "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-medium border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function WalletsApp() {
  const [chain, setChain] = useState<"ethereum" | "arweave">("ethereum");
  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC), []);

  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const selected = selIdx !== null && wallets[selIdx] ? wallets[selIdx] : null;

  const [ethBal, setEthBal] = useState("0.000000");
  const [moneyBal, setMoneyBal] = useState("0.00");

  const [tab, setTab] = useState<"home" | "apps" | "explorer" | "iframe">("home");
  const [vanityMode, setVanityMode] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<StatusEntry[]>([]);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [iframeTitle, setIframeTitle] = useState("");

  const [sendType, setSendType] = useState<"ETH" | "Token">("ETH");
  const [recipient, setRecipient] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [sendTokenAddr, setSendTokenAddr] = useState("");
  const [gasPriceOpt, setGasPriceOpt] = useState<"auto" | "manual">("auto");
  const [gasPriceManual, setGasPriceManual] = useState("");

  const [swapDir, setSwapDir] = useState<"ethToToken" | "tokenToEth">("ethToToken");
  const [swapTokenAddr, setSwapTokenAddr] = useState("");
  const [swapAmt, setSwapAmt] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [gasLimit, setGasLimit] = useState("500000");

  const [coinList, setCoinList] = useState<CoinEntry[]>([]);
  const [coinImportAddr, setCoinImportAddr] = useState("");

  const [expAction, setExpAction] = useState("");
  const [expAddress, setExpAddress] = useState("");
  const [expTxHash, setExpTxHash] = useState("");
  const [expTimestamp, setExpTimestamp] = useState("");
  const [expContract, setExpContract] = useState("");
  const [expLogAddr, setExpLogAddr] = useState("");
  const [expFromBlock, setExpFromBlock] = useState("");
  const [expToBlock, setExpToBlock] = useState("");
  const [expResult, setExpResult] = useState("Results will appear here...");

  const fileRef = useRef<HTMLInputElement>(null);

  const addStatus = useCallback((msg: string, status: StatusEntry["status"] = "pending") => {
    setStatuses((p) => [{ msg, status }, ...p].slice(0, 10));
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!selected) return;
    try {
      const ethW = await provider.getBalance(selected.address);
      setEthBal(parseFloat(ethers.utils.formatEther(ethW)).toFixed(6));
      const money = new ethers.Contract(MONEY_ADDRESS, ERC20_ABI, provider);
      const mBal = await money.balanceOf(selected.address);
      setMoneyBal(parseFloat(ethers.utils.formatEther(mBal)).toFixed(2));
    } catch (e: any) {
      addStatus(`Balance fetch failed: ${e.message}`, "error");
    }
  }, [selected, provider, addStatus]);

  useEffect(() => {
    const w: StoredWallet[] = storageGet("wallets", []);
    setWallets(w);
    if (w.length > 0) setSelIdx(0);
    setCoinList(storageGet("coinList", []));
  }, []);

  useEffect(() => {
    if (selected) fetchBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.address]);

  const saveWallets = useCallback((w: StoredWallet[]) => {
    setWallets(w);
    localStorage.setItem("wallets", JSON.stringify(w));
  }, []);

  /* ================================================================ */
  /*  Wallet actions                                                   */
  /* ================================================================ */

  const createWallet = useCallback(async () => {
    addStatus("Creating wallet...");
    try {
      let wallet: ethers.Wallet;
      if (vanityMode) {
        let attempts = 0;
        while (true) {
          attempts++;
          wallet = ethers.Wallet.createRandom();
          if (wallet.address.toLowerCase().startsWith("0x100")) break;
          if (attempts > 10000) { addStatus("Failed after 10000 attempts for 0x100 prefix", "error"); return; }
        }
      } else {
        wallet = ethers.Wallet.createRandom();
      }
      const entry: StoredWallet = { address: wallet.address, privateKey: wallet.privateKey, type: "moneyfund" };
      const newW = [...wallets, entry];
      saveWallets(newW);
      setSelIdx(newW.length - 1);
      addStatus(`Wallet created: ${shorten(wallet.address)}`, "success");
    } catch (e: any) {
      addStatus(`Failed: ${e.message}`, "error");
    }
  }, [wallets, vanityMode, saveWallets, addStatus]);

  const exportWallets = useCallback(() => {
    if (wallets.length === 0) { addStatus("No wallets to export", "error"); return; }
    const blob = new Blob([JSON.stringify(wallets, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wallets.json";
    a.click();
    URL.revokeObjectURL(a.href);
    addStatus("Wallets exported", "success");
  }, [wallets, addStatus]);

  const importWallets = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (!Array.isArray(data)) throw new Error("Invalid format");
          const valid = data.filter((w: any) => w.address && w.privateKey && w.type);
          saveWallets(valid);
          if (valid.length > 0) setSelIdx(0);
          addStatus(`Imported ${valid.length} wallets`, "success");
        } catch (err: any) {
          addStatus(`Import failed: ${err.message}`, "error");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [saveWallets, addStatus],
  );

  const copyAddress = useCallback(() => {
    if (!selected) { addStatus("No wallet selected", "error"); return; }
    navigator.clipboard.writeText(selected.address);
    addStatus("Address copied", "success");
  }, [selected, addStatus]);

  /* ================================================================ */
  /*  Send                                                             */
  /* ================================================================ */

  const handleSend = useCallback(async () => {
    if (!selected) { addStatus("No wallet selected", "error"); return; }
    if (!recipient || !sendAmt) { addStatus("Recipient and amount required", "error"); return; }
    addStatus(`Sending ${sendAmt} ${sendType}...`);
    try {
      const signer = new ethers.Wallet(selected.privateKey, provider);
      if (sendType === "ETH") {
        const tx = await signer.sendTransaction({ to: recipient, value: ethers.utils.parseEther(sendAmt) });
        const receipt = await tx.wait();
        addStatus(`ETH sent! Tx: ${shorten(receipt.transactionHash)}`, "success");
      } else {
        if (!ethers.utils.isAddress(sendTokenAddr)) { addStatus("Invalid token address", "error"); return; }
        const tok = new ethers.Contract(sendTokenAddr, ERC20_ABI, signer);
        const dec = await tok.decimals();
        const amt = ethers.utils.parseUnits(sendAmt, dec);
        const tx = await tok.transfer(recipient, amt);
        const receipt = await tx.wait();
        addStatus(`Token sent! Tx: ${shorten(receipt.transactionHash)}`, "success");
      }
      await fetchBalance();
    } catch (e: any) {
      addStatus(`Transfer failed: ${e.message}`, "error");
    }
  }, [selected, recipient, sendAmt, sendType, sendTokenAddr, provider, addStatus, fetchBalance]);

  /* ================================================================ */
  /*  Swap                                                             */
  /* ================================================================ */

  const handleSwap = useCallback(async () => {
    if (!selected) { addStatus("No wallet selected", "error"); return; }
    if (!ethers.utils.isAddress(swapTokenAddr) || !swapAmt || parseFloat(swapAmt) <= 0) {
      addStatus("Valid token address and amount required", "error"); return;
    }
    addStatus(`Swapping ${swapAmt} ${swapDir === "ethToToken" ? "ETH → Token" : "Token → ETH"}...`);
    try {
      const signer = new ethers.Wallet(selected.privateKey, provider);
      const router = new ethers.Contract(UNISWAP_ROUTER, ROUTER_ABI, signer);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      const slip = parseFloat(slippage) / 100;
      if (swapDir === "ethToToken") {
        const path = [WETH, swapTokenAddr];
        const amtIn = ethers.utils.parseEther(swapAmt);
        const amounts = await router.getAmountsOut(amtIn, path);
        const minOut = amounts[1].mul(Math.floor((1 - slip) * 10000)).div(10000);
        const tx = await router.swapExactETHForTokens(minOut, path, selected.address, deadline, { value: amtIn, gasLimit: parseInt(gasLimit) });
        const r = await tx.wait();
        addStatus(`Swap success! Tx: ${shorten(r.transactionHash)}`, "success");
      } else {
        const tok = new ethers.Contract(swapTokenAddr, ERC20_ABI, signer);
        const dec = await tok.decimals();
        const amtIn = ethers.utils.parseUnits(swapAmt, dec);
        const approveTx = await tok.approve(UNISWAP_ROUTER, amtIn);
        await approveTx.wait();
        const path = [swapTokenAddr, WETH];
        const amounts = await router.getAmountsOut(amtIn, path);
        const minOut = amounts[1].mul(Math.floor((1 - slip) * 10000)).div(10000);
        const tx = await router.swapExactTokensForETH(amtIn, minOut, path, selected.address, deadline, { gasLimit: parseInt(gasLimit) });
        const r = await tx.wait();
        addStatus(`Swap success! Tx: ${shorten(r.transactionHash)}`, "success");
      }
      await fetchBalance();
    } catch (e: any) {
      addStatus(`Swap failed: ${e.message}`, "error");
    }
  }, [selected, swapTokenAddr, swapAmt, swapDir, slippage, gasLimit, provider, addStatus, fetchBalance]);

  /* ================================================================ */
  /*  Import coin                                                      */
  /* ================================================================ */

  const importCoin = useCallback(async () => {
    if (!selected) { addStatus("No wallet selected", "error"); return; }
    if (!ethers.utils.isAddress(coinImportAddr)) { addStatus("Invalid address", "error"); return; }
    try {
      const tok = new ethers.Contract(coinImportAddr, ERC20_ABI, provider);
      const dec = await tok.decimals();
      const bal = await tok.balanceOf(selected.address);
      const formatted = ethers.utils.formatUnits(bal, dec);
      const newList = [...coinList, { address: coinImportAddr, balance: formatted }];
      setCoinList(newList);
      localStorage.setItem("coinList", JSON.stringify(newList));
      addStatus(`Coin imported: ${shorten(coinImportAddr)}`, "success");
    } catch (e: any) {
      addStatus(`Import failed: ${e.message}`, "error");
    }
  }, [selected, coinImportAddr, coinList, provider, addStatus]);

  /* ================================================================ */
  /*  Explorer                                                         */
  /* ================================================================ */

  const searchExplorer = useCallback(async () => {
    if (!expAction) { setExpResult("Please select an action."); return; }
    addStatus(`Fetching ${expAction} data...`);
    let url = "";
    switch (expAction) {
      case "balance": url = `${ETHERSCAN_API}?module=account&action=balance&address=${expAddress}&apikey=${ETHERSCAN_KEY}`; break;
      case "txlist": url = `${ETHERSCAN_API}?module=account&action=txlist&address=${expAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_KEY}`; break;
      case "tokentx": url = `${ETHERSCAN_API}?module=account&action=tokentx&address=${expAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_KEY}`; break;
      case "tokennfttx": url = `${ETHERSCAN_API}?module=account&action=tokennfttx&address=${expAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_KEY}`; break;
      case "txlistinternal": url = `${ETHERSCAN_API}?module=account&action=txlistinternal&address=${expAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_KEY}`; break;
      case "gettxreceiptstatus": url = `${ETHERSCAN_API}?module=account&action=gettxreceiptstatus&txhash=${expTxHash}&apikey=${ETHERSCAN_KEY}`; break;
      case "getblockbytime": url = `${ETHERSCAN_API}?module=block&action=getblocknobytime&timestamp=${expTimestamp}&closest=before&apikey=${ETHERSCAN_KEY}`; break;
      case "getabi": url = `${ETHERSCAN_API}?module=contract&action=getabi&address=${expContract}&apikey=${ETHERSCAN_KEY}`; break;
      case "tokensupply": url = `${ETHERSCAN_API}?module=account&action=tokensupply&contractaddress=${expContract}&apikey=${ETHERSCAN_KEY}`; break;
      case "tokenbalance": url = `${ETHERSCAN_API}?module=account&action=tokenbalance&contractaddress=${expContract}&address=${expAddress}&apikey=${ETHERSCAN_KEY}`; break;
      case "gasoracle": url = `${ETHERSCAN_API}?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_KEY}`; break;
      case "ethsupply": url = `${ETHERSCAN_API}?module=stats&action=ethsupply&apikey=${ETHERSCAN_KEY}`; break;
      case "ethprice": url = `${ETHERSCAN_API}?module=stats&action=ethprice&apikey=${ETHERSCAN_KEY}`; break;
      case "getlogs": url = `${ETHERSCAN_API}?module=logs&action=getLogs&fromBlock=${expFromBlock}&toBlock=${expToBlock}&address=${expLogAddr}&apikey=${ETHERSCAN_KEY}`; break;
      default: setExpResult("Invalid action"); return;
    }
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === "1") {
        setExpResult(JSON.stringify(data.result, null, 2));
        addStatus(`Fetched ${expAction} data`, "success");
      } else {
        setExpResult(`Error: ${data.message || "Unknown"}`);
        addStatus(`Failed: ${data.message}`, "error");
      }
    } catch (e: any) {
      setExpResult(`Error: ${e.message}`);
      addStatus(`Failed: ${e.message}`, "error");
    }
  }, [expAction, expAddress, expTxHash, expTimestamp, expContract, expLogAddr, expFromBlock, expToBlock, addStatus]);

  const needsAddr = ["balance", "txlist", "tokentx", "tokennfttx", "txlistinternal", "tokenbalance"].includes(expAction);
  const needsTx = expAction === "gettxreceiptstatus";
  const needsTime = expAction === "getblockbytime";
  const needsContract = ["getabi", "tokensupply", "tokenbalance"].includes(expAction);
  const needsLogs = expAction === "getlogs";

  const openApp = useCallback((app: AppTile) => {
    setIframeUrl(app.url);
    setIframeTitle(app.title);
    setTab("iframe");
  }, []);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  const ethTabs: { id: "home" | "apps" | "explorer"; label: string; icon: string }[] = [
    { id: "home", label: "Home", icon: "⬡" },
    { id: "apps", label: "Apps", icon: "◫" },
    { id: "explorer", label: "Explorer", icon: "◎" },
  ];

  const actionBtns = [
    { id: "send", label: "Send", icon: "↑" },
    { id: "swap", label: "Swap", icon: "⇄" },
    { id: "crypto", label: "My Crypto", icon: "◈" },
  ];

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[720px] mx-auto space-y-5">

        {/* ── Page title ── */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">Wallets</h1>
          <p className="text-xs text-white/30 mt-1">Manage your Ethereum & Arweave wallets</p>
        </div>

        {/* ── Chain switcher ── */}
        <div className={`${card} p-1.5 flex gap-1`}>
          <button
            type="button"
            onClick={() => setChain("ethereum")}
            className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              chain === "ethereum"
                ? "bg-blue-500/15 text-blue-400 shadow-[inset_0_1px_0_rgba(59,130,246,0.2)]"
                : "text-white/35 hover:text-white/55 hover:bg-white/[0.03]"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-blue-400" style={{ opacity: chain === "ethereum" ? 1 : 0.3 }} />
            Ethereum
          </button>
          <button
            type="button"
            onClick={() => setChain("arweave")}
            className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              chain === "arweave"
                ? "bg-purple-500/15 text-purple-400 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]"
                : "text-white/35 hover:text-white/55 hover:bg-white/[0.03]"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-400" style={{ opacity: chain === "arweave" ? 1 : 0.3 }} />
            Arweave
          </button>
        </div>

        {/* ── Arweave ── */}
        {chain === "arweave" && <ArweaveWallet />}

        {/* ── Ethereum ── */}
        {chain === "ethereum" && (
          <div className="space-y-5">

            {/* Tab bar */}
            <div className={`${card} p-1.5 flex gap-1`}>
              {ethTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    tab === t.id
                      ? "bg-blue-500/15 text-blue-400 shadow-[inset_0_1px_0_rgba(59,130,246,0.2)]"
                      : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
                  }`}
                >
                  <span className="text-xs opacity-60">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ================================================================ */}
            {/*  HOME TAB                                                        */}
            {/* ================================================================ */}
            {tab === "home" && (
              <div className="space-y-4">

                {/* Wallet selector */}
                <div className={`${card} p-4 space-y-3`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Active Wallet</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/25">0x100</span>
                      <label className="relative w-9 h-5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vanityMode}
                          onChange={(e) => { setVanityMode(e.target.checked); addStatus(`0x100 Mode ${e.target.checked ? "ON" : "OFF"}`, "success"); }}
                          className="sr-only peer"
                        />
                        <span className="absolute inset-0 bg-white/[0.08] rounded-full peer-checked:bg-blue-500/40 transition-all" />
                        <span className="absolute left-[2px] top-[2px] w-4 h-4 bg-white/60 rounded-full peer-checked:translate-x-4 peer-checked:bg-blue-400 transition-all" />
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={selIdx ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") { setSelIdx(null); setEthBal("0.000000"); setMoneyBal("0.00"); }
                        else setSelIdx(parseInt(v));
                      }}
                      className={`flex-1 ${selectCls}`}
                    >
                      <option value="">Select a wallet...</option>
                      {wallets.map((w, i) => (
                        <option key={i} value={i}>{shorten(w.address)} ({w.type})</option>
                      ))}
                    </select>
                    <button type="button" onClick={copyAddress} className={btnSmall}>Copy</button>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={createWallet} className={`flex-1 ${btnSmall}`}>Create</button>
                    <label className={`flex-1 ${btnSmall} flex items-center justify-center cursor-pointer`}>
                      Import
                      <input ref={fileRef} type="file" accept=".json" onChange={importWallets} className="hidden" />
                    </label>
                    <button type="button" onClick={exportWallets} className={`flex-1 ${btnSmall}`}>Export</button>
                  </div>
                </div>

                {/* Balance */}
                <div className={`${card} p-5`}>
                  <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Balances</span>
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-2xl font-bold text-white tracking-tight">{ethBal}</p>
                      <p className="text-xs text-white/30 mt-0.5">ETH</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white tracking-tight">{moneyBal}</p>
                      <p className="text-xs text-white/30 mt-0.5">MONEY</p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className={`${card} p-1.5 flex gap-1`}>
                  {actionBtns.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setOpenSection(openSection === s.id ? null : s.id)}
                      className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        openSection === s.id
                          ? "bg-blue-500/15 text-blue-400"
                          : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
                      }`}
                    >
                      <span className="text-xs opacity-60">{s.icon}</span>
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* ── Send ── */}
                {openSection === "send" && (
                  <div className={`${card} p-5 space-y-4`}>
                    <h3 className="text-sm font-semibold text-white/80">Send ETH or Tokens</h3>
                    <div>
                      <label className={labelCls}>Transfer Type</label>
                      <select value={sendType} onChange={(e) => setSendType(e.target.value as any)} className={selectCls}>
                        <option value="ETH">Send ETH</option>
                        <option value="Token">Send Token</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Recipient</label>
                      <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Address or ENS" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Amount</label>
                      <input type="number" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder="0.00" step="0.0001" className={inputCls} />
                    </div>
                    {sendType === "Token" && (
                      <div>
                        <label className={labelCls}>Token Address</label>
                        <input value={sendTokenAddr} onChange={(e) => setSendTokenAddr(e.target.value)} placeholder="0x..." className={inputCls} />
                      </div>
                    )}
                    <div>
                      <label className={labelCls}>Gas Price</label>
                      <select value={gasPriceOpt} onChange={(e) => setGasPriceOpt(e.target.value as any)} className={selectCls}>
                        <option value="auto">Auto Estimate</option>
                        <option value="manual">Manual</option>
                      </select>
                    </div>
                    {gasPriceOpt === "manual" && (
                      <div>
                        <label className={labelCls}>Gas Price (Gwei)</label>
                        <input type="number" value={gasPriceManual} onChange={(e) => setGasPriceManual(e.target.value)} placeholder="e.g. 20" className={inputCls} />
                      </div>
                    )}
                    <button type="button" onClick={handleSend} className={btnPrimary}>Transfer</button>
                  </div>
                )}

                {/* ── Swap ── */}
                {openSection === "swap" && (
                  <div className={`${card} p-5 space-y-4`}>
                    <h3 className="text-sm font-semibold text-white/80">Swap Tokens</h3>
                    <div>
                      <label className={labelCls}>Direction</label>
                      <select value={swapDir} onChange={(e) => setSwapDir(e.target.value as any)} className={selectCls}>
                        <option value="ethToToken">ETH → Token</option>
                        <option value="tokenToEth">Token → ETH</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Token Address</label>
                      <input value={swapTokenAddr} onChange={(e) => setSwapTokenAddr(e.target.value)} placeholder="0x..." className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Amount</label>
                      <input type="number" value={swapAmt} onChange={(e) => setSwapAmt(e.target.value)} placeholder="0.00" step="0.0001" className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Slippage</label>
                        <select value={slippage} onChange={(e) => setSlippage(e.target.value)} className={selectCls}>
                          {["0.1", "0.5", "1", "3", "5", "10"].map((s) => (
                            <option key={s} value={s}>{s}%</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Gas Limit</label>
                        <select value={gasLimit} onChange={(e) => setGasLimit(e.target.value)} className={selectCls}>
                          {["200000", "300000", "400000", "500000"].map((g) => (
                            <option key={g} value={g}>{parseInt(g).toLocaleString()}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button type="button" onClick={handleSwap} className={btnPrimary}>Swap</button>
                  </div>
                )}

                {/* ── My Crypto ── */}
                {openSection === "crypto" && (
                  <div className={`${card} p-5 space-y-4`}>
                    <h3 className="text-sm font-semibold text-white/80">My Crypto</h3>
                    <div>
                      <label className={labelCls}>Token Contract</label>
                      <input value={coinImportAddr} onChange={(e) => setCoinImportAddr(e.target.value)} placeholder="0x..." className={inputCls} />
                    </div>
                    <button type="button" onClick={importCoin} className={btnPrimary}>Import</button>
                    {coinList.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                        {coinList.map((c, i) => (
                          <div key={i} className="flex justify-between items-center text-sm">
                            <span className="text-white/50 font-mono text-xs">{shorten(c.address)}</span>
                            <span className="text-white/80">{c.balance}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {coinList.length === 0 && <p className="text-xs text-white/25">No tokens imported yet.</p>}
                  </div>
                )}

                {/* ── Status log ── */}
                {statuses.length > 0 && (
                  <div className={`${card} p-4 max-h-[240px] overflow-y-auto space-y-1`} style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
                    {statuses.map((s, i) => (
                      <div
                        key={i}
                        className={`text-xs py-2 px-3 rounded-lg ${
                          s.status === "success"
                            ? "text-emerald-400 bg-emerald-500/5"
                            : s.status === "error"
                              ? "text-red-400 bg-red-500/5"
                              : "text-white/50 bg-white/[0.02]"
                        }`}
                      >
                        {s.msg}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ================================================================ */}
            {/*  APPS TAB                                                        */}
            {/* ================================================================ */}
            {tab === "apps" && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {APPS.map((app) => (
                  <button
                    key={app.title}
                    type="button"
                    onClick={() => openApp(app)}
                    className={`${card} group p-3 flex flex-col items-center justify-center h-[90px] text-center cursor-pointer hover:bg-white/[0.05] hover:border-white/[0.12] active:scale-95 transition-all`}
                  >
                    <span className="text-2xl mb-1.5 group-hover:scale-110 transition-transform">{app.icon}</span>
                    <span className="text-[10px] font-medium text-white/50 group-hover:text-white/70 transition-colors leading-tight">{app.title}</span>
                  </button>
                ))}
              </div>
            )}

            {/* ================================================================ */}
            {/*  EXPLORER TAB                                                    */}
            {/* ================================================================ */}
            {tab === "explorer" && (
              <div className={`${card} p-5 space-y-4`}>
                <h3 className="text-sm font-semibold text-white/80">Block Explorer</h3>
                <div>
                  <label className={labelCls}>Action</label>
                  <select value={expAction} onChange={(e) => setExpAction(e.target.value)} className={selectCls}>
                    {EXPLORER_ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
                {needsAddr && (
                  <div>
                    <label className={labelCls}>Address</label>
                    <input value={expAddress} onChange={(e) => setExpAddress(e.target.value)} placeholder="0x..." className={inputCls} />
                  </div>
                )}
                {needsTx && (
                  <div>
                    <label className={labelCls}>Transaction Hash</label>
                    <input value={expTxHash} onChange={(e) => setExpTxHash(e.target.value)} placeholder="0x..." className={inputCls} />
                  </div>
                )}
                {needsTime && (
                  <div>
                    <label className={labelCls}>Timestamp (UNIX)</label>
                    <input type="number" value={expTimestamp} onChange={(e) => setExpTimestamp(e.target.value)} placeholder="1677654321" className={inputCls} />
                  </div>
                )}
                {needsContract && (
                  <div>
                    <label className={labelCls}>Contract Address</label>
                    <input value={expContract} onChange={(e) => setExpContract(e.target.value)} placeholder="0x..." className={inputCls} />
                  </div>
                )}
                {needsLogs && (
                  <>
                    <div>
                      <label className={labelCls}>Contract Address</label>
                      <input value={expLogAddr} onChange={(e) => setExpLogAddr(e.target.value)} placeholder="0x..." className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>From Block</label>
                        <input type="number" value={expFromBlock} onChange={(e) => setExpFromBlock(e.target.value)} placeholder="0" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>To Block</label>
                        <input type="number" value={expToBlock} onChange={(e) => setExpToBlock(e.target.value)} placeholder="99999999" className={inputCls} />
                      </div>
                    </div>
                  </>
                )}
                <button type="button" onClick={searchExplorer} className={btnPrimary}>Search</button>
                <pre className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-white/40 max-h-[360px] overflow-auto whitespace-pre-wrap break-all font-mono" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                  {expResult}
                </pre>
              </div>
            )}

            {/* ================================================================ */}
            {/*  IFRAME TAB                                                      */}
            {/* ================================================================ */}
            {tab === "iframe" && iframeUrl && (
              <div className={`${card} p-4 space-y-3`}>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => { setTab("apps"); setIframeUrl(null); }} className={btnSmall}>
                    ← Back
                  </button>
                  <span className="text-sm font-medium text-white/70">{iframeTitle}</span>
                  <a href={iframeUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-blue-400/60 hover:text-blue-400 transition-colors">
                    Open ↗
                  </a>
                </div>
                <iframe
                  src={iframeUrl}
                  title={iframeTitle}
                  className="w-full rounded-xl border border-white/[0.06]"
                  style={{ height: "clamp(300px, 50vh, 420px)", background: "rgba(0,0,0,0.3)" }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
