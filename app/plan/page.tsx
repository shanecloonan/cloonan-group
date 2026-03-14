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
      { title: "Extract shared design tokens", detail: "The same card, inputCls, selectCls, btnPrimary, btnGhost, btnGold, and labelCls strings are copy-pasted across every page component. Extract them into a single lib/ui-tokens.ts and import everywhere. This eliminates ~200 lines of duplication and ensures a single source of truth for styling.", files: "etf-app, dividends-app, dao-app, dex-app, auction-app, multiswap-app, storefront-app, airdrop-app, moneydividends-app, auth-panel", priority: "high" },
      { title: "Extract shared utility functions", detail: "The shorten(address) helper is duplicated in 10+ files. A storageGet/storageSet helper also appears in several. Centralize into lib/utils.ts.", files: "All *-app.tsx files", priority: "high" },
      { title: "Create shared WalletSelector component", detail: "Every contract page rebuilds the same wallet selector UI (select dropdown + MetaMask button + auth gate). This should be a single reusable component. The wallet-bar.tsx component exists but isn't used by most pages yet.", files: "etf-app, dividends-app, auction-app, multiswap-app, storefront-app, airdrop-app, moneydividends-app", priority: "high" },
      { title: "Unified getSigner() in wallet context", detail: "Each page independently decides whether to create a signer from MetaMask (Web3Provider) or a private key (ethers.Wallet). This logic should live in the wallet context as a getSigner() method that handles both cases and returns the correct signer.", files: "wallet-context.tsx, all contract pages", priority: "high" },
      { title: "Create shared useStatusLog hook", detail: "The log/status pattern (array of {msg, status, time} entries, logRef for scroll-to-bottom, addLog helper) is reimplemented in every contract page. Extract into a reusable useStatusLog() hook.", files: "etf-app, dividends-app, dao-app, dex-app, auction-app, multiswap-app, storefront-app", priority: "medium" },
      { title: "Migrate DAO and DEX to wallet context", detail: "The DAO and DEX pages still use their own MetaMask-only connection logic (window.ethereum directly) instead of the shared WalletProvider. They should use useWallet() for consistency with the rest of the app, enabling MoneyFund wallet support on those pages too.", files: "dao-app.tsx, dex-app.tsx", priority: "high" },
      { title: "Add React error boundaries", detail: "No error boundaries exist. An uncaught error in any contract interaction crashes the entire page. Add error boundaries around each page's main content to show a graceful fallback.", files: "layout.tsx or per-page", priority: "high" },
      { title: "Centralize RPC and API key configuration", detail: "Infura RPC URLs and Etherscan API keys are hardcoded in multiple files. Centralize into a single lib/config.ts that reads from environment variables, with a retry/fallback mechanism.", files: "All abis.ts files, wallets-app, dex-app", priority: "high" },
      { title: "Auth gate missing on some contract pages", detail: "Auction, multiswap, storefront, and moneydividends show the wallet selector UI without checking authentication state. They should show AuthPanel when !user || !vaultUnlocked, matching the pattern used by ETF and dividends. Auction imports AuthPanel but never renders it.", files: "auction-app.tsx, multiswap-app.tsx, storefront-app.tsx, moneydividends-app.tsx", priority: "high" },
      { title: "Silent error swallowing in wallet context", detail: "Several catch blocks in wallet-context.tsx silently swallow decryption errors and Supabase failures. These should at minimum be logged to console for debugging, or surfaced to the user when actionable.", files: "wallet-context.tsx", priority: "medium" },
      { title: "signIn skips vault key verification", detail: "Unlike unlockVault (which calls verifyKeyCheck), the signIn function derives the vault key and immediately loads wallets without verifying the key is correct. If a user resets their Supabase password, the derived key changes and all wallet decryptions silently fail — the user sees zero wallets with no error message. Fix: verify the derived key against key_check in signIn, same as unlockVault does.", files: "wallet-context.tsx", priority: "high" },
      { title: "addEthWallet race condition loses wallets on multi-import", detail: "addEthWallet reads ethWallets from the closure instead of using a functional updater (setEthWallets(prev => ...)). When importing multiple wallets in a loop, each call reads the same stale ethWallets array, and only the last wallet survives. Fix: use the functional form of the setter.", files: "wallet-context.tsx", priority: "high" },
      { title: "Inconsistent ERC20 ABI definitions across files", detail: "erc20Abi is defined differently in 7+ files: moneydividends uses full JSON with internalType, airdrop uses shorter JSON, storefront uses different param names, auction uses human-readable strings, dividends uses legacy constant:true format, dao uses a TOKEN_ABI subset, dex uses ERC20_ABI. This makes maintenance error-prone. Fix: define one canonical ERC20 ABI in lib/abis.ts and import everywhere.", files: "All abis.ts files", priority: "high" },
      { title: "Contract addresses mismatch between /contracts page and ABIs", detail: "Five launcher addresses shown on the /contracts page differ from those actually used in the corresponding abis.ts files: Dividends Launcher (0xdf1e... vs 0x5ef0...), DAO Launcher (0x8ef4... vs 0xc346...), Multiswap Launcher (0xe01f... vs 0x40af...), Ad-space Launcher (0x346a... vs 0xE01F...), Storefront Launcher (0x20c8... vs 0x15a3...). Either the display or the ABI is stale. Fix: audit which are correct and reconcile.", files: "contracts/page.tsx, all abis.ts", priority: "high" },
      { title: "Stale closure references in useCallback dependency arrays", detail: "Multiple specific instances: multiswap handleDeploy calls refreshContracts but omits it from deps. Storefront refreshLockers reads selectedEthAddress but omits it from deps. DEX toggle calls listPairs but omits it from deps (hidden by eslint-disable). These cause stale function references that may silently malfunction after state changes.", files: "multiswap-app.tsx, storefront-app.tsx, dex-app.tsx", priority: "medium" },
      { title: "State mutation via shallow array copy pattern", detail: "Several onChange handlers do `const n = [...arr]; n[i].prop = val; setArr(n)`. The spread creates a new array but elements are the same object references — n[i].prop mutates the original state object. This violates React's immutability contract and can cause bugs with concurrent features or React.memo. Fix: use .map() to create new objects at the changed index.", files: "multiswap-app.tsx (swapFees, airdropFees), storefront-app.tsx (shareholders)", priority: "medium" },
      { title: "selectEthWallet receives empty string instead of null", detail: "When the user selects the default 'Select a wallet...' option, e.target.value is '' which is passed directly to selectEthWallet. Other pages correctly coerce this with `|| null`. Passing an empty string causes the context to look for a wallet with address '' which won't match anything but also won't properly clear the selection.", files: "auction-app.tsx, multiswap-app.tsx", priority: "low" },
      { title: "No .env.example documenting required environment variables", detail: ".env files are in .gitignore but there is no .env.example or .env.local.example file. New developers have no documentation of which env vars are required (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and RPC/API keys once centralized).", files: "Project root", priority: "low" },
      { title: "Lint script misconfigured in package.json", detail: "The lint script is just 'eslint' with no path or config argument. It should be 'next lint' or 'eslint .' to actually scan the codebase. Also missing: typecheck script (tsc --noEmit), format script, and test script.", files: "package.json", priority: "low" },
      { title: "Airdrop page missing auth gate", detail: "Unlike ETF, dividends, etc. which check !user || !vaultUnlocked and show AuthPanel, the airdrop app doesn't import AuthPanel or destructure user/vaultUnlocked from useWallet at all. Users can see and use the full airdrop UI without authenticating.", files: "airdrop-app.tsx", priority: "high" },
    ],
  },
  {
    id: "func",
    icon: "⚡",
    label: "Functionality",
    color: "text-amber-400",
    dot: "bg-amber-400",
    items: [
      { title: "No chain ID verification in wallet context", detail: "The WalletProvider never checks the connected network's chain ID. Pages using useWallet() (ETF, multiswap, auction, storefront, airdrop, moneydividends) have no network safety check — users on BSC, Polygon, or any other chain will silently send transactions to the wrong network. Only DEX, DAO, and dividends check chainId because they connect independently via window.ethereum. Fix: add a chainId check and chainChanged listener in the wallet context, and expose a chainId state so pages can gate transactions.", files: "wallet-context.tsx, etf-app, multiswap-app, auction-app, storefront-app, airdrop-app, moneydividends-app", priority: "high" },
      { title: "MetaMask signer path incomplete on some pages", detail: "Several pages use selectedEthWallet.privateKey! (non-null assertion) without a MetaMask fallback. If a MetaMask wallet is selected, these pages will fail because MetaMask wallets have no privateKey in the context. Each page needs to check the wallet type and use Web3Provider for MetaMask.", files: "auction-app, storefront-app, airdrop-app, moneydividends-app", priority: "high" },
      { title: "Missing transaction hash copy/link", detail: "When a transaction succeeds, the hash appears only in the status log as truncated text. Users should be able to copy the full hash or click to view on Etherscan directly.", files: "All contract pages", priority: "medium" },
      { title: "No gas estimation before transactions", detail: "Users have no idea what a transaction will cost before confirming. Adding a pre-transaction gas estimate (using estimateGas) would improve confidence and reduce failed transactions.", files: "All contract pages", priority: "medium" },
      { title: "Form state not reset after successful actions", detail: "After launching an ETF, creating a DAO, deploying a multiswap, etc., the form fields retain their values. They should clear on success to signal completion and prepare for the next action.", files: "etf-app, dao-app, multiswap-app, storefront-app, auction-app", priority: "low" },
      { title: "DEX pair loading blocked without wallet", detail: "Loading and viewing DEX pair details is gated behind wallet connection, but reading pair data is a read-only operation that should work without a connected wallet.", files: "dex-app.tsx", priority: "medium" },
      { title: "Airdrop data stored only in localStorage", detail: "Master contacts, custom lists, and airdrop history are in localStorage and will be lost if the user clears browser data or switches devices. Since Supabase auth is now available, these could be synced to the database for authenticated users.", files: "airdrop-app.tsx", priority: "medium" },
      { title: "Contracts page has stale external links", detail: "Several entries on the contracts page link to moneyfund.com when internal routes exist (e.g., Coin Launcher links to moneyfund.com/deploy instead of an internal page). These should be updated as internal pages are built.", files: "contracts/page.tsx", priority: "low" },
      { title: "No refresh/polling for on-chain data", detail: "ETF prices, dividend pool balances, auction bids, and other on-chain data only update when the user manually triggers a refresh. Periodic polling (e.g., every 30s) or a manual refresh button on all pages would keep data current.", files: "All contract pages", priority: "medium" },
      { title: "Input validation gaps", detail: "Several forms accept invalid inputs: the gas calculator coerces 0 to 1 but allows negative values (parseInt('-5') is truthy, bypasses the || 1 fallback), auction fee rows don't validate addresses before deploy, and ETF token weights can exceed 100% without a clear error. Add client-side validation with inline error messages.", files: "about-app (gas calc), auction-app, etf-app", priority: "medium" },
      { title: "Wallet export downloads unencrypted private keys", detail: "The export wallets feature on the /wallets page downloads a JSON file with plaintext private keys. This should display a prominent warning and optionally encrypt the export file with a user-provided password.", files: "wallets-app.tsx", priority: "medium" },
      { title: "Reward tokens formatted with hardcoded 18 decimals", detail: "MoneyFund Dividends page uses formatEther (18 decimals) for all reward token amounts. Tokens like USDC (6 decimals) or WBTC (8 decimals) will display values off by orders of magnitude — e.g. 1,000,000 USDC raw would show as 0.000001. Fix: fetch decimals() for each reward token and use formatUnits(value, decimals).", files: "moneydividends-app.tsx", priority: "high" },
      { title: "Hardcoded gas estimation for airdrops can cause transaction reverts", detail: "The airdrop page uses a purely arithmetic gas estimate (base 60000 + 45000 per recipient + 20000 buffer) instead of calling contract.estimateGas. First-time transfers to new addresses cost ~25k more due to storage slot creation, so large airdrops to new addresses will consistently underestimate gas and revert. Fix: use contract.estimateGas.airdropTokens(...) and multiply by 1.2x buffer.", files: "airdrop-app.tsx", priority: "high" },
      { title: "ETF mint ETH value calculation may be double-scaled", detail: "etf-app.tsx computes totalWei = etfAmountWei.mul(weiPerEtf) where etfAmountWei is already in wei (1e18 scale) and weiPerEtf returns wei-per-one-whole-token. This produces a value 1e18x too large, sending vastly more ETH than intended as msg.value. Fix: divide by parseEther('1') after multiplication, or verify the contract's mintWithEth internally accounts for this.", files: "etf-app.tsx", priority: "high" },
      { title: "Vanity wallet generation blocks the main thread", detail: "The vanity mode runs a synchronous while(true) loop of up to 10,000 createRandom() calls on the main thread. A 3-hex-digit prefix (0x100) has ~1/4096 odds per attempt, so this typically runs thousands of iterations, freezing the entire browser UI for seconds. Fix: offload to a Web Worker or batch iterations with setTimeout to yield back to the event loop.", files: "wallets-app.tsx", priority: "medium" },
      { title: "Manual gas price option is non-functional", detail: "The wallets page collects gasPriceManual state and renders a 'Manual' gas price option in the Send form, but handleSend never reads gasPriceManual. The transaction is always sent without a gasPrice override regardless of the user's selection. Fix: when gasPriceOpt === 'manual', include gasPrice: parseUnits(gasPriceManual, 'gwei') in the transaction object.", files: "wallets-app.tsx", priority: "medium" },
      { title: "percentAppreciation.toNumber() can overflow", detail: "ETF card rendering calls etf.percentAppreciation.toNumber() which throws if the BigNumber exceeds Number.MAX_SAFE_INTEGER. For a long-running ETF with extreme appreciation this would crash the entire page render. Fix: use formatUnits or toString() with manual parsing.", files: "etf-app.tsx", priority: "medium" },
      { title: "Multiswap embed code uses hardcoded contract address", detail: "The 'Copy Embed Code' button always outputs a hardcoded address (0xDfEa...4cFc9) regardless of which multiswap contract the user has deployed. Fix: use the selected contract's actual address, or let the user select from their deployed contracts.", files: "multiswap-app.tsx", priority: "medium" },
      { title: "Single busy boolean blocks all concurrent operations", detail: "Auction, multiswap, and storefront pages use one global busy flag. While deploying, you cannot place a bid in a different auction. While depositing to one storefront, you can't buy from another. Fix: use per-action or per-contract busy states (e.g., Record<string, boolean>).", files: "auction-app.tsx, multiswap-app.tsx, storefront-app.tsx", priority: "medium" },
      { title: "Sequential DAO and proposal RPC loading is very slow", detail: "Every DAO is loaded sequentially, and within each DAO, every proposal is also loaded sequentially. With 10 DAOs averaging 5 proposals each, that's 50+ sequential RPC calls. Fix: use Promise.all to parallelize DAO loading and parallelize proposal loading within each DAO.", files: "dao-app.tsx", priority: "medium" },
      { title: "DAO action buttons lack loading/disabled states", detail: "Vote Yes, Vote No, Execute, and Reclaim buttons remain fully clickable while their async operations are in progress. Double-clicking can submit duplicate transactions. Fix: add per-action loading state to disable buttons during pending operations.", files: "dao-app.tsx", priority: "medium" },
      { title: "Arweave balance display truncated to whole AR", detail: "Balance calculation uses BigInt integer division (BigInt(winston) / BigInt(10**12)) which drops all fractional amounts. A user with 0.5 AR sees '0'. Fix: convert to Number and divide with decimal precision, e.g., (Number(winston) / 1e12).toFixed(6).", files: "arweave-wallet.tsx", priority: "medium" },
      { title: "Arweave fetch calls don't check response status", detail: "getBalance, getPrice, and getAnchor all call fetch() and immediately call res.text() without checking res.ok. A 404 or 500 response returns the error body as a string, which is then used as a numeric value (e.g., BigInt('Not Found') throws). Fix: add if (!res.ok) throw new Error(...) after each fetch.", files: "arweave-wallet.tsx", priority: "medium" },
      { title: "Arweave chunk upload errors silently ignored", detail: "Each chunk POST response during file upload is not checked for success. If a chunk fails (network error, server rejection), the upload continues and reports 'Uploaded!' at the end, but the file will be corrupted/incomplete on Arweave. Fix: check response status of each chunk upload and abort on failure.", files: "arweave-wallet.tsx", priority: "medium" },
      { title: "parseInt truncates decimal penalty values without warning", detail: "In dividends-app.tsx, parseInt(initPenalty) silently truncates decimals. If a user enters '30.5' for the initial penalty, parseInt returns 30 with no feedback. The input field has no step restriction preventing decimal entry. Fix: validate that initPenalty is an integer or use Math.round with a notification.", files: "dividends-app.tsx", priority: "low" },
      { title: "Unbounded log arrays in auction and multiswap pages", detail: "Unlike dividends (which keeps 100 entries) and airdrop (which keeps 50), the auction and multiswap log arrays grow without limit. Over a long session this will slow down rendering. Fix: add .slice(-100) or similar cap.", files: "auction-app.tsx, multiswap-app.tsx", priority: "low" },
      { title: "fetchRewardTokens continues past zero-address entries", detail: "The reward token loop in dividends-app continues on ADDRESS_ZERO instead of breaking, meaning a zero-address entry in the middle causes extra unnecessary RPC calls before the eventual revert breaks the loop. Fix: break on ADDRESS_ZERO if the contract uses it as a sentinel.", files: "dividends-app.tsx", priority: "low" },
      { title: "Unhandled MetaMask connection rejection on moneydividends page", detail: "connectMetaMask is passed directly as an onClick handler. The async function can reject (user cancels MetaMask popup), leading to an unhandled promise rejection in the console. Other pages wrap it in .catch(() => {}). Fix: wrap in a handler that catches the rejection.", files: "moneydividends-app.tsx", priority: "low" },
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
      { title: "Contracts page has a different visual theme", detail: "The /contracts page uses a purple gradient background (linear-gradient #1a0d2e → #0f0a1e) while every other page uses #08090e. It also uses a green glow border animation that doesn't appear elsewhere. Align with the unified dark glassmorphic theme.", files: "contracts/page.tsx", priority: "medium" },
      { title: "Focus ring color inconsistency", detail: "Some inputs use focus:border-indigo-400/60 (ETF, dividends, auction, multiswap, storefront) while others use focus:border-blue-400/60 (wallets page). Standardize to indigo across all pages for consistency.", files: "wallets-app.tsx, arweave-wallet.tsx", priority: "low" },
      { title: "Button gradient variations", detail: "ETF uses btnGold (amber gradient), dividends uses btnPrimary (indigo), multiswap has yet another style. While some variation is intentional for page identity, the core action buttons should follow a consistent hierarchy: primary (indigo), accent (gold), ghost (outline), danger (red).", files: "Multiple pages", priority: "low" },
      { title: "Max-width inconsistency across pages", detail: "Pages use different max-widths: 720px (wallets, DEX), 900px (multiswap), 1100px (ETF, dividends, DAO, about). The most polished pages use 1100px. Standardize to 1100px for all full-page layouts.", files: "dex-app, multiswap-app, wallets-app", priority: "low" },
      { title: "Missing loading skeletons", detail: "When ETF data, dividend pools, DAO lists, or auction data is loading, the page shows either nothing or a brief flash. Skeleton placeholders would provide better perceived performance and reduce layout shift.", files: "All contract pages", priority: "medium" },
      { title: "FAQ section has no expand/collapse animation", detail: "FAQ items on the /about page appear instantly when toggled. A smooth height transition would feel more polished. The +/× icon rotates but the content has no animation.", files: "about-app.tsx", priority: "low" },
      { title: "Toast notifications for transaction results", detail: "Success and error messages currently only appear in per-page status logs that are easy to miss (especially if scrolled off-screen). A global toast/notification system would ensure users always see transaction results.", files: "App-wide", priority: "medium" },
      { title: "Accessibility: missing ARIA attributes", detail: "The FAQ accordion lacks aria-expanded and aria-controls. Several form inputs lack proper label associations (htmlFor). These are WCAG AA compliance gaps.", files: "about-app.tsx, multiple forms", priority: "medium" },
      { title: "Color contrast below WCAG AA", detail: "Very muted text like text-white/15, text-white/20, and text-white/25 falls below the 4.5:1 contrast ratio requirement for normal text. The dimmest readable text should be around text-white/40 minimum.", files: "Multiple pages", priority: "medium" },
      { title: "Full Arweave private key displayed on screen", detail: "The 'Key Preview' section renders the entire RSA-4096 JWK private key (all components: d, p, q, dp, dq, qi, n, e) in the DOM via JSON.stringify(localJwk). Anyone viewing the screen or any browser extension with DOM access can capture it. Fix: only show the public key (n, e) or a fingerprint/hash of the key.", files: "arweave-wallet.tsx", priority: "high" },
      { title: "Copy and explorer buttons hidden on mobile on /contracts", detail: "The copy-address button and Etherscan explorer link both have 'hidden sm:inline-flex', making them invisible on mobile. These are the two most important actions on the contracts page. Fix: show them on mobile in a different layout (e.g., stacked or via tap on the address).", files: "contracts/page.tsx", priority: "medium" },
      { title: "Internal routes on contracts page open in new tabs", detail: "All 'go' links on the contracts page use target='_blank', including internal routes like /etf, /dividends, /multiswap. Same-site navigation should open in the same tab using Next.js Link. External links (moneyfund.com) can keep target='_blank'.", files: "contracts/page.tsx", priority: "medium" },
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
      { title: "About page orb animation triggers 60fps React re-renders", detail: "The dividend pool orb uses setOrbScale() inside a requestAnimationFrame loop, triggering a full React re-render ~60 times per second for a simple breathing animation. Combined with the 600ms setDivCount interval, the about page re-renders constantly. Fix: use CSS @keyframes with transform: scale() or a ref with direct DOM manipulation — no React state needed.", files: "about-app.tsx", priority: "high" },
      { title: "Duplicate SVG element IDs across UDiagram instances", detail: "Three UDiagram components are rendered on the about page, each emitting <defs> with identical IDs (ae, ai, al-grad, dl-grad, pl-grad). Duplicate IDs in the DOM are invalid HTML. Browsers may resolve url(#al-grad) to the first definition which works by accident, but this is unreliable across browsers. Fix: pass a unique prefix prop and use it in all ID references.", files: "about-app.tsx", priority: "medium" },
      { title: "Storefront form handlers not memoized with stale closure risk", detail: "updateDeposit and updateList are plain functions recreated every render. More critically, they call getDepositForm/getListForm which read from the stale closure (depositForms/listForms) rather than the setter's prev argument. Rapid sequential updates can lose data. Fix: inline the fallback inside the setter callback: setDepositForms(p => ({...p, [addr]: {...(p[addr] || defaults), [field]: value}})).", files: "storefront-app.tsx", priority: "medium" },
      { title: "Spinner component redefined inside render body", detail: "The Spinner component is defined as a const arrow function inside the EtfApp component body. It's recreated on every render, causing React to unmount and remount the spinner DOM nodes unnecessarily. Fix: move the Spinner definition outside the component or wrap in useMemo.", files: "etf-app.tsx", priority: "low" },
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
      { title: "API keys exposed in client bundle", detail: "The Infura and Etherscan API keys are hardcoded in client-side code and shipped in the JS bundle. They should be either moved to NEXT_PUBLIC_ env vars (still public but not hardcoded) or proxied through a Next.js API route to keep them server-side.", files: "wallets-app.tsx, dex-app.tsx, multiple abis.ts", priority: "high" },
      { title: "Airdrop localStorage logs grow without limit", detail: "Each airdrop adds N log entries (one per recipient) to localStorage. A 500-recipient airdrop adds 500 entries. Over time this can exceed localStorage limits (typically 5-10MB) and silently fail or throw. Fix: add a cap like .slice(0, 1000) when storing.", files: "airdrop-app.tsx", priority: "medium" },
      { title: "Missing metadata/SEO on contracts and plan pages", detail: "The contracts page and plan page are 'use client' components with no metadata export. Other pages correctly export metadata with title, description, and robots directives. Fix: either split into a server-component wrapper that exports metadata, or use generateMetadata.", files: "contracts/page.tsx, plan/page.tsx", priority: "low" },
      { title: "Unused exceljs dependency in package.json", detail: "exceljs is listed in dependencies but not imported anywhere in the codebase. It adds unnecessary bundle weight. html-to-image IS used by company-chart.tsx and should be kept. Fix: remove exceljs from dependencies.", files: "package.json", priority: "low" },
      { title: "Inconsistent RPC variable naming across ABIs", detail: "Different abis.ts files use different names for the same Infura endpoint: RPC_URL (moneydividends, airdrop, storefront, multiswap, auction), INFURA_RPC (dao, dividends), RPC_ENDPOINTS array (etf), and dex-app.tsx defines its own INFURA_RPC instead of importing. This makes it hard to change the RPC endpoint globally. Fix: centralize into lib/config.ts.", files: "All abis.ts files, dex-app.tsx", priority: "medium" },
    ],
  },
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

  const counts = { high: 0, medium: 0, low: 0 };
  for (const s of SECTIONS) for (const it of s.items) counts[it.priority]++;

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
        <div className="grid grid-cols-3 gap-3 mb-10">
          {(["high", "medium", "low"] as const).map((p) => {
            const cfg = PRIORITY_CONFIG[p];
            return (
              <div key={p} className={`${card} p-4 text-center`}>
                <p className="text-3xl font-bold text-white">{counts[p]}</p>
                <p className={`text-xs font-semibold uppercase tracking-wider mt-1 ${cfg.text}`}>{cfg.label} Priority</p>
              </div>
            );
          })}
        </div>

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

        {/* Items */}
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

        <p className="text-center text-[11px] text-white/10 pt-12">Auto-generated from codebase analysis</p>
      </div>
    </div>
  );
}
