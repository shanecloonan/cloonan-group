# eth-scanner research stack — Phase 1

Research-grade **defensive** audit layers that sit **beside** Lane A (the funds-at-risk picker). Lane A is unchanged. This package turns that sieve into the front door of a deeper stack.

**Version:** research stack `0.1.0` (scanner stays `0.3.16` — no 0.3.x bump).

**Hard rule:** findings are invariant violations, property failures, and detector reports. `defensive_only=true` is forced on every row. **Never** exploit code, PoCs, payloads, drain scripts, or live fund-moving transactions.

## How to run

From `eth-scanner/` (`PYTHONPATH=src`):

```bash
cd eth-scanner
export PYTHONPATH=src

# Dry-run on a local ERC-4626 fixture (no keys, no RPC)
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

`/test` UI wiring is **Phase 2**. Phase 1 is the CLI.

Env (all optional; never invent keys):

| Variable | Purpose |
|---|---|
| `ETHERSCAN_API_KEYS` | Live Sourcify/Etherscan ingest (same as Lane A) |
| `ETH_RPC_URL` | Read-only `eth_getStorageAt` / `eth_call` (L0 EIP-1967, L5 fork checks) |
| `ETH_SCANNER_DRY_RUN=1` | Force local `work/` store |

Ask before any paid API spend. Free-tier Etherscan keys the user already configured are fine.

## Layers

| Layer | Name | Phase 1 | Notes |
|---|---|---|---|
| **L0** | Acquisition & IR | **Live** | Reuses Lane A Sourcify/Etherscan multifile fetch. Emits normalized contract IR: address, name, Lane A role, ABI (best-effort from source), source paths, storage layout *if* `solc` can produce it, implementation, facets, selectors. |
| **L1** | Lane A triage | **Live (existing)** | Unchanged picker. Only `in-scope` / funds-at-risk family / `diamond-facets-missing` false-keep proceed to L2+. |
| **L2** | Static analysis | **Live** | Slither when the CLI + source are present (curated funds-safety allowlist). Custom Python detectors: weak-auth value moves, share/asset shape, Chainlink-like freshness hooks. Slither missing → skip with a note. |
| **L3** | Funds-flow / authority | **Live** | Callable sinks (`transfer` / `transferFrom` / `call{value}`) + modifiers/roles. Summary only — **no** exploit-path synthesis. |
| **L4** | Property / invariant harness | **Scaffold** | Foundry-style conservation stubs for `vault` / `staking` / `lending` under `research/invariants/templates/`. `forge test` runs only when a `foundry.toml` fixture exists **and** `forge` is on PATH; otherwise skip. No attacker contracts. |
| **L5** | Live fork checks | **Scaffold** | Optional `totalAssets` vs `convertToAssets(totalSupply)` via read-only `eth_call`. No RPC → dry-run / mock only. |

### L0 proxy / diamond rules

- **EIP-1967:** explorer `Implementation` *or* `eth_getStorageAt` of the canonical implementation slot. No bytecode-guess rules.
- **Diamond / EIP-2535:** facets are listed only from an **explicit** list. If a loupe/cut surface is present and facets are not listed → `diamond-facets-missing` and **that path stops**. Phase 2: `eth_call` loupe.

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

## Phase 2 (documented, not built)

- Halmos / hevm symbolic properties
- Echidna campaign runner
- Full diamond facet fetch via `eth_call` (`facets()` / `facetAddresses()`)
- `/test` UI tab for research findings

## Tests

```bash
cd eth-scanner
export PYTHONPATH=src
python -m unittest discover -s tests -v
```

New modules: `test_research_*.py`. Existing Lane A suite must stay green.
