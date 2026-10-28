# eth-scanner research stack — Phase 2

Research-grade **defensive** audit layers that sit **beside** Lane A (the funds-at-risk picker). Lane A is unchanged. This package turns that sieve into a runnable pipeline: IR, static detectors, funds-flow, **built-in fuzz**, symbolic hooks, diamond loupe, and receipts.

**Version:** research stack `0.2.0` (scanner stays `0.3.18` — no 0.3.x bump).

**Hard rule:** findings are invariant violations, property failures, and detector reports. `defensive_only=true` is forced on every row. **Never** exploit code, PoCs, payloads, drain scripts, or live fund-moving transactions.

## How to run

From `eth-scanner/` (`PYTHONPATH=src`):

```bash
cd eth-scanner
export PYTHONPATH=src

# Dry-run on a local ERC-4626 fixture (no keys, no RPC, no optional CLIs required)
python -m eth_scanner.research run \
  --address 0xd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2 \
  --source tests/fixtures/erc4626_vault_like.sol \
  --dry-run

# Same entry via the existing CLI
python -m eth_scanner research run --address 0x… --source path/to.sol --dry-run

# Write Foundry stubs only
python -m eth_scanner.research generate-invariants --role vault --out /tmp/inv
```

Receipts land next to Lane A files:

- `work/receipts/research-<address>-<timestamp>.md`
- `work/receipts/research-<address>-<timestamp>.json`

`/test` has a **Research** tab (route stays `/test`) that runs this dry-run and shows layers / skips / findings. If Python is unavailable, upload or show the last receipt — the UI never invents secrets.

Env (all optional; never invent keys):

| Variable | Purpose |
|---|---|
| `ETHERSCAN_API_KEYS` | Live Sourcify/Etherscan ingest (same as Lane A) |
| `ETH_RPC_URL` | Read-only `eth_getStorageAt` / `eth_call` (L0 EIP-1967 + EIP-2535 loupe, L5 fork checks) |
| `ETH_SCANNER_DRY_RUN=1` | Force local `work/` store |

Ask before any paid API spend. Free-tier Etherscan keys the user already configured are fine.

## Optional tools

Install any of these on PATH. Missing tools **skip with a receipt note** — the run still succeeds.

| Tool | Install (typical) | Used for |
|---|---|---|
| `forge` | [Foundry](https://book.getfoundry.sh/getting-started/installation) `foundryup` | L4+ built-in fuzz / invariant tests |
| `echidna` | [Echidna](https://github.com/crytic/echidna#installation) | L4 property campaign on the same families |
| `halmos` | `pipx install halmos` | L4 symbolic `check_*` properties |
| `hevm` | [hevm](https://hevm.dev/) | L5 symbolic view-sig hook |
| `slither` | `pipx install slither-analyzer` | L2 funds-safety detectors |
| `solc` | solc-select / Foundry | L0 storage layout (best-effort) |

### Exact symbolic commands

```bash
# From a materialized copy of research/fuzz/ (written under work/fuzz/<address>/)
halmos --function check_ --solver-timeout-assertion 2000

# After forge has compiled (out/ present)
hevm symbolic --code <deployed-bytecode-hex> --sig "totalAssets()" --smttimeout 5000
```

## Layers

| Layer | Name | Status | Notes |
|---|---|---|---|
| **L0** | Acquisition & IR | **Live** | Reuses Lane A Sourcify/Etherscan multifile fetch. Emits normalized contract IR: address, name, Lane A role, ABI (best-effort from source), source paths, storage layout *if* `solc` can produce it, implementation, facets, selectors. |
| **L1** | Lane A triage | **Live (existing)** | Unchanged picker. Only `in-scope` / funds-at-risk family / `diamond-facets-missing` false-keep proceed to L2+. |
| **L2** | Static analysis | **Live** | Slither when the CLI + source are present (curated funds-safety allowlist). Custom Python detectors: weak-auth value moves, share/asset shape, Chainlink-like freshness hooks. Slither missing → skip with a note. |
| **L3** | Funds-flow / authority | **Live** | Callable sinks (`transfer` / `transferFrom` / `call{value}`) + modifiers/roles. Summary only — **no** exploit-path synthesis. |
| **L4** | Property / invariant harness | **Live (skip-if-missing)** | Role templates under `research/invariants/templates/`. Built-in Foundry fuzz project under `research/fuzz/` (vault conservation, share↔asset, staking balance, lending solvency). `forge test --fuzz-runs 64` when `forge` is on PATH. |
| **L4** | Echidna | **Skip-if-missing** | Property stubs in `research/fuzz/echidna/`. `echidna` on PATH → campaign; else receipt note. |
| **L4** | Halmos | **Skip-if-missing** | `check_*` view properties in the fuzz project. |
| **L5** | hevm | **Skip-if-missing** | Read-only `hevm symbolic` on a view sig when bytecode is compiled. |
| **L5** | Live fork checks | **Skip-if-missing** | Optional `totalAssets` vs `convertToAssets(totalSupply)` via read-only `eth_call`. No RPC → dry-run / mock only. |

### L0 proxy / diamond rules

- **EIP-1967:** explorer `Implementation` *or* `eth_getStorageAt` of the canonical implementation slot. No bytecode-guess rules.
- **Diamond / EIP-2535:** facets from an **explicit** list **or** a read-only loupe `eth_call` (`facetAddresses` + `facetFunctionSelectors`, fallback `facets()`) when `ETH_RPC_URL` is set. **No facet ABI guessing.** If the loupe/cut surface is present and facets still cannot be listed → `diamond-facets-missing` and **that path stops**.

## Finding schema

```json
{
  "id": "L2-weak-auth-value-move-1",
  "severity": "info|low|med|high|crit",
  "layer": "L2|L3|L4|L5",
  "title": "…",
  "evidence": "…",
  "address": "0x…",
  "detector": "custom:weak-auth-value-move",
  "defensive_only": true
}
```

## Slither allowlist (funds safety)

`reentrancy-eth`, `reentrancy-no-eth`, `arbitrary-send-eth`, `arbitrary-send-erc20`, `controlled-delegatecall`, `uninitialized-storage`, `uninitialized-state`, `suicidal`, `tx-origin`, `unchecked-transfer`, `unchecked-lowlevel`, `unchecked-send`, `locked-ether`, `delegatecall-loop`, `encode-packed-collision`, `incorrect-equality`, `unused-return`, `mapping-deletion`, `divide-before-multiply`, plus a few adjacent funds-safety checks. Style/naming/pragma detectors are dropped.

## Still needs external infra (not a hard fail)

- Live Etherscan/Sourcify ingest (`ETHERSCAN_API_KEYS`)
- Live loupe / EIP-1967 / L5 fork `eth_call` (`ETH_RPC_URL`)
- Optional CLIs in the table above
- Remote persist (`SUPABASE_SERVICE_ROLE_KEY`) — `/test` research tab is dry-run

## Tests

```bash
cd eth-scanner
export PYTHONPATH=src
python -m unittest discover -s tests -v
```

New modules: `test_research_*.py`. Existing Lane A suite must stay green.
