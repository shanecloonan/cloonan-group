"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */

const LAYER_COLORS = {
  asset: "bg-gradient-to-br from-[#1A3C34] to-[#1F4A40]",
  distribution: "bg-gradient-to-br from-[#8B3A2B] to-[#A65343]",
  profit: "bg-gradient-to-br from-[#3F2A6D] to-[#4B367E]",
  dex: "bg-gradient-to-br from-[#3A3A3A] to-[#4A4A4A]",
};

const FEE_DATA = [
  { contract: "Coin Launcher", feeType: "0.2% Launch", wallet: "0.1%", dividends: "0.1%", notes: "Optional: Up to 3% tx fee; MF takes 30% (15% each)", layer: "asset" as const },
  { contract: "ETF Launcher", feeType: "0.35% Transaction", wallet: "0.125%", dividends: "0.125%", notes: "0.1% MONEY burned; Optional: Custom fee to creator", layer: "asset" as const },
  { contract: "Dividend Launcher", feeType: "0.5% Stake/Unstake/Claim", wallet: "0.5%", dividends: "None", notes: "Early unstake penalties to pool creator", layer: "distribution" as const },
  { contract: "DAO Launcher", feeType: "0.5% Swap", wallet: "0.25%", dividends: "0.25%", notes: "-", layer: "distribution" as const },
  { contract: "Storefront Launcher", feeType: "0.4% Sale", wallet: "0.2%", dividends: "0.2%", notes: "99.6% (9960 bps) to custom shareholders", layer: "profit" as const },
  { contract: "Ad Space Launcher", feeType: "0.4% Platform", wallet: "0.2%", dividends: "0.2%", notes: "$1 USD comment fee to highest bidder", layer: "profit" as const },
  { contract: "Multiswap Launcher", feeType: "0.1% Primary", wallet: "0.05%", dividends: "0.05%", notes: "Optional: Up to 3% to custom receivers", layer: "profit" as const },
  { contract: "MoneyFund DEX", feeType: "0.5% Swap", wallet: "0.1%", dividends: "0.1%", notes: "0.3% to liquidity providers", layer: "dex" as const },
];

const POOL_BRANCHES = [
  { label: "Coin Launches", pct: "0.1%", icon: "🚀" },
  { label: "Optional fees", pct: "15%", icon: "🪙" },
  { label: "ETFs", pct: "0.125%", icon: "📈" },
  { label: "DEX swaps", pct: "0.1%", icon: "💰" },
  { label: "DAOs", pct: "0.25%", icon: "🏛" },
  { label: "Storefronts", pct: "0.2%", icon: "🛍" },
  { label: "Ad Space", pct: "0.2%", icon: "📰" },
  { label: "Multiswaps", pct: "0.05%", icon: "🔄" },
];

const FAQ_ITEMS = [
  { q: "How do I launch a custom ERC-20 token with Coin Launcher?", a: "Go to Coin Launcher, enter the token's name, ticker, total supply, and optional transaction fees (up to 3%). Specify fee receivers and shares (summing to 10,000 basis points). A 0.2% launch fee applies, split equally (0.1% each) to MoneyFund Wallet and MONEY Dividends.", layer: "asset" as const },
  { q: "How are ETF fund prices calculated?", a: "ETF prices are calculated using Chainlink's ETH/USD feed and Uniswap V2 pair prices for underlying tokens. The price per share in wei reflects the weighted value of tokens (weights sum to 10,000 basis points).", layer: "asset" as const },
  { q: "What is a DAO?", a: "A Decentralized Autonomous Organization (DAO) is a blockchain-based system governed by smart contracts, allowing token holders to vote on proposals without centralized control. Users propose and vote on token swaps using an ERC-20 token.", layer: "distribution" as const },
  { q: "How do Dividend pool rewards work?", a: "Users stake tokens to receive ERC-721 NFTs. Rewards (ETH or ERC-20) are distributed proportionally based on staked tokens relative to the total (e.g., 1000/10,000 = 10% of rewards). Early unstaking incurs penalties calculated as penalty = initialPenalty - (daysElapsed × dailyPenaltyDecay).", layer: "distribution" as const },
  { q: "How do Dividend receipt NFTs work?", a: "When you stake tokens, the contract mints a unique ERC-721 NFT representing your stake. This NFT is transferable on secondary markets like OpenSea while tokens remain staked, allowing others to claim rewards or unstake.", layer: "distribution" as const },
  { q: "Can I customize NFT listing payments in Storefront?", a: "Yes, creators list NFTs with prices in ETH or any ERC-20 token. Specify custom payees and shares per listing, overriding defaults. A 0.4% sale fee applies, split equally to MoneyFund Wallet and MONEY Dividends, with 99.6% to payees.", layer: "profit" as const },
  { q: "How do Ad Space comments and refunds work?", a: "Users comment by paying a fee (minimum $1 USD equivalent) to the bidder, with 0.4% split equally to MoneyFund Wallet and MONEY Dividends. Bids are refunded (0-100%) when outbid, with non-refunded portions to fee receivers.", layer: "profit" as const },
  { q: "What makes Multiswap unique?", a: "Multiswap supports batch swaps (ETH-to-tokens, token-to-token, multi-token swaps) and batch distributions (tokens/ETH to single/multiple recipients) in one transaction. A 0.1% fee splits equally to MoneyFund Wallet and MONEY Dividends, with optional fees up to 3%.", layer: "profit" as const },
  { q: "How does the MoneyFund DEX differ from Multiswap?", a: "MoneyFund DEX is our own AMM built from scratch with a 0.5% swap fee (0.3% to LP, 0.1% each to MoneyFund Wallet and MONEY Dividends). Multiswap is built on top of Uniswap, allowing unique batch swaps and distributions.", layer: "dex" as const },
  { q: "Is MoneyFund open-source?", a: "MoneyFund's smart contracts will be open-sourced once the platform reaches a $1 million market cap, releasing all 62,000 lines of code for public audit. Until then, all contract actions are transparent on-chain via public functions and event logs.", layer: undefined },
  { q: "Is MoneyFund secure?", a: "Yes, MoneyFund uses non-custodial wallets where users retain full control of their private keys. Contracts use ReentrancyGuard and follow best practices for secure execution.", layer: undefined },
  { q: "Who created MoneyFund?", a: "My name is Shane — I'm the owner & only employee.", layer: undefined },
];

const CONTRACT_SECTIONS = [
  {
    title: "Coin Launcher", layer: "asset" as const,
    creator: "Set name, ticker, total supply, and optional transaction fees (up to 3%), with 70% going to your chosen wallets and 30% split equally between MoneyFund Wallet and MONEY Dividends. A 0.2% launch fee applies, also split equally.",
    user: "Send tokens, approve spending, and check balances. All standard ERC-20 functions supported.",
  },
  {
    title: "ETF Launcher", layer: "asset" as const,
    creator: "Build an ETF fund by selecting ERC-20 tokens and setting their percentage allocations (summing to 100%). Choose a name, ticker, and optional transaction fee. The fund uses Uniswap V2 for swaps and Chainlink for ETH/USD pricing. 0.35% transaction fee with 0.125% each to MoneyFund Wallet and MONEY Dividends, 0.1% to burn MONEY tokens.",
    user: "Deposit ETH to mint ETF shares, burn shares to get ETH back, or withdraw underlying tokens. Check fund details, token balances, share prices, and performance metrics.",
  },
  {
    title: "Dividend Launcher", layer: "distribution" as const,
    creator: "Set up a staking pool for an ERC-20 token, defining lock duration, initial penalty for early withdrawal, and daily penalty reduction (up to 365 days). Each stake issues a unique NFT (ERC-721) for tracking. A 0.5% fee applies to staking, unstaking, and reward claims.",
    user: "Deposit tokens to stake and receive a unique NFT. Claim dividends in ETH or ERC-20 tokens based on your share of the pool. Unstake tokens after the lock period, or earlier with a penalty.",
  },
  {
    title: "DAO Launcher", layer: "distribution" as const,
    creator: "Launch a DAO with an ERC-20 token for voting, setting voting period, mode (Rape or Standard), locked token percentage, approval threshold, daily proposal limit, and slippage for swaps. 0.5% fee on executed swaps splits equally between MoneyFund Wallet and MONEY Dividends.",
    user: "Propose token swaps (ETH-to-ERC20 or ERC20-to-ETH), vote on proposals with locked tokens, reclaim tokens after voting, and execute approved proposals.",
  },
  {
    title: "Storefront Launcher", layer: "profit" as const,
    creator: "Create an NFT marketplace by setting shareholder wallets and profit shares (up to 99.6%). Deposit and list ERC-721 NFTs with price in ETH or ERC-20 tokens, with timelock for listings. 0.4% sale fee splits equally between MoneyFund Wallet and MONEY Dividends.",
    user: "Buy NFTs from the marketplace using ETH or ERC-20 tokens. Check listing details, sales statistics, and profit distributions.",
  },
  {
    title: "Ad Space Launcher", layer: "profit" as const,
    creator: "Launch a continuous ad auction by setting refund percentage (0-100%), fee receivers, starting bid, minimum bid increment, ad lock duration, comment fee, and payment token. 0.4% bid fee splits equally between MoneyFund Wallet and MONEY Dividends.",
    user: "Bid on ad space with ETH or ERC-20 tokens. If highest bidder, adjust comment fees, message length, or payment token. Comment on ads by paying a fee (minimum $1 USD).",
  },
  {
    title: "Multiswap Launcher", layer: "profit" as const,
    creator: "Build a trading platform for swapping and distributing tokens/ETH, with optional fees up to 3%. 0.1% platform fee splits equally between MoneyFund Wallet and MONEY Dividends. Embed as a widget on any website.",
    user: "Swap ETH for tokens, tokens for ETH/tokens, including batch swaps. Distribute tokens/ETH to one or multiple recipients in a single transaction.",
  },
  {
    title: "MoneyFund DEX", layer: "dex" as const,
    creator: "",
    user: "An automated market maker (AMM) for swapping ETH and ERC-20 tokens. Users add or remove liquidity to earn 0.3% swap fees. 0.5% swap fee with 0.3% to LPs, 0.1% each to MoneyFund Wallet and MONEY Dividends.",
  },
];

/* ================================================================== */
/*  GAS CALCULATOR LOGIC                                               */
/* ================================================================== */

function calcGas(numItems: number, type: string) {
  let bundled: number, individual: number;
  switch (type) {
    case "ethToTokens":
    case "tokensToEth":
    case "tokensToTokens":
      bundled = 21000 + 3500 + 6500 + numItems * 85000 + (numItems - 1) * 1000;
      individual = numItems * (21000 + 85000);
      break;
    case "singleToken":
      bundled = 21000 + 3500 + numItems * 35000 + (numItems - 1) * 1000;
      individual = numItems * (21000 + 35000);
      break;
    case "multipleTokens":
      bundled = 21000 + 3500 + numItems * numItems * 35000 + (numItems * numItems - 1) * 1000;
      individual = numItems * numItems * (21000 + 35000);
      break;
    case "multipleTokensSingle":
      bundled = 21000 + 3500 + numItems * 35000 + (numItems - 1) * 1000;
      individual = numItems * (21000 + 35000);
      break;
    case "eth":
      bundled = 21000 + 3500 + numItems * 16000 + (numItems - 1) * 1000;
      individual = numItems * (21000 + 16000);
      break;
    default:
      return { bundled: 0, individual: 0, savings: "0" };
  }
  const savings = individual > 0 ? ((individual - bundled) / individual * 100).toFixed(2) : "0";
  return { bundled, individual, savings };
}

/* ================================================================== */
/*  DESIGN TOKENS                                                      */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-teal-600 to-teal-500 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer";

function layerBg(l?: string) {
  if (l === "asset") return "bg-gradient-to-br from-[#1A3C34] to-[#1F4A40]";
  if (l === "distribution") return "bg-gradient-to-br from-[#8B3A2B] to-[#A65343]";
  if (l === "profit") return "bg-gradient-to-br from-[#3F2A6D] to-[#4B367E]";
  if (l === "dex") return "bg-gradient-to-br from-[#3A3A3A] to-[#4A4A4A]";
  return "bg-white/[0.04]";
}

/* ================================================================== */
/*  U-DIAGRAM SVG COMPONENT                                            */
/* ================================================================== */

function UDiagram({ label, boxes, desc, pathEnd }: {
  label: string;
  boxes: { left: { label: string; layer: string }; bottom: { label: string; layer: string }; right: { label: string; layer: string } };
  desc: string;
  pathEnd?: string;
}) {
  const rightDollar = boxes.right.layer !== "none";
  const xEnd = pathEnd === "275" ? 275 : 260;
  const pathD = `M60,60 V210 H${xEnd} V60`;

  const boxFill = (layer: string) => {
    if (layer === "asset") return "url(#al-grad)";
    if (layer === "distribution") return "url(#dl-grad)";
    if (layer === "profit") return "url(#pl-grad)";
    return "#000";
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[320px]">
      <p className="text-lg font-bold text-white mt-16 -mb-12 text-center">{label}</p>
      <svg viewBox="0 0 320 260" className="w-[320px] h-[260px]" aria-label={`${label} U Diagram`}>
        <defs>
          <marker id="ae" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="white" /></marker>
          <marker id="ai" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="white" /></marker>
          <linearGradient id="al-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#3F2A6D" /><stop offset="100%" stopColor="#4B367E" /></linearGradient>
          <linearGradient id="dl-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#8B3A2B" /><stop offset="100%" stopColor="#A65343" /></linearGradient>
          <linearGradient id="pl-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#1A3C34" /><stop offset="100%" stopColor="#1F4A40" /></linearGradient>
        </defs>
        <path d={pathD} fill="none" stroke="white" strokeWidth="3" markerEnd="url(#ae)" />
        <circle r="6" fill="gold"><animateMotion dur="3s" repeatCount="indefinite" path={pathD} /></circle>
        {rightDollar && <circle r="6" fill="gold"><animateMotion dur="3s" repeatCount="indefinite" path={pathD} begin="1.5s" /></circle>}
        <rect x="30" y="110" width="60" height="40" rx="8" ry="8" fill={boxFill(boxes.left.layer)} stroke="#fff" strokeWidth="2" />
        <text x="60" y="130" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{boxes.left.label}</text>
        <line x1="60" y1="60" x2="60" y2="110" stroke="white" strokeWidth="2" markerEnd="url(#ai)" />
        <rect x="130" y="190" width="60" height="40" rx="8" ry="8" fill={boxFill(boxes.bottom.layer)} stroke="#fff" strokeWidth="2" />
        <text x="160" y="210" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{boxes.bottom.label}</text>
        <line x1="110" y1="210" x2="130" y2="210" stroke="white" strokeWidth="2" markerEnd="url(#ai)" />
        <rect x={xEnd - 30} y="110" width="60" height="40" rx="8" ry="8" fill={boxFill(boxes.right.layer)} stroke="#fff" strokeWidth="2" />
        <text x={xEnd} y="130" fill="white" fontSize={boxes.right.label.length > 7 ? "8" : "10"} fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{boxes.right.label}</text>
        <line x1={xEnd} y1="170" x2={xEnd} y2="150" stroke="white" strokeWidth="2" markerEnd="url(#ai)" />
        <circle cx="60" cy="60" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
        <text x="60" y="60" fill="black" fontSize="24" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
        {rightDollar ? (
          <>
            <circle cx="260" cy="36" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x="260" y="36" fill="black" fontSize="24" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
            <circle cx="290" cy="36" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x="290" y="36" fill="black" fontSize="24" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
          </>
        ) : (
          <>
            <circle cx="260" cy="42" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x="260" y="42" fill="white" fontSize="18" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">?</text>
          </>
        )}
      </svg>
      <p className="max-w-[300px] text-center text-[11px] text-white/50 leading-relaxed mt-2">{desc}</p>
    </div>
  );
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export default function AboutApp() {
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({});
  const [divCount, setDivCount] = useState(0);
  const feeChartRef = useRef<HTMLCanvasElement>(null);
  const feeChartInst = useRef<Chart | null>(null);

  /* gas calculator state */
  const [opType, setOpType] = useState("");
  const [funcType, setFuncType] = useState("");
  const [numTokens, setNumTokens] = useState(2);
  const [numRecipients, setNumRecipients] = useState(2);
  const [gasResult, setGasResult] = useState<{ bundled: number; individual: number; savings: string } | null>(null);

  /* gas charts refs */
  const gasChartRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const gasChartInsts = useRef<Record<string, Chart>>({});

  const toggleFaq = useCallback((i: number) => setFaqOpen((p) => ({ ...p, [i]: !p[i] })), []);

  /* ---- dividend counter ---- */
  useEffect(() => {
    const saved = parseInt(localStorage.getItem("divCounter") || "0");
    setDivCount(saved);
    const interval = setInterval(() => {
      setDivCount((p) => {
        const next = p + 1;
        if (next % 43 === 0) localStorage.setItem("divCounter", String(next));
        return next;
      });
    }, 600);
    return () => clearInterval(interval);
  }, []);

  /* ---- fee structure chart ---- */
  useEffect(() => {
    if (!feeChartRef.current) return;
    if (feeChartInst.current) feeChartInst.current.destroy();
    feeChartInst.current = new Chart(feeChartRef.current, {
      type: "bar",
      data: {
        labels: ["Coin", "ETF", "Dividend", "DAO", "Storefront", "Ad Space", "Multiswap", "DEX"],
        datasets: [
          { label: "MoneyFund Wallet Fee (%)", data: [0.1, 0.125, 0.5, 0.25, 0.2, 0.2, 0.05, 0.1], backgroundColor: "rgba(0,139,139,0.8)", borderColor: "#008B8B", borderWidth: 1 },
          { label: "MONEY Dividends Fee (%)", data: [0.1, 0.125, 0, 0.25, 0.2, 0.2, 0.05, 0.1], backgroundColor: "rgba(199,21,133,0.8)", borderColor: "#C71585", borderWidth: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: "#F5F5F5" } },
          y: { beginAtZero: true, max: 0.6, grid: { color: "rgba(168,181,194,0.2)" }, ticks: { color: "#F5F5F5", stepSize: 0.1 } },
        },
        plugins: { legend: { labels: { color: "#F5F5F5" } } },
      },
    });
    return () => { feeChartInst.current?.destroy(); };
  }, []);

  /* ---- gas comparison charts ---- */
  useEffect(() => {
    const chartConfigs: { id: string; label: string; type: string; xLabel: string }[] = [
      { id: "cEth2T", label: "Swap ETH → Multiple Tokens", type: "ethToTokens", xLabel: "Number of Tokens" },
      { id: "cT2Eth", label: "Swap Multiple Tokens → ETH", type: "tokensToEth", xLabel: "Number of Tokens" },
      { id: "cT2T", label: "Swap Multiple Tokens → Tokens", type: "tokensToTokens", xLabel: "Number of Tokens" },
      { id: "cSingle", label: "Distribute Single Token to Multiple Addresses", type: "singleToken", xLabel: "Number of Recipients" },
      { id: "cMulti", label: "Distribute Multiple Tokens to Multiple Addresses", type: "multipleTokens", xLabel: "Number of Tokens" },
      { id: "cMultiS", label: "Distribute Multiple Tokens to Single Address", type: "multipleTokensSingle", xLabel: "Number of Tokens" },
      { id: "cEthD", label: "Distribute ETH to Multiple Addresses", type: "eth", xLabel: "Number of Recipients" },
    ];
    chartConfigs.forEach(({ id, type, xLabel }) => {
      const canvas = gasChartRefs.current[id];
      if (!canvas) return;
      if (gasChartInsts.current[id]) gasChartInsts.current[id].destroy();
      const labels = Array.from({ length: 9 }, (_, i) => String(i + 1));
      gasChartInsts.current[id] = new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Bundled", data: labels.map((_, i) => calcGas(i + 1, type).bundled), backgroundColor: "#4CAF50" },
            { label: "Individual", data: labels.map((_, i) => calcGas(i + 1, type).individual), backgroundColor: "#F44336" },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: xLabel, color: "#F5F5F5" }, ticks: { color: "#F5F5F5" } },
            y: { title: { display: true, text: "Gas Used (Units)", color: "#F5F5F5" }, ticks: { color: "#F5F5F5" }, beginAtZero: true },
          },
          plugins: { legend: { labels: { color: "#F5F5F5" } } },
        },
      });
    });
    return () => { Object.values(gasChartInsts.current).forEach((c) => c.destroy()); };
  }, []);

  /* ---- gas calculator ---- */
  const handleCalc = useCallback(() => {
    if (!funcType) return;
    const items = ["singleToken", "eth"].includes(funcType) ? numRecipients : numTokens;
    setGasResult(calcGas(items, funcType));
  }, [funcType, numTokens, numRecipients]);

  const funcOptions: Record<string, { value: string; label: string }[]> = {
    swap: [
      { value: "ethToTokens", label: "Swap ETH for Multiple Tokens" },
      { value: "tokensToEth", label: "Swap Multiple Tokens for ETH" },
      { value: "tokensToTokens", label: "Swap Multiple Tokens for Tokens" },
    ],
    send: [
      { value: "singleToken", label: "Distribute Single Token to Multiple Addresses" },
      { value: "multipleTokens", label: "Distribute Multiple Tokens to Multiple Addresses" },
      { value: "multipleTokensSingle", label: "Distribute Multiple Tokens to Single Address" },
      { value: "eth", label: "Distribute ETH to Multiple Addresses" },
    ],
  };

  const showTokens = funcType && !["eth"].includes(funcType);
  const showRecipients = ["singleToken", "multipleTokens", "eth"].includes(funcType);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-8 py-10 space-y-16">

        {/* ═══════════ WHITEPAPER TITLE ═══════════ */}
        <div className="text-center">
          <h1 className="text-3xl sm:text-[40px] font-bold text-white uppercase tracking-wide">MoneyFund Whitepaper</h1>
        </div>

        {/* ═══════════ LAYER KEY ═══════════ */}
        <div className="flex flex-wrap justify-center gap-4">
          {[["Asset Layer", "asset"], ["Distribution Layer", "distribution"], ["Profit Layer", "profit"]].map(([label, key]) => (
            <div key={key} className={`${layerBg(key)} px-5 py-2 rounded-lg text-sm font-bold text-white text-center`}>{label}</div>
          ))}
        </div>

        {/* ═══════════ U-DIAGRAMS ═══════════ */}
        <div className="flex flex-col lg:flex-row items-start justify-center gap-12">
          <UDiagram
            label="Equities"
            boxes={{ left: { label: "Business", layer: "asset" }, bottom: { label: "Shares", layer: "profit" }, right: { label: "Dividends", layer: "distribution" } }}
            desc="Unlike crypto, equities rely on fundamentals more than speculative degeneracy. Equity is made up out of thin air and thus carries ever-present risks like dilution and centralized control. Summary of downsides: high friction, mutable supply, mutable dividends."
          />
          <UDiagram
            label="Shitcoins"
            boxes={{ left: { label: "Tokens", layer: "profit" }, bottom: { label: "Nothing", layer: "none" }, right: { label: "Nothing", layer: "none" } }}
            desc="This diagram represents 99% of cryptocurrencies & the larger problem MoneyFund seeks to solve. Despite significant shortcomings, tokens still outshine equities in many key ways — ERC-20 tokens operate on a decentralized network ensuring trustless & permissionless transacting 24/7 globally. Summary of downsides: people are tired of gay nonsense."
          />
          <UDiagram
            label="MoneyFunds"
            pathEnd="275"
            boxes={{ left: { label: "Business", layer: "asset" }, bottom: { label: "Dividends", layer: "distribution" }, right: { label: "Tokens", layer: "profit" } }}
            desc="MoneyFund combines the sustainability of traditional business with the transparency + decentralization of the Ethereum blockchain. No more expensive IPOs, no more scam ICOs — the future is IMOs. Initial Money Offerings are the gold standard for tokenized asset deployment. Dividend immutability is a significant upgrade to the offchain tradfi model. Summary of downsides: none."
          />
        </div>

        {/* ═══════════ WHERE DOES THE MONEY COME FROM ═══════════ */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white uppercase">Where does the MONEY come from?</h2>
        </div>

        <div className="hidden md:flex justify-center">
          <div className="relative w-[600px] h-[600px] rounded-3xl flex items-center justify-center" style={{ background: "radial-gradient(circle at center, #1a1a1a, #0A0E13)" }}>
            {POOL_BRANCHES.map((b, i) => {
              const angle = (i * Math.PI * 2) / 8;
              const r = 230;
              const x = 300 + r * Math.cos(angle) - 48;
              const y = 300 + r * Math.sin(angle) - 48;
              const bgClass = i % 3 === 0 ? LAYER_COLORS.asset : i % 3 === 1 ? LAYER_COLORS.distribution : LAYER_COLORS.profit;
              return (
                <div key={i} className={`absolute w-24 h-24 rounded-full flex flex-col items-center justify-center text-center text-white text-[10px] font-bold ${bgClass} shadow-lg`} style={{ left: x, top: y }}>
                  <span className="text-xl mb-0.5">{b.icon}</span>
                  <span className="leading-tight">{b.label}</span>
                  <span className="text-[9px] font-normal text-white/60 mt-0.5">{b.pct}</span>
                </div>
              );
            })}
            <div className="w-40 h-40 rounded-full flex flex-col items-center justify-center text-center z-10 animate-pulse" style={{ background: "radial-gradient(circle at 30% 30%, #00f7ff, #004466 60%, #001a33)", boxShadow: "0 0 40px #00f7ff, inset 0 0 20px #003344" }}>
              <span className="text-[22px] font-bold text-amber-400 leading-tight uppercase" style={{ fontFamily: "'Orbitron', sans-serif" }}>MONEY<br />Dividends</span>
              <span className="bg-white text-black font-bold text-xs px-2 py-0.5 rounded mt-1">{divCount}</span>
            </div>
          </div>
        </div>

        {/* mobile pool */}
        <div className="md:hidden grid grid-cols-2 gap-3">
          {POOL_BRANCHES.map((b, i) => {
            const bgClass = i % 3 === 0 ? LAYER_COLORS.asset : i % 3 === 1 ? LAYER_COLORS.distribution : LAYER_COLORS.profit;
            return (
              <div key={i} className={`${bgClass} rounded-xl p-3 text-center text-white text-xs font-bold`}>
                <span className="text-lg">{b.icon}</span>
                <p className="mt-1">{b.label}</p>
                <p className="text-[10px] font-normal text-white/50">{b.pct}</p>
              </div>
            );
          })}
        </div>

        {/* ═══════════ INTRO TEXT ═══════════ */}
        <div className={`${card} p-6 sm:p-8 space-y-4`}>
          <p className="text-sm text-white/70 leading-relaxed">
            The MoneyFund protocol consists of seven interconnected factory smart contracts that are divided into three categories and collectively referred to as the tri-layer launchpad. Smart contracts are digital agreements that run on the blockchain and automatically execute when conditions are met. A factory smart contract is like a vending machine for vending machines — a contract that creates contracts. The tri-layer launchpad enables anyone to codelessly deploy custom smart contracts by filling out simple forms.
          </p>
        </div>

        {/* ═══════════ LAYER CARDS ═══════════ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`${LAYER_COLORS.asset} rounded-xl p-5 text-sm text-white/80 leading-relaxed`}>
            The Asset Layer enables creation of ERC-20 tokens and ETFs. Fed by distribution contracts, this is the destination for value in MF&apos;s trilayer model.
          </div>
          <div className={`${LAYER_COLORS.distribution} rounded-xl p-5 text-sm text-white/80 leading-relaxed`}>
            The Distribution Layer manages token allocations through custom staking pools and DAOs, serving as the vehicle that connects assets to profit layer contracts.
          </div>
          <div className={`${LAYER_COLORS.profit} rounded-xl p-5 text-sm text-white/80 leading-relaxed`}>
            The Profit Layer generates external cashflow via contracts like Multiswap, Storefront, and Auction factories — giving tokens sustainable life through on-chain business.
          </div>
        </div>

        {/* ═══════════ CONTRACT SECTIONS ═══════════ */}
        {CONTRACT_SECTIONS.map((c) => (
          <div key={c.title} className={`${layerBg(c.layer)} rounded-2xl p-6 sm:p-8 space-y-4`}>
            <h3 className="text-xl sm:text-2xl font-bold text-white text-center">{c.title}</h3>
            <div className={`grid ${c.creator ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"} gap-4`}>
              {c.creator && (
                <div className="bg-black/20 rounded-xl p-4">
                  <p className="text-xs font-bold text-white/50 uppercase mb-2">Creator</p>
                  <p className="text-xs text-white/70 leading-relaxed">{c.creator}</p>
                </div>
              )}
              <div className="bg-black/20 rounded-xl p-4">
                <p className="text-xs font-bold text-white/50 uppercase mb-2">User</p>
                <p className="text-xs text-white/70 leading-relaxed">{c.user}</p>
              </div>
            </div>
          </div>
        ))}

        {/* ═══════════ FEE STRUCTURE ═══════════ */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white uppercase">Fee Structure</h2>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-white/80 border-collapse rounded-xl overflow-hidden" style={{ background: "#1F1F1F" }}>
            <thead>
              <tr className="bg-gradient-to-r from-[#4A4A4A] to-[#6B6B6B] text-white text-[11px] uppercase">
                <th className="p-3 text-left">Contract</th>
                <th className="p-3 text-left">Fee Type</th>
                <th className="p-3 text-left">MF Wallet</th>
                <th className="p-3 text-left">MONEY Dividends</th>
                <th className="p-3 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {FEE_DATA.map((r, i) => (
                <tr key={i} className={`${layerBg(r.layer)} border-b border-white/[0.06] hover:brightness-110 transition-all`}>
                  <td className="p-3 font-semibold">{r.contract}</td>
                  <td className="p-3">{r.feeType}</td>
                  <td className="p-3">{r.wallet}</td>
                  <td className="p-3">{r.dividends}</td>
                  <td className="p-3 text-white/50">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* mobile fee cards */}
        <div className="md:hidden space-y-2">
          {FEE_DATA.map((r, i) => (
            <div key={i} className={`${layerBg(r.layer)} rounded-xl p-4 text-xs space-y-1`}>
              <p className="font-bold text-white">{r.contract}</p>
              <p className="text-white/60">{r.feeType} — Wallet: {r.wallet}, Dividends: {r.dividends}</p>
            </div>
          ))}
        </div>

        <div className={`${card} p-5`} style={{ height: 320 }}>
          <canvas ref={feeChartRef} />
        </div>

        {/* ═══════════ FAQ ═══════════ */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white uppercase">Frequently Asked Questions</h2>
        </div>

        <div className={`${card} p-5 space-y-2`}>
          {FAQ_ITEMS.map((item, i) => (
            <div key={i}>
              <button
                type="button"
                onClick={() => toggleFaq(i)}
                className={`w-full flex items-center justify-between text-left px-4 py-3 rounded-lg text-sm font-semibold text-white/80 cursor-pointer transition-all hover:brightness-110 ${layerBg(item.layer)}`}
              >
                <span>{item.q}</span>
                <span className="text-cyan-400 ml-2">{faqOpen[i] ? "−" : "+"}</span>
              </button>
              {faqOpen[i] && (
                <div className="bg-[#333] rounded-lg p-4 mt-1 text-xs text-white/70 leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ═══════════ GAS CALCULATOR ═══════════ */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white uppercase">Multiswap Gas Usage Comparison</h2>
        </div>

        <div className={`${LAYER_COLORS.profit} rounded-2xl p-6 sm:p-8 space-y-5`}>
          <h3 className="text-lg font-bold text-white text-center">Gas Cost Calculator</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-cyan-300 font-medium block mb-1">Operation Type</label>
              <select value={opType} onChange={(e) => { setOpType(e.target.value); setFuncType(""); setGasResult(null); }} className={selectCls}>
                <option value="">-- Select --</option>
                <option value="swap">Swap</option>
                <option value="send">Send</option>
              </select>
            </div>
            {opType && (
              <div>
                <label className="text-xs text-cyan-300 font-medium block mb-1">Function</label>
                <select value={funcType} onChange={(e) => { setFuncType(e.target.value); setGasResult(null); }} className={selectCls}>
                  <option value="">-- Select --</option>
                  {(funcOptions[opType] || []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
            {showTokens && (
              <div>
                <label className="text-xs text-cyan-300 font-medium block mb-1">Number of Tokens</label>
                <input type="number" value={numTokens} onChange={(e) => setNumTokens(parseInt(e.target.value) || 1)} min={1} className={inputCls} />
              </div>
            )}
            {showRecipients && (
              <div>
                <label className="text-xs text-cyan-300 font-medium block mb-1">Number of Recipients</label>
                <input type="number" value={numRecipients} onChange={(e) => setNumRecipients(parseInt(e.target.value) || 1)} min={1} className={inputCls} />
              </div>
            )}
          </div>
          <div className="flex gap-3 justify-center">
            <button type="button" onClick={handleCalc} disabled={!funcType} className={btnPrimary}>Calculate</button>
            <button type="button" onClick={() => { setOpType(""); setFuncType(""); setGasResult(null); setNumTokens(2); setNumRecipients(2); }} className="h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-red-600 to-red-500 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer">Reset</button>
          </div>
          {gasResult && (
            <div className="bg-black/30 rounded-xl p-4 text-xs text-white/70 space-y-1">
              <p>Bundled Gas: <span className="text-white font-semibold">{gasResult.bundled.toLocaleString()}</span> units</p>
              <p>Individual Gas: <span className="text-white font-semibold">{gasResult.individual.toLocaleString()}</span> units</p>
              <p>Gas Savings: <span className="text-emerald-400 font-semibold">{gasResult.savings}%</span></p>
            </div>
          )}
        </div>

        {/* Gas comparison charts */}
        {[
          { id: "cEth2T", label: "Swap ETH for Multiple Tokens" },
          { id: "cT2Eth", label: "Swap Multiple Tokens for ETH" },
          { id: "cT2T", label: "Swap Multiple Tokens for Tokens" },
          { id: "cSingle", label: "Distribute Single Token to Multiple Addresses" },
          { id: "cMulti", label: "Distribute Multiple Tokens to Multiple Addresses" },
          { id: "cMultiS", label: "Distribute Multiple Tokens to Single Address" },
          { id: "cEthD", label: "Distribute ETH to Multiple Addresses" },
        ].map(({ id, label }) => (
          <div key={id} className={`${card} p-5 space-y-2`}>
            <h3 className="text-sm font-bold text-white/70 text-center">{label}</h3>
            <div style={{ height: 280 }}>
              <canvas ref={(el) => { gasChartRefs.current[id] = el; }} />
            </div>
          </div>
        ))}

        <p className="text-center text-[11px] text-white/20 pb-4">Powered by MoneyFund</p>
      </div>
    </div>
  );
}
