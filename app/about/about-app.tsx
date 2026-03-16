"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Chart, registerables } from "chart.js";
import CompanyChart from "../company-chart";

Chart.register(...registerables);

/* ================================================================== */
/*  SECTION MENU DEFINITIONS                                           */
/* ================================================================== */

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "start", label: "Get Started" },
  { id: "architecture", label: "Architecture" },
  { id: "diagrams", label: "U-Diagrams" },
  { id: "dividends", label: "Dividend Pool" },
  { id: "trilayer", label: "Tri-Layer" },
  { id: "tokenomics", label: "Tokenomics" },
  { id: "contracts", label: "Contracts" },
  { id: "security", label: "Security" },
  { id: "arweave", label: "Arweave" },
  { id: "fees", label: "Fee Structure" },
  { id: "faq", label: "FAQ" },
  { id: "gas", label: "Gas Calculator" },
  { id: "glossary", label: "Glossary" },
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
/*  ARWEAVE FEATURES                                                   */
/* ================================================================== */

type ArweaveFeatureLayer = "storage" | "network" | "compute" | "wallet";

const ARWEAVE_FEATURES: {
  title: string;
  layer: ArweaveFeatureLayer;
  icon: string;
  summary: string;
  details: string[];
}[] = [
  {
    title: "PermaWrite",
    layer: "storage",
    icon: "📜",
    summary: "Private storage with permanent Arweave archival. Files and text are uploaded to the Arweave blockchain where they persist forever — no hosting fees, no expiration, no takedowns.",
    details: [
      "44 categories across 9 groups (Media, Documents, Code, Creative, Data, Web, Social, Science, Other) with automatic content-type detection",
      "Smart upload: tries Turbo (bundled, instant) first, falls back to L1 base layer",
      "Metadata logged to Supabase for search, filtering, and category browsing",
      "Custom tags and suggested tags per category for rich on-chain metadata",
      "Visibility toggle: private (Supabase only) or permawrite (Arweave + Supabase)",
      "PermaFeed view with Arweave TX IDs and direct links to ViewBlock explorer",
    ],
  },
  {
    title: "Gateway Infrastructure",
    layer: "network",
    icon: "🌐",
    summary: "Direct peer-to-peer access to the Arweave network. Requests route through discovered peer nodes — public gateways are only used as a last resort.",
    details: [
      "Supabase Edge Function proxy for server-side Arweave API access",
      "Dynamic peer pool with health monitoring and automatic failover",
      "Block explorer: browse blocks, view transactions, inspect tags and data",
      "GraphQL console for querying the Arweave transaction index (GQL)",
      "Transaction browser with owner, recipient, tag, and block range filters",
      "Upload history tracking with Supabase-backed bookmarks",
    ],
  },
  {
    title: "ar.io Network",
    layer: "network",
    icon: "🔗",
    summary: "Integration with the decentralized ar.io gateway network for smart gateway selection, health monitoring, and ArNS name resolution.",
    details: [
      "Gateway discovery from curated high-quality nodes (arweave.net, ar-io.net, arweave.dev, g8way.io)",
      "Health checks with latency measurement and block height verification",
      "Network statistics: total gateways, average stake, best latency, highest block",
      "ArNS (Arweave Name System) resolution: resolve ar://name to TX IDs",
      "ArNS URLs formatted as https://{name}.arweave.dev or https://{name}.ar-io.net",
      "Best-gateway selection algorithm based on health and latency",
    ],
  },
  {
    title: "Turbo Bundled Uploads",
    layer: "storage",
    icon: "⚡",
    summary: "Instant Arweave confirmations via ar.io's Turbo bundler service. Uploads are bundled into ANS-104 data items for near-instant finality instead of waiting for L1 block confirmations.",
    details: [
      "ANS-104 data item creation with cryptographic signing (RSA-PSS + SHA-256)",
      "Deep hash anchoring for tamper-proof content addressing",
      "Price estimation in winc (winston credits) before upload",
      "Balance checking and top-up URL generation via ArDrive",
      "Supports both raw data and file uploads with content-type tags",
      "Automatic fallback to L1 base layer if Turbo credits are insufficient",
    ],
  },
  {
    title: "ArConnect Wallet",
    layer: "wallet",
    icon: "🔐",
    summary: "Browser extension wallet integration via ArConnect (Wander). Provides a unified interface for both JWK file wallets and ArConnect browser wallets.",
    details: [
      "Auto-detection of window.arweaveWallet injection with event listener fallback",
      "Permission-scoped connection: ACCESS_ADDRESS, ACCESS_PUBLIC_KEY, SIGN_TRANSACTION, DISPATCH",
      "Transaction dispatch with automatic bundling for instant finality",
      "JWK import/export for portable wallet management",
      "Balance display in AR with winston precision",
      "Dual wallet source support: JWK files or ArConnect extension",
    ],
  },
  {
    title: "AO Compute Layer",
    layer: "compute",
    icon: "🧠",
    summary: "Integration with AO, a hyper-parallel compute environment built on Arweave. Processes run as permanent on-chain programs with message-passing architecture.",
    details: [
      "Direct REST API integration — no aoconnect SDK dependency",
      "Dryrun execution via Compute Units (CU) for reading process state",
      "Message sending via Messenger Units (MU) with signed ANS-104 data items",
      "Token operations: balance queries, transfers, and multi-token portfolio views",
      "Well-known AO tokens: ARIO, TRUNK, LLAMA, BARK",
      "Process info lookup and result reading by message ID",
    ],
  },
  {
    title: "Warp SmartWeave",
    layer: "compute",
    icon: "📄",
    summary: "Warp SmartWeave contract integration for reading contract state, browsing interactions, parsing Atomic Assets, and checking PST balances — all via direct REST API calls.",
    details: [
      "Contract state reading via DRE (Distributed Resolution Environment) nodes with automatic failover",
      "Interaction browsing via Warp Gateway with pagination support",
      "Atomic Asset (NFT) parsing: single transaction that is both content AND contract",
      "PST (Profit Sharing Token) balance checking for known contracts (ARDRIVE, U, BAZAR)",
      "Vouch Protocol integration for wallet reputation verification",
      "Contract explorer links to Sonar (Warp's block explorer)",
    ],
  },
];

function arweaveLayerBg(l: ArweaveFeatureLayer) {
  if (l === "storage") return "bg-gradient-to-br from-[#1A2F3C] to-[#1F3A4A]";
  if (l === "network") return "bg-gradient-to-br from-[#2A2F3C] to-[#35394E]";
  if (l === "compute") return "bg-gradient-to-br from-[#2F2A3C] to-[#3D354E]";
  if (l === "wallet") return "bg-gradient-to-br from-[#1A3C2F] to-[#1F4A3A]";
  return "bg-white/[0.04]";
}

function arweaveLayerDot(l: ArweaveFeatureLayer) {
  if (l === "storage") return "bg-cyan-400";
  if (l === "network") return "bg-blue-400";
  if (l === "compute") return "bg-violet-400";
  if (l === "wallet") return "bg-teal-400";
  return "bg-white/30";
}

function arweaveLayerLabel(l: ArweaveFeatureLayer) {
  if (l === "storage") return "Storage";
  if (l === "network") return "Network";
  if (l === "compute") return "Compute";
  if (l === "wallet") return "Wallet";
  return "";
}

/* ================================================================== */
/*  ARCHITECTURE                                                       */
/* ================================================================== */

const ARCH_LAYERS: {
  label: string;
  color: string;
  dotColor: string;
  components: { name: string; detail: string }[];
}[] = [
  {
    label: "Frontend",
    color: "bg-gradient-to-br from-[#1A2F3C] to-[#1F3A4A]",
    dotColor: "bg-cyan-400",
    components: [
      { name: "Next.js 16 (App Router)", detail: "Server and client components with file-based routing, server actions, and Turbopack for fast builds." },
      { name: "React 19", detail: "Client-side interactivity with hooks, Suspense boundaries, and dynamic imports for code-split Arweave modules." },
      { name: "Tailwind CSS v4", detail: "Utility-first styling with custom design tokens (brand-*, gold), dark theme, and responsive breakpoints." },
      { name: "Chart.js", detail: "Interactive fee distribution charts, gas comparison visualizations, and data-driven dashboards." },
    ],
  },
  {
    label: "Backend & Auth",
    color: "bg-gradient-to-br from-[#2A2F3C] to-[#35394E]",
    dotColor: "bg-blue-400",
    components: [
      { name: "Supabase (Auth + Postgres)", detail: "Email/password authentication with JWT sessions, row-level security, and Postgres for upload records, bookmarks, and PermaWrite metadata." },
      { name: "Supabase Edge Functions", detail: "Serverless Arweave gateway proxy that handles peer discovery, request routing, caching, and cost estimation without exposing infrastructure." },
      { name: "Encrypted Vault", detail: "AES-GCM encrypted local storage for private keys. Ethereum keys and Arweave JWKs are encrypted with a user-derived key and never leave the browser unencrypted." },
    ],
  },
  {
    label: "Ethereum (L1)",
    color: "bg-gradient-to-br from-[#1A3C34] to-[#1F4A40]",
    dotColor: "bg-emerald-400",
    components: [
      { name: "ethers.js v6", detail: "Ethereum wallet management, contract interaction, transaction signing, and ENS resolution via Infura and Ankr RPC endpoints." },
      { name: "8 Factory Contracts", detail: "Coin Launcher, ETF Launcher, Dividend Launcher, DAO Launcher, Multisig Launcher, Storefront, Ad Space, and Multiswap — each deploying customizable child contracts." },
      { name: "MoneyFund DEX", detail: "Custom constant-product AMM with its own liquidity pools, separate from Uniswap routing used by Multiswap." },
      { name: "Chainlink Price Feeds", detail: "ETH/USD oracle integration for ETF share pricing and USD-denominated fee calculations." },
    ],
  },
  {
    label: "Arweave (Permaweb)",
    color: "bg-gradient-to-br from-[#2F2A3C] to-[#3D354E]",
    dotColor: "bg-violet-400",
    components: [
      { name: "ArweaveGateway (custom)", detail: "Full Arweave HTTP client with peer pool management, block browsing, GraphQL queries, transaction submission, and content rendering — zero SDK dependencies." },
      { name: "Turbo Bundler (ar.io)", detail: "ANS-104 data item creation, deep hash signing, and instant bundled uploads via ArDrive's Turbo service." },
      { name: "AO Compute Layer", detail: "Hyper-parallel process messaging via Compute Units (read) and Messenger Units (write) with token balance management." },
      { name: "Warp SmartWeave", detail: "Contract state reading via DRE nodes, Atomic Asset parsing, PST balance queries, and Vouch Protocol integration." },
    ],
  },
];

/* ================================================================== */
/*  SECURITY                                                           */
/* ================================================================== */

const SECURITY_PRINCIPLES: {
  title: string;
  icon: string;
  description: string;
  details: string[];
}[] = [
  {
    title: "Non-Custodial by Design",
    icon: "🔑",
    description: "MoneyFund never holds, accesses, or transmits your private keys. All signing happens locally in the browser.",
    details: [
      "Ethereum private keys are derived from user-provided mnemonic phrases and encrypted with AES-GCM before storage",
      "Arweave JWK keypairs are generated using Web Crypto API (RSA-PSS, 4096-bit) and stored encrypted in the vault",
      "The encrypted vault is locked with a user-chosen password — losing the password means the vault is irrecoverable",
      "No server-side key storage — Supabase stores only public metadata (addresses, upload records, bookmarks)",
    ],
  },
  {
    title: "Smart Contract Safety",
    icon: "🛡",
    description: "All factory contracts follow battle-tested patterns to prevent common attack vectors.",
    details: [
      "ReentrancyGuard on all state-changing functions that handle ETH or token transfers",
      "Checks-Effects-Interactions pattern enforced throughout the codebase",
      "Immutable parameters: once a dividend pool, token, or storefront is deployed, core settings cannot be altered",
      "62,000+ lines of Solidity — full source will be open-sourced at $1M market cap for public audit",
    ],
  },
  {
    title: "Transport & Session Security",
    icon: "🔒",
    description: "All network communication is encrypted and sessions are scoped with minimal privilege.",
    details: [
      "Supabase Auth with JWT tokens — sessions expire and refresh automatically",
      "Row-level security (RLS) policies on all Supabase tables — users can only access their own data",
      "Arweave transactions are signed client-side using RSA-PSS + SHA-256 before submission",
      "HTTPS-only communication with all external services (Arweave gateways, Turbo, AO, Warp DRE)",
    ],
  },
  {
    title: "Transparency & Immutability",
    icon: "📋",
    description: "On-chain contracts are transparent by default — every function call and event is publicly auditable.",
    details: [
      "All contract actions emit events that are permanently recorded on Ethereum",
      "No admin keys or upgrade proxies — deployed contracts are immutable",
      "Fee splits are hardcoded in factory bytecode and cannot be changed post-deployment",
      "Storefront listing timelocks provide verifiable minimum listing durations for investor confidence",
    ],
  },
];

/* ================================================================== */
/*  TOKENOMICS                                                         */
/* ================================================================== */

const TOKENOMICS_METRICS: { label: string; value: string; sub: string }[] = [
  { label: "Token Standard", value: "ERC-20", sub: "Ethereum Mainnet" },
  { label: "Total Supply", value: "1,000,000,000", sub: "Fixed — no minting function" },
  { label: "Burn Mechanism", value: "ETF 0.1%", sub: "MONEY burned on each ETF transaction" },
  { label: "Dividend Source", value: "8 Contracts", sub: "All factories feed the MONEY pool" },
  { label: "Staking Model", value: "ERC-721 NFT", sub: "Stake receipt is a transferable NFT" },
  { label: "Fee Split", value: "50 / 50", sub: "MoneyFund Wallet + MONEY Dividends" },
];

const DIVIDEND_MATH = [
  { label: "Your share", formula: "your_staked / total_staked", example: "If you stake 1,000 MONEY and the total pool is 10,000 → your share is 10%" },
  { label: "Reward claim", formula: "share × accumulated_rewards", example: "If the pool has accumulated 5 ETH in rewards and your share is 10% → you can claim 0.5 ETH" },
  { label: "Early unstake penalty", formula: "initialPenalty - (daysElapsed × dailyDecay)", example: "If initial penalty is 50% and daily decay is 1%, after 20 days → penalty = 50% - 20% = 30%" },
  { label: "Storefront payout", formula: "sale_price × 0.996 → shareholders", example: "On a 1 ETH sale, 0.004 ETH goes to MF fees, 0.996 ETH is split among shareholders" },
];

/* ================================================================== */
/*  GETTING STARTED                                                    */
/* ================================================================== */

const GETTING_STARTED_STEPS: {
  step: number;
  title: string;
  description: string;
  link?: { label: string; href: string };
}[] = [
  {
    step: 1,
    title: "Create an Account",
    description: "Sign up with your email address. MoneyFund uses Supabase Auth — your credentials are hashed and stored securely, and session tokens refresh automatically.",
    link: { label: "Sign In", href: "/auth" },
  },
  {
    step: 2,
    title: "Unlock the Vault",
    description: "Set a vault password to encrypt your local key store. This password encrypts all private keys using AES-GCM before they touch storage. If you lose this password, your vault is unrecoverable — there are no resets.",
    link: { label: "Go to Wallets", href: "/wallets" },
  },
  {
    step: 3,
    title: "Set Up an Ethereum Wallet",
    description: "Import an existing mnemonic (12 or 24 words) or generate a new one. Your private key is derived locally using BIP-39/BIP-44 and never leaves your browser unencrypted. Fund with ETH for gas fees.",
    link: { label: "Wallets", href: "/wallets" },
  },
  {
    step: 4,
    title: "Set Up an Arweave Wallet (Optional)",
    description: "Generate a new RSA-4096 keypair or import an existing JWK file. This wallet is used for permanent storage on Arweave, AO compute operations, and PermaWrite. You can also connect ArConnect for browser-extension signing.",
    link: { label: "Wallets → Arweave", href: "/wallets" },
  },
  {
    step: 5,
    title: "Explore the Platform",
    description: "Deploy smart contracts from the Contracts page, upload files permanently with PermaWrite, browse the permaweb through the Gateway, or use the Multiswap for batch token operations.",
    link: { label: "Contracts", href: "/contracts" },
  },
  {
    step: 6,
    title: "Stake MONEY for Dividends",
    description: "Once you hold MONEY tokens, stake them in the dividend pool to earn a proportional share of all platform fees. Your stake is represented as a transferable ERC-721 NFT.",
  },
];

/* ================================================================== */
/*  GLOSSARY                                                           */
/* ================================================================== */

const GLOSSARY_TERMS: { term: string; definition: string; category: string }[] = [
  { term: "ERC-20", definition: "The standard interface for fungible tokens on Ethereum. All tokens launched via Coin Launcher and ETFs follow this standard.", category: "Ethereum" },
  { term: "ERC-721", definition: "The standard for non-fungible tokens (NFTs). MoneyFund uses ERC-721 for dividend staking receipts and storefront listings.", category: "Ethereum" },
  { term: "AMM", definition: "Automated Market Maker — a decentralized exchange mechanism that uses liquidity pools and a mathematical formula (constant product: x × y = k) instead of an order book.", category: "Ethereum" },
  { term: "LP", definition: "Liquidity Provider — a user who deposits tokens into an AMM pool to earn a share of trading fees.", category: "Ethereum" },
  { term: "Gas", definition: "The unit measuring computational effort on Ethereum. Each operation costs a specific amount of gas, paid in ETH. Multiswap bundles operations to reduce total gas.", category: "Ethereum" },
  { term: "Wei / Gwei", definition: "Units of ETH. 1 ETH = 10¹⁸ wei = 10⁹ gwei. Gas prices are typically quoted in gwei.", category: "Ethereum" },
  { term: "Basis Points (bps)", definition: "A unit equal to 1/100th of a percent. 10,000 bps = 100%. MoneyFund uses bps for fee shares and allocation weights.", category: "Ethereum" },
  { term: "ReentrancyGuard", definition: "A smart contract pattern that prevents a function from being called again before it finishes executing. Prevents the classic reentrancy attack vector.", category: "Ethereum" },
  { term: "Factory Contract", definition: "A smart contract that deploys other smart contracts. Each MoneyFund launcher is a factory that creates customized child contracts.", category: "Ethereum" },
  { term: "Arweave", definition: "A permanent data storage blockchain. Unlike IPFS (content-addressed but not guaranteed persistent), Arweave pays miners to store data forever via a one-time endowment fee.", category: "Arweave" },
  { term: "Permaweb", definition: "The permanent web built on Arweave. Once data is uploaded, it is accessible forever via its transaction ID through any Arweave gateway.", category: "Arweave" },
  { term: "JWK", definition: "JSON Web Key — the RSA keypair format used by Arweave wallets. Contains the public key (n) and private key components (d, p, q, dp, dq, qi).", category: "Arweave" },
  { term: "Winston", definition: "The smallest unit of AR (Arweave's native token). 1 AR = 10¹² winston. Named after Winston Churchill.", category: "Arweave" },
  { term: "ANS-104", definition: "Arweave Network Standard for bundled data items. Allows multiple data items to be bundled into a single L1 transaction for efficiency.", category: "Arweave" },
  { term: "ArNS", definition: "Arweave Name System — maps human-readable names to Arweave transaction IDs, similar to DNS for the permaweb.", category: "Arweave" },
  { term: "Turbo", definition: "ar.io's bundling service for instant Arweave uploads. Data items are signed locally and bundled by the service, providing near-instant confirmation.", category: "Arweave" },
  { term: "AO", definition: "Arweave Operating System — a hyper-parallel compute environment where processes run as permanent on-chain programs with message-passing architecture.", category: "Arweave" },
  { term: "CU / MU", definition: "Compute Unit and Messenger Unit — the two core AO services. CU executes read-only evaluations (dryrun), MU handles signed message delivery.", category: "Arweave" },
  { term: "SmartWeave", definition: "A smart contract protocol on Arweave where contract logic is stored on-chain and state is lazily evaluated by reading interaction transactions.", category: "Arweave" },
  { term: "DRE", definition: "Distributed Resolution Environment — Warp's network of nodes that pre-compute and cache SmartWeave contract states for fast reads.", category: "Arweave" },
  { term: "PST", definition: "Profit Sharing Token — an Arweave SmartWeave token standard where holders earn a share of usage fees paid to the associated application.", category: "Arweave" },
  { term: "Atomic Asset", definition: "An Arweave NFT standard where the content data and the SmartWeave contract state live in a single transaction — the asset is its own contract.", category: "Arweave" },
  { term: "Supabase", definition: "An open-source Firebase alternative providing Postgres database, authentication, edge functions, and row-level security. MoneyFund uses it for user accounts and metadata.", category: "Platform" },
  { term: "Vault", definition: "MoneyFund's encrypted local key store. Private keys are AES-GCM encrypted with a user password and stored in the browser. Non-custodial — no server backup.", category: "Platform" },
  { term: "MFTL Token", definition: "MoneyFund Tri-Layer Token — any ERC-20 token deployed through the MoneyFund launchpad that connects to the tri-layer ecosystem.", category: "Platform" },
  { term: "PermaWrite", definition: "MoneyFund's permanent file storage system built on Arweave. Files are categorized, tagged, and stored forever with optional private/public visibility.", category: "Platform" },
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

function UDiagram({ label, boxes, desc, pathEnd, descSize }: {
  label: string;
  boxes: { left: { label: string; layer: string }; bottom: { label: string; layer: string }; right: { label: string; layer: string } };
  desc: string;
  pathEnd?: string;
  descSize?: string;
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
    <div className="flex flex-col items-center w-full max-w-[320px] mx-auto">
      <p className="text-base font-bold text-white mb-2 text-center">{label}</p>
      <div className={`${card} p-4 w-full`}>
        <svg viewBox="0 0 320 260" className="w-full h-auto" aria-label={`${label} U Diagram`}>
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
          {rightDollar ? (<>
            <circle cx="260" cy="36" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x="260" y="36" fill="black" fontSize="24" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
            <circle cx="290" cy="36" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x="290" y="36" fill="black" fontSize="24" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">$</text>
          </>) : (<>
            <circle cx="260" cy="42" r="15" fill="gold" stroke="#fff" strokeWidth="2" />
            <text x="260" y="42" fill="white" fontSize="18" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">?</text>
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
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export default function AboutApp() {
  const [activeSection, setActiveSection] = useState("overview");
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({});
  const [divCount, setDivCount] = useState(0);
  const [orbScale, setOrbScale] = useState(1);
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
    let dir = 1, sc = 1;
    const breathe = () => {
      sc += 0.002 * dir;
      if (sc >= 1.08) dir = -1;
      if (sc <= 0.96) dir = 1;
      setOrbScale(sc);
      rafId = requestAnimationFrame(breathe);
    };
    let rafId = requestAnimationFrame(breathe);
    return () => { clearInterval(interval); cancelAnimationFrame(rafId); };
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

      {/* ═══════════ ENTITY STRUCTURE ═══════════ */}
      <CompanyChart />

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

        {/* ═══════════ GETTING STARTED ═══════════ */}
        <section id="start" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="Set up your account and wallets in a few minutes">Getting Started</SectionHeading>

          <div className="space-y-3">
            {GETTING_STARTED_STEPS.map((s) => (
              <div key={s.step} className={`${card} overflow-hidden`}>
                <div className="flex items-start gap-4 p-5 sm:p-6">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/[0.08] flex items-center justify-center text-sm font-bold text-cyan-300/70 shrink-0">
                    {s.step}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-white/80 mb-1">{s.title}</h3>
                    <p className="text-xs text-white/45 leading-relaxed">{s.description}</p>
                    {s.link && (
                      <a href={s.link.href} className="inline-block mt-2 text-[10px] text-cyan-400/60 hover:text-cyan-300 uppercase tracking-wider font-semibold transition-colors">
                        {s.link.label} →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className={`${card} p-4 text-center`}>
            <p className="text-[10px] text-white/20 leading-relaxed">
              MoneyFund is non-custodial — you are responsible for backing up your mnemonic phrases and Arweave JWK files.
              There is no password reset or key recovery. Store backups securely offline.
            </p>
          </div>
        </section>

        {/* ═══════════ ARCHITECTURE ═══════════ */}
        <section id="architecture" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="How the frontend, backend, Ethereum, and Arweave layers connect">System Architecture</SectionHeading>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/60 leading-relaxed">
              MoneyFund is a multi-chain application spanning two blockchains (Ethereum and Arweave) with a Supabase backend for authentication, metadata storage, and serverless gateway proxying. The frontend is a single Next.js 16 application that communicates directly with both chains from the browser — private keys never leave the client. The architecture is designed for zero SDK dependencies on the Arweave side, using direct HTTP and GraphQL calls for maximum control and minimal bundle size.
            </p>
          </div>

          {/* Connection diagram */}
          <div className={`${card} p-5 sm:p-6`}>
            <div className="flex items-center justify-center gap-2 flex-wrap text-[10px] font-mono text-white/30 mb-4">
              <span className="px-2 py-1 rounded bg-cyan-500/10 text-cyan-300/60 border border-cyan-500/20">Browser</span>
              <span className="text-white/15">→</span>
              <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300/60 border border-blue-500/20">Supabase</span>
              <span className="text-white/15">→</span>
              <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300/60 border border-emerald-500/20">Ethereum</span>
              <span className="text-white/15">+</span>
              <span className="px-2 py-1 rounded bg-violet-500/10 text-violet-300/60 border border-violet-500/20">Arweave</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-center">
              {[
                { label: "Client Signing", desc: "All TX signing happens in the browser. Keys are AES-GCM encrypted in local vault.", color: "border-cyan-500/20" },
                { label: "Edge Proxy", desc: "Supabase Edge Functions route Arweave requests through the peer pool.", color: "border-blue-500/20" },
                { label: "Direct Peers", desc: "Arweave data fetched from discovered peer nodes. Public gateways as fallback only.", color: "border-violet-500/20" },
                { label: "Multi-RPC", desc: "Ethereum calls load-balanced across Infura, Ankr, and Cloudflare RPCs.", color: "border-emerald-500/20" },
              ].map((item) => (
                <div key={item.label} className={`rounded-xl bg-white/[0.02] border ${item.color} p-3`}>
                  <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1">{item.label}</p>
                  <p className="text-[10px] text-white/30 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stack layers */}
          <div className="space-y-4">
            {ARCH_LAYERS.map((layer) => (
              <div key={layer.label} className={`${layer.color} rounded-2xl border border-white/[0.06] overflow-hidden`}>
                <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${layer.dotColor}`} />
                  <h3 className="text-base font-bold text-white">{layer.label}</h3>
                </div>
                <div className="p-5 sm:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {layer.components.map((comp) => (
                      <div key={comp.name} className="space-y-1">
                        <p className="text-xs font-semibold text-white/70">{comp.name}</p>
                        <p className="text-[11px] text-white/40 leading-relaxed">{comp.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════ U-DIAGRAMS ═══════════ */}
        <section id="diagrams" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="How MoneyFund compares to equities and shitcoins">Value Flow Diagrams</SectionHeading>
          <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8 lg:gap-6">
            <UDiagram label="Equities" boxes={{ left: { label: "Business", layer: "asset" }, bottom: { label: "Shares", layer: "profit" }, right: { label: "Dividends", layer: "distribution" } }} desc="Unlike crypto, equities rely on fundamentals more than speculative degeneracy. While that tends to be positive, existing systems & structures are perhaps equally flawed in their own ways. Equity is made up out of thin air and thus carries ever-present risks like dilution and centralized control. There are basically two types: private equity + stocks. Private equity often requires you to be an accredited investor which is basically a rich person. This means poor people cant buy companies until they get listed on a public ponzi at massively inflated valuations. It's also difficult to fund many risky business endeavors with traditional systems because they're gatekept by boomers and regulators. For instance an IPO costs about 25 million dollars. The stock market has a number of familiar flaws like restricted trading hours. Due to the aforementioned inferiorities both of these analog asset types will be replaced by ERC-20 tokens. Summary of downsides: high friction, mutable supply, mutable dividends." />
            <UDiagram label="Shitcoins" boxes={{ left: { label: "Tokens", layer: "profit" }, bottom: { label: "Nothing", layer: "none" }, right: { label: "Nothing", layer: "none" } }} desc="This diagram represents 99% of cryptocurrencies & the larger problem MoneyFund seeks to solve. These are pointless nonsense coins which is only sustainable for top-quality memes. Certain cartoons are great for short-term gambling but the space has become predictably oversaturated with fagcoins that are resented by normal people. The main barrier to shitcoin adoption is their vapid uselessness. Besides coordinated wealth transfers, shitcoins are purposeless and thus automatically dismissed from the conversations of productive society. Despite significant shortcomings, tokens still outshine equities in many key ways. ERC-20 tokens operate on a decentralized network that ensures trustless & permissionless transacting 24/7 globally. The Ethereum blockchain is the oldest + largest smart contract platform in the world. This network effect, as well as the inherent composability of ERC-20 tokens, has allowed them to gain widespread adoption as the global standard for tokenized assets like stablecoins. Summary of downsides: people are tired of gay nonsense." />
            <UDiagram label="MoneyFunds" pathEnd="275" descSize="text-[7px]" boxes={{ left: { label: "Business", layer: "asset" }, bottom: { label: "Dividends", layer: "distribution" }, right: { label: "Tokens", layer: "profit" } }} desc="MoneyFund combines the sustainability of traditional business with the transparency + decentralization of the Ethereum blockchain. No more expensive IPOs, no more scam ICOs- the future is IMOs. Initial Money Offerings are the gold standard for tokenized asset deployment and all coins launched elsewhere should be dismissed & discredited. MFTL tokens allow for unlimited customization within secure parameters. This constrained flexibility allows MoneyFund infrastructure to facilitate the creation + management of uniquely productive assets. In addition to the benefits of being built on the largest defi network in the world, MF offers additional advantages over traditional equities- the largest two being transparency and immutability. For instance walmart can delist or change prices at any time whereas the storefronts produced by our factory include a listing timelock mechanism to enhance operational transparency. This is beneficial to users who are considering investing in some MFTL token thats connected to an NFT storefront for example. Users can view the store's inventory and timelocks to know the minimum duration that items will be locked in the storefront + listed at their current price for. This allows auditors to know how long the MFTL token will be backed by listings. Similarly, dividend immutability is a significant upgrade to the offchain tradfi model. Once a dividend pool is deployed nobody can make changes. Same thing for tokens- once a coin is launched the company it represents cannot dilute shareholders unless something like a mintable function is explicitly written in the contract. Summary of downsides: none." />
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
                transform: `scale(${orbScale})`,
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

        {/* ═══════════ TOKENOMICS ═══════════ */}
        <section id="tokenomics" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="MONEY token supply, burns, staking mechanics, and fee math">MONEY Tokenomics</SectionHeading>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TOKENOMICS_METRICS.map((m) => (
              <div key={m.label} className={`${card} p-4 text-center`}>
                <p className="text-[10px] text-white/30 uppercase tracking-wider font-medium">{m.label}</p>
                <p className="text-lg font-bold text-white mt-1">{m.value}</p>
                <p className="text-[10px] text-white/25 mt-0.5">{m.sub}</p>
              </div>
            ))}
          </div>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/60 leading-relaxed">
              The MONEY token has a fixed supply of 1 billion tokens with no minting function — the supply can only decrease through burns. Every ETF transaction burns 0.1% of the fee in MONEY, creating deflationary pressure proportional to platform usage. Revenue from all eight factory contracts is funneled into the MONEY dividend pool, where stakers earn a proportional share based on their staked amount relative to the total pool. Staking issues a transferable ERC-721 NFT, meaning staked positions can be traded on secondary markets like OpenSea while the underlying tokens remain locked.
            </p>
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="px-6 py-4 border-b border-white/[0.06]">
              <h3 className="text-sm font-bold text-white/80">Dividend & Fee Math</h3>
              <p className="text-[10px] text-white/30 mt-0.5">How rewards, penalties, and payouts are calculated</p>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {DIVIDEND_MATH.map((item) => (
                <div key={item.label} className="px-6 py-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-white/70">{item.label}</span>
                    <code className="text-[10px] font-mono text-cyan-300/50 bg-cyan-500/5 px-2 py-0.5 rounded border border-cyan-500/10">{item.formula}</code>
                  </div>
                  <p className="text-[11px] text-white/35 leading-relaxed">{item.example}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={`${card} p-5`}>
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Revenue Flow Summary</h3>
            <div className="space-y-2">
              {[
                { source: "All 8 factories", split: "50% MoneyFund Wallet + 50% MONEY Dividends", note: "Base platform fees" },
                { source: "ETF transactions", split: "0.125% + 0.125% + 0.1% MONEY burn", note: "Deflationary burn on every ETF trade" },
                { source: "Custom creator fees", split: "Up to 3% set by contract creators", note: "70% to creator receivers, 30% to MF" },
                { source: "DEX LP fees", split: "0.3% to liquidity providers", note: "Separate from the 0.1% + 0.1% MF fee" },
              ].map((item) => (
                <div key={item.source} className="flex items-start gap-3 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 mt-1.5 shrink-0" />
                  <div>
                    <span className="text-white/60 font-medium">{item.source}</span>
                    <span className="text-white/25 mx-2">→</span>
                    <span className="text-white/40">{item.split}</span>
                    <p className="text-[10px] text-white/20 mt-0.5">{item.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ CONTRACTS ═══════════ */}
        <section id="contracts" className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Detailed breakdown of each factory contract">Smart Contracts</SectionHeading>
          {CONTRACT_SECTIONS.map((c) => (
            <div key={c.title} className={`${layerBg(c.layer)} rounded-2xl border border-white/[0.06] overflow-hidden`}>
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
          ))}
        </section>

        {/* ═══════════ SECURITY ═══════════ */}
        <section id="security" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="Non-custodial design, on-chain immutability, and zero-trust architecture">Security Model</SectionHeading>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SECURITY_PRINCIPLES.map((p) => (
              <div key={p.title} className={`${card} overflow-hidden`}>
                <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
                  <span className="text-lg">{p.icon}</span>
                  <h3 className="text-sm font-bold text-white/80">{p.title}</h3>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-xs text-white/50 leading-relaxed">{p.description}</p>
                  <ul className="space-y-1.5">
                    {p.details.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-white/35 leading-relaxed">
                        <span className="w-1 h-1 rounded-full bg-emerald-400/60 mt-1.5 shrink-0" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          <div className={`${card} p-5`}>
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Audit Status</h3>
            <div className="space-y-2 text-xs text-white/45 leading-relaxed">
              <p>MoneyFund smart contracts have not yet undergone a formal third-party audit. The full Solidity source code (62,000+ lines) will be released for public audit once the MONEY token reaches a $1 million market cap.</p>
              <p>In the meantime, all contract actions are transparent on-chain — every function call, event emission, and state change is publicly verifiable via Etherscan. The contracts use established patterns (OpenZeppelin ReentrancyGuard, Checks-Effects-Interactions) and have been internally reviewed.</p>
            </div>
          </div>
        </section>

        {/* ═══════════ ARWEAVE ═══════════ */}
        <section id="arweave" className="space-y-8 scroll-mt-28">
          <SectionHeading sub="Permanent storage, decentralized compute, and peer-to-peer networking on Arweave">Arweave Infrastructure</SectionHeading>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/60 leading-relaxed">
              Arweave is a permanent data storage network that pays miners to store data forever in a single upfront transaction. MoneyFund integrates a full Arweave stack — from low-level peer networking and bundled uploads to high-level smart contract interactions and a permanent file archival system. All integrations use direct REST APIs with zero SDK dependencies, keeping the bundle lean and giving full control over request routing, error handling, and failover logic.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {(["storage", "network", "compute", "wallet"] as ArweaveFeatureLayer[]).map((key) => (
              <div key={key} className={`${arweaveLayerBg(key)} px-5 py-3 rounded-xl text-center min-w-[130px] border border-white/[0.06]`}>
                <div className="flex items-center justify-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${arweaveLayerDot(key)}`} />
                  <p className="text-sm font-bold text-white">{arweaveLayerLabel(key)}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {ARWEAVE_FEATURES.map((f) => (
              <div key={f.title} className={`${arweaveLayerBg(f.layer)} rounded-2xl border border-white/[0.06] overflow-hidden`}>
                <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${arweaveLayerDot(f.layer)}`} />
                  <span className="text-lg">{f.icon}</span>
                  <h3 className="text-base sm:text-lg font-bold text-white">{f.title}</h3>
                  <span className="text-[10px] font-bold text-white/20 uppercase tracking-wider ml-auto hidden sm:block">{arweaveLayerLabel(f.layer)}</span>
                </div>
                <div className="p-5 sm:p-6 space-y-4">
                  <p className="text-xs text-white/60 leading-relaxed">{f.summary}</p>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    {f.details.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-white/45 leading-relaxed">
                        <span className={`w-1 h-1 rounded-full ${arweaveLayerDot(f.layer)} mt-1.5 flex-shrink-0`} />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
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
                  <span className={`text-white/20 text-sm ml-3 flex-shrink-0 transition-transform ${faqOpen[i] ? "rotate-45" : ""}`}>+</span>
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
                  <input type="number" value={numTokens} onChange={(e) => setNumTokens(parseInt(e.target.value) || 1)} min={1} className={inputCls} />
                </div>
              )}
              {["singleToken", "multipleTokens", "eth"].includes(funcType) && (
                <div>
                  <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-1.5">Recipients</label>
                  <input type="number" value={numRecipients} onChange={(e) => setNumRecipients(parseInt(e.target.value) || 1)} min={1} className={inputCls} />
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

        {/* ═══════════ GLOSSARY ═══════════ */}
        <section id="glossary" className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Definitions of key terms used throughout the documentation">Glossary</SectionHeading>

          {(["Ethereum", "Arweave", "Platform"] as const).map((cat) => {
            const terms = GLOSSARY_TERMS.filter((t) => t.category === cat);
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className={`w-2 h-2 rounded-full ${cat === "Ethereum" ? "bg-emerald-400" : cat === "Arweave" ? "bg-violet-400" : "bg-cyan-400"}`} />
                  <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider">{cat}</h3>
                </div>
                <div className={`${card} overflow-hidden divide-y divide-white/[0.04]`}>
                  {terms.map((t) => (
                    <div key={t.term} className="px-5 py-3 flex items-start gap-4">
                      <code className="text-[11px] font-mono text-cyan-300/60 font-semibold shrink-0 min-w-[120px] sm:min-w-[160px] pt-0.5">{t.term}</code>
                      <p className="text-[11px] text-white/40 leading-relaxed">{t.definition}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <p className="text-center text-[11px] text-white/15 pt-8 pb-4">Powered by MoneyFund</p>
      </div>
    </div>
  );
}
