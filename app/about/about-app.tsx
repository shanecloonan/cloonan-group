"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

/* ================================================================== */
/*  SECTION MENU DEFINITIONS                                           */
/* ================================================================== */

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "diagrams", label: "U-Diagrams" },
  { id: "dividends", label: "Dividend Pool" },
  { id: "trilayer", label: "Tri-Layer" },
  { id: "contracts", label: "Contracts" },
  { id: "fees", label: "Fee Structure" },
  { id: "faq", label: "FAQ" },
  { id: "gas", label: "Gas Calculator" },
];

/* ================================================================== */
/*  DATA                                                                */
/* ================================================================== */

const POOL_BRANCHES = [
  { label: "Coin Launches", pct: "0.1%", icon: "🚀", layer: "asset" as const },
  { label: "Optional fees", pct: "15%", icon: "🪙", layer: "distribution" as const },
  { label: "ETFs", pct: "0.125%", icon: "📈", layer: "asset" as const },
  { label: "DEX swaps", pct: "0.1%", icon: "💰", layer: "profit" as const },
  { label: "DAOs", pct: "0.25%", icon: "🏛", layer: "distribution" as const },
  { label: "Storefronts", pct: "0.2%", icon: "🛍", layer: "profit" as const },
  { label: "Ad Space", pct: "0.2%", icon: "📰", layer: "profit" as const },
  { label: "Multiswaps", pct: "0.05%", icon: "🔄", layer: "profit" as const },
  { label: "Airdrops", pct: "0.1%", icon: "🎁", layer: "utility" as const },
];

const FEE_DATA = [
  { contract: "Coin Launcher", feeType: "0.2% Launch", wallet: "0.1%", dividends: "0.1%", notes: "Optional: Up to 3% tx fee; MF takes 30% (15% each)", layer: "asset" as const },
  { contract: "ETF Launcher", feeType: "0.35% Transaction", wallet: "0.125%", dividends: "0.125%", notes: "0.1% MONEY burned; Optional: Custom fee to creator", layer: "asset" as const },
  { contract: "Dividend Launcher", feeType: "0.5% Stake/Unstake/Claim", wallet: "0.5%", dividends: "None", notes: "Early unstake penalties to pool creator", layer: "distribution" as const },
  { contract: "DAO Launcher", feeType: "0.5% Swap", wallet: "0.25%", dividends: "0.25%", notes: "-", layer: "distribution" as const },
  { contract: "Storefront Launcher", feeType: "0.4% Sale", wallet: "0.2%", dividends: "0.2%", notes: "99.6% (9960 bps) to custom shareholders", layer: "profit" as const },
  { contract: "Ad Space Launcher", feeType: "0.4% Platform", wallet: "0.2%", dividends: "0.2%", notes: "$1 USD comment fee to highest bidder", layer: "profit" as const },
  { contract: "Multiswap Launcher", feeType: "0.1% Primary", wallet: "0.05%", dividends: "0.05%", notes: "Optional: Up to 3% to custom receivers", layer: "profit" as const },
  { contract: "MoneyFund DEX", feeType: "0.5% Swap", wallet: "0.1%", dividends: "0.1%", notes: "0.3% to liquidity providers", layer: "dex" as const },
  { contract: "MoneyFund Airdrop", feeType: "0.2% Airdrop", wallet: "0.1%", dividends: "0.1%", notes: "Per batch distribution", layer: "utility" as const },
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
  { q: "How does the Multisig Launcher work?", a: "The Multisig Launcher deploys multi-signature wallets that require M-of-N signers to approve any transaction. Creators specify the signer addresses and the confirmation threshold. Supported operations include ETH transfers, ERC-20 transfers, and arbitrary contract calls. This enables teams, DAOs, or any group to manage shared assets securely without a single point of failure.", layer: "distribution" as const },
  { q: "How does the MoneyFund Airdrop work?", a: "The Airdrop contract allows batch distribution of ERC-20 tokens to multiple recipients in a single transaction. Users choose between uniform mode (same amount to everyone) or individual mode (custom amounts per recipient). It includes a master contact list, custom lists, leaderboard tracking, and full airdrop history. A 0.2% fee applies per batch, split between MoneyFund Wallet and MONEY Dividends.", layer: "utility" as const },
  { q: "Is MoneyFund open-source?", a: "MoneyFund's smart contracts will be open-sourced once the platform reaches a $1 million market cap, releasing all 62,000 lines of code for public audit. Until then, all contract actions are transparent on-chain via public functions and event logs.", layer: undefined },
  { q: "Is MoneyFund secure?", a: "Yes, MoneyFund uses non-custodial wallets where users retain full control of their private keys. Contracts use ReentrancyGuard and follow best practices for secure execution.", layer: undefined },
  { q: "Who created MoneyFund?", a: "My name is Shane — I'm the owner & only employee.", layer: undefined },
];

const CONTRACT_SECTIONS = [
  { title: "Coin Launcher", layer: "asset" as const, creator: "Set name, ticker, total supply, and optional transaction fees (up to 3%), with 70% going to your chosen wallets and 30% split equally between MoneyFund Wallet and MONEY Dividends. A 0.2% launch fee applies, also split equally.", user: "Send tokens, approve spending, and check balances. All standard ERC-20 functions supported." },
  { title: "ETF Launcher", layer: "asset" as const, creator: "Build an ETF fund by selecting ERC-20 tokens and setting their percentage allocations (summing to 100%). Choose a name, ticker, and optional transaction fee. The fund uses Uniswap V2 for swaps and Chainlink for ETH/USD pricing. 0.35% transaction fee with 0.125% each to MoneyFund Wallet and MONEY Dividends, 0.1% to burn MONEY tokens.", user: "Deposit ETH to mint ETF shares, burn shares to get ETH back, or withdraw underlying tokens. Check fund details, token balances, share prices, and performance metrics." },
  { title: "Dividend Launcher", layer: "distribution" as const, creator: "Set up a staking pool for an ERC-20 token, defining lock duration, initial penalty for early withdrawal, and daily penalty reduction (up to 365 days). Each stake issues a unique NFT (ERC-721) for tracking. A 0.5% fee applies to staking, unstaking, and reward claims.", user: "Deposit tokens to stake and receive a unique NFT. Claim dividends in ETH or ERC-20 tokens based on your share of the pool. Unstake tokens after the lock period, or earlier with a penalty." },
  { title: "DAO Launcher", layer: "distribution" as const, creator: "Launch a DAO with an ERC-20 token for voting, setting voting period, mode (Rape or Standard), locked token percentage, approval threshold, daily proposal limit, and slippage for swaps. 0.5% fee on executed swaps splits equally between MoneyFund Wallet and MONEY Dividends.", user: "Propose token swaps (ETH-to-ERC20 or ERC20-to-ETH), vote on proposals with locked tokens, reclaim tokens after voting, and execute approved proposals." },
  { title: "Multisig Launcher", layer: "distribution" as const, creator: "Deploy a multi-signature wallet by specifying required signers and confirmation threshold (M-of-N). Choose which addresses can propose, confirm, and execute transactions. Supports ETH transfers, ERC-20 token transfers, and arbitrary contract calls — all requiring the configured number of approvals before execution.", user: "Submit transactions for group approval, confirm or revoke pending transactions, and execute once the required threshold is met. View pending and executed transaction history, check signer status, and manage shared treasury assets securely without any single point of failure." },
  { title: "Storefront Launcher", layer: "profit" as const, creator: "Create an NFT marketplace by setting shareholder wallets and profit shares (up to 99.6%). Deposit and list ERC-721 NFTs with price in ETH or ERC-20 tokens, with timelock for listings. 0.4% sale fee splits equally between MoneyFund Wallet and MONEY Dividends.", user: "Buy NFTs from the marketplace using ETH or ERC-20 tokens. Check listing details, sales statistics, and profit distributions." },
  { title: "Ad Space Launcher", layer: "profit" as const, creator: "Launch a continuous ad auction by setting refund percentage (0-100%), fee receivers, starting bid, minimum bid increment, ad lock duration, comment fee, and payment token. 0.4% bid fee splits equally between MoneyFund Wallet and MONEY Dividends.", user: "Bid on ad space with ETH or ERC-20 tokens. If highest bidder, adjust comment fees, message length, or payment token. Comment on ads by paying a fee (minimum $1 USD)." },
  { title: "Multiswap Launcher", layer: "profit" as const, creator: "Build a trading platform for swapping and distributing tokens/ETH, with optional fees up to 3%. 0.1% platform fee splits equally between MoneyFund Wallet and MONEY Dividends. Embed as a widget on any website.", user: "Swap ETH for tokens, tokens for ETH/tokens, including batch swaps. Distribute tokens/ETH to one or multiple recipients in a single transaction." },
  { title: "MoneyFund DEX", layer: "dex" as const, creator: "", user: "A custom-built automated market maker (AMM) for swapping ETH and ERC-20 tokens. Unlike Multiswap (which routes through Uniswap), the DEX maintains its own liquidity pools and constant-product pricing. Users add or remove liquidity to earn 0.3% swap fees. Total 0.5% swap fee: 0.3% to LPs, 0.1% each to MoneyFund Wallet and MONEY Dividends." },
  { title: "MoneyFund Airdrop", layer: "utility" as const, creator: "", user: "A batch token distribution tool for sending ERC-20 tokens to multiple recipients in a single transaction. Supports uniform amounts (same amount to everyone) and individual amounts (custom per-recipient). Includes a master contact list, custom lists, leaderboard tracking, and airdrop history. A 0.2% fee applies to each airdrop." },
];

/* ================================================================== */
/*  GAS CALCULATOR                                                     */
/* ================================================================== */

function calcGas(n: number, type: string) {
  let b: number, ind: number;
  switch (type) {
    case "ethToTokens": case "tokensToEth": case "tokensToTokens":
      b = 21000 + 3500 + 6500 + n * 85000 + (n - 1) * 1000; ind = n * (21000 + 85000); break;
    case "singleToken":
      b = 21000 + 3500 + n * 35000 + (n - 1) * 1000; ind = n * (21000 + 35000); break;
    case "multipleTokens":
      b = 21000 + 3500 + n * n * 35000 + (n * n - 1) * 1000; ind = n * n * (21000 + 35000); break;
    case "multipleTokensSingle":
      b = 21000 + 3500 + n * 35000 + (n - 1) * 1000; ind = n * (21000 + 35000); break;
    case "eth":
      b = 21000 + 3500 + n * 16000 + (n - 1) * 1000; ind = n * (21000 + 16000); break;
    default: return { bundled: 0, individual: 0, savings: "0" };
  }
  return { bundled: b, individual: ind, savings: ind > 0 ? ((ind - b) / ind * 100).toFixed(2) : "0" };
}

/* ================================================================== */
/*  DESIGN TOKENS                                                      */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnCalc = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-teal-600 to-teal-500 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer";

function layerBg(l?: string) {
  if (l === "asset") return "bg-gradient-to-br from-[#1A3C34] to-[#1F4A40]";
  if (l === "distribution") return "bg-gradient-to-br from-[#8B3A2B] to-[#A65343]";
  if (l === "profit") return "bg-gradient-to-br from-[#3F2A6D] to-[#4B367E]";
  if (l === "dex") return "bg-gradient-to-br from-[#3A3A3A] to-[#4A4A4A]";
  if (l === "utility") return "bg-gradient-to-br from-[#2A3A5C] to-[#354A6E]";
  return "bg-white/[0.04]";
}

function layerDot(l?: string) {
  if (l === "asset") return "bg-emerald-400";
  if (l === "distribution") return "bg-orange-400";
  if (l === "profit") return "bg-purple-400";
  if (l === "dex") return "bg-gray-400";
  if (l === "utility") return "bg-sky-400";
  return "bg-white/30";
}

/* ================================================================== */
/*  U-DIAGRAM                                                          */
/* ================================================================== */

function UDiagram({ label, boxes, desc, pathEnd, descSize, prefix = "u" }: {
  label: string;
  boxes: { left: { label: string; layer: string }; bottom: { label: string; layer: string }; right: { label: string; layer: string } };
  desc: string;
  pathEnd?: string;
  descSize?: string;
  prefix?: string;
}) {
  const rightDollar = boxes.right.layer !== "none";
  const xEnd = pathEnd === "275" ? 275 : 260;
  const pathD = `M60,60 V210 H${xEnd} V60`;
  const boxFill = (layer: string) => {
    if (layer === "asset") return `url(#${prefix}-al)`;
    if (layer === "distribution") return `url(#${prefix}-dl)`;
    if (layer === "profit") return `url(#${prefix}-pl)`;
    if (layer === "none") return "none";
    return "#000";
  };
  const boxStroke = (layer: string) => layer === "none" ? "rgba(255,255,255,0.2)" : "#fff";
  const boxStrokeDash = (layer: string) => layer === "none" ? "4 3" : undefined;

  return (
    <div className="flex flex-col items-center w-full max-w-[320px] mx-auto">
      <p className="text-base font-bold text-white mb-2 text-center">{label}</p>
      <div className={`${card} p-4 w-full`}>
        <svg viewBox="0 0 320 250" className="w-full h-auto" aria-label={`${label} U Diagram`}>
          <defs>
            <marker id={`${prefix}-ae`} markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="white" /></marker>
            <marker id={`${prefix}-ai`} markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="white" /></marker>
            <linearGradient id={`${prefix}-al`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#3F2A6D" /><stop offset="100%" stopColor="#4B367E" /></linearGradient>
            <linearGradient id={`${prefix}-dl`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#8B3A2B" /><stop offset="100%" stopColor="#A65343" /></linearGradient>
            <linearGradient id={`${prefix}-pl`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#1A3C34" /><stop offset="100%" stopColor="#1F4A40" /></linearGradient>
          </defs>
          {/* U-shaped flow path */}
          <path d={pathD} fill="none" stroke="white" strokeWidth="3" markerEnd={`url(#${prefix}-ae)`} />
          {/* Animated gold coins traveling along the path */}
          <circle r="6" fill="gold"><animateMotion dur="3s" repeatCount="indefinite" path={pathD} /></circle>
          {rightDollar && <circle r="6" fill="gold"><animateMotion dur="3s" repeatCount="indefinite" path={pathD} begin="1.5s" /></circle>}
          {/* Flow direction labels on the path */}
          <text x="46" y="170" fill="rgba(255,255,255,0.25)" fontSize="8" textAnchor="middle" dominantBaseline="middle" transform="rotate(-90,46,170)">value in</text>
          <text x={xEnd + 14} y="170" fill="rgba(255,255,255,0.25)" fontSize="8" textAnchor="middle" dominantBaseline="middle" transform={`rotate(90,${xEnd + 14},170)`}>value out</text>
          {/* Left box — connected from $ coin above */}
          <rect x="30" y="110" width="60" height="40" rx="8" ry="8" fill={boxFill(boxes.left.layer)} stroke={boxStroke(boxes.left.layer)} strokeWidth="2" strokeDasharray={boxStrokeDash(boxes.left.layer)} />
          <text x="60" y="130" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{boxes.left.label}</text>
          <line x1="60" y1="70" x2="60" y2="110" stroke="white" strokeWidth="2" markerEnd={`url(#${prefix}-ai)`} />
          {/* Bottom box — connected from horizontal segment of U */}
          <rect x="130" y="190" width="60" height="40" rx="8" ry="8" fill={boxFill(boxes.bottom.layer)} stroke={boxStroke(boxes.bottom.layer)} strokeWidth="2" strokeDasharray={boxStrokeDash(boxes.bottom.layer)} />
          <text x="160" y="210" fill={boxes.bottom.layer === "none" ? "rgba(255,255,255,0.35)" : "white"} fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{boxes.bottom.label}</text>
          <line x1="110" y1="210" x2="130" y2="210" stroke="white" strokeWidth="2" markerEnd={`url(#${prefix}-ai)`} />
          {/* Right box — connected from ascending segment of U */}
          <rect x={xEnd - 30} y="110" width="60" height="40" rx="8" ry="8" fill={boxFill(boxes.right.layer)} stroke={boxStroke(boxes.right.layer)} strokeWidth="2" strokeDasharray={boxStrokeDash(boxes.right.layer)} />
          <text x={xEnd} y="130" fill={boxes.right.layer === "none" ? "rgba(255,255,255,0.35)" : "white"} fontSize={boxes.right.label.length > 7 ? "8" : "10"} fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{boxes.right.label}</text>
          <line x1={xEnd} y1="170" x2={xEnd} y2="150" stroke="white" strokeWidth="2" markerEnd={`url(#${prefix}-ai)`} />
          {/* Input $ coin (top-left) */}
          <circle cx="60" cy="50" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
          <text x="60" y="50" fill="black" fontSize="20" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
          {/* Output coins (top-right) */}
          {rightDollar ? (<>
            <circle cx={xEnd - 15} cy="40" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x={xEnd - 15} y="40" fill="black" fontSize="20" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
            <circle cx={xEnd + 15} cy="40" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x={xEnd + 15} y="40" fill="black" fontSize="20" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
          </>) : (<>
            <circle cx={xEnd} cy="40" r="15" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeDasharray="4 3" />
            <text x={xEnd} y="40" fill="rgba(255,255,255,0.4)" fontSize="16" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">?</text>
          </>)}
        </svg>
      </div>
      <p className={`max-w-[300px] text-center ${descSize || "text-[11px]"} text-white/40 leading-relaxed mt-3`}>{desc}</p>
    </div>
  );
}

/* ================================================================== */
/*  ANIMATED COIN COMPONENT for Dividend Pool                          */
/* ================================================================== */

function AnimatedCoins({ branchIndex, total }: { branchIndex: number; total: number }) {
  const angle = (branchIndex * Math.PI * 2) / total;
  const r = 220;
  const sx = 300 + r * Math.cos(angle);
  const sy = 300 + r * Math.sin(angle);
  const delays = useMemo(() => [0, 1.2, 2.5, 3.8], []);

  return (<>
    {delays.map((d, ci) => (
      <circle key={ci} r="8" fill="gold" opacity="0.9" filter="url(#coinGlow)">
        <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${d}s`} fill="freeze" path={`M${sx},${sy} L300,300`} />
        <animate attributeName="opacity" values="0.9;0.9;0" keyTimes="0;0.7;1" dur="2.5s" repeatCount="indefinite" begin={`${d}s`} />
        <animate attributeName="r" values="8;6;2" keyTimes="0;0.8;1" dur="2.5s" repeatCount="indefinite" begin={`${d}s`} />
      </circle>
    ))}
  </>);
}

/* ================================================================== */
/*  SECTION HEADING                                                    */
/* ================================================================== */

function SectionHeading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="text-center space-y-1 pt-4">
      <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{children}</h2>
      {sub && <p className="text-xs text-white/30">{sub}</p>}
      <div className="mx-auto mt-3 w-16 h-[2px] rounded-full bg-gradient-to-r from-cyan-500/60 to-purple-500/60" />
    </div>
  );
}

/* ================================================================== */
/*  FLOW DIAGRAM PRIMITIVES                                            */
/* ================================================================== */

function Node({
  icon,
  label,
  sub,
  color = "border-white/10",
  glow,
  size = "md",
}: {
  icon: string;
  label: string;
  sub?: string;
  color?: string;
  glow?: string;
  size?: "sm" | "md" | "lg";
}) {
  const pad = size === "sm" ? "px-3 py-2" : size === "lg" ? "px-5 py-4" : "px-4 py-3";
  const iconSize = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";
  const labelSize = size === "sm" ? "text-[10px]" : "text-xs";
  return (
    <div
      className={`${pad} rounded-xl border ${color} bg-white/[0.03] flex flex-col items-center gap-1 min-w-[60px] sm:min-w-[80px] relative`}
      style={glow ? { boxShadow: `0 0 20px 2px ${glow}` } : undefined}
    >
      <span className={iconSize}>{icon}</span>
      <span className={`${labelSize} font-semibold text-white/80 text-center leading-tight`}>
        {label}
      </span>
      {sub && (
        <span className="text-[9px] text-white/30 text-center leading-tight">{sub}</span>
      )}
    </div>
  );
}

function Arrow({
  dir = "right",
  label,
  color = "text-white/40",
  dashed,
}: {
  dir?: "right" | "down" | "left" | "up";
  label?: string;
  color?: string;
  dashed?: boolean;
}) {
  const arrows: Record<string, string> = { right: "→", down: "↓", left: "←", up: "↑" };
  const isVert = dir === "down" || dir === "up";
  return (
    <div
      className={`flex ${isVert ? "flex-col" : "flex-col sm:flex-row"} items-center gap-0.5 ${color} shrink-0`}
    >
      {label && (
        <span className="text-[9px] text-white/30 font-medium whitespace-nowrap max-w-[140px] sm:max-w-none truncate sm:truncate-none">
          {label}
        </span>
      )}
      <div
        className={`flex items-center justify-center ${
          isVert ? "h-6 w-px" : "h-4 w-px sm:h-px sm:w-8"
        }`}
      >
        <div
          className={`${isVert ? "w-px h-full" : "w-px h-full sm:w-full sm:h-px"} ${
            dashed ? "border-dashed" : ""
          }`}
          style={{
            background: dashed
              ? undefined
              : "currentColor",
            borderTop: dashed && !isVert ? "1px dashed currentColor" : undefined,
            borderLeft: dashed && isVert ? "1px dashed currentColor" : undefined,
          }}
        />
      </div>
      <span className={`text-sm font-bold ${isVert ? "" : "hidden sm:inline"}`}>{arrows[dir]}</span>
      <span className={`text-sm font-bold sm:hidden ${isVert ? "hidden" : ""}`}>{arrows.down}</span>
    </div>
  );
}

function FlowRow({
  children,
  wrap,
}: {
  children: React.ReactNode;
  wrap?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center gap-2 ${
        wrap ? "flex-col sm:flex-row" : ""
      }`}
    >
      {children}
    </div>
  );
}

function FlowCol({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">{children}</div>
  );
}

function Badge({
  text,
  color = "bg-white/5 text-white/40",
}: {
  text: string;
  color?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold ${color}`}
    >
      {text}
    </span>
  );
}

function SectionTitle({
  icon,
  title,
  sub,
  accent,
}: {
  icon: string;
  title: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <span className="text-3xl">{icon}</span>
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white/90">{title}</h2>
        <p className={`text-xs mt-0.5 ${accent}`}>{sub}</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PENALTY TIMELINE VISUAL                                            */
/* ================================================================== */

function PenaltyTimeline({
  hardLock,
  initPenalty,
  decayPerDay,
}: {
  hardLock: number;
  initPenalty: number;
  decayPerDay: number;
}) {
  const breakeven = decayPerDay > 0 ? hardLock + initPenalty / decayPerDay : 0;
  const totalDays = Math.ceil(breakeven * 1.15) || 30;
  const segments = 40;

  const points = useMemo(() => {
    const pts: { day: number; penalty: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const day = (i / segments) * totalDays;
      let penalty: number;
      if (day < hardLock) {
        penalty = 100;
      } else {
        const elapsed = day - hardLock;
        penalty = Math.max(0, initPenalty - elapsed * decayPerDay);
      }
      pts.push({ day, penalty });
    }
    return pts;
  }, [hardLock, initPenalty, decayPerDay, totalDays]);

  const hardLockPct = (hardLock / totalDays) * 100;
  const breakevenPct = (breakeven / totalDays) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] text-white/40 font-semibold uppercase tracking-wider">
        <span>Penalty Decay Timeline</span>
        <span className="text-white/40">|</span>
        <span>
          Breakeven: <span className="text-emerald-400">{breakeven.toFixed(1)} days</span>
        </span>
      </div>

      <div className="relative h-28 rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-red-500/[0.06] border-r border-red-500/20"
          style={{ width: `${hardLockPct}%` }}
        />
        <div
          className="absolute top-0 h-full border-r border-dashed border-emerald-500/30"
          style={{ left: `${Math.min(breakevenPct, 100)}%` }}
        />

        <svg
          viewBox={`0 0 ${segments} 100`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          <defs>
            <linearGradient id="penGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgb(239,68,68)" stopOpacity="0.6" />
              <stop offset="50%" stopColor="rgb(245,158,11)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="penFill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgb(239,68,68)" stopOpacity="0.08" />
              <stop offset="50%" stopColor="rgb(245,158,11)" stopOpacity="0.04" />
              <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path
            d={
              `M 0 ${100 - points[0].penalty} ` +
              points
                .map((p, i) => `L ${i} ${100 - p.penalty}`)
                .join(" ") +
              ` L ${segments} 100 L 0 100 Z`
            }
            fill="url(#penFill)"
          />
          <path
            d={
              `M 0 ${100 - points[0].penalty} ` +
              points.map((p, i) => `L ${i} ${100 - p.penalty}`).join(" ")
            }
            fill="none"
            stroke="url(#penGrad)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="absolute bottom-1 left-1 text-[9px] text-red-400/60 font-semibold">
          LOCKED
        </div>
        <div
          className="absolute bottom-1 text-[9px] text-emerald-400/60 font-semibold"
          style={{ left: `${Math.min(breakevenPct, 98)}%` }}
        >
          0% PENALTY
        </div>
        <div className="absolute top-1 right-2 text-[9px] text-white/40">
          Day 0 → {totalDays.toFixed(0)}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-500/40" /> Hard Lock ({hardLock}d)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-500/40" /> Penalty Decay (−{decayPerDay}%/day)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-emerald-500/40" /> Penalty-free
        </span>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  ARCHITECTURE DIAGRAM SECTIONS                                      */
/* ================================================================== */

function DividendArchitecture() {
  const [h, setH] = useState(7);
  const [p, setP] = useState(30);
  const [d, setD] = useState(1);

  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🥩"
        title="Dividend Launcher"
        sub="ERC-721 staking pools with time-locked rewards and penalty mechanics"
        accent="text-purple-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-6`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Architecture Overview
        </h3>
        <div className="flex flex-col items-center gap-1">
          <div className="sm:hidden flex flex-col items-center gap-1">
            <Node icon="👤" label="Pool Creator" color="border-purple-500/20" glow="rgba(168,85,247,0.08)" />
            <Arrow dir="down" label="createPool()" color="text-purple-400/40" />
            <Node icon="🏭" label="Factory" sub="0x5ef0...128a" color="border-indigo-500/20" glow="rgba(99,102,241,0.08)" />
            <Arrow dir="down" label="deploys" color="text-indigo-400/40" />
            <Node icon="🥩" label="Staking Pool" sub="per-token" color="border-purple-500/20" glow="rgba(168,85,247,0.1)" size="lg" />
          </div>
          <div className="hidden sm:block">
            <FlowRow>
              <Node icon="👤" label="Pool Creator" color="border-purple-500/20" glow="rgba(168,85,247,0.08)" />
              <Arrow label="createPool()" color="text-purple-400/40" />
              <Node icon="🏭" label="Factory" sub="0x5ef0...128a" color="border-indigo-500/20" glow="rgba(99,102,241,0.08)" />
              <Arrow label="deploys" color="text-indigo-400/40" />
              <Node icon="🥩" label="Staking Pool" sub="per-token" color="border-purple-500/20" glow="rgba(168,85,247,0.1)" size="lg" />
            </FlowRow>
          </div>
          <div className="text-[10px] text-white/40 py-2">Factory creates one pool per ERC-20 token with configurable penalty parameters</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-lg">
            {[
              { label: "token", desc: "ERC-20 address" },
              { label: "hardLock", desc: "Lock duration" },
              { label: "initPenalty", desc: "Starting penalty %" },
              { label: "decayRate", desc: "Daily reduction %" },
            ].map((p) => (
              <div
                key={p.label}
                className="text-center px-3 py-2 rounded-lg bg-purple-500/[0.05] border border-purple-500/10"
              >
                <div className="text-[10px] font-mono text-purple-400/80">{p.label}</div>
                <div className="text-[9px] text-white/30 mt-0.5">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Staking Flow — Tokens → NFT Receipt
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Staker" color="border-blue-500/20" />
            <Arrow label="approve(pool, amount)" color="text-blue-400/40" />
            <Node icon="🪙" label="ERC-20 Token" color="border-amber-500/20" />
          </FlowRow>
          <Arrow dir="down" label="then" color="text-white/40" />
          <FlowRow wrap>
            <Node icon="👤" label="Staker" color="border-blue-500/20" />
            <Arrow label="stake(amount)" color="text-purple-400/40" />
            <Node icon="🥩" label="Pool" color="border-purple-500/20" glow="rgba(168,85,247,0.06)" />
          </FlowRow>
          <Arrow dir="down" label="pool executes" color="text-white/40" />
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <FlowRow wrap>
              <Node icon="🪙" label="Tokens" sub="transferFrom" color="border-amber-500/20" size="sm" />
              <Arrow label="locked in" color="text-amber-400/30" />
              <Node icon="🔒" label="Pool Vault" color="border-amber-500/20" size="sm" />
            </FlowRow>
            <span className="text-white/10 text-lg">+</span>
            <FlowRow wrap>
              <Node icon="🥩" label="Pool" color="border-purple-500/20" size="sm" />
              <Arrow label="mint()" color="text-emerald-400/30" />
              <Node icon="🎫" label="NFT Receipt" sub="ERC-721" color="border-emerald-500/20" glow="rgba(16,185,129,0.06)" size="sm" />
            </FlowRow>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Badge text="0.5% Fee → MoneyFund Wallet" color="bg-purple-500/10 text-purple-400/60" />
            <Badge text="NFT = tradeable on OpenSea" color="bg-emerald-500/10 text-emerald-400/60" />
          </div>
        </div>
      </div>

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Reward Distribution — Proportional to Stake Share
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="Ξ" label="ETH" sub="receive()" color="border-sky-500/20" size="sm" />
            <Node icon="🪙" label="ERC-20" sub="transfer()" color="border-amber-500/20" size="sm" />
            <Arrow label="sent to pool" color="text-sky-400/30" />
            <Node icon="🥩" label="Reward Pool" color="border-purple-500/20" glow="rgba(168,85,247,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="distributed by share" color="text-white/40" />
          <div className="grid grid-cols-3 gap-3 w-full max-w-md">
            {[
              { pct: "50%", tokens: "5,000", total: "10,000" },
              { pct: "30%", tokens: "3,000", total: "10,000" },
              { pct: "20%", tokens: "2,000", total: "10,000" },
            ].map((s, i) => (
              <div
                key={i}
                className="text-center px-2 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
              >
                <div className="text-lg mb-1">🎫</div>
                <div className="text-xs font-bold text-purple-400">{s.pct}</div>
                <div className="text-[9px] text-white/40 mt-0.5">
                  {s.tokens} / {s.total}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-white/40 text-center">
            reward = (userStake / totalStaked) × rewardBalance
          </div>
          <FlowRow wrap>
            <Node icon="🎫" label="NFT Holder" color="border-emerald-500/20" size="sm" />
            <Arrow label="claimAllRewards(tokenId)" color="text-emerald-400/30" />
            <Node icon="💰" label="ETH + Tokens" sub="rewards sent" color="border-sky-500/20" size="sm" />
          </FlowRow>
          <Badge text="0.5% claim fee → MoneyFund Wallet" color="bg-purple-500/10 text-purple-400/60" />
        </div>
      </div>

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Unstaking — NFT Burn + Penalty Mechanics
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="🎫" label="NFT" sub="ERC-721" color="border-emerald-500/20" />
            <Arrow label="unstake(tokenId)" color="text-red-400/40" />
            <Node icon="🥩" label="Pool" color="border-purple-500/20" />
          </FlowRow>
          <Arrow dir="down" label="pool executes" color="text-white/40" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
            <div className="text-center px-3 py-3 rounded-xl bg-red-500/[0.04] border border-red-500/10">
              <div className="text-lg mb-1">🔥</div>
              <div className="text-[10px] font-semibold text-red-400/80">NFT Burned</div>
              <div className="text-[9px] text-white/40 mt-0.5">Receipt destroyed</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/10">
              <div className="text-lg mb-1">💰</div>
              <div className="text-[10px] font-semibold text-emerald-400/80">Tokens Returned</div>
              <div className="text-[9px] text-white/40 mt-0.5">amount − penalty</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/10">
              <div className="text-lg mb-1">⚠️</div>
              <div className="text-[10px] font-semibold text-amber-400/80">Penalty</div>
              <div className="text-[9px] text-white/40 mt-0.5">→ Pool Creator</div>
            </div>
          </div>

          <div className="w-full max-w-lg px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04] text-center">
            <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-2">
              Penalty Formula
            </div>
            <div className="text-sm font-mono text-amber-400/80">
              penalty = initPenalty − (daysAfterLock × decayPerDay)
            </div>
            <div className="text-sm font-mono text-emerald-400/80 mt-1">
              breakeven = hardLock + (initPenalty / decayPerDay)
            </div>
          </div>
        </div>
      </div>

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Interactive Penalty Timeline
        </h3>
        <div className="grid grid-cols-3 gap-3 max-w-md">
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider font-semibold block mb-1">
              Hard Lock (days)
            </label>
            <input
              type="range"
              min={0}
              max={60}
              value={h}
              onChange={(e) => setH(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="text-xs text-purple-400 text-center mt-0.5">{h}</div>
          </div>
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider font-semibold block mb-1">
              Init Penalty (%)
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={p}
              onChange={(e) => setP(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="text-xs text-amber-400 text-center mt-0.5">{p}%</div>
          </div>
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider font-semibold block mb-1">
              Decay/Day (%)
            </label>
            <input
              type="range"
              min={0.1}
              max={10}
              step={0.1}
              value={d}
              onChange={(e) => setD(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <div className="text-xs text-emerald-400 text-center mt-0.5">{d}%</div>
          </div>
        </div>
        <PenaltyTimeline hardLock={h} initPenalty={p} decayPerDay={d} />
      </div>

      <div className={`${card} p-5 sm:p-6 space-y-4`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          ERC-721 Receipt NFT — Lifecycle
        </h3>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            { step: "1", icon: "🪙", title: "Stake Tokens", desc: "Deposit ERC-20 into pool", color: "border-blue-500/15" },
            { step: "2", icon: "🎫", title: "NFT Minted", desc: "Unique ERC-721 receipt", color: "border-emerald-500/15" },
            { step: "3", icon: "🔄", title: "Tradeable", desc: "Sell/transfer on OpenSea", color: "border-indigo-500/15" },
            { step: "4", icon: "💰", title: "Claim Rewards", desc: "NFT holder earns dividends", color: "border-amber-500/15" },
            { step: "5", icon: "🔥", title: "Unstake & Burn", desc: "Tokens returned, NFT destroyed", color: "border-red-500/15" },
          ].map((s) => (
            <div
              key={s.step}
              className={`w-28 px-3 py-3 rounded-xl bg-white/[0.02] border ${s.color} text-center`}
            >
              <div className="text-[9px] text-white/40 font-bold mb-1">STEP {s.step}</div>
              <div className="text-xl mb-1">{s.icon}</div>
              <div className="text-[11px] font-semibold text-white/70">{s.title}</div>
              <div className="text-[9px] text-white/40 mt-0.5">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EtfArchitecture() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="📈"
        title="ETF Launcher"
        sub="Weighted token baskets with Uniswap V2 swaps and Chainlink pricing"
        accent="text-amber-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Create → Mint → Burn Flow
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Creator" color="border-amber-500/20" />
            <Arrow label="createETF(name, symbol, tokens[], weights[])" color="text-amber-400/40" />
            <Node icon="🏭" label="ETF Manager" color="border-amber-500/20" glow="rgba(245,158,11,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="deploys ERC-20 share token" color="text-white/40" />
          <Node icon="📈" label="ETF Token" sub="ERC-20 shares" color="border-amber-500/20" glow="rgba(245,158,11,0.06)" size="lg" />
        </div>

        <div className="text-center space-y-2">
          <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
            Weighted Token Basket
          </div>
          <div className="flex justify-center gap-2 flex-wrap">
            {[
              { sym: "WETH", pct: "40%", color: "bg-blue-500/10 text-blue-400/80 border-blue-500/15" },
              { sym: "USDC", pct: "25%", color: "bg-green-500/10 text-green-400/80 border-green-500/15" },
              { sym: "LINK", pct: "20%", color: "bg-indigo-500/10 text-indigo-400/80 border-indigo-500/15" },
              { sym: "UNI", pct: "15%", color: "bg-pink-500/10 text-pink-400/80 border-pink-500/15" },
            ].map((t) => (
              <div
                key={t.sym}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold ${t.color}`}
              >
                {t.sym} {t.pct}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`${card} p-5 space-y-3`}>
          <h4 className="text-xs font-bold text-emerald-400/80 uppercase tracking-wider">Mint (Buy In)</h4>
          <FlowCol>
            <FlowRow>
              <Node icon="Ξ" label="ETH" color="border-sky-500/20" size="sm" />
              <Arrow label="mintWithEth()" color="text-emerald-400/30" />
              <Node icon="🏭" label="Manager" color="border-amber-500/20" size="sm" />
            </FlowRow>
            <Arrow dir="down" color="text-emerald-400/20" />
            <div className="text-center text-[9px] text-white/40">
              Uniswap V2 swaps ETH → underlying tokens
            </div>
            <Arrow dir="down" color="text-emerald-400/20" />
            <FlowRow>
              <Node icon="📈" label="ETF Shares" sub="minted to user" color="border-emerald-500/20" size="sm" />
            </FlowRow>
          </FlowCol>
          <Badge text="0.35% fee: 0.125% wallet + 0.125% dividends + 0.1% MONEY burn" color="bg-amber-500/10 text-amber-400/60" />
        </div>

        <div className={`${card} p-5 space-y-3`}>
          <h4 className="text-xs font-bold text-red-400/80 uppercase tracking-wider">Burn (Redeem)</h4>
          <FlowCol>
            <FlowRow>
              <Node icon="📈" label="ETF Shares" color="border-amber-500/20" size="sm" />
              <Arrow label="burn()" color="text-red-400/30" />
              <Node icon="🏭" label="Manager" color="border-amber-500/20" size="sm" />
            </FlowRow>
            <Arrow dir="down" color="text-red-400/20" />
            <div className="text-center text-[9px] text-white/40">
              Underlying tokens sold → ETH via Uniswap
            </div>
            <Arrow dir="down" color="text-red-400/20" />
            <FlowRow>
              <Node icon="Ξ" label="ETH" sub="returned to user" color="border-sky-500/20" size="sm" />
            </FlowRow>
          </FlowCol>
          <Badge text="Shares burned, proportional ETH returned" color="bg-red-500/10 text-red-400/60" />
        </div>
      </div>
    </section>
  );
}

function DaoArchitecture() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🗳️"
        title="DAO Launcher"
        sub="On-chain governance with token-weighted voting and proposal execution"
        accent="text-sky-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Proposal Lifecycle
        </h3>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            { step: "1", icon: "📝", title: "Create Proposal", desc: "Send ETH or swap tokens", color: "border-sky-500/15" },
            { step: "2", icon: "🗳️", title: "Voting Period", desc: "Token holders vote Yes/No", color: "border-indigo-500/15" },
            { step: "3", icon: "⏱️", title: "Period Ends", desc: "Votes tallied by weight", color: "border-amber-500/15" },
            { step: "4", icon: "⚡", title: "Execute", desc: "If majority reached", color: "border-emerald-500/15" },
            { step: "5", icon: "🔓", title: "Reclaim", desc: "Unlock voting tokens", color: "border-purple-500/15" },
          ].map((s) => (
            <div
              key={s.step}
              className={`w-28 px-3 py-3 rounded-xl bg-white/[0.02] border ${s.color} text-center`}
            >
              <div className="text-[9px] text-white/40 font-bold mb-1">STEP {s.step}</div>
              <div className="text-xl mb-1">{s.icon}</div>
              <div className="text-[11px] font-semibold text-white/70">{s.title}</div>
              <div className="text-[9px] text-white/40 mt-0.5">{s.desc}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-2 pt-3">
          <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
            Vote Weight Mechanics
          </div>
          <div className="w-full max-w-md px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="text-[10px] text-white/40 space-y-1.5">
              <div className="flex justify-between">
                <span>Vote weight</span>
                <span className="text-sky-400/70 font-mono">userTokenBalance</span>
              </div>
              <div className="flex justify-between">
                <span>Tokens locked during vote</span>
                <span className="text-amber-400/70 font-mono">voteLockPct% of balance</span>
              </div>
              <div className="flex justify-between">
                <span>Silence = Consent</span>
                <span className="text-emerald-400/70 font-mono">non-voters count as Yes</span>
              </div>
              <div className="flex justify-between">
                <span>Execution swap fee</span>
                <span className="text-purple-400/70 font-mono">0.5% → wallet + dividends</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DexArchitecture() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🍒"
        title="MoneyFund DEX"
        sub="Custom AMM with constant-product pools and LP rewards"
        accent="text-pink-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          AMM Architecture
        </h3>

        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="🪙" label="Token A" color="border-pink-500/20" />
            <span className="text-white/10 text-lg">×</span>
            <Node icon="🪙" label="Token B" color="border-pink-500/20" />
            <span className="text-white/10 text-lg">=</span>
            <Node icon="📊" label="k (constant)" sub="x × y = k" color="border-pink-500/20" glow="rgba(236,72,153,0.06)" />
          </FlowRow>

          <div className="w-full max-w-lg grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="text-center px-3 py-3 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/10">
              <div className="text-lg mb-1">💧</div>
              <div className="text-[11px] font-semibold text-emerald-400/80">Add Liquidity</div>
              <div className="text-[9px] text-white/40 mt-0.5">Deposit both tokens, receive LP shares</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-pink-500/[0.04] border border-pink-500/10">
              <div className="text-lg mb-1">⇄</div>
              <div className="text-[11px] font-semibold text-pink-400/80">Swap</div>
              <div className="text-[9px] text-white/40 mt-0.5">Trade along the curve, 0.5% fee</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-red-500/[0.04] border border-red-500/10">
              <div className="text-lg mb-1">🔥</div>
              <div className="text-[11px] font-semibold text-red-400/80">Remove Liquidity</div>
              <div className="text-[9px] text-white/40 mt-0.5">Burn LP, reclaim both tokens</div>
            </div>
          </div>
        </div>

        <div className="text-center space-y-2 pt-2">
          <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
            0.5% Swap Fee Distribution
          </div>
          <div className="flex justify-center gap-3">
            <Badge text="0.3% → Liquidity Providers" color="bg-emerald-500/10 text-emerald-400/60" />
            <Badge text="0.1% → Wallet" color="bg-pink-500/10 text-pink-400/60" />
            <Badge text="0.1% → Dividends" color="bg-purple-500/10 text-purple-400/60" />
          </div>
        </div>
      </div>
    </section>
  );
}

function StorefrontArchitecture() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🛒"
        title="Storefront Launcher"
        sub="Decentralized NFT marketplace with custom payee splits"
        accent="text-emerald-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Marketplace Flow
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Creator" color="border-emerald-500/20" />
            <Arrow label="createNFTLocker(payees, shares)" color="text-emerald-400/40" />
            <Node icon="🏪" label="Storefront" sub="NFT Locker" color="border-emerald-500/20" glow="rgba(16,185,129,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="then" color="text-white/40" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 w-full max-w-xl">
            {[
              { icon: "📦", title: "Deposit NFT", desc: "ERC-721 → Locker" },
              { icon: "🏷️", title: "List NFT", desc: "Set price + timelock" },
              { icon: "💳", title: "Buy NFT", desc: "ETH or ERC-20" },
              { icon: "💸", title: "Split Payment", desc: "99.6% to payees" },
            ].map((s) => (
              <div key={s.title} className="text-center px-2 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="text-lg mb-1">{s.icon}</div>
                <div className="text-[10px] font-semibold text-white/70">{s.title}</div>
                <div className="text-[9px] text-white/40 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
          <Badge text="0.4% sale fee: 0.2% wallet + 0.2% dividends" color="bg-emerald-500/10 text-emerald-400/60" />
        </div>
      </div>
    </section>
  );
}

function AuctionArchitecture() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🖼️"
        title="Ad-space Launcher"
        sub="Continuous ascending auctions with configurable refund and comment mechanics"
        accent="text-orange-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Auction Lifecycle
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Creator" color="border-orange-500/20" />
            <Arrow label="deployAuction()" color="text-orange-400/40" />
            <Node icon="🖼️" label="Auction Contract" color="border-orange-500/20" glow="rgba(249,115,22,0.08)" />
          </FlowRow>
          <Arrow dir="down" color="text-white/40" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-lg">
            {[
              { icon: "💰", title: "Place Bid", desc: "Must exceed previous + increment" },
              { icon: "↩️", title: "Refund", desc: "0-100% of outbid amount returned" },
              { icon: "✍️", title: "Sign Ad", desc: "Comment for a fee ($1+ USD)" },
            ].map((s) => (
              <div key={s.title} className="text-center px-2 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="text-lg mb-1">{s.icon}</div>
                <div className="text-[10px] font-semibold text-white/70">{s.title}</div>
                <div className="text-[9px] text-white/40 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
          <Badge text="0.4% bid fee: 0.2% wallet + 0.2% dividends" color="bg-orange-500/10 text-orange-400/60" />
        </div>
      </div>
    </section>
  );
}

function MultiswapArchitecture() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🐙"
        title="Multiswap Launcher"
        sub="Batch swaps and distributions via Uniswap V2 in a single transaction"
        accent="text-teal-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Swap + Distribute Architecture
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Deployer" color="border-teal-500/20" />
            <Arrow label="deploy(swapReceivers, distReceivers)" color="text-teal-400/40" />
            <Node icon="🐙" label="Multiswap Widget" color="border-teal-500/20" glow="rgba(20,184,166,0.08)" />
          </FlowRow>
          <Arrow dir="down" color="text-white/40" />
          <div className="grid grid-cols-2 gap-3 w-full max-w-md">
            <div className="text-center px-3 py-3 rounded-xl bg-teal-500/[0.04] border border-teal-500/10">
              <div className="text-lg mb-1">⇄</div>
              <div className="text-[11px] font-semibold text-teal-400/80">Batch Swaps</div>
              <div className="text-[9px] text-white/40 mt-1 space-y-0.5">
                <div>ETH → Multiple tokens</div>
                <div>Token → Multiple tokens</div>
                <div>Multi-hop routing</div>
              </div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-teal-500/[0.04] border border-teal-500/10">
              <div className="text-lg mb-1">📤</div>
              <div className="text-[11px] font-semibold text-teal-400/80">Batch Distributions</div>
              <div className="text-[9px] text-white/40 mt-1 space-y-0.5">
                <div>ETH to many wallets</div>
                <div>Tokens to many wallets</div>
                <div>Custom split %</div>
              </div>
            </div>
          </div>
          <Badge text="0.1% fee: 0.05% wallet + 0.05% dividends" color="bg-teal-500/10 text-teal-400/60" />
        </div>
      </div>
    </section>
  );
}

function AirdropArchitecture() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🎁"
        title="Airdrop Tool"
        sub="Batch ERC-20 distribution to multiple recipients in one transaction"
        accent="text-rose-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Airdrop Flow
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Sender" color="border-rose-500/20" />
            <Arrow label="approve(contract, total)" color="text-rose-400/40" />
            <Node icon="🪙" label="ERC-20" color="border-amber-500/20" />
          </FlowRow>
          <Arrow dir="down" label="then" color="text-white/40" />
          <FlowRow wrap>
            <Node icon="👤" label="Sender" color="border-rose-500/20" />
            <Arrow label="airdropTokens(token, recipients[], amounts[])" color="text-rose-400/40" />
            <Node icon="🎁" label="Airdrop Contract" color="border-rose-500/20" glow="rgba(244,63,94,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="distributes" color="text-white/40" />
          <div className="flex gap-2 flex-wrap justify-center">
            {["👤", "👤", "👤", "👤", "👤"].map((_, i) => (
              <Node key={i} icon="👤" label={`Recipient ${i + 1}`} color="border-white/[0.06]" size="sm" />
            ))}
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            <Badge text="Uniform mode: same amount to all" color="bg-rose-500/10 text-rose-400/60" />
            <Badge text="Individual mode: custom per-recipient" color="bg-amber-500/10 text-amber-400/60" />
          </div>
          <Badge text="0.2% fee: 0.1% wallet + 0.1% dividends" color="bg-rose-500/10 text-rose-400/60" />
        </div>
      </div>
    </section>
  );
}

function getArchitecture(title: string): React.ReactNode {
  switch (title) {
    case "Dividend Launcher": return <DividendArchitecture />;
    case "ETF Launcher": return <EtfArchitecture />;
    case "DAO Launcher": return <DaoArchitecture />;
    case "Storefront Launcher": return <StorefrontArchitecture />;
    case "Ad Space Launcher": return <AuctionArchitecture />;
    case "Multiswap Launcher": return <MultiswapArchitecture />;
    case "MoneyFund DEX": return <DexArchitecture />;
    case "MoneyFund Airdrop": return <AirdropArchitecture />;
    default: return null;
  }
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export default function AboutApp() {
  const [activeSection, setActiveSection] = useState("overview");
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({});
  const [divCount, setDivCount] = useState(0);
  const feeChartRef = useRef<HTMLCanvasElement>(null);
  const feeChartInst = useRef<Chart | null>(null);

  /* gas calc */
  const [opType, setOpType] = useState("");
  const [funcType, setFuncType] = useState("");
  const [numTokens, setNumTokens] = useState(2);
  const [numRecipients, setNumRecipients] = useState(2);
  const [gasResult, setGasResult] = useState<{ bundled: number; individual: number; savings: string } | null>(null);
  const gasChartRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const gasChartInsts = useRef<Record<string, Chart>>({});

  const toggleFaq = useCallback((i: number) => setFaqOpen((p) => ({ ...p, [i]: !p[i] })), []);

  /* ---- intersection observer for active section ---- */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  /* ---- dividend counter + breathing ---- */
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
    return () => { clearInterval(interval); };
  }, []);

  /* ---- fee chart ---- */
  useEffect(() => {
    if (!feeChartRef.current) return;
    if (feeChartInst.current) feeChartInst.current.destroy();
    feeChartInst.current = new Chart(feeChartRef.current, {
      type: "bar",
      data: {
        labels: ["Coin", "ETF", "Dividend", "DAO", "Storefront", "Ad Space", "Multiswap", "DEX", "Airdrop"],
        datasets: [
          { label: "MoneyFund Wallet (%)", data: [0.1, 0.125, 0.5, 0.25, 0.2, 0.2, 0.05, 0.1, 0.1], backgroundColor: "rgba(0,139,139,0.8)", borderColor: "#008B8B", borderWidth: 1 },
          { label: "MONEY Dividends (%)", data: [0.1, 0.125, 0, 0.25, 0.2, 0.2, 0.05, 0.1, 0.1], backgroundColor: "rgba(199,21,133,0.8)", borderColor: "#C71585", borderWidth: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: "#999" } },
          y: { beginAtZero: true, max: 0.6, grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "#999", stepSize: 0.1 } },
        },
        plugins: { legend: { labels: { color: "#ccc", font: { size: 11 } } } },
      },
    });
    return () => { feeChartInst.current?.destroy(); };
  }, []);

  /* ---- gas charts ---- */
  useEffect(() => {
    const cfgs = [
      { id: "cEth2T", type: "ethToTokens", x: "Tokens" },
      { id: "cT2Eth", type: "tokensToEth", x: "Tokens" },
      { id: "cT2T", type: "tokensToTokens", x: "Tokens" },
      { id: "cSingle", type: "singleToken", x: "Recipients" },
      { id: "cMulti", type: "multipleTokens", x: "Tokens" },
      { id: "cMultiS", type: "multipleTokensSingle", x: "Tokens" },
      { id: "cEthD", type: "eth", x: "Recipients" },
    ];
    cfgs.forEach(({ id, type, x }) => {
      const cv = gasChartRefs.current[id];
      if (!cv) return;
      if (gasChartInsts.current[id]) gasChartInsts.current[id].destroy();
      const ls = Array.from({ length: 9 }, (_, i) => String(i + 1));
      gasChartInsts.current[id] = new Chart(cv, {
        type: "bar",
        data: { labels: ls, datasets: [
          { label: "Bundled", data: ls.map((_, i) => calcGas(i + 1, type).bundled), backgroundColor: "#4CAF50" },
          { label: "Individual", data: ls.map((_, i) => calcGas(i + 1, type).individual), backgroundColor: "#F44336" },
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: x, color: "#999" }, ticks: { color: "#999" } },
            y: { title: { display: true, text: "Gas", color: "#999" }, ticks: { color: "#999" }, beginAtZero: true },
          },
          plugins: { legend: { labels: { color: "#ccc", font: { size: 11 } } } },
        },
      });
    });
    return () => { Object.values(gasChartInsts.current).forEach((c) => c.destroy()); };
  }, []);

  const handleCalc = useCallback(() => {
    if (!funcType) return;
    setGasResult(calcGas(["singleToken", "eth"].includes(funcType) ? numRecipients : numTokens, funcType));
  }, [funcType, numTokens, numRecipients]);

  const funcOptions: Record<string, { value: string; label: string }[]> = {
    swap: [
      { value: "ethToTokens", label: "ETH → Multiple Tokens" },
      { value: "tokensToEth", label: "Multiple Tokens → ETH" },
      { value: "tokensToTokens", label: "Multiple Tokens → Tokens" },
    ],
    send: [
      { value: "singleToken", label: "Single Token → Multiple Addresses" },
      { value: "multipleTokens", label: "Multiple Tokens → Multiple Addresses" },
      { value: "multipleTokensSingle", label: "Multiple Tokens → Single Address" },
      { value: "eth", label: "ETH → Multiple Addresses" },
    ],
  };

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>

      {/* ═══════════ STICKY SECTION NAV ═══════════ */}
      <div className="sticky top-14 z-40 border-b border-white/[0.04]" style={{ background: "rgba(8,9,14,0.92)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-[1100px] mx-auto px-4 overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-0.5 py-2 min-w-max">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className={`px-3.5 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide uppercase whitespace-nowrap transition-all cursor-pointer ${
                  activeSection === s.id
                    ? "text-cyan-400 bg-cyan-400/10"
                    : "text-white/30 hover:text-white/60 hover:bg-white/[0.03]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-16 space-y-20">

        {/* ═══════════ OVERVIEW ═══════════ */}
        <section id="overview" className="space-y-8 scroll-mt-28">
          <div className="text-center space-y-3 pt-6">
            <h1 className="text-3xl sm:text-[42px] font-extrabold text-white uppercase tracking-wider">MoneyFund</h1>
            <p className="text-sm text-white/40 max-w-lg mx-auto leading-relaxed">
              The tri-layer launchpad for codelessly deploying custom smart contracts on Ethereum.
            </p>
            <div className="mx-auto mt-4 w-24 h-[2px] rounded-full bg-gradient-to-r from-cyan-500/40 via-purple-500/40 to-amber-500/40" />
          </div>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/60 leading-relaxed">
              The MoneyFund protocol consists of eight interconnected factory smart contracts that are divided into three categories and collectively referred to as the tri-layer launchpad. Smart contracts are digital agreements that run on the blockchain and automatically execute when conditions are met. A factory smart contract is like a vending machine for vending machines — a contract that creates contracts. The tri-layer launchpad enables anyone to codelessly deploy custom smart contracts by filling out simple forms. In addition to the eight factories, the protocol includes standalone utility contracts such as the MoneyFund DEX (a custom AMM), an Airdrop tool for batch token distributions, and a dedicated MONEY Dividends staking contract — all of which feed into the unified fee ecosystem.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {([["Asset Layer", "asset", "Creates tokens & ETFs"], ["Distribution Layer", "distribution", "Staking pools & DAOs"], ["Profit Layer", "profit", "Revenue-generating contracts"]] as const).map(([label, key, sub]) => (
              <div key={key} className={`${layerBg(key)} px-5 py-3 rounded-xl text-center min-w-[160px]`}>
                <p className="text-sm font-bold text-white">{label}</p>
                <p className="text-[10px] text-white/50 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════ U-DIAGRAMS ═══════════ */}
        <section id="diagrams" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="How MoneyFund compares to equities and shitcoins">Value Flow Diagrams</SectionHeading>
          <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8 lg:gap-6">
            <UDiagram prefix="eq" label="Equities" boxes={{ left: { label: "Business", layer: "asset" }, bottom: { label: "Shares", layer: "profit" }, right: { label: "Dividends", layer: "distribution" } }} desc="Unlike crypto, equities rely on fundamentals more than speculative degeneracy. While that tends to be positive, existing systems & structures are perhaps equally flawed in their own ways. Equity is made up out of thin air and thus carries ever-present risks like dilution and centralized control. There are basically two types: private equity + stocks. Private equity often requires you to be an accredited investor which is basically a rich person. This means poor people cant buy companies until they get listed on a public ponzi at massively inflated valuations. It's also difficult to fund many risky business endeavors with traditional systems because they're gatekept by boomers and regulators. For instance an IPO costs about 25 million dollars. The stock market has a number of familiar flaws like restricted trading hours. Due to the aforementioned inferiorities both of these analog asset types will be replaced by ERC-20 tokens. Summary of downsides: high friction, mutable supply, mutable dividends." />
            <UDiagram prefix="sc" label="Shitcoins" boxes={{ left: { label: "Tokens", layer: "profit" }, bottom: { label: "Nothing", layer: "none" }, right: { label: "Nothing", layer: "none" } }} desc="This diagram represents 99% of cryptocurrencies & the larger problem MoneyFund seeks to solve. These are pointless nonsense coins which is only sustainable for top-quality memes. Certain cartoons are great for short-term gambling but the space has become predictably oversaturated with fagcoins that are resented by normal people. The main barrier to shitcoin adoption is their vapid uselessness. Besides coordinated wealth transfers, shitcoins are purposeless and thus automatically dismissed from the conversations of productive society. Despite significant shortcomings, tokens still outshine equities in many key ways. ERC-20 tokens operate on a decentralized network that ensures trustless & permissionless transacting 24/7 globally. The Ethereum blockchain is the oldest + largest smart contract platform in the world. This network effect, as well as the inherent composability of ERC-20 tokens, has allowed them to gain widespread adoption as the global standard for tokenized assets like stablecoins. Summary of downsides: people are tired of gay nonsense." />
            <UDiagram prefix="mf" label="MoneyFunds" pathEnd="275" descSize="text-[7px]" boxes={{ left: { label: "Business", layer: "asset" }, bottom: { label: "Dividends", layer: "distribution" }, right: { label: "Tokens", layer: "profit" } }} desc="MoneyFund combines the sustainability of traditional business with the transparency + decentralization of the Ethereum blockchain. No more expensive IPOs, no more scam ICOs- the future is IMOs. Initial Money Offerings are the gold standard for tokenized asset deployment and all coins launched elsewhere should be dismissed & discredited. MFTL tokens allow for unlimited customization within secure parameters. This constrained flexibility allows MoneyFund infrastructure to facilitate the creation + management of uniquely productive assets. In addition to the benefits of being built on the largest defi network in the world, MF offers additional advantages over traditional equities- the largest two being transparency and immutability. For instance walmart can delist or change prices at any time whereas the storefronts produced by our factory include a listing timelock mechanism to enhance operational transparency. This is beneficial to users who are considering investing in some MFTL token thats connected to an NFT storefront for example. Users can view the store's inventory and timelocks to know the minimum duration that items will be locked in the storefront + listed at their current price for. This allows auditors to know how long the MFTL token will be backed by listings. Similarly, dividend immutability is a significant upgrade to the offchain tradfi model. Once a dividend pool is deployed nobody can make changes. Same thing for tokens- once a coin is launched the company it represents cannot dilute shareholders unless something like a mintable function is explicitly written in the contract. Summary of downsides: none." />
          </div>
        </section>

        {/* ═══════════ DIVIDEND POOL ═══════════ */}
        <section id="dividends" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="Every contract feeds revenue into the MONEY dividend pool">Where Does the MONEY Come From?</SectionHeading>

          {/* Desktop: full animated visualization */}
          <div className="hidden md:flex justify-center">
            <div className="relative w-[640px] h-[640px] rounded-3xl" style={{ background: "radial-gradient(circle at center, #111318, #08090e)" }}>
              {/* SVG layer for paths + animated coins */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 600">
                <defs>
                  <filter id="coinGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                {POOL_BRANCHES.map((_, i) => {
                  const angle = (i * Math.PI * 2) / POOL_BRANCHES.length;
                  const r = 220;
                  const ex = 300 + r * Math.cos(angle);
                  const ey = 300 + r * Math.sin(angle);
                  const strokeColor = i % 3 === 0 ? "rgba(52,211,153,0.12)" : i % 3 === 1 ? "rgba(251,146,60,0.12)" : "rgba(167,139,250,0.12)";
                  return <line key={`line-${i}`} x1="300" y1="300" x2={ex} y2={ey} stroke={strokeColor} strokeWidth="10" />;
                })}
                {POOL_BRANCHES.map((_, i) => <AnimatedCoins key={`coins-${i}`} branchIndex={i} total={POOL_BRANCHES.length} />)}
              </svg>

              {/* Branch orbs */}
              {POOL_BRANCHES.map((b, i) => {
                const angle = (i * Math.PI * 2) / POOL_BRANCHES.length;
                const r = 220;
                const x = 320 + r * Math.cos(angle) - 48;
                const y = 320 + r * Math.sin(angle) - 48;
                return (
                  <div key={i} className={`absolute w-24 h-24 rounded-full flex flex-col items-center justify-center text-center text-white text-[10px] font-bold ${layerBg(b.layer)} shadow-lg shadow-black/30 border border-white/[0.08]`} style={{ left: x, top: y }}>
                    <span className="text-xl mb-0.5">{b.icon}</span>
                    <span className="leading-tight">{b.label}</span>
                    <span className="text-[9px] font-normal text-white/50 mt-0.5">{b.pct}</span>
                  </div>
                );
              })}

              {/* Center orb */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[160px] h-[160px] rounded-full flex flex-col items-center justify-center text-center z-10 transition-transform" style={{
                background: "radial-gradient(circle at 30% 30%, #00f7ff, #004466 60%, #001a33)",
                boxShadow: "0 0 50px rgba(0,247,255,0.5), 0 0 100px rgba(0,247,255,0.15), inset 0 0 25px #003344",
                animation: "orbBreathe 3s ease-in-out infinite",
              }}>
                <span className="text-[20px] font-extrabold text-amber-400 leading-tight uppercase" style={{ fontFamily: "'Orbitron', sans-serif" }}>MONEY<br />Dividends</span>
                <span className="bg-white text-black font-bold text-xs px-2.5 py-0.5 rounded-md mt-1.5 shadow">{divCount}</span>
              </div>
            </div>
          </div>

          {/* Mobile grid */}
          <div className="md:hidden space-y-4">
            <div className="flex justify-center">
              <div className="w-28 h-28 rounded-full flex flex-col items-center justify-center text-center" style={{
                background: "radial-gradient(circle at 30% 30%, #00f7ff, #004466 60%, #001a33)",
                boxShadow: "0 0 30px rgba(0,247,255,0.4)",
              }}>
                <span className="text-sm font-extrabold text-amber-400 uppercase" style={{ fontFamily: "'Orbitron', sans-serif" }}>MONEY</span>
                <span className="bg-white text-black font-bold text-[10px] px-2 py-0.5 rounded mt-1">{divCount}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {POOL_BRANCHES.map((b, i) => (
                <div key={i} className={`${layerBg(b.layer)} rounded-xl p-3 text-center text-white text-xs font-bold border border-white/[0.06]`}>
                  <span className="text-lg">{b.icon}</span>
                  <p className="mt-1">{b.label}</p>
                  <p className="text-[10px] font-normal text-white/40">{b.pct}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ TRI-LAYER ═══════════ */}
        <section id="trilayer" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="Three interconnected layers that power the MoneyFund ecosystem">Tri-Layer Architecture</SectionHeading>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([
              { key: "asset" as const, title: "Asset Layer", desc: "The Asset Layer enables creation of ERC-20 tokens and ETFs. Fed by distribution contracts, this is the destination for value in MF's trilayer model." },
              { key: "distribution" as const, title: "Distribution Layer", desc: "The Distribution Layer manages token allocations and governance through custom staking pools, DAOs, and multisig wallets, serving as the vehicle that connects assets to profit layer contracts." },
              { key: "profit" as const, title: "Profit Layer", desc: "The Profit Layer generates external cashflow via contracts like Multiswap, Storefront, and Auction factories — giving tokens sustainable life through on-chain business." },
            ]).map((l) => (
              <div key={l.key} className={`${layerBg(l.key)} rounded-2xl p-5 border border-white/[0.06] hover:border-white/[0.12] transition-all`}>
                <div className={`w-2 h-2 rounded-full ${layerDot(l.key)} mb-3`} />
                <h3 className="text-sm font-bold text-white mb-2">{l.title}</h3>
                <p className="text-xs text-white/60 leading-relaxed">{l.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════ CONTRACTS ═══════════ */}
        <section id="contracts" className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Detailed breakdown of each factory contract">Smart Contracts</SectionHeading>
          {CONTRACT_SECTIONS.map((c) => (
            <div key={c.title} className="space-y-6 overflow-x-hidden">
              <div className={`${layerBg(c.layer)} rounded-2xl border border-white/[0.06] overflow-hidden`}>
                <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${layerDot(c.layer)}`} />
                  <h3 className="text-base sm:text-lg font-bold text-white">{c.title}</h3>
                </div>
                <div className={`grid ${c.creator ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"} divide-y md:divide-y-0 md:divide-x divide-white/[0.06]`}>
                  {c.creator && (
                    <div className="p-5">
                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Creator</p>
                      <p className="text-xs text-white/60 leading-relaxed">{c.creator}</p>
                    </div>
                  )}
                  <div className="p-5">
                    <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">User</p>
                    <p className="text-xs text-white/60 leading-relaxed">{c.user}</p>
                  </div>
                </div>
              </div>
              {getArchitecture(c.title)}
            </div>
          ))}
        </section>

        {/* ═══════════ FEE STRUCTURE ═══════════ */}
        <section id="fees" className="space-y-6 scroll-mt-28">
          <SectionHeading sub="How fees are distributed across the platform">Fee Structure</SectionHeading>

          <div className="hidden md:block overflow-x-auto">
            <div className={`${card} overflow-hidden`}>
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="p-3.5 text-left text-[10px] font-bold text-white/40 uppercase tracking-wider">Contract</th>
                    <th className="p-3.5 text-left text-[10px] font-bold text-white/40 uppercase tracking-wider">Fee Type</th>
                    <th className="p-3.5 text-left text-[10px] font-bold text-white/40 uppercase tracking-wider">MF Wallet</th>
                    <th className="p-3.5 text-left text-[10px] font-bold text-white/40 uppercase tracking-wider">MONEY Dividends</th>
                    <th className="p-3.5 text-left text-[10px] font-bold text-white/40 uppercase tracking-wider">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {FEE_DATA.map((r, i) => (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="p-3.5 font-semibold text-white/80 flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${layerDot(r.layer)}`} />{r.contract}
                      </td>
                      <td className="p-3.5">{r.feeType}</td>
                      <td className="p-3.5 text-teal-400/80">{r.wallet}</td>
                      <td className="p-3.5 text-pink-400/80">{r.dividends}</td>
                      <td className="p-3.5 text-white/35">{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="md:hidden space-y-2">
            {FEE_DATA.map((r, i) => (
              <div key={i} className={`${card} p-4 text-xs space-y-1.5`}>
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${layerDot(r.layer)}`} />
                  <span className="font-bold text-white/80">{r.contract}</span>
                </div>
                <p className="text-white/40">{r.feeType}</p>
                <div className="flex gap-3">
                  <span className="text-teal-400/70">Wallet: {r.wallet}</span>
                  <span className="text-pink-400/70">Dividends: {r.dividends}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={`${card} p-5`} style={{ height: 320 }}>
            <canvas ref={feeChartRef} />
          </div>
        </section>

        {/* ═══════════ FAQ ═══════════ */}
        <section id="faq" className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Common questions about MoneyFund contracts">Frequently Asked Questions</SectionHeading>
          <div className="space-y-2">
            {FAQ_ITEMS.map((item, i) => (
              <div key={i} className={`${card} overflow-hidden`}>
                <button
                  type="button"
                  onClick={() => toggleFaq(i)}
                  className="w-full flex items-center justify-between text-left px-5 py-3.5 cursor-pointer transition-all hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${layerDot(item.layer)}`} />
                    <span className="text-[13px] font-medium text-white/70">{item.q}</span>
                  </div>
                  <span className={`text-white/40 text-sm ml-3 flex-shrink-0 transition-transform ${faqOpen[i] ? "rotate-45" : ""}`}>+</span>
                </button>
                {faqOpen[i] && (
                  <div className="px-5 pb-4 pt-0 ml-6 border-t border-white/[0.04]">
                    <p className="text-xs text-white/50 leading-relaxed pt-3">{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════ GAS CALCULATOR ═══════════ */}
        <section id="gas" className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Compare bundled vs individual transaction gas costs">Multiswap Gas Calculator</SectionHeading>

          <div className={`${card} p-6 sm:p-8 space-y-5`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-1.5">Operation</label>
                <select value={opType} onChange={(e) => { setOpType(e.target.value); setFuncType(""); setGasResult(null); }} className={selectCls}>
                  <option value="">Select type...</option>
                  <option value="swap">Swap</option>
                  <option value="send">Send</option>
                </select>
              </div>
              {opType && (
                <div>
                  <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-1.5">Function</label>
                  <select value={funcType} onChange={(e) => { setFuncType(e.target.value); setGasResult(null); }} className={selectCls}>
                    <option value="">Select function...</option>
                    {(funcOptions[opType] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              {funcType && !["eth"].includes(funcType) && (
                <div>
                  <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-1.5">Tokens</label>
                  <input type="number" value={numTokens} onChange={(e) => setNumTokens(Math.max(1, parseInt(e.target.value) || 1))} min={1} className={inputCls} />
                </div>
              )}
              {["singleToken", "multipleTokens", "eth"].includes(funcType) && (
                <div>
                  <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-1.5">Recipients</label>
                  <input type="number" value={numRecipients} onChange={(e) => setNumRecipients(Math.max(1, parseInt(e.target.value) || 1))} min={1} className={inputCls} />
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <button type="button" onClick={handleCalc} disabled={!funcType} className={`${btnCalc} disabled:opacity-30 disabled:cursor-not-allowed`}>Calculate</button>
              <button type="button" onClick={() => { setOpType(""); setFuncType(""); setGasResult(null); setNumTokens(2); setNumRecipients(2); }} className="h-11 px-6 rounded-xl font-semibold text-sm border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer">Reset</button>
            </div>
            {gasResult && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 text-center">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Bundled</p>
                  <p className="text-sm font-bold text-white/80 mt-1">{gasResult.bundled.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 text-center">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Individual</p>
                  <p className="text-sm font-bold text-white/80 mt-1">{gasResult.individual.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/10 p-4 text-center">
                  <p className="text-[10px] text-emerald-400/50 uppercase tracking-wider">Savings</p>
                  <p className="text-sm font-bold text-emerald-400 mt-1">{gasResult.savings}%</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { id: "cEth2T", label: "ETH → Multiple Tokens" },
              { id: "cT2Eth", label: "Tokens → ETH" },
              { id: "cT2T", label: "Tokens → Tokens" },
              { id: "cSingle", label: "Token → Multiple Addresses" },
              { id: "cMulti", label: "Tokens → Multiple Addresses" },
              { id: "cMultiS", label: "Tokens → Single Address" },
              { id: "cEthD", label: "ETH → Multiple Addresses" },
            ].map(({ id, label }) => (
              <div key={id} className={`${card} p-4`}>
                <p className="text-[11px] font-semibold text-white/40 mb-2 text-center">{label}</p>
                <div style={{ height: 220 }}>
                  <canvas ref={(el) => { gasChartRefs.current[id] = el; }} />
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
