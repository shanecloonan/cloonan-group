"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";

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

interface AppTile {
  icon: string;
  title: string;
  url: string;
}

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
  { value: "", label: "-- Choose an action --" },
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

interface StoredWallet {
  address: string;
  privateKey: string;
  type: string;
}

interface StatusEntry {
  msg: string;
  status: "pending" | "success" | "error";
}

interface CoinEntry {
  address: string;
  balance: string;
}

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
/*  COMPONENT                                                          */
/* ================================================================== */

export default function WalletsApp() {
  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC), []);

  /* wallet state */
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const selected = selIdx !== null && wallets[selIdx] ? wallets[selIdx] : null;

  /* balances */
  const [ethBal, setEthBal] = useState("0.000000");
  const [moneyBal, setMoneyBal] = useState("0.00");

  /* ui state */
  const [tab, setTab] = useState<"home" | "apps" | "explorer" | "iframe">("home");
  const [vanityMode, setVanityMode] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<StatusEntry[]>([]);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [iframeTitle, setIframeTitle] = useState("");

  /* send form */
  const [sendType, setSendType] = useState<"ETH" | "Token">("ETH");
  const [recipient, setRecipient] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [sendTokenAddr, setSendTokenAddr] = useState("");
  const [gasPriceOpt, setGasPriceOpt] = useState<"auto" | "manual">("auto");
  const [gasPriceManual, setGasPriceManual] = useState("");

  /* swap form */
  const [swapDir, setSwapDir] = useState<"ethToToken" | "tokenToEth">("ethToToken");
  const [swapTokenAddr, setSwapTokenAddr] = useState("");
  const [swapAmt, setSwapAmt] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [gasLimit, setGasLimit] = useState("500000");

  /* my crypto */
  const [coinList, setCoinList] = useState<CoinEntry[]>([]);
  const [coinImportAddr, setCoinImportAddr] = useState("");

  /* explorer */
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

  /* ---- status log ---- */
  const addStatus = useCallback((msg: string, status: StatusEntry["status"] = "pending") => {
    setStatuses((p) => [{ msg, status }, ...p].slice(0, 10));
  }, []);

  /* ---- fetch balances ---- */
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

  /* ---- load wallets on mount ---- */
  useEffect(() => {
    const w: StoredWallet[] = storageGet("wallets", []);
    setWallets(w);
    if (w.length > 0) setSelIdx(0);
    setCoinList(storageGet("coinList", []));
  }, []);

  /* ---- fetch balance on wallet change ---- */
  useEffect(() => {
    if (selected) fetchBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.address]);

  /* ---- persist wallets ---- */
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
          if (attempts > 10000) {
            addStatus("Failed after 10000 attempts for 0x100 prefix", "error");
            return;
          }
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
        const tx = await router.swapExactETHForTokens(minOut, path, selected.address, deadline, {
          value: amtIn,
          gasLimit: parseInt(gasLimit),
        });
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
        const tx = await router.swapExactTokensForETH(amtIn, minOut, path, selected.address, deadline, {
          gasLimit: parseInt(gasLimit),
        });
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

  /* ---- explorer field visibility ---- */
  const needsAddr = ["balance", "txlist", "tokentx", "tokennfttx", "txlistinternal", "tokenbalance"].includes(expAction);
  const needsTx = expAction === "gettxreceiptstatus";
  const needsTime = expAction === "getblockbytime";
  const needsContract = ["getabi", "tokensupply", "tokenbalance"].includes(expAction);
  const needsLogs = expAction === "getlogs";

  /* ---- open app in iframe ---- */
  const openApp = useCallback((app: AppTile) => {
    setIframeUrl(app.url);
    setIframeTitle(app.title);
    setTab("iframe");
  }, []);

  /* ================================================================ */
  /*  CSS classes                                                      */
  /* ================================================================ */

  const btnCls = "w-full py-3 px-4 rounded-lg font-semibold text-base bg-[#4F46E5] text-[#F9FAFB] hover:bg-[#6366F1] hover:scale-[1.02] disabled:bg-gray-600/60 disabled:cursor-not-allowed transition-all flex justify-center items-center min-h-[44px]";
  const btnSmCls = "flex-1 py-2 px-3 rounded-lg font-semibold text-xs bg-[#4F46E5] text-[#F9FAFB] hover:bg-[#6366F1] hover:scale-[1.02] transition-all flex justify-center items-center min-h-[36px]";
  const inputCls = "w-full py-3 px-3 rounded-lg bg-[rgba(17,24,39,0.9)] text-[#E5E7EB] text-base border border-[rgba(99,102,241,0.2)] focus:border-[#6366F1] focus:shadow-[0_0_8px_rgba(99,102,241,0.5)] outline-none transition-all placeholder:text-[#9CA3AF]";
  const selectCls = `${inputCls} appearance-none pr-8`;
  const labelCls = "block text-[#A5F3FC] text-sm font-medium mb-1";

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div
      className="min-h-screen flex justify-center items-start p-3 sm:p-6"
      style={{ background: "#0A0C1E", fontFamily: "'Manrope', sans-serif" }}
    >
      <div
        className="w-full max-w-[800px] rounded-2xl p-3 sm:p-6"
        style={{
          background: "rgba(10,17,32,0.95)",
          border: "2px solid #FFD700",
          boxShadow: "0 0 10px rgba(255,215,0,0.3), 0 6px 20px rgba(0,0,0,0.3)",
        }}
      >
        {/* ── Header ── */}
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">MoneyFund Wallets</h1>
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-sm text-[#F1F5F9]">0x100 Mode</span>
            <label className="relative w-12 h-6 cursor-pointer">
              <input
                type="checkbox"
                checked={vanityMode}
                onChange={(e) => { setVanityMode(e.target.checked); addStatus(`0x100 Mode ${e.target.checked ? "Enabled" : "Disabled"}`, "success"); }}
                className="sr-only peer"
              />
              <span className="absolute inset-0 bg-[#475569] rounded-full peer-checked:bg-[#10B981] transition-all" />
              <span className="absolute left-[3px] bottom-[3px] w-[18px] h-[18px] bg-white rounded-full peer-checked:translate-x-6 transition-all" />
            </label>
          </div>
        </div>

        {/* ── Tab nav (desktop) ── */}
        <div className="hidden sm:flex gap-2 mb-5">
          {(["home", "apps", "explorer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-3.5 px-4 rounded-t-lg text-lg font-semibold text-center transition-all ${
                tab === t ? "bg-[#FFD700] text-[#0A0C1E]" : "bg-white/5 text-[#A5F3FC] hover:bg-white/10"
              }`}
            >
              {t === "home" ? "Home" : t === "apps" ? "Apps" : "Explorer"}
            </button>
          ))}
        </div>

        {/* ── Mobile dropdown ── */}
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as any)}
          className="sm:hidden w-full mb-4 py-2.5 px-3 rounded-lg text-base bg-[rgba(17,24,39,0.9)] text-[#E5E7EB] border-2 border-[#FFD700] outline-none appearance-none pr-10"
          style={{ backgroundImage: "url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23E5E7EB%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", backgroundSize: "12px" }}
        >
          <option value="home">🏠 Home</option>
          <option value="apps">📱 Apps</option>
          <option value="explorer">🔍 Explorer</option>
        </select>

        {/* ================================================================ */}
        {/*  HOME TAB                                                        */}
        {/* ================================================================ */}
        {tab === "home" && (
          <div>
            {/* Wallet selector */}
            <div className="flex items-center gap-2 mb-4">
              <select
                value={selIdx ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") { setSelIdx(null); setEthBal("0.000000"); setMoneyBal("0.00"); }
                  else setSelIdx(parseInt(v));
                }}
                className={`flex-[9] ${selectCls}`}
              >
                <option value="">-- Select Wallet --</option>
                {wallets.map((w, i) => (
                  <option key={i} value={i}>{w.address} ({w.type})</option>
                ))}
              </select>
              <button type="button" onClick={copyAddress} className="flex-[1] py-3 px-2 rounded-lg font-semibold text-sm bg-[#4F46E5] text-[#F9FAFB] hover:bg-[#6366F1] transition-all min-h-[44px]">
                Copy
              </button>
            </div>

            {/* Create / Import / Export */}
            <div className="flex gap-3 flex-wrap mb-4">
              <button type="button" onClick={createWallet} className={btnSmCls}>Create New Wallet</button>
              <label className={`${btnSmCls} cursor-pointer`}>
                Import Wallets
                <input ref={fileRef} type="file" accept=".json" onChange={importWallets} className="hidden" />
              </label>
              <button type="button" onClick={exportWallets} className={btnSmCls}>Export Wallets</button>
            </div>

            {/* Balance box */}
            <div className="rounded-lg p-4 my-4 border border-[rgba(99,102,241,0.2)]" style={{ background: "rgba(17,24,39,0.9)" }}>
              <div className="flex justify-between items-center my-2 text-base">
                <strong className="text-white font-medium">Money Balance:</strong>
                <span className="text-[#A5F3FC]">{moneyBal} MONEY</span>
              </div>
              <div className="flex justify-between items-center my-2 text-base">
                <strong className="text-white font-medium">Ethereum Balance:</strong>
                <span className="text-[#A5F3FC]">{ethBal} ETH</span>
              </div>
            </div>

            {/* Send / Swap / My Crypto toggles */}
            <div className="flex gap-2 flex-wrap mt-4">
              {[
                { id: "send", label: "Send" },
                { id: "swap", label: "Swap" },
                { id: "crypto", label: "My Crypto" },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setOpenSection(openSection === s.id ? null : s.id)}
                  className={`flex-1 py-2 px-3 rounded-lg font-semibold text-xs transition-all min-h-[36px] ${
                    openSection === s.id ? "bg-[#6366F1] text-white" : "bg-[#4F46E5] text-[#F9FAFB] hover:bg-[#6366F1]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* ── Send section ── */}
            {openSection === "send" && (
              <div className="mt-2 p-4 rounded-lg border border-[rgba(99,102,241,0.2)]" style={{ background: "rgba(17,24,39,0.9)" }}>
                <h3 className="text-xl font-semibold text-white mb-4">Send ETH or Coins</h3>
                <div className="mb-4">
                  <label className={labelCls}>Transfer Type</label>
                  <select value={sendType} onChange={(e) => setSendType(e.target.value as any)} className={selectCls}>
                    <option value="ETH">Send ETH</option>
                    <option value="Token">Send Coin</option>
                  </select>
                </div>
                <div className="mb-4">
                  <label className={labelCls}>Recipient Address or ENS</label>
                  <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Enter address or ENS" className={inputCls} />
                </div>
                <div className="mb-4">
                  <label className={labelCls}>Amount to Transfer</label>
                  <input type="number" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder="Enter amount" step="0.0001" className={inputCls} />
                </div>
                {sendType === "Token" && (
                  <div className="mb-4">
                    <label className={labelCls}>Token Address</label>
                    <input value={sendTokenAddr} onChange={(e) => setSendTokenAddr(e.target.value)} placeholder="Enter token address" className={inputCls} />
                  </div>
                )}
                <div className="mb-4">
                  <label className={labelCls}>Gas Price Option</label>
                  <select value={gasPriceOpt} onChange={(e) => setGasPriceOpt(e.target.value as any)} className={selectCls}>
                    <option value="auto">Auto Estimate</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                {gasPriceOpt === "manual" && (
                  <div className="mb-4">
                    <label className={labelCls}>Gas Price (Gwei)</label>
                    <input type="number" value={gasPriceManual} onChange={(e) => setGasPriceManual(e.target.value)} placeholder="Enter gas price" className={inputCls} />
                  </div>
                )}
                <button type="button" onClick={handleSend} className={btnCls}>Transfer Funds</button>
              </div>
            )}

            {/* ── Swap section ── */}
            {openSection === "swap" && (
              <div className="mt-2 p-4 rounded-lg border border-[rgba(99,102,241,0.2)]" style={{ background: "rgba(17,24,39,0.9)" }}>
                <h3 className="text-xl font-semibold text-white mb-4">Swap Coins</h3>
                <div className="mb-4">
                  <label className={labelCls}>Swap Direction</label>
                  <select value={swapDir} onChange={(e) => setSwapDir(e.target.value as any)} className={selectCls}>
                    <option value="ethToToken">ETH to Coin</option>
                    <option value="tokenToEth">Coin to ETH</option>
                  </select>
                </div>
                <div className="mb-4">
                  <label className={labelCls}>Coin Contract Address</label>
                  <input value={swapTokenAddr} onChange={(e) => setSwapTokenAddr(e.target.value)} placeholder="Enter coin CA" className={inputCls} />
                </div>
                <div className="mb-4">
                  <label className={labelCls}>Amount to Swap</label>
                  <input type="number" value={swapAmt} onChange={(e) => setSwapAmt(e.target.value)} placeholder="Enter amount" step="0.0001" className={inputCls} />
                </div>
                <div className="mb-4">
                  <label className={labelCls}>Slippage Tolerance</label>
                  <select value={slippage} onChange={(e) => setSlippage(e.target.value)} className={selectCls}>
                    {["0.1", "0.5", "1", "3", "5", "10"].map((s) => (
                      <option key={s} value={s}>{s}%</option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className={labelCls}>Gas Limit</label>
                  <select value={gasLimit} onChange={(e) => setGasLimit(e.target.value)} className={selectCls}>
                    {["200000", "300000", "400000", "500000"].map((g) => (
                      <option key={g} value={g}>{parseInt(g).toLocaleString()}</option>
                    ))}
                  </select>
                </div>
                <button type="button" onClick={handleSwap} className={btnCls}>Swap</button>
              </div>
            )}

            {/* ── My Crypto section ── */}
            {openSection === "crypto" && (
              <div className="mt-2 p-4 rounded-lg border border-[rgba(99,102,241,0.2)]" style={{ background: "rgba(17,24,39,0.9)" }}>
                <h3 className="text-xl font-semibold text-white mb-4">My Crypto</h3>
                <div className="mb-4">
                  <label className={labelCls}>Token Contract Address</label>
                  <input value={coinImportAddr} onChange={(e) => setCoinImportAddr(e.target.value)} placeholder="Enter token address" className={inputCls} />
                </div>
                <button type="button" onClick={importCoin} className={btnCls}>Import Coin</button>
                <div className="mt-4 text-sm text-[#E5E7EB]">
                  {coinList.length === 0 ? (
                    <p>No coins imported yet.</p>
                  ) : (
                    coinList.map((c, i) => (
                      <p key={i} className="my-1"><strong className="text-white">{shorten(c.address)}</strong>: {c.balance} tokens</p>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ── Status list ── */}
            {statuses.length > 0 && (
              <ul className="mt-5 max-h-[300px] overflow-y-auto pr-2" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(99,102,241,0.4) transparent" }}>
                {statuses.map((s, i) => (
                  <li
                    key={i}
                    className={`relative py-3 px-4 text-sm border-b-[3px] border-white/10 transition-colors hover:bg-white/5 ${
                      s.status === "success" ? "text-[#10B981]" : s.status === "error" ? "text-[#F87171]" : "text-[#F1F5F9]"
                    }`}
                  >
                    {s.msg}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/*  APPS TAB                                                        */}
        {/* ================================================================ */}
        {tab === "apps" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 my-5">
            {APPS.map((app) => (
              <button
                key={app.title}
                type="button"
                onClick={() => openApp(app)}
                className="rounded-xl p-4 flex flex-col items-center justify-center h-[100px] text-center cursor-pointer transition-all hover:scale-105 hover:shadow-[0_6px_16px_rgba(0,0,0,0.3)]"
                style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))", boxShadow: "0 4px 10px rgba(0,0,0,0.2)" }}
              >
                <span className="text-5xl text-[#6366F1] mb-2">{app.icon}</span>
                <span className="text-[10px] font-semibold text-white">{app.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* ================================================================ */}
        {/*  EXPLORER TAB                                                    */}
        {/* ================================================================ */}
        {tab === "explorer" && (
          <div>
            <h3 className="text-xl font-semibold text-white mb-4">Block Explorer</h3>
            <div className="mb-4">
              <label className={labelCls}>Select Action</label>
              <select value={expAction} onChange={(e) => setExpAction(e.target.value)} className={selectCls}>
                {EXPLORER_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            {needsAddr && (
              <div className="mb-4">
                <label className={labelCls}>Address</label>
                <input value={expAddress} onChange={(e) => setExpAddress(e.target.value)} placeholder="e.g., 0xde0b..." className={inputCls} />
              </div>
            )}
            {needsTx && (
              <div className="mb-4">
                <label className={labelCls}>Transaction Hash</label>
                <input value={expTxHash} onChange={(e) => setExpTxHash(e.target.value)} placeholder="e.g., 0x..." className={inputCls} />
              </div>
            )}
            {needsTime && (
              <div className="mb-4">
                <label className={labelCls}>Timestamp (UNIX)</label>
                <input type="number" value={expTimestamp} onChange={(e) => setExpTimestamp(e.target.value)} placeholder="e.g., 1677654321" className={inputCls} />
              </div>
            )}
            {needsContract && (
              <div className="mb-4">
                <label className={labelCls}>Contract Address</label>
                <input value={expContract} onChange={(e) => setExpContract(e.target.value)} placeholder="e.g., 0xdac17f..." className={inputCls} />
              </div>
            )}
            {needsLogs && (
              <>
                <div className="mb-4">
                  <label className={labelCls}>Contract Address</label>
                  <input value={expLogAddr} onChange={(e) => setExpLogAddr(e.target.value)} placeholder="e.g., 0xdac17f..." className={inputCls} />
                </div>
                <div className="mb-4">
                  <label className={labelCls}>From Block</label>
                  <input type="number" value={expFromBlock} onChange={(e) => setExpFromBlock(e.target.value)} placeholder="e.g., 0" className={inputCls} />
                </div>
                <div className="mb-4">
                  <label className={labelCls}>To Block</label>
                  <input type="number" value={expToBlock} onChange={(e) => setExpToBlock(e.target.value)} placeholder="e.g., 99999999" className={inputCls} />
                </div>
              </>
            )}
            <button type="button" onClick={searchExplorer} className={btnCls}>Search</button>
            <pre className="mt-5 p-3 rounded-lg bg-[rgba(17,24,39,0.9)] border border-[rgba(99,102,241,0.2)] text-sm text-[#E5E7EB] max-h-[400px] overflow-auto whitespace-pre-wrap break-all" style={{ scrollbarWidth: "thin" }}>
              {expResult}
            </pre>
          </div>
        )}

        {/* ================================================================ */}
        {/*  IFRAME TAB                                                      */}
        {/* ================================================================ */}
        {tab === "iframe" && iframeUrl && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <button type="button" onClick={() => { setTab("apps"); setIframeUrl(null); }} className="py-2 px-4 rounded-lg text-sm font-semibold bg-[#4F46E5] text-[#F9FAFB] hover:bg-[#6366F1] transition-all">
                ← Back
              </button>
              <span className="text-white font-semibold">{iframeTitle}</span>
              <a href={iframeUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[#6366F1] text-sm hover:underline">
                Open in new tab ↗
              </a>
            </div>
            <iframe
              src={iframeUrl}
              title={iframeTitle}
              className="w-full rounded-lg border-none"
              style={{ height: "clamp(300px, 50vh, 400px)", background: "rgba(17,24,39,0.9)" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
