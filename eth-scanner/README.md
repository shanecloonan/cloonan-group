# eth-scanner — Ethereum-only invariant pipeline

Defensive static triage for Ethereum contracts. Automation emits **buckets**, never a human verdict. Heuristic flags are **leads**, never findings.

Triage UI: **`/test`** on this site (noindex, not in public nav). **Run** kicks Lane A for one address (or a local fixture). Scanner runtime is the Python CLI (`python -m eth_scanner`) spawned by `POST /api/test/run`, not the public marketing pages.

On Vercel the Node serverless image has no system Python. `next build` (when `VERCEL=1`) downloads a pinned portable CPython into `eth-scanner/.runtime/python` and Next file-tracing ships it plus `eth-scanner/src` and the Lane A fixtures with `/api/test/run`. If that binary is missing at request time, the route can lazy-install the same pin under `/tmp`. Override with `ETH_SCANNER_PYTHON`. Local `next dev` still uses `python3` / `python` on PATH.

## Hard rules

- Ethereum only.
- Read-only explorer / RPC / local source. **No** exploit code, attack payloads, PoCs, theft simulations, or live fund-moving transactions.
- **Never auto-yes.** **Never auto-no** on low IR or decompile confidence → `manual-review`.
- Heimdall / Panoramix are hypothesis generators only (`src_confidence=low`).
- Attack fuzz / local-fork theft sims are out of scope.
- Service-role Supabase writes are server-side only. Do not prefix secrets with `NEXT_PUBLIC_`.

Filtration: `docs/ETH_SWEEP_SCANNING_REFERENCE.md` §6.0 (also copied under this package’s parent `docs/`).

## Scope — funds at risk only

Lane A is a **picker** for venues that regularly *hold or account* other people’s value. It is not a funds-at-risk oracle and never a verdict. If the contract does not look like a place where third-party funds sit, it is cool-archived.

| Lane scope | Contract class | What happens |
|---|---|---|
| **in-scope** (main path) | `lending` · `vault` · `staking` · `pool` · `bridge` · `maker` | Family promote → `lane-b-queue` |
| **in-scope** | `custody` (generic hold, no family) | S5/S6 heat / TVL / weirdness. Prefer false keep. |
| **demoted-token** | `token` · `wrap-token` · `nft` | Cool-archive (`lane-a-cool`). **TVL does not promote.** |
| **demoted-passthrough** | `router` · `nft-market` | Cool-archive. Pass-through swap routers and atomic NFT settlement do not hold funds. |
| **utility** | no custody movers | S4 close / cool |

**In-scope examples:** Aave V2/V3 pools, Compound cTokens / Comet, Morpho Blue, Balancer Vault, ERC-4626 / Yearn vaults / Maker Pot / Maker Join / UsdsJoin / DssLitePsm / Gearbox PoolV3, staking / MasterChef / Convex / Aura / EigenLayer / Lido-style pooled ETH / Lido WithdrawalQueue / Kelp LRTDepositPool / Renzo RestakeManager / Rocket Pool rETH + DepositPool / Swell swETH / rswETH / ether.fi LiquidityPool / Mantle LSP Staking + UnstakeRequestsManager / Liquid Collective LsETH / Curve gauges, Uni V2 pairs / Uni V3 *pools* / Uni V4 *PoolManager* / Curve / crvUSD LLAMMA / Pendle *markets* (reserve custody), Maker VAT, Across / Hop / Optimism portal / OP StandardBridge / Arbitrum Inbox / Polygon EtherPredicate / FxPortal token tunnels / Scroll L1 messenger+ETH/WETH gateway / Starknet StarkGate / zkSync Mailbox / SynapseBridge / Linea TokenBridge / Wormhole TokenBridge / Celer cBridge / other lock-release bridges, SparkLend / Liquity TroveManager + BorrowerOperations / Liquity V2 TroveManager + StabilityPool / Fluid Liquidity / Gearbox CreditManager / crvUSD Controller / Euler EVault / FraxlendPair / Yearn V3 / PufferVault / Maple syrupUSDC-USDT / Enzyme VaultLib / Origin OETHVault / Treehouse tETH Vault + TAsset + RedemptionV3 / Sommelier Cellar / TermRepoCollateralManager + TermRepoLocker / Veda BoringVault + withdraw queue / Upshift institutional / Mellow ALM vault / Mellow ERC20RootVault / Concrete async vault / Reserve Folio + BackingManager / Stargate V2 pools / CCIP LockReleaseTokenPool, GMX-like GLP vaults, unnamed ETH/token piggy-banks (`withdraw` of `address(this).balance`). Fluid Liquidity *proxy-only* blobs whose modules are missing stay `custody` (`diamond-facets-missing`); the Etherscan DummyImpl ABI surface is `lending`. Aave/Spark WrappedTokenGateway, CoW GPv2Settlement, Sky DaiUsds, Compound CometRewards, Maple SyrupRouter, Stargate V2 TokenMessaging, TreehouseRouter, and Usual DaoCollateral are pass-through. Aave/Spark PoolAddressesProvider and Reserve FolioDeployer are utility (registry / factory).

**Hybrids stay in-scope:** a token that is also a vault, lending market, AMM, or staking pool (cToken, 4626 share token, Curve LP, stETH) is classified as the venue, never demoted as a token. Prefer false keep.

**Demoted / excluded:** plain ERC-20 (USDT, USDC, Dai, …) including mint/burn/rescue admin tokens (`rescueERC20`, `recoverFrozenFunds`, `forceMint` / `forceBurn`, `minter_mint` / `minter_burn_from`, Reserve RToken `issueTo` / `redeemTo` / `melt` / `monetizeDonations`, …) and DSS `move`/`push`/`pull` aliases; WETH / wstETH / weETH / rsETH-wrap / ezETH-wrap / cbETH / wOETH-like share-wraps; Uni V3 *SwapRouter*, Uni V2 *Router02*, 1inch / Universal Router, Pendle *Action* / *PendleRouterV4* diamond facets, CoW GPv2Settlement, Sky DaiUsds, Compound CometRewards, Maple SyrupRouter, Stargate V2 TokenMessaging, TreehouseRouter, Usual DaoCollateral, Veda Teller, and similar pass-throughs; Aave/Spark PoolAddressesProvider (registry); Reserve FolioDeployer (factory); ERC-721/1155 collections; Seaport-style atomic fulfill/match with no escrow. `transfer` / `approve` / `totalSupply` / `transferOwnership` are noise here. The eETH / rsETH / ezETH / mETH / frxETH *tokens* are share receipts (LiquidityPool / LRTDepositPool / RestakeManager / Mantle staking / Frax redemption hold the ETH). cbETH is an oracle `exchangeRate` wrap (Coinbase holds ETH). wOETH wraps rebasing OETH. eUSD RToken is a token (basket sits on BackingManager).

**Do Not Auto-Dismiss:** unverified / failed IR / failed unpack / rate-limited ingest / truly ambiguous *non-token* auth still go to `manual-review`, never silent `no`.

Signals live in `heuristics/scope.py`. Funds-at-risk family tags are checked *before* ERC-20/721 shape so a pool that calls `IERC20.transferFrom` is never demoted as a token. Imported `IERC20` / `IUniswapV3Pool` / `IWETH9` on a Uni V3 *SwapRouter* do not flip it to `custody` — pass-through still demotes. Imported `IUniswapV3SwapCallback` / `uniswapV2Call` on a Uni V3 *pool* or Uni V2 pair do not flip it to `router` — reserve AMMs stay in-scope as `pool` (`Slot0 public override slot0`, mint/collect/burn/swap/flash). Etherscan `ContractName` scopes family identity to that contract plus `is` parents *and* `using Lib for` libraries — a Sourcify tree that also ships sibling `Morpho.sol` must not flip MetaMorpho to lending. Name aliases include `Pool`/`PoolInstance`, version suffixes, `Impl`/`Facet`/`Interface`. `yVault` vs `Vault` is intentionally **not** aliased. Diamond loupes that miss facet files prefer false keep (`diamond-facets-missing`); a diamond *router* facet still cools. Yearn `uint256 public pricePerShare` and Vyper `def pricePerShare` tag `yearn-share-price` (live yvUSDC `0xa354…C4DE`, yvWETH `0xa258…68c`, yvDAI `0xdA81…c95`: Etherscan `ContractName=Vyper_contract`, compiler `vyper:0.2.12`). Live Across Hub (`0xc186…Eda`) Sourcify `HubPool` file movers include `addLiquidity` / `proposeRootBundle` / `executeRootBundle`. Live Pendle Market (wstETH 30DEC2027 `0x342808…Be3b`) is `pool`; PendleRouterV4 thin diamond stays cool. Dai is a DSS token, not Vat. weETH / rsETH-wrap / ezETH-wrap / cbETH / wOETH are wrap-tokens. Hop L1 ERC20 (`0x3666…18a`, `L1_ERC20_Bridge`) is the live verified Hop lock — L1 ETH (`0xb890…777f`) is still unverified on Etherscan and Sourcify (Pass 25 re-checked; keep the shape fixture). Diamond / EIP-2535 loupes that miss facet files prefer false keep. A named OZ `TransparentUpgradeableProxy` / `ERC1967Proxy` / `EIP173Proxy` shell must not inherit sibling `depositV3` (Resolv / Lombard Sourcify trees) — stay `diamond-facets-missing` and classify the impl. Aragon `AppProxyUpgradeable` (Lido stETH `0xae7a…e84`) used to cool as utility (`delegatedFwd`, no delegatecall+fallback) — stay diamond-facets-missing; classify the Lido impl. SynapseBridge impl is `bridge` (`depositAndSwap`+`mintAndSwap`+`kappaExists`) — must not win as `eth-custody-withdraw`. Linea TokenBridge is `bridge` (`bridgeToken`+`completeBridging`). Wormhole TokenBridge is `bridge` (`completeTransfer`+`attestToken`). Celer cBridge is `bridge` (`addNativeLiquidity`+`decWithdrawMsg`). Pass 25 hunt: no new unique FAR pin. Residual Sourcify+Etherscan 404s stay unverified (Hop L1 ETH, Goldfinch Senior impl, scrvUSD, RateX, rswETH, Stader StakePoolManager, Eigen stETH Strategy, StakeWise VaultGenesis, Blast/Mantle L1, Linea L1 Message, Karak VaultSupervisor, Inception instETH, Symbiotic DefaultCollateral). Honest keeps and OZ/Aragon thin-proxy `diamond-facets-missing` unchanged. LZ EndpointV2 / Hyperlane Mailbox / Axelar Gateway stay prefer-false-keep. ether.fi LiquidityPool is `staking` (`getTotalPooledEther`+`requestWithdraw`) — imported EigenLayer `exchange` must not steal `curve-pool`. TreehouseRouter and Usual DaoCollateral cool. tETH Vault / TAsset / RedemptionV3 are vaults. USD0++ stays generic custody (holds USD0 until unwrap). eUSD RToken cools as a token. Reserve Folio is 4626; FolioDeployer cools; BackingManager is a vault (`forwardRevenue`+`grantRTokenAllowance`). Mantle Staking is `stake/reward`; UnstakeRequestsManager is `mantle-unstake-queue`. CCIP LockReleaseTokenPool is `bridge` (`lockOrBurn`+`releaseOrMint`+`provideLiquidity`). FraxlendPair is `lending` (`borrowAsset`+`repayAsset`). Sommelier Cellar is `vault` (`callOnAdaptor`+`addPosition`). TermRepoCollateralManager / TermRepoLocker are vaults. Liquid Collective LsETH is `staking`. Veda BoringVault is `vault` (`enter`+`exit`+`manage`); the Teller cools (`depositAndBridge`+`shareLockPeriod` — lzReceive is not a lock); the on-chain queue is a vault. Upshift institutional is `vault` (`lockCapital`+`claimDailyInterest`). Mellow ALM vault is `vault` (`transferAndPush`+`reclaimTokens`). Mellow ERC20RootVault is `vault` (`hasSubvault`+`addDepositorsToAllowlist`). Concrete async vault impls are `vault` (`cachedTotalAssets`+`claimWithdrawal`) — proxy-only blobs stay diamond-facets-missing. Clearpool PoolMaster impl is already lending-ix. Liquity V2 TroveManager is `lending` (`batchLiquidateTroves`); StabilityPool is `vault` (`provideToSP`+`offset`) — WETH / wstETH / rETH branches all tag. BOLD is a token. Yearn V3 vault original / TokenizedStrategy 3.1.0 are 4626. PufferVaultV5 impl is a 4626 vault. Maple syrupUSDC/USDT are 4626; SyrupRouter cools. Stargate V2 pools are `bridge`; TokenMessaging cools. Enzyme VaultLib and Origin OETHVault are vaults. Pendle SY-stETH is 4626. Maker DaiJoin / GemJoin / UsdsJoin are `vault` (`maker-join`; *this* contract must declare `vat` — imported `PotLike.vat` on DsrManager must not steal). DssLitePsm is `vault` (`maker-psm`). Sky DaiUsds (`daiToUsds`+`usdsToDai`) is a 1:1 converter and cools. DsrManager stays generic custody. Compound CometRewards cools (`getRewardOwed`+`claim`). Aave/Spark PoolAddressesProvider is utility. sUSDe / sfrxETH are 4626 vaults; USDe is a token. Balancer V2 Vault (`0xBA12…F2C8`) is `vault`. Gearbox CreditManagerV3 is `lending`; Gearbox PoolV3 is a 4626 `vault`. crvUSD Controller is `lending`; LLAMMA `exchange` is `pool`. Euler EVault impl is `lending`. Contango Vault stays generic custody (Do Not Auto-Dismiss). Uni V4 PoolManager is `pool`. CoW GPv2Settlement cools (`invalidateOrder`+`settle`). frxETH cools as a permissioned-mint receipt. A `.depositEther` *call* (Rocket DepositPool → vault) is not a lock-release verb; `function depositEther` still is. Imported IWstETH.unwrap on Lido WithdrawalQueue is not a share-wrap. Optimism Portal 2 impl (`0x1005…6748`), L1StandardBridge impl (`0xb37a…a891`), Arbitrum Inbox impl (`0x7c05…0a10`) pin the proxy IR lift. Polygon EtherPredicate / ERC20Predicate / Plasma DepositManager / FxERC20RootTunnel, Scroll L1 messenger + ETH/WETH gateway, StarknetEthBridge, and zkSync Mailbox / L1ERC20Bridge are lock-release bridges. FxRoot is messaging-only (utility). Hop bonder `stake`/`unstake` and sibling `function stake` / `finalizeWithdrawal` / EigenLayer `queueWithdrawals` *interfaces* must not steal the family. Same-file sibling WETH `deposit`/`msg.value` must not flip mETH to wrap-token. The ETH GMX *token* is not a vault (GLP vault is Arbitrum-first). Prefer false keep for true reserves.

## Research stack (Phase 2, beside Lane A)

Lane A stays the picker. A **research audit stack** (`0.2.0`) sits next to it and only runs L2+ on Lane A funds-at-risk venues. Scanner semver stays `0.3.22`.

```bash
python -m eth_scanner.research run --address 0x… --source tests/fixtures/erc4626_vault_like.sol --dry-run
```

Layers L0–L5, built-in fuzz, symbolic hooks, diamond loupe, receipts: [`research/README.md`](research/README.md). `/test` has a Research tab (route stays `/test`).

## Layout

```
eth-scanner/
  src/eth_scanner/
    ingest/etherscan.py      # multi-key rotation + rate limits
    decompile/heimdall.py    # Heimdall/Panoramix CLI stub; else low confidence
    ir/normalize.py          # IR + ir_confidence high|med|low
    funnel/s0_s7.py          # §6.0 cheap-first scoring funnel
    heuristics/invariant_pass.py
    heuristics/scope.py      # token demote vs in-scope family
    lane_a/worker.py         # S0–S5 + S6 gate
    lane_b/worker.py         # S7 on lane-b-queue + manual-review
    research/                # Phase 2 defensive audit stack (L0–L5)
    store/supabase.py        # service-role or local dry-run
    receipt.py               # Markdown scan receipts (downloadable .md)
    cli.py
  research/README.md         # L0–L5 architecture + how to run
  research/invariants/       # Foundry invariant templates (no attacker harness)
  research/fuzz/             # Built-in Foundry + Echidna conservation harness
  supabase/migrations/20261027_eth_scanner_queue.sql
  tests/test_funnel_buckets.py
  tests/test_unpack_and_movers.py
  tests/test_receipts.py
  tests/test_scope_and_regressions.py
  tests/test_etherscan_resilience.py
  tests/test_research_*.py
```

Wired into the repo migration path as `infra/supabase/migrations/2026-10-27-eth-scanner-queue.sql` (`npm run db:migrate:all`).

## Multi-file / standard-json ingest

Etherscan verified sources are often **Standard-JSON-Input** (`{{ "language":"Solidity", "sources": { "File.sol": { "content": "..." } } }}`) or a `{ "sources": ... }` map — not a single `.sol` blob. Lane A unpacks those files into `work/sources/<address>/` (or a temp dir during `normalize`) and runs the heuristic IR lift on the unpacked tree. Flattened Solidity is also written onto `SourceArtifact.content` so pattern skim still sees real functions.

If Etherscan marks the address as a proxy (`Proxy=1` / `Implementation`), the **implementation** source is fetched and used for the IR lift (not only stored). Proxy-only bytecode/source is not treated as the custody surface. Unpacked trees keep `lib/` paths (Aave V3 and similar store the pool under `lib/<pkg>/...`).

Vanilla ERC20 `transfer` / `approve` / `transferFrom` are recorded as leads, not I1 custody movers, and the whole token is **demoted** from the main lane. WETH-like wrap/unwrap is tagged `wrap-unwrap` and likewise demoted (never auto-yes). Pass-through routers (`exactInput`) and atomic NFT markets (`fulfillOrder`) are `demoted-passthrough`.

## Env

| Variable | Required | Purpose |
|---|---|---|
| `ETHERSCAN_API_KEYS` | for live ingest | Comma-separated keys; rotated; default **0.4s** min interval |
| `SUPABASE_SERVICE_ROLE_KEY` | for remote persist | Server-side only. Absent → **dry-run** JSON under `eth-scanner/work/` |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | optional | Defaults to `https://xvjqxjakckkbfsdrntwk.supabase.co` |
| `ETH_RPC_URL` | optional | Read-only `eth_getCode` |
| `ETH_SCANNER_PYTHON` | optional | Interpreter for `python -m eth_scanner` (else `python3` / `python`, then the portable bundle) |
| `ETH_SCANNER_BUNDLE_PYTHON=1` | optional | Download the portable linux-gnu CPython during a local `next build` |
| `ETH_SCANNER_DRY_RUN=1` | optional | Force local store |
| `ETH_SCANNER_HEAT_THRESHOLD` | optional | Default `3` |
| `ETH_SCANNER_TVL_FLOOR` | optional | Default `10000` |
| `ETH_SCANNER_ETHERSCAN_INTERVAL` | optional | Seconds between key uses (default `0.4`, min `0.2`) |

See `.env.example` here and the repo-root `.env.example`.

## Run

From this directory (or set `PYTHONPATH=src`):

```bash
cd eth-scanner
export PYTHONPATH=src

# Funnel tests (no keys, no network)
python -m unittest discover -s tests -v

# Lane A dry-run on a local fixture (no Etherscan / no service role)
python -m eth_scanner lane-a \
  --address 0x1111111111111111111111111111111111111111 \
  --source tests/fixtures/gated_vault.sol \
  --dry-run

# Lane A live ingest (needs ETHERSCAN_API_KEYS). Writes buckets to Supabase
# when SUPABASE_SERVICE_ROLE_KEY is set; otherwise the same dry-run store.
python -m eth_scanner enqueue 0x... --tvl 25000
python -m eth_scanner lane-a --address 0x...
# or claim pending rows:
python -m eth_scanner lane-a --claim 10

# Lane B — S7 on lane-b-queue + manual-review promotions
python -m eth_scanner lane-b --claim 5
python -m eth_scanner lane-b --address 0x... --source path/to/src.sol

# Surface helper (ported invariant_pass heuristics; leads only)
python -m eth_scanner surface path/to/src --json -

python -m eth_scanner list
python -m eth_scanner list --results

# Research stack (Lane A gate → IR → Slither → funds-flow → fuzz → receipt)
python -m eth_scanner.research run \
  --address 0xd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2 \
  --source tests/fixtures/erc4626_vault_like.sol \
  --dry-run
```

Apply SQL (from repo root, needs `SUPABASE_ACCESS_TOKEN`):

```bash
npm run db:migrate -- infra/supabase/migrations/2026-10-27-eth-scanner-queue.sql
# or
npm run db:migrate:all
```

## Buckets

| Bucket | Meaning |
|---|---|
| `lane-a-cool` | High/usable IR, movers gated or none |
| `lane-b-queue` | S6 gate (heat / TVL / weirdness) |
| `manual-review` | Low/failed confidence or ambiguous cheap check — **not discarded** |
| `human-no-candidate` | High-confidence all-clear — human stamps `no` |
| `human-yes-candidate` | BROKEN hypothesis with exact locus — human stamps `yes` after path verify (no PoC) |

Lane A never emits `human-yes-candidate`. Lane B never marks BROKEN from heuristics; that status is only routed if a human-injected locus is present.

## Confidence

- `src_confidence`: `high` exact verified match · `med` partial · `low` decompile only
- `ir_confidence`: `high` Slither SSA **or** clear heuristic inventory on verified Solidity/Vyper · `med` partial / unparsed · `low` decompile / failed lift

Low or failed IR **always** → `manual-review`.

## Scan receipts (Markdown)

Every Lane A / Lane B run writes a **self-contained Markdown receipt** (`.md` only — that is the downloadable format). Paste the file into another AI chat as the full scan context. There is no dedicated per-run receipt in the dry-run JSON store; `work/dry-run-store.json` remains the machine log, and the receipt is the human/AI handoff.

### What it contains

- Contract address, bytecode hash, TVL, target status
- Source provenance (verified Etherscan / local `--source` / decompile stub, tool, `src_confidence`, `verified_match`) — **source body is omitted**
- Lanes run (A / B) and S0–S7 `stage_trace`
- Leads (pattern skim, value movers, I1–I8 stubs) — **never findings**
- Routing **bucket** (clearly labeled: automation emits buckets, not a human verdict) plus the human stamp still required
- Confidence, notes, timestamps, scanner id / version / worker
- A “Handoff for another AI” section so a later model can continue without this repo

Env secrets and API keys are redacted and never written into receipts.

### Where it is saved

Default: `eth-scanner/work/receipts/receipt-<address>-lane-<a|b>-<timestamp>.md`  
(`work/` is gitignored.)

### CLI

```bash
cd eth-scanner
export PYTHONPATH=src

# After any lane-a / lane-b run the path is printed on stderr
# and included as receipt_path in the JSON payload.
python -m eth_scanner lane-a \
  --address 0x1111111111111111111111111111111111111111 \
  --source tests/fixtures/gated_vault.sol \
  --dry-run
# stderr: receipt /…/eth-scanner/work/receipts/receipt-0x1111…-lane-a-….md

# Named file
python -m eth_scanner lane-a --address 0x… --source path/to.sol --dry-run \
  --receipt /tmp/my-receipt.md

# Directory of .md files (default is <work>/receipts/)
python -m eth_scanner lane-b --address 0x… --dry-run --receipt-dir ./work/receipts

# Rebuild from the store
python -m eth_scanner receipt --address 0x… --dry-run

# Skip writing
python -m eth_scanner lane-a --address 0x… --source path/to.sol --dry-run --no-receipt
```

### /test UI

Triage at **`/test`** (noindex, not in public nav).

- **Run** (primary) posts to `POST /api/test/run` with `{ address, fixture? }` and executes `python -m eth_scanner lane-a` for that target (system Python locally; portable CPython on Vercel Node serverless). Progress and the last bucket/heat/confidence show on the page; the table refreshes from `GET /api/test`.
- Click a table row to load that address into the Run field.
- Optional **local fixture** uses a whitelisted file under `eth-scanner/tests/fixtures/` (`--source`). No arbitrary paths.
- Each row still has **Download .md** → `GET /api/test/receipt?address=0x…` (`text/markdown` attachment).

**Honesty:** live persist needs `SUPABASE_SERVICE_ROLE_KEY`; live ingest needs `ETHERSCAN_API_KEYS`. If those are unset, Run is still a dry-run: stub decompile (usually `manual-review`) or a local fixture, writing `eth-scanner/work/`. The page chips say which mode you are in. When the service-role key is unset, receipt download serves the latest file under `eth-scanner/work/receipts/` if present, otherwise it rebuilds Markdown from `dry-run-store.json`.
