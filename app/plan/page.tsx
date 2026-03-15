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
      { title: "Create shared WalletSelector component", detail: "Every contract page rebuilds the same wallet selector UI (select dropdown + MetaMask button + auth gate). This should be a single reusable component. The wallet-bar.tsx component exists but isn't used by most pages yet.", files: "etf-app, dividends-app, auction-app, multiswap-app, storefront-app, airdrop-app, moneydividends-app", priority: "high" },
      { title: "Create shared useStatusLog hook", detail: "The log/status pattern (array of {msg, status, time} entries, logRef for scroll-to-bottom, addLog helper) is reimplemented in every contract page. Extract into a reusable useStatusLog() hook.", files: "etf-app, dividends-app, dao-app, dex-app, auction-app, multiswap-app, storefront-app", priority: "medium" },
      { title: "Migrate DAO and DEX to wallet context", detail: "The DAO and DEX pages still use their own MetaMask-only connection logic (window.ethereum directly) instead of the shared WalletProvider. They should use useWallet() for consistency with the rest of the app, enabling MoneyFund wallet support on those pages too.", files: "dao-app.tsx, dex-app.tsx", priority: "high" },
      { title: "Silent error swallowing in wallet context", detail: "Several catch blocks in wallet-context.tsx silently swallow decryption errors and Supabase failures. These should at minimum be logged to console for debugging, or surfaced to the user when actionable.", files: "wallet-context.tsx", priority: "medium" },
      { title: "Stale closure references in useCallback dependency arrays", detail: "Multiple specific instances: multiswap handleDeploy calls refreshContracts but omits it from deps. Storefront refreshLockers reads selectedEthAddress but omits it from deps. DEX toggle calls listPairs but omits it from deps (hidden by eslint-disable). These cause stale function references that may silently malfunction after state changes.", files: "multiswap-app.tsx, storefront-app.tsx, dex-app.tsx", priority: "medium" },
      { title: "State mutation via shallow array copy pattern", detail: "Several onChange handlers do `const n = [...arr]; n[i].prop = val; setArr(n)`. The spread creates a new array but elements are the same object references — n[i].prop mutates the original state object. This violates React's immutability contract and can cause bugs with concurrent features or React.memo. Fix: use .map() to create new objects at the changed index.", files: "multiswap-app.tsx (swapFees, airdropFees), storefront-app.tsx (shareholders)", priority: "medium" },
      { title: "No .env.example documenting required environment variables", detail: ".env files are in .gitignore but there is no .env.example or .env.local.example file. New developers have no documentation of which env vars are required (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_INFURA_KEY, NEXT_PUBLIC_ETHERSCAN_KEY).", files: "Project root", priority: "low" },
      { title: "Lint script misconfigured in package.json", detail: "The lint script is just 'eslint' with no path or config argument. It should be 'next lint' or 'eslint .' to actually scan the codebase. Also missing: typecheck script (tsc --noEmit), format script, and test script.", files: "package.json", priority: "low" },
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
      { title: "DEX pair loading blocked without wallet", detail: "Loading and viewing DEX pair details is gated behind wallet connection, but reading pair data is a read-only operation that should work without a connected wallet.", files: "dex-app.tsx", priority: "medium" },
      { title: "Airdrop data stored only in localStorage", detail: "Master contacts, custom lists, and airdrop history are in localStorage and will be lost if the user clears browser data or switches devices. Since Supabase auth is now available, these could be synced to the database for authenticated users.", files: "airdrop-app.tsx", priority: "medium" },
      { title: "Contracts page has stale external links", detail: "Several entries on the contracts page link to moneyfund.com when internal routes exist (e.g., Coin Launcher links to moneyfund.com/deploy instead of an internal page). These should be updated as internal pages are built.", files: "contracts/page.tsx", priority: "low" },
      { title: "No refresh/polling for on-chain data", detail: "ETF prices, dividend pool balances, auction bids, and other on-chain data only update when the user manually triggers a refresh. Periodic polling (e.g., every 30s) or a manual refresh button on all pages would keep data current.", files: "All contract pages", priority: "medium" },
      { title: "Input validation gaps", detail: "Several forms accept invalid inputs: the gas calculator coerces 0 to 1 but allows negative values (parseInt('-5') is truthy, bypasses the || 1 fallback), auction fee rows don't validate addresses before deploy, and ETF token weights can exceed 100% without a clear error. Add client-side validation with inline error messages.", files: "about-app (gas calc), auction-app, etf-app", priority: "medium" },
      { title: "Wallet export downloads unencrypted private keys", detail: "The export wallets feature on the /wallets page downloads a JSON file with plaintext private keys. This should display a prominent warning and optionally encrypt the export file with a user-provided password.", files: "wallets-app.tsx", priority: "medium" },
      { title: "Vanity wallet generation blocks the main thread", detail: "The vanity mode runs a synchronous while(true) loop of up to 10,000 createRandom() calls on the main thread. A 3-hex-digit prefix (0x100) has ~1/4096 odds per attempt, so this typically runs thousands of iterations, freezing the entire browser UI for seconds. Fix: offload to a Web Worker or batch iterations with setTimeout to yield back to the event loop.", files: "wallets-app.tsx", priority: "medium" },
      { title: "Manual gas price option is non-functional", detail: "The wallets page collects gasPriceManual state and renders a 'Manual' gas price option in the Send form, but handleSend never reads gasPriceManual. The transaction is always sent without a gasPrice override regardless of the user's selection. Fix: when gasPriceOpt === 'manual', include gasPrice: parseUnits(gasPriceManual, 'gwei') in the transaction object.", files: "wallets-app.tsx", priority: "medium" },
      { title: "Multiswap embed code uses hardcoded contract address", detail: "The 'Copy Embed Code' button always outputs a hardcoded address (0xDfEa...4cFc9) regardless of which multiswap contract the user has deployed. Fix: use the selected contract's actual address, or let the user select from their deployed contracts.", files: "multiswap-app.tsx", priority: "medium" },
      { title: "Single busy boolean blocks all concurrent operations", detail: "Auction, multiswap, and storefront pages use one global busy flag. While deploying, you cannot place a bid in a different auction. While depositing to one storefront, you can't buy from another. Fix: use per-action or per-contract busy states (e.g., Record<string, boolean>).", files: "auction-app.tsx, multiswap-app.tsx, storefront-app.tsx", priority: "medium" },
      { title: "Sequential DAO and proposal RPC loading is very slow", detail: "Every DAO is loaded sequentially, and within each DAO, every proposal is also loaded sequentially. With 10 DAOs averaging 5 proposals each, that's 50+ sequential RPC calls. Fix: use Promise.all to parallelize DAO loading and parallelize proposal loading within each DAO.", files: "dao-app.tsx", priority: "medium" },
      { title: "DAO action buttons lack loading/disabled states", detail: "Vote Yes, Vote No, Execute, and Reclaim buttons remain fully clickable while their async operations are in progress. Double-clicking can submit duplicate transactions. Fix: add per-action loading state to disable buttons during pending operations.", files: "dao-app.tsx", priority: "medium" },
      { title: "parseInt truncates decimal penalty values without warning", detail: "In dividends-app.tsx, parseInt(initPenalty) silently truncates decimals. If a user enters '30.5' for the initial penalty, parseInt returns 30 with no feedback. The input field has no step restriction preventing decimal entry. Fix: validate that initPenalty is an integer or use Math.round with a notification.", files: "dividends-app.tsx", priority: "low" },
      { title: "Unbounded log arrays in auction and multiswap pages", detail: "Unlike dividends (which keeps 100 entries) and airdrop (which keeps 50), the auction and multiswap log arrays grow without limit. Over a long session this will slow down rendering. Fix: add .slice(-100) or similar cap.", files: "auction-app.tsx, multiswap-app.tsx", priority: "low" },
      { title: "fetchRewardTokens continues past zero-address entries", detail: "The reward token loop in dividends-app continues on ADDRESS_ZERO instead of breaking, meaning a zero-address entry in the middle causes extra unnecessary RPC calls before the eventual revert breaks the loop. Fix: break on ADDRESS_ZERO if the contract uses it as a sentinel.", files: "dividends-app.tsx", priority: "low" },
      { title: "Race condition in DAO refresh with no cancellation", detail: "refreshDAOs depends on account. Connecting a wallet recreates refreshDAOs and triggers the useEffect. If a refresh is already in-flight, there's no cancellation — two concurrent refreshes can race and the stale one may overwrite the fresh results. Fix: add an AbortController or cancelled flag in the effect cleanup.", files: "dao-app.tsx", priority: "medium" },
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
      { title: "Color contrast below WCAG AA", detail: "Very muted text like text-white/15, text-white/20, and text-white/25 falls below the 4.5:1 contrast ratio requirement for normal text. The dimmest readable text should be around text-white/40 minimum.", files: "Multiple pages", priority: "medium" },
      { title: "Homepage lacks call-to-action or navigation guidance", detail: "The homepage shows only a hero section and company chart. There are no buttons, links, or guidance to direct users to Wallets, About, or Contracts. A first-time visitor has only the navbar. Fix: add CTA buttons below the hero (e.g., 'Get Started', 'View Contracts', 'Launch Your Fund').", files: "app/page.tsx", priority: "medium" },
      { title: "Dividend pool details grid unreadable on small mobile", detail: "The pool details section uses 'grid grid-cols-3' without a responsive prefix. On small mobile screens, 3 columns of detailed pool information will be cramped and unreadable. Fix: use 'grid grid-cols-1 sm:grid-cols-3' to stack on mobile.", files: "dividends-app.tsx", priority: "medium" },
      { title: "Help toggle icons not keyboard-accessible", detail: "The '?' help toggle icons on the ETF page are <span> elements with onClick but no role='button', tabIndex={0}, or onKeyDown handler. They're completely unreachable by keyboard users. Fix: change to <button> elements or add the missing ARIA attributes.", files: "etf-app.tsx", priority: "low" },
      { title: "Form inputs lack htmlFor/id label associations", detail: "Labels throughout the app (ETF name, symbol, weights; auth panel email/password; etc.) use <label className=...> without htmlFor, and inputs have no id. Screen readers can't associate labels with their inputs. Fix: add matching htmlFor and id attributes, or nest inputs inside labels.", files: "etf-app.tsx, auth-panel.tsx, dividends-app.tsx, others", priority: "low" },
      { title: "SEO description uses 'Hedge Fun' pun", detail: "The metadata description in layout.tsx says 'Hedge Fun' which is the intentional pun for the visible tagline. However, the meta description is used by search engines — users searching for 'hedge fund' won't find 'hedge fun'. Fix: use 'Hedge Fund' in the meta description while keeping the pun in the visible UI.", files: "layout.tsx", priority: "low" },
    ],
  },
  {
    id: "perf",
    icon: "⏱",
    label: "Performance",
    color: "text-emerald-400",
    dot: "bg-emerald-400",
    items: [
      { title: "Chart.js loaded eagerly on /about", detail: "The entire Chart.js library (~200KB) is imported at the top of about-app.tsx and loaded even if the user never scrolls to the fee chart or gas calculator. Use next/dynamic with ssr:false to lazy-load the chart sections.", files: "about-app.tsx", priority: "medium" },
      { title: "Heavy contract pages should use dynamic imports", detail: "Pages like ETF, dividends, and DAO pull in ethers.js and large ABIs. Using next/dynamic for the main app component on each page would enable code splitting and faster initial load.", files: "All page.tsx files", priority: "medium" },
      { title: "ethers.js import could be tree-shaken", detail: "Most files do import { ethers } from 'ethers' which imports the entire library. Using granular imports (e.g., from ethers/lib/utils) where possible would reduce bundle size.", files: "All files importing ethers", priority: "low" },
      { title: "ETF card list re-renders entirely on any state change", detail: "When any state in etf-app.tsx changes (e.g., typing in an input), all ETF cards re-render. Extracting ETF cards into a memoized component would prevent unnecessary renders.", files: "etf-app.tsx", priority: "low" },
      { title: "Wallet context value triggers full re-renders", detail: "The WalletProvider's value object has a large dependency array in useMemo. Any change (e.g., selecting a wallet) causes all context consumers to re-render. Consider splitting into separate contexts (AuthContext + WalletContext) or using selectors.", files: "wallet-context.tsx", priority: "low" },
      { title: "Manrope font not loaded globally", detail: "The ETF page sets fontFamily: 'Manrope' inline but Manrope isn't loaded in the root layout. Either add it via next/font or remove the reference to prevent FOUT.", files: "etf-app.tsx, layout.tsx", priority: "low" },
      { title: "Duplicate SVG element IDs across UDiagram instances", detail: "Three UDiagram components are rendered on the about page, each emitting <defs> with identical IDs (ae, ai, al-grad, dl-grad, pl-grad). Duplicate IDs in the DOM are invalid HTML. Browsers may resolve url(#al-grad) to the first definition which works by accident, but this is unreliable across browsers. Fix: pass a unique prefix prop and use it in all ID references.", files: "about-app.tsx", priority: "medium" },
      { title: "Storefront form handlers not memoized with stale closure risk", detail: "updateDeposit and updateList are plain functions recreated every render. More critically, they call getDepositForm/getListForm which read from the stale closure (depositForms/listForms) rather than the setter's prev argument. Rapid sequential updates can lose data. Fix: inline the fallback inside the setter callback: setDepositForms(p => ({...p, [addr]: {...(p[addr] || defaults), [field]: value}})).", files: "storefront-app.tsx", priority: "medium" },
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
      { title: "Airdrop localStorage logs grow without limit", detail: "Each airdrop adds N log entries (one per recipient) to localStorage. A 500-recipient airdrop adds 500 entries. Over time this can exceed localStorage limits (typically 5-10MB) and silently fail or throw. Fix: add a cap like .slice(0, 1000) when storing.", files: "airdrop-app.tsx", priority: "medium" },
      { title: "Missing metadata/SEO on contracts and plan pages", detail: "The contracts page and plan page are 'use client' components with no metadata export. Other pages correctly export metadata with title, description, and robots directives. Fix: either split into a server-component wrapper that exports metadata, or use generateMetadata.", files: "contracts/page.tsx, plan/page.tsx", priority: "low" },
      { title: "Unused exceljs dependency in package.json", detail: "exceljs is listed in dependencies but not imported anywhere in the codebase. It adds unnecessary bundle weight. html-to-image IS used by company-chart.tsx and should be kept. Fix: remove exceljs from dependencies.", files: "package.json", priority: "low" },
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
    <div className="min-h-screen" style={{ background: "#08090e" }}>
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
