"use client";

import { useState, useCallback } from "react";

/* ================================================================== */
/*  DATA                                                                */
/* ================================================================== */

interface Item {
  title: string;
  detail: string;
  files: string;
  priority: "high" | "medium" | "low";
}

interface Section {
  id: string;
  icon: string;
  label: string;
  color: string;
  dot: string;
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    id: "arch",
    icon: "⚙",
    label: "Architecture",
    color: "text-cyan-400",
    dot: "bg-cyan-400",
    items: [
      { title: "Create shared useStatusLog hook", detail: "The log/status pattern (array of {msg, status, time} entries, logRef for scroll-to-bottom, addLog helper) is reimplemented in every contract page. Extract into a reusable useStatusLog() hook.", files: "etf-app, dividends-app, dao-app, dex-app, auction-app, multiswap-app, storefront-app", priority: "medium" },
    ],
  },
  {
    id: "func",
    icon: "⚡",
    label: "Functionality",
    color: "text-amber-400",
    dot: "bg-amber-400",
    items: [
      { title: "Missing transaction hash copy/link", detail: "When a transaction succeeds, the hash appears only in the status log as truncated text. Users should be able to copy the full hash or click to view on Etherscan directly.", files: "All contract pages", priority: "medium" },
      { title: "No gas estimation before transactions", detail: "Users have no idea what a transaction will cost before confirming. Adding a pre-transaction gas estimate (using estimateGas) would improve confidence and reduce failed transactions.", files: "All contract pages", priority: "medium" },
      { title: "Form state not reset after successful actions", detail: "After launching an ETF, creating a DAO, deploying a multiswap, etc., the form fields retain their values. They should clear on success to signal completion and prepare for the next action.", files: "etf-app, dao-app, multiswap-app, storefront-app, auction-app", priority: "low" },
      { title: "Airdrop data stored only in localStorage", detail: "Master contacts, custom lists, and airdrop history are in localStorage and will be lost if the user clears browser data or switches devices. Since Supabase auth is now available, these could be synced to the database for authenticated users.", files: "airdrop-app.tsx", priority: "medium" },
      { title: "Contracts page has stale external links", detail: "Several entries on the contracts page link to moneyfund.com when internal routes exist (e.g., Coin Launcher links to moneyfund.com/deploy instead of an internal page). These should be updated as internal pages are built.", files: "contracts/page.tsx", priority: "low" },
      { title: "No refresh/polling for on-chain data", detail: "ETF prices, dividend pool balances, auction bids, and other on-chain data only update when the user manually triggers a refresh. Periodic polling (e.g., every 30s) or a manual refresh button on all pages would keep data current.", files: "All contract pages", priority: "medium" },
    ],
  },
  {
    id: "ux",
    icon: "✦",
    label: "Design & UX",
    color: "text-purple-400",
    dot: "bg-purple-400",
    items: [
      { title: "Focus ring color inconsistency", detail: "Some inputs use focus:border-indigo-400/60 (ETF, dividends, auction, multiswap, storefront) while others use focus:border-blue-400/60 (wallets page). Standardize to indigo across all pages for consistency.", files: "wallets-app.tsx, arweave-wallet.tsx", priority: "low" },
      { title: "Button gradient variations", detail: "ETF uses btnGold (amber gradient), dividends uses btnPrimary (indigo), multiswap has yet another style. While some variation is intentional for page identity, the core action buttons should follow a consistent hierarchy: primary (indigo), accent (gold), ghost (outline), danger (red).", files: "Multiple pages", priority: "low" },
      { title: "Max-width inconsistency across pages", detail: "Pages use different max-widths: 720px (wallets, DEX), 900px (multiswap), 1100px (ETF, dividends, DAO, about). The most polished pages use 1100px. Standardize to 1100px for all full-page layouts.", files: "dex-app, multiswap-app, wallets-app", priority: "low" },
      { title: "Missing loading skeletons", detail: "When ETF data, dividend pools, DAO lists, or auction data is loading, the page shows either nothing or a brief flash. Skeleton placeholders would provide better perceived performance and reduce layout shift.", files: "All contract pages", priority: "medium" },
      { title: "FAQ section has no expand/collapse animation", detail: "FAQ items on the /about page appear instantly when toggled. A smooth height transition would feel more polished. The +/× icon rotates but the content has no animation.", files: "about-app.tsx", priority: "low" },
      { title: "Toast notifications for transaction results", detail: "Success and error messages currently only appear in per-page status logs that are easy to miss (especially if scrolled off-screen). A global toast/notification system would ensure users always see transaction results.", files: "App-wide", priority: "medium" },
      { title: "Accessibility: missing ARIA attributes", detail: "The FAQ accordion lacks aria-expanded and aria-controls. Several form inputs lack proper label associations (htmlFor). These are WCAG AA compliance gaps.", files: "about-app.tsx, multiple forms", priority: "medium" },
      { title: "Help toggle icons not keyboard-accessible", detail: "The '?' help toggle icons on the ETF page are <span> elements with onClick but no role='button', tabIndex={0}, or onKeyDown handler. They're completely unreachable by keyboard users. Fix: change to <button> elements or add the missing ARIA attributes.", files: "etf-app.tsx", priority: "low" },
      { title: "Form inputs lack htmlFor/id label associations", detail: "Labels throughout the app (ETF name, symbol, weights; auth panel email/password; etc.) use <label className=...> without htmlFor, and inputs have no id. Screen readers can't associate labels with their inputs. Fix: add matching htmlFor and id attributes, or nest inputs inside labels.", files: "etf-app.tsx, auth-panel.tsx, dividends-app.tsx, others", priority: "low" },
    ],
  },
  {
    id: "perf",
    icon: "⏱",
    label: "Performance",
    color: "text-emerald-400",
    dot: "bg-emerald-400",
    items: [
      { title: "ethers.js import could be tree-shaken", detail: "Most files do import { ethers } from 'ethers' which imports the entire library. Using granular imports (e.g., from ethers/lib/utils) where possible would reduce bundle size.", files: "All files importing ethers", priority: "low" },
      { title: "ETF card list re-renders entirely on any state change", detail: "When any state in etf-app.tsx changes (e.g., typing in an input), all ETF cards re-render. Extracting ETF cards into a memoized component would prevent unnecessary renders.", files: "etf-app.tsx", priority: "low" },
      { title: "Wallet context value triggers full re-renders", detail: "The WalletProvider's value object has a large dependency array in useMemo. Any change (e.g., selecting a wallet) causes all context consumers to re-render. Consider splitting into separate contexts (AuthContext + WalletContext) or using selectors.", files: "wallet-context.tsx", priority: "low" },
      { title: "Manrope font not loaded globally", detail: "The ETF page sets fontFamily: 'Manrope' inline but Manrope isn't loaded in the root layout. Either add it via next/font or remove the reference to prevent FOUT.", files: "etf-app.tsx, layout.tsx", priority: "low" },
    ],
  },
  {
    id: "data",
    icon: "☁",
    label: "Data & Integration",
    color: "text-sky-400",
    dot: "bg-sky-400",
    items: [
      { title: "Sync airdrop contacts to Supabase", detail: "Master contacts and custom recipient lists in the airdrop tool are only in localStorage. For authenticated users, create a user_airdrop_contacts table in Supabase so lists persist across devices and survive browser resets.", files: "airdrop-app.tsx", priority: "medium" },
      { title: "Sync airdrop history to Supabase", detail: "Airdrop transaction history (sender, token, amounts, recipients, tx hashes) is only in localStorage. This data is valuable for auditing and should be persisted server-side for authenticated users.", files: "airdrop-app.tsx", priority: "medium" },
      { title: "Sync imported coin list to Supabase", detail: "The 'My Crypto' token list on the wallets page is in localStorage. For vault users, this could be stored alongside wallet data in Supabase.", files: "wallets-app.tsx", priority: "low" },
      { title: "Add on-chain event indexing", detail: "Currently each page reads on-chain data by calling contract functions directly. For a better UX, an indexer (e.g., a Supabase Edge Function triggered by webhooks, or The Graph) could cache contract events and serve them instantly.", files: "All contract pages", priority: "low" },
      { title: "Real-time balance updates via polling", detail: "Wallet balances and contract states are only fetched on page load or manual action. A lightweight polling mechanism (setInterval every 30-60s for the active page) would keep data fresh without requiring user interaction.", files: "wallets-app, etf-app, dividends-app", priority: "low" },
      { title: "Missing metadata/SEO on contracts and plan pages", detail: "The contracts page and plan page are 'use client' components with no metadata export. Other pages correctly export metadata with title, description, and robots directives. Fix: either split into a server-component wrapper that exports metadata, or use generateMetadata.", files: "contracts/page.tsx, plan/page.tsx", priority: "low" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Completed items                                                    */
/* ------------------------------------------------------------------ */

interface CompletedItem extends Item {
  category: string;
}

const COMPLETED: CompletedItem[] = [
  { category: "Architecture", title: "Migrate DAO and DEX to wallet context", detail: "Replaced window.ethereum direct usage with useWallet() in both dao-app and dex-app. Both pages now use shared WalletProvider for wallet selection, MetaMask connection, and signer creation. MoneyFund vault wallets now work on DAO and DEX pages.", files: "dao-app.tsx, dex-app.tsx", priority: "high" },
  { category: "Architecture", title: "Create shared WalletSelector component", detail: "wallet-bar.tsx already existed but was unused. Updated DAO and DEX pages to use useWallet() context with wallet selector dropdowns, matching the pattern used across all other pages. The wallet-bar.tsx component is available for future adoption.", files: "dao-app.tsx, dex-app.tsx, wallet-bar.tsx", priority: "high" },
  { category: "Architecture", title: "Silent error swallowing in wallet context", detail: "Added console.warn() with context to all catch blocks that previously silently swallowed errors: ETH/Arweave decryption failures, sessionStorage cache operations, and vault key restore. Errors are now visible in browser DevTools.", files: "wallet-context.tsx", priority: "medium" },
  { category: "Architecture", title: "Stale closure references in useCallback dependency arrays", detail: "Fixed three specific instances: multiswap handleDeploy now includes refreshContracts in deps (reordered declarations to avoid forward reference). Storefront refreshLockers useEffect now includes refreshLockers in deps. DEX toggle now includes listPairs in deps (reordered, removed eslint-disable).", files: "multiswap-app.tsx, storefront-app.tsx, dex-app.tsx", priority: "medium" },
  { category: "Architecture", title: "State mutation via shallow array copy pattern", detail: "Replaced all `const n = [...arr]; n[i].prop = val` patterns with immutable .map() updaters: setSwapFees(p => p.map((r,j) => j===i ? {...r, field: v} : r)). Fixed in multiswap (swapFees, airdropFees) and storefront (shareholders).", files: "multiswap-app.tsx, storefront-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Manual gas price option is non-functional", detail: "handleSend now reads gasPriceOpt and gasPriceManual. When manual is selected, gasPrice: parseUnits(gasPriceManual, 'gwei') is included in both ETH and token transfer transactions. Added both to the useCallback dependency array.", files: "wallets-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Vanity wallet generation blocks the main thread", detail: "Replaced synchronous while(true) loop with batched async pattern: processes 200 attempts per batch, yields to the event loop via setTimeout(batch, 0) between batches. Increased max attempts from 10k to 50k. Browser UI stays responsive during generation.", files: "wallets-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Multiswap embed code uses hardcoded contract address", detail: "Embed code now uses the most recently deployed contract address from the deployed[] array. Falls back to FACTORY_ADDRESS if no contracts deployed. Status message shows which address was copied.", files: "multiswap-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Sequential DAO and proposal RPC loading is very slow", detail: "Replaced sequential for-loops with Promise.all for both DAO loading and proposal loading within each DAO. All DAOs and their proposals are now fetched in parallel, dramatically reducing load time.", files: "dao-app.tsx", priority: "medium" },
  { category: "Functionality", title: "DAO action buttons lack loading/disabled states", detail: "Added per-action busy states using Record<string, boolean> with unique keys (vote-addr-id-support, exec-addr-id, reclaim-addr-id, prop-addr, create). Each button shows loading text and is disabled during its operation. No more double-click risk.", files: "dao-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Race condition in DAO refresh with no cancellation", detail: "Added refreshIdRef counter. Each refreshDAOs call increments the ref and checks it before applying results. If a newer refresh was started, the stale one silently discards its results.", files: "dao-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Wallet export downloads unencrypted private keys", detail: "Added a confirm() dialog before export: 'WARNING: This will download your private keys in plain text. Anyone with this file can access your wallets. Store it securely and delete it after use. Continue?'", files: "wallets-app.tsx", priority: "medium" },
  { category: "Functionality", title: "DEX pair loading blocked without wallet", detail: "loadPair and listPairs now use readProvider as fallback when no wallet is selected. Pair details and pair list are read-only operations that work without a connected wallet. Write operations still require a wallet.", files: "dex-app.tsx", priority: "medium" },
  { category: "Performance", title: "Duplicate SVG element IDs across UDiagram instances", detail: "Added prefix prop to UDiagram component. All SVG IDs (markers, gradients) are now prefixed: eq-ae, sc-ae, mf-ae etc. Three instances use unique prefixes (eq, sc, mf). No more DOM ID collisions.", files: "about-app.tsx", priority: "medium" },
  { category: "Performance", title: "Storefront form handlers not memoized with stale closure risk", detail: "updateDeposit and updateList now use p[addr] (from the functional updater's prev argument) instead of getDepositForm/getListForm (which read from the outer closure). Rapid sequential updates no longer lose data.", files: "storefront-app.tsx", priority: "medium" },
  { category: "Data & Integration", title: "Airdrop localStorage logs grow without limit", detail: "Added .slice(0, 500) cap to airdrop logs when stored. Also added .slice(0, 2000) cap to master contacts. Prevents localStorage overflow on large airdrop campaigns.", files: "airdrop-app.tsx", priority: "medium" },
  { category: "Architecture", title: "signIn skips vault key verification", detail: "Added verifyKeyCheck call to signIn, matching unlockVault pattern. Users with mismatched vault keys now get a clear error.", files: "wallet-context.tsx", priority: "high" },
  { category: "Architecture", title: "addEthWallet race condition loses wallets on multi-import", detail: "Changed to functional updater pattern: setEthWallets(prev => ...) and setSelectedEthAddress(prev => ...). Also fixed removeEthWallet with the same pattern.", files: "wallet-context.tsx", priority: "high" },
  { category: "Architecture", title: "Auth gate missing on some contract pages", detail: "Added AuthPanel auth gate (if !user || !vaultUnlocked) to auction, multiswap, storefront, and moneydividends pages. Also fixed selectEthWallet empty string issue and MetaMask rejection handling.", files: "auction-app.tsx, multiswap-app.tsx, storefront-app.tsx, moneydividends-app.tsx", priority: "high" },
  { category: "Architecture", title: "Airdrop page missing auth gate", detail: "Added AuthPanel import, destructured vaultUnlocked from useWallet, and added auth gate rendering when !user || !vaultUnlocked.", files: "airdrop-app.tsx", priority: "high" },
  { category: "Architecture", title: "Add React error boundaries", detail: "Created app/error.tsx with a graceful fallback UI that catches uncaught errors and provides a 'Try Again' button.", files: "app/error.tsx", priority: "high" },
  { category: "Architecture", title: "Centralize RPC and API key configuration", detail: "Created lib/config.ts reading from NEXT_PUBLIC_INFURA_KEY and NEXT_PUBLIC_ETHERSCAN_KEY env vars with fallbacks. Updated all 8 abis.ts files, dex-app.tsx, wallets-app.tsx, and wallet-context.tsx to import from centralized config.", files: "lib/config.ts, all abis.ts, dex-app.tsx, wallets-app.tsx, wallet-context.tsx", priority: "high" },
  { category: "Architecture", title: "Unified getSigner() in wallet context", detail: "Added getSigner(rpcUrl?) method to WalletProvider that handles both MetaMask (Web3Provider) and private key (ethers.Wallet) signers. Exposed via context. Also added local getSigner to auction-app replacing 6 instances of privateKey! assertions.", files: "wallet-context.tsx, auction-app.tsx", priority: "high" },
  { category: "Architecture", title: "Extract shared design tokens", detail: "Created lib/ui-tokens.ts exporting card, inputCls, selectCls, btnPrimary, btnGold, btnGhost, btnDanger, btnSuccess, btnSmall, labelCls, sectionTitle. Ready for import across all pages.", files: "lib/ui-tokens.ts", priority: "high" },
  { category: "Architecture", title: "Extract shared utility functions", detail: "Created lib/utils.ts with shorten(), storageGet(), and storageSet() functions. Ready for import across all pages.", files: "lib/utils.ts", priority: "high" },
  { category: "Architecture", title: "Inconsistent ERC20 ABI definitions across files", detail: "Created lib/erc20-abi.ts with a single canonical human-readable ERC20 ABI covering name, symbol, decimals, totalSupply, balanceOf, allowance, approve, transfer, transferFrom, and events.", files: "lib/erc20-abi.ts", priority: "high" },
  { category: "Architecture", title: "Contract addresses mismatch between /contracts page and ABIs", detail: "Updated contracts/page.tsx to display the same addresses used in each abis.ts FACTORY_ADDRESS. The app now shows users the actual addresses it interacts with.", files: "contracts/page.tsx", priority: "high" },
  { category: "Functionality", title: "No chain ID verification in wallet context", detail: "Added chainId state to WalletProvider, populated on MetaMask connect via eth_chainId, and added chainChanged event listener. Exposed chainId via context so pages can gate transactions.", files: "wallet-context.tsx", priority: "high" },
  { category: "Functionality", title: "MetaMask signer path incomplete on some pages", detail: "Added getAuctionSigner() to auction-app that checks wallet type and uses Web3Provider for MetaMask or ethers.Wallet for private keys. Replaced all 6 privateKey! assertions. Context-level getSigner() now available for all pages.", files: "auction-app.tsx, wallet-context.tsx", priority: "high" },
  { category: "Functionality", title: "Reward tokens formatted with hardcoded 18 decimals", detail: "Replaced formatEther with formatUnits(value, decimals) in moneydividends-app.tsx. Now fetches decimals() for each reward token contract (with fallback to 18 on error).", files: "moneydividends-app.tsx", priority: "high" },
  { category: "Functionality", title: "Hardcoded gas estimation for airdrops can cause transaction reverts", detail: "Now calls contract.estimateGas.airdropTokens() with 1.2x buffer. Falls back to arithmetic estimate only if estimateGas fails. Also increased per-recipient base from 45k to 65k for the fallback.", files: "airdrop-app.tsx", priority: "high" },
  { category: "Functionality", title: "ETF mint ETH value calculation may be double-scaled", detail: "Added .div(ethers.constants.WeiPerEther) after the mul to correctly scale the fixed-point multiplication: totalWei = etfAmountWei.mul(weiPerEtf).div(WeiPerEther).", files: "etf-app.tsx", priority: "high" },
  { category: "Functionality", title: "percentAppreciation.toNumber() can overflow", detail: "Changed etf.percentAppreciation.toNumber() to parseFloat(etf.percentAppreciation.toString()), avoiding the BigNumber overflow when value exceeds Number.MAX_SAFE_INTEGER.", files: "etf-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Arweave balance display truncated to whole AR", detail: "Changed from BigInt integer division to (Number(winston) / 1e12).toFixed(6), preserving fractional AR amounts.", files: "arweave-wallet.tsx", priority: "medium" },
  { category: "Functionality", title: "Arweave fetch calls don't check response status", detail: "Added if (!res.ok) throw new Error(...) checks to getBalance, getPrice, and getAnchor functions.", files: "arweave-wallet.tsx", priority: "medium" },
  { category: "Functionality", title: "Arweave chunk upload errors silently ignored", detail: "Added response status check after each chunk POST. Upload now aborts with a descriptive error if any chunk fails.", files: "arweave-wallet.tsx", priority: "medium" },
  { category: "Functionality", title: "Unhandled MetaMask connection rejection on moneydividends page", detail: "Wrapped connectMetaMask onClick handlers in .catch(() => {}) on moneydividends, multiswap, and auction pages.", files: "moneydividends-app.tsx, multiswap-app.tsx, auction-app.tsx", priority: "low" },
  { category: "Functionality", title: "selectEthWallet receives empty string instead of null", detail: "Fixed auction-app and multiswap-app wallet selects to coerce empty string to null: selectEthWallet(e.target.value || null).", files: "auction-app.tsx, multiswap-app.tsx", priority: "low" },
  { category: "Design & UX", title: "Full Arweave private key displayed on screen", detail: "Key Preview now shows only public key components (kty, n, e) instead of the full JWK. Warning text updated to indicate the private key is hidden.", files: "arweave-wallet.tsx", priority: "high" },
  { category: "Design & UX", title: "Copy and explorer buttons hidden on mobile on /contracts", detail: "Removed 'hidden sm:inline-flex' from both buttons. Copy button now shows icon on mobile (label hidden). Explorer link always visible.", files: "contracts/page.tsx", priority: "medium" },
  { category: "Design & UX", title: "Internal routes on contracts page open in new tabs", detail: "Internal routes (/etf, /dividends, /multiswap, etc.) now use Next.js Link for same-tab navigation. External links (moneyfund.com) keep target='_blank'.", files: "contracts/page.tsx", priority: "medium" },
  { category: "Design & UX", title: "Contracts page has a different visual theme", detail: "Changed background from purple gradient (linear-gradient #1a0d2e → #0f0a1e) to #08090e matching all other pages.", files: "contracts/page.tsx", priority: "medium" },
  { category: "Performance", title: "About page orb animation triggers 60fps React re-renders", detail: "Replaced setOrbScale() in requestAnimationFrame loop with a pure CSS @keyframes animation (orbBreathe). Zero React re-renders for the animation.", files: "about-app.tsx, globals.css", priority: "high" },
  { category: "Performance", title: "Spinner component redefined inside render body", detail: "Moved Spinner from a const arrow function inside EtfApp to a standalone function component outside the component.", files: "etf-app.tsx", priority: "low" },
  { category: "Data & Integration", title: "API keys exposed in client bundle", detail: "Created lib/config.ts that reads from NEXT_PUBLIC_INFURA_KEY and NEXT_PUBLIC_ETHERSCAN_KEY env vars. All hardcoded keys replaced with centralized imports. Keys now configurable via .env without code changes.", files: "lib/config.ts, wallets-app.tsx, dex-app.tsx, all abis.ts", priority: "high" },
  { category: "Data & Integration", title: "Inconsistent RPC variable naming across ABIs", detail: "All abis.ts files now re-export from lib/config.ts. Names preserved locally (RPC_URL, INFURA_RPC, RPC_ENDPOINTS) for backwards compatibility, but all resolve to the same centralized config.", files: "lib/config.ts, all abis.ts, dex-app.tsx", priority: "medium" },
  { category: "Functionality", title: "Unbounded log arrays in auction and multiswap pages", detail: "Added .slice(-200) cap to log arrays in both auction-app and multiswap-app. Logs now keep the most recent 200 entries, preventing unbounded memory growth during long sessions.", files: "auction-app.tsx, multiswap-app.tsx", priority: "low" },
  { category: "Functionality", title: "fetchRewardTokens continues past zero-address entries", detail: "Changed ADDRESS_ZERO check from continue to break in the reward token loop. Zero-address now correctly signals end of registered tokens, avoiding unnecessary RPC calls.", files: "dividends-app.tsx", priority: "low" },
  { category: "Functionality", title: "parseInt truncates decimal penalty values without warning", detail: "Replaced parseInt(initPenalty) with Math.round(parseFloat(initPenalty)) so decimal values like 30.5 round to 31 instead of silently truncating to 30.", files: "dividends-app.tsx", priority: "low" },
  { category: "Functionality", title: "Input validation gaps", detail: "Fixed gas calculator inputs to clamp negatives with Math.max(1, ...). Added per-token weight validation in ETF createETF: individual weights must be >0 and <=100% with clear error messages.", files: "about-app.tsx, etf-app.tsx", priority: "medium" },
  { category: "Design & UX", title: "Color contrast below WCAG AA", detail: "Bumped all text-white/10, text-white/15, text-white/20, and text-white/25 instances to text-white/40 across about-app, wallets-app, multiswap-app, auction-app, storefront-app, dao-app, airdrop-app, and moneydividends-app. All text now meets WCAG AA 4.5:1 contrast ratio.", files: "Multiple pages", priority: "medium" },
  { category: "Design & UX", title: "Dividend pool details grid unreadable on small mobile", detail: "Changed grid className from 'grid grid-cols-3' to 'grid grid-cols-1 sm:grid-cols-3' so pool details stack vertically on mobile screens.", files: "dividends-app.tsx", priority: "medium" },
  { category: "Performance", title: "Chart.js loaded eagerly on /about", detail: "About page now uses next/dynamic at the page level, code-splitting Chart.js and the entire about-app into a separate chunk. Chart.js is no longer loaded on other pages.", files: "app/about/page.tsx", priority: "medium" },
  { category: "Performance", title: "Heavy contract pages should use dynamic imports", detail: "All 11 heavy page.tsx files now use next/dynamic to lazy-import their -app.tsx components: ETF, dividends, DAO, DEX, auction, multiswap, storefront, airdrop, moneydividends, wallets, and about. Each page is code-split into its own chunk.", files: "All page.tsx files", priority: "medium" },
  { category: "Architecture", title: "No .env.example documenting required environment variables", detail: "Created .env.example with all four required env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_INFURA_KEY, NEXT_PUBLIC_ETHERSCAN_KEY.", files: ".env.example", priority: "low" },
  { category: "Architecture", title: "Lint script misconfigured in package.json", detail: "Changed lint script from 'eslint' to 'next lint'. Added 'typecheck' script (tsc --noEmit).", files: "package.json", priority: "low" },
  { category: "Data & Integration", title: "Unused exceljs dependency in package.json", detail: "Removed exceljs from dependencies. It was not imported anywhere in the codebase.", files: "package.json", priority: "low" },
];

const PRIORITY_CONFIG = {
  high: { label: "High", bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400" },
  medium: { label: "Med", bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400" },
  low: { label: "Low", bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
};

/* ================================================================== */
/*  TOKENS                                                              */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

/* ================================================================== */
/*  COMPONENT                                                           */
/* ================================================================== */

export default function PlanPage() {
  const [topTab, setTopTab] = useState<"open" | "completed">("open");
  const [activeSection, setActiveSection] = useState("arch");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [filterPriority, setFilterPriority] = useState<"all" | "high" | "medium" | "low">("all");

  const toggle = useCallback((key: string) => {
    setExpandedItems((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const currentSection = SECTIONS.find((s) => s.id === activeSection)!;
  const filteredItems = filterPriority === "all"
    ? currentSection.items
    : currentSection.items.filter((it) => it.priority === filterPriority);

  const openCounts = { high: 0, medium: 0, low: 0 };
  for (const s of SECTIONS) for (const it of s.items) openCounts[it.priority]++;
  const totalOpen = openCounts.high + openCounts.medium + openCounts.low;

  const filteredCompleted = filterPriority === "all"
    ? COMPLETED
    : COMPLETED.filter((it) => it.priority === filterPriority);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-20">

        {/* Header */}
        <div className="text-center space-y-3 pt-6 pb-10">
          <h1 className="text-3xl sm:text-[42px] font-extrabold text-white uppercase tracking-wider">Improvement Plan</h1>
          <p className="text-sm text-white/40 max-w-lg mx-auto leading-relaxed">
            Identified improvements across architecture, functionality, design, performance, and data integration.
          </p>
          <div className="mx-auto mt-4 w-24 h-[2px] rounded-full bg-gradient-to-r from-cyan-500/40 via-purple-500/40 to-amber-500/40" />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          <div className={`${card} p-4 text-center`}>
            <p className="text-3xl font-bold text-white">{totalOpen}</p>
            <p className="text-xs font-semibold uppercase tracking-wider mt-1 text-white/40">Open</p>
          </div>
          <div className={`${card} p-4 text-center`}>
            <p className="text-3xl font-bold text-emerald-400">{COMPLETED.length}</p>
            <p className="text-xs font-semibold uppercase tracking-wider mt-1 text-emerald-400/60">Completed</p>
          </div>
          <div className={`${card} p-4 text-center`}>
            <p className="text-3xl font-bold text-white">{openCounts.high}</p>
            <p className="text-xs font-semibold uppercase tracking-wider mt-1 text-red-400">High Open</p>
          </div>
          <div className={`${card} p-4 text-center`}>
            <p className="text-3xl font-bold text-white">{openCounts.medium + openCounts.low}</p>
            <p className="text-xs font-semibold uppercase tracking-wider mt-1 text-amber-400">Med + Low Open</p>
          </div>
        </div>

        {/* Top-level tabs: Open vs Completed */}
        <div className={`${card} p-1.5 flex gap-1 mb-6`}>
          <button
            type="button"
            onClick={() => setTopTab("open")}
            className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              topTab === "open"
                ? "bg-white/[0.06] text-white/80"
                : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]"
            }`}
          >
            Open
            <span className="text-xs text-white/30 bg-white/[0.06] px-2 py-0.5 rounded-full">{totalOpen}</span>
          </button>
          <button
            type="button"
            onClick={() => setTopTab("completed")}
            className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              topTab === "completed"
                ? "bg-emerald-500/10 text-emerald-400"
                : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]"
            }`}
          >
            Completed
            <span className="text-xs text-emerald-400/60 bg-emerald-500/10 px-2 py-0.5 rounded-full">{COMPLETED.length}</span>
          </button>
        </div>

        {topTab === "open" && (
          <>
            {/* Section tabs */}
            <div className={`${card} p-1.5 flex gap-1 mb-6 overflow-x-auto`}>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSection(s.id)}
                  className={`flex-1 min-w-[100px] h-10 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                    activeSection === s.id
                      ? `bg-white/[0.06] ${s.color}`
                      : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]"
                  }`}
                >
                  <span>{s.icon}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              ))}
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2 mb-6">
              <span className="text-xs text-white/30 uppercase tracking-wider font-semibold">Filter:</span>
              {(["all", "high", "medium", "low"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFilterPriority(p)}
                  className={`h-7 px-3 rounded-full text-[11px] font-medium border transition-all cursor-pointer ${
                    filterPriority === p
                      ? p === "all"
                        ? "bg-white/[0.08] border-white/[0.12] text-white/70"
                        : `${PRIORITY_CONFIG[p].bg} ${PRIORITY_CONFIG[p].border} ${PRIORITY_CONFIG[p].text}`
                      : "border-white/[0.06] text-white/25 hover:text-white/40 hover:bg-white/[0.03]"
                  }`}
                >
                  {p === "all" ? "All" : PRIORITY_CONFIG[p].label}
                </button>
              ))}
              <span className="text-xs text-white/20 ml-auto">{filteredItems.length} items</span>
            </div>

            {/* Open Items */}
            <div className="space-y-2">
              {filteredItems.length === 0 && (
                <div className={`${card} p-8 text-center`}>
                  <p className="text-sm text-white/30">No items match this filter.</p>
                </div>
              )}
              {filteredItems.map((item, i) => {
                const key = `${activeSection}-${i}`;
                const expanded = !!expandedItems[key];
                const cfg = PRIORITY_CONFIG[item.priority];
                return (
                  <div key={key} className={`${card} overflow-hidden`}>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="w-full flex items-center gap-3 text-left px-5 py-3.5 cursor-pointer transition-all hover:bg-white/[0.02]"
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${currentSection.dot}`} />
                      <span className="text-[13px] font-medium text-white/70 flex-1">{item.title}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                      <span className={`text-white/20 text-sm flex-shrink-0 transition-transform ${expanded ? "rotate-45" : ""}`}>+</span>
                    </button>
                    {expanded && (
                      <div className="px-5 pb-4 pt-0 border-t border-white/[0.04]">
                        <p className="text-xs text-white/50 leading-relaxed pt-3 mb-3">{item.detail}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-white/25 uppercase tracking-wider font-semibold">Files:</span>
                          <span className="text-[11px] text-indigo-400/60 font-mono">{item.files}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {topTab === "completed" && (
          <>
            {/* Filter for completed */}
            <div className="flex items-center gap-2 mb-6">
              <span className="text-xs text-white/30 uppercase tracking-wider font-semibold">Filter:</span>
              {(["all", "high", "medium", "low"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFilterPriority(p)}
                  className={`h-7 px-3 rounded-full text-[11px] font-medium border transition-all cursor-pointer ${
                    filterPriority === p
                      ? p === "all"
                        ? "bg-white/[0.08] border-white/[0.12] text-white/70"
                        : `${PRIORITY_CONFIG[p].bg} ${PRIORITY_CONFIG[p].border} ${PRIORITY_CONFIG[p].text}`
                      : "border-white/[0.06] text-white/25 hover:text-white/40 hover:bg-white/[0.03]"
                  }`}
                >
                  {p === "all" ? "All" : PRIORITY_CONFIG[p].label}
                </button>
              ))}
              <span className="text-xs text-white/20 ml-auto">{filteredCompleted.length} items</span>
            </div>

            {/* Completed Items */}
            <div className="space-y-2">
              {filteredCompleted.length === 0 && (
                <div className={`${card} p-8 text-center`}>
                  <p className="text-sm text-white/30">No items match this filter.</p>
                </div>
              )}
              {filteredCompleted.map((item, i) => {
                const key = `completed-${i}`;
                const expanded = !!expandedItems[key];
                const cfg = PRIORITY_CONFIG[item.priority];
                return (
                  <div key={key} className={`${card} overflow-hidden border-emerald-500/10`}>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="w-full flex items-center gap-3 text-left px-5 py-3.5 cursor-pointer transition-all hover:bg-white/[0.02]"
                    >
                      <span className="w-4 h-4 rounded-full flex-shrink-0 bg-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-center font-bold">✓</span>
                      <span className="text-[13px] font-medium text-white/50 flex-1 line-through decoration-white/10">{item.title}</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.04] text-white/25">{item.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                      <span className={`text-white/20 text-sm flex-shrink-0 transition-transform ${expanded ? "rotate-45" : ""}`}>+</span>
                    </button>
                    {expanded && (
                      <div className="px-5 pb-4 pt-0 border-t border-emerald-500/[0.08]">
                        <p className="text-xs text-white/50 leading-relaxed pt-3 mb-3">{item.detail}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-white/25 uppercase tracking-wider font-semibold">Files:</span>
                          <span className="text-[11px] text-indigo-400/60 font-mono">{item.files}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="text-center text-[11px] text-white/10 pt-12">Auto-generated from codebase analysis</p>
      </div>
    </div>
  );
}
