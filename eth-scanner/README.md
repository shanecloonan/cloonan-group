# eth-scanner — Ethereum-only invariant pipeline

Defensive static triage for Ethereum contracts. Automation emits **buckets**, never a human verdict. Heuristic flags are **leads**, never findings.

Triage UI (read-only): **`/test`** on this site. Scanner runtime lives here, not on the public marketing pages.

## Hard rules

- Ethereum only.
- Read-only explorer / RPC / local source. **No** exploit code, attack payloads, PoCs, theft simulations, or live fund-moving transactions.
- **Never auto-yes.** **Never auto-no** on low IR or decompile confidence → `manual-review`.
- Heimdall / Panoramix are hypothesis generators only (`src_confidence=low`).
- Attack fuzz / local-fork theft sims are out of scope.
- Service-role Supabase writes are server-side only. Do not prefix secrets with `NEXT_PUBLIC_`.

Filtration: `docs/ETH_SWEEP_SCANNING_REFERENCE.md` §6.0 (also copied under this package’s parent `docs/`).

## Layout

```
eth-scanner/
  src/eth_scanner/
    ingest/etherscan.py      # multi-key rotation + rate limits
    decompile/heimdall.py    # Heimdall/Panoramix CLI stub; else low confidence
    ir/normalize.py          # IR + ir_confidence high|med|low
    funnel/s0_s7.py          # §6.0 cheap-first scoring funnel
    heuristics/invariant_pass.py
    lane_a/worker.py         # S0–S5 + S6 gate
    lane_b/worker.py         # S7 on lane-b-queue + manual-review
    store/supabase.py        # service-role or local dry-run
    cli.py
  supabase/migrations/20261027_eth_scanner_queue.sql
  tests/test_funnel_buckets.py
```

Wired into the repo migration path as `infra/supabase/migrations/2026-10-27-eth-scanner-queue.sql` (`npm run db:migrate:all`).

## Multi-file / standard-json ingest

Etherscan verified sources are often **Standard-JSON-Input** (`{{ "language":"Solidity", "sources": { "File.sol": { "content": "..." } } }}`) or a `{ "sources": ... }` map — not a single `.sol` blob. Lane A unpacks those files into `work/sources/<address>/` (or a temp dir during `normalize`) and runs the heuristic IR lift on the unpacked tree. Flattened Solidity is also written onto `SourceArtifact.content` so pattern skim still sees real functions.

If Etherscan marks the address as a proxy (`Proxy=1` / `Implementation`), the **implementation** source is fetched and used for the IR lift (not only stored). Proxy-only bytecode/source is not treated as the custody surface.

Vanilla ERC20 `transfer` / `approve` / `transferFrom` are recorded as leads, not I1 custody movers. WETH-like wrap/unwrap is tagged `wrap-unwrap` (still never auto-yes; unsure withdraws stay `manual-review`).

## Env

| Variable | Required | Purpose |
|---|---|---|
| `ETHERSCAN_API_KEYS` | for live ingest | Comma-separated keys; rotated; ~0.25s min interval |
| `SUPABASE_SERVICE_ROLE_KEY` | for remote persist | Server-side only. Absent → **dry-run** JSON under `eth-scanner/work/` |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | optional | Defaults to `https://xvjqxjakckkbfsdrntwk.supabase.co` |
| `ETH_RPC_URL` | optional | Read-only `eth_getCode` |
| `ETH_SCANNER_DRY_RUN=1` | optional | Force local store |
| `ETH_SCANNER_HEAT_THRESHOLD` | optional | Default `3` |
| `ETH_SCANNER_TVL_FLOOR` | optional | Default `10000` |

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
- `ir_confidence`: `high` Slither SSA on verified Solidity · `med` heuristic/Vyper · `low` decompile / failed lift

Low or failed IR **always** → `manual-review`.
