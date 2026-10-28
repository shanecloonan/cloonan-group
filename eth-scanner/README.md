# eth-scanner — Ethereum-only invariant pipeline

Defensive static triage for Ethereum contracts. Automation emits **buckets**, never a human verdict. Heuristic flags are **leads**, never findings.

Triage UI: **`/test`** on this site (noindex, not in public nav). **Run** kicks Lane A for one address (or a local fixture). Scanner runtime is the Python CLI spawned by `POST /api/test/run`, not the public marketing pages.

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

**In-scope examples:** Aave V2/V3 pools, Compound cTokens, Balancer Vault, ERC-4626 / Yearn vaults, staking / MasterChef / Lido-style pooled ETH, Uni V2 pairs / Uni V3 *pools* / Curve (reserve custody), Maker VAT, bridges that lock/release, unnamed ETH/token piggy-banks (`withdraw` of `address(this).balance`).

**Hybrids stay in-scope:** a token that is also a vault, lending market, AMM, or staking pool (cToken, 4626 share token, Curve LP, stETH) is classified as the venue, never demoted as a token. Prefer false keep.

**Demoted / excluded:** plain ERC-20 (USDT, USDC, …) including mint/burn/rescue admin tokens (`rescueERC20`, …); WETH-like wrap/unwrap; Uni V3 *SwapRouter* and similar exact-input pass-throughs; ERC-721/1155 collections; Seaport-style atomic fulfill/match with no escrow. `transfer` / `approve` / `totalSupply` / `transferOwnership` are noise here.

**Do Not Auto-Dismiss:** unverified / failed IR / failed unpack / rate-limited ingest / truly ambiguous *non-token* auth still go to `manual-review`, never silent `no`.

Signals live in `heuristics/scope.py`. Funds-at-risk family tags are checked *before* ERC-20/721 shape so a pool that calls `IERC20.transferFrom` is never demoted as a token. Imported `IERC20` / `IUniswapV3Pool` / `IWETH9` on a Uni V3 *SwapRouter* do not flip it to `custody` — pass-through still demotes. Imported `IUniswapV3SwapCallback` / `uniswapV2Call` on a Uni V3 *pool* or Uni V2 pair do not flip it to `router` — reserve AMMs stay in-scope as `pool` (`Slot0 public override slot0`, mint/collect/burn/swap/flash). Prefer false keep for true reserves.

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
    store/supabase.py        # service-role or local dry-run
    receipt.py               # Markdown scan receipts (downloadable .md)
    cli.py
  supabase/migrations/20261027_eth_scanner_queue.sql
  tests/test_funnel_buckets.py
  tests/test_unpack_and_movers.py
  tests/test_receipts.py
  tests/test_scope_and_regressions.py
  tests/test_etherscan_resilience.py
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

- **Run** (primary) posts to `POST /api/test/run` with `{ address, fixture? }` and executes `python -m eth_scanner lane-a` for that target. Progress and the last bucket/heat/confidence show on the page; the table refreshes from `GET /api/test`.
- Click a table row to load that address into the Run field.
- Optional **local fixture** uses a whitelisted file under `eth-scanner/tests/fixtures/` (`--source`). No arbitrary paths.
- Each row still has **Download .md** → `GET /api/test/receipt?address=0x…` (`text/markdown` attachment).

**Honesty:** live persist needs `SUPABASE_SERVICE_ROLE_KEY`; live ingest needs `ETHERSCAN_API_KEYS`. If those are unset, Run is still a dry-run: stub decompile (usually `manual-review`) or a local fixture, writing `eth-scanner/work/`. The page chips say which mode you are in. When the service-role key is unset, receipt download serves the latest file under `eth-scanner/work/receipts/` if present, otherwise it rebuilds Markdown from `dry-run-store.json`.
