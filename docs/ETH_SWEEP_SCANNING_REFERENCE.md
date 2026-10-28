# Sweep & Scanning Logic — Master Reference

**This repo copy** lives at `docs/ETH_SWEEP_SCANNING_REFERENCE.md` (Cloonan Group / MoneyFund). The Ethereum-only runner is `eth-scanner/`; read-only triage is `/test`. **Keep §6.0** (filtration funnel) as the scoring contract.

**Audience:** future you / workers scanning contracts across chains.
**Scope note (2026-10-27):** Stand up the new automated fuzzing / testing / running environment on **Ethereum first** (one cohesive stack). This document still covers **all** sweep logic (Solana ELF/sBPF, multi-chain factory, invariants), not only Ethereum.
**Hard ban:** defensive analysis only. No exploit code, attack payloads, PoCs, forks that simulate theft, or live fund-moving tests.
**Filtration balance (caller, 2026-10-27):** (1) do not chase wild geese — false positives are the main cost because these bugs are cheap to test once flagged; (2) do not exclude real bugs — a genuine stealable path must not die as a low score; (3) keep the net wide across a broad surface. See §6.0 scoring funnel.

Related live files:
- Factory brief: `WORKER_BRIEF.md`
- Invariant depth mode: `INVARIANT_FRAMEWORK.md`
- Surface helper (in progress): `invariant_pass.py`
- Queue: `queue.csv` (never rebuild with `build_queue.py` unless owner sets `ALLOW_QUEUE_REBUILD=1`)
- Shared results: `results/`, `append_shared_cumulative.py`, `sweep_cumulative.xlsx`

---

## 1. Mission and verdict bar

Industrial whitehat triage: find paths where an **outsider** can steal funds held **today**.

| Verdict | Meaning |
|---|---|
| `yes` | Exact outsider-stealable-today path: `file:function:line` (or binary locus), reachable precondition, live funds. Grep hits never qualify. |
| `no` | Reviewed; no such path. |
| `needs-look` | Real unresolved surface (unread math, unverified bytecode, ABI≠binary, residual that cannot close read-only). |
| `skip` | Out of scope / giant / already reviewed / dead. |

**Only `yes` counts as a finding.** Admin-key trust, dormant code, and “would work if market empty but it isn’t” do not.

---

## 2. Factory pipeline (breadth — all chains)

### 2.1 Queue & workers
1. Claim N highest-priority `pending` rows under `flock` on `queue.lock`.
2. Expand `batch` rows into concrete `(chain, address)` rows (dedupe).
3. Triage → write `results/<id>_<name>.md` → mark `done` under lock.
4. Append to shared cumulative (`append_shared_cumulative.py`) with agent label:
   `solana | ethereum | base | bsc | all-chains | new-contracts | old-contracts | pattern-risk | invariant`.

### 2.2 Known-pattern pass (WORKER_BRIEF §3)
Fast named-bug triage after deploy-vs-source and owner/upgrade notes:

- **EVM:** empty-market / exchange-rate inflation, ERC4626 rounding & donation, reentrancy, spot-oracle (`slot0`/reserves), fee-on-transfer/rebase drift, reflection skim, missing slippage, sig replay / EIP-712 domain, unchecked calls, pre-0.8 overflow.
- **Solana:** missing signer/owner, account substitution, PDA seed collisions, close/realloc, CPI privilege, arithmetic.
- **Move / Cairo / TON / Clarity:** capability / caller checks, flash hot-potato, felt overflow, bounce/sender/op, post-conditions.

A pattern hit is a **lead**, not a finding. Trace the fund-moving path by hand.

### 2.3 Segments (where work comes from)
`new-programs`, `recent-deploys`, `forks`, `obscure-eth/evm`, `tokens`, `non-evm`, `evm-needs-look`, `bounty-list` — see `README.md`.

---

## 3. Six-pass local ELF / sBPF analysis (closed Solana programs)

Used when source/IDL is missing or lies (Solstice USX/YieldVault, Katana, etc.). Tools under `deepdive/`: `getprog.py`, `dump.py`, `disasm.py` (Capstone BPF), `calls.py`, `sigs.py`, `probe.py`, `rpc.py`, …

### Pass map (repeatable recipe)

| Pass | Goal | Typical actions |
|---|---|---|
| **1. Acquire binary** | Ground truth ELF | `getAccountInfo` on program → follow ProgramData → strip BPFLoaderUpgradeable header → sha256; record upgrade authority (or `None` = immutable). |
| **2. Surface inventory** | What exists without full decompile | Strings, error names, syscall imports (`sol_*`), Anchor discriminators, IDL if any, account metas from recent txs. |
| **3. Entry / dispatch map** | Find handlers | Discriminator → wrapper → `try_accounts` → handler; build ix name ↔ code offset table. |
| **4. Auth & account constraints** | I1 / I4 | Trace Signer / owner / PDA seed checks in `try_accounts`; **compare to IDL `isSigner` / docs**. Katana lesson: IDL said `userAuthority` non-signer; binary Signer loader → `AccountNotSigner` (0xbc2/3010) on live sim. |
| **5. Value + accounting math** | I2 / I7 | Trace token CPI / lamport moves; mul_div / rounding; who can move exchange rate; empty-supply edges. Solstice: Capstone line-trace of Lock/Unlock/Withdraw u128 floor math; rate moves only via permissioned paths. |
| **6. Close or escalate** | Verdict | HOLD → `no`; BROKEN outsider today → `yes`; unread residual → `needs-look` with exact unread locus. Never invent a path to force `yes`. |

**Solstice outcome pattern:** six passes → strong circumstantial safety, **no surviving outsider hypothesis**, still `needs-look` until share/redeem bodies fully closed (or cleared after deeper sBPF). Closed stripped sBPF without IDL is the classic blocker.

**Katana outcome pattern:** binary overrides IDL; live `simulateTransaction` (read-only rejection) confirmed signer requirement. Path claim flipped false without writing an exploit.

---

## 4. STRATO findings (lessons for scanning)

Refs: `results/Q00342_strato_verdict.md`, bridge notes `Q00858_strato_bridge.md`, YES/MAYBE board `YES_MAYBE_recheck_2026-10-26.md`.

**Code-level hypothesis (SolidVM / upquark):** platform `Proxy` with unguarded constructor + documented `address.call("<constructor>", …)` re-invocation → overwrite `logicContract` / owner → delegatecall attacker logic → mint/drain pattern. Blast radius = Proxy-backed stack; vault still custodied ~$1.6M USDST on re-read; not paused; vulnerable source bytes still present.

**Why it stayed `needs-look` (not `yes`):**
- Operator **rewrote history** (prior exploit tx hash → null) and rebuilt node to **v19.6**.
- Residual: fresh-genesis rebuild *might* have silently disabled constructor re-invoke — **invisible to read-only source**.
- Closing residual would need a forbidden test tx → leave MAYBE; allow code-level whitehat report without on-chain PoC.

**Scanning lessons:**
1. History rewrite / node rebuild can erase corroboration — treat “already exploited” as soft evidence only if the tx still exists.
2. Strongest code signal ≠ automatic `yes`; bar is outsider-stealable-**today** under current VM semantics.
3. On exotic VMs (SolidVM), document platform primitives (`call(name)`) as first-class trust/auth surfaces (I3/I4).
4. Board snapshot after full recheck (2026-10-26): **RESTORE-YES = 0**, STRATO = top KEEP-MAYBE, ~100 other needs-look mostly unread/closed-source.

---

## 5. Invariant / novel-bug framework (depth mode)

Full text: `INVARIANT_FRAMEWORK.md`. Complements named patterns: ask what must stay true, not whether bug X appears.

### Core invariants
| ID | Property (short) |
|---|---|
| **I1** | Value movers ⇄ auth gates — outsider receives ≤ they deposited/earned, own position only. |
| **I2** | Conservation — shares ↔ assets ↔ fees ↔ reserves; both sides of ledger update. |
| **I3** | Trust boundaries — oracles, callbacks, token quirks, bridge messages, signatures. |
| **I4** | Interface vs behavior — ABI/IDL/docs/source == deployed binary. |
| **I5** | Fork-diff — every change vs canonical Compound/Aave/Uni/4626/Anchor template. |
| **I6** | Privilege monotonicity — no outsider path widens roles/caps/upgrade auth. |
| **I7** | Empty / first-deposit / dust / epoch edges on exchange rate. |
| **I8** | Cross-function sequencing — A then B leaves inconsistent trusted state. |

### Rubric
Score 0–3 each: funds today, outsider reachability, auth signal, novelty/divergence (max 12).
- ≥8 deep-read now → HOLDS / BROKEN / OPEN
- Scores **rank** deep work; they do **not** auto-dismiss (see §6.0 Do Not Auto-Dismiss). Low IR ⇒ `manual-review` even if score looks low.
- `yes` only on BROKEN with exact path + today + live funds
- Agent label: `invariant` (or `invariant|<chain>`)

### Helper
`python3 invariant_pass.py <source-tree> [-o report.md] [--json out.json]` — heuristic surface inventory (fund movers, weak auth proximity, accounting hotspots, external calls). **Never a finding alone.**

---


---

## 6.0 Filtration & triage funnel (noise vs coverage)

**Design goal.** Cheap stages kill the most likely noise first. Expensive stages run only on survivors. **Ambiguity never becomes discard** — weak or failed cheap checks route to a **manual-review bucket**, not to `no`/`skip` by automation.

### Balance constraints
| Constraint | Implication for the funnel |
|---|---|
| Don’t chase wild geese | False positives dominate cost → front-load filters that historically produce empty deep-reads (dead contracts, giants already audited, pure admin surfaces with no outsider entry). |
| Don’t exclude real bugs | A miss is worse than a wasted 10-minute read → **no auto-dismiss** when IR/decompile/confidence is weak or a check fails ambiguously. |
| Keep the net wide | Lane A still touches a huge address set; Lane B is gated, not the intake. |

### Explicit rule — Do Not Auto-Dismiss
Anything that fails a cheap check **because confidence is low, IR is thin, decompile is messy, or the signal is ambiguous** goes to bucket `manual-review` (queue verdict stays `needs-look` or status annotation `manual-review`), **never** automated `no` / `skip`.
Only **high-confidence negative** evidence may auto-close (e.g. verified source + strong IR + all I1 value-movers show explicit outsider-binding auth + no OPEN high-score hypothesis after Lane B — and even then a human stamps `no`).

### Scoring funnel (cheap → expensive)

| Stage | What runs | Kill / keep | Why it sits here |
|---|---|---|---|
| **S0 — Intake gate** | Chain=ETH (for new env), not already `done`/`skip` with same bytecode hash, not TVL=0 *and* no code | Drop only empty EOAs / zero-code / exact duplicate bytecode already closed `no` with same hash | Cheapest possible; removes pure waste without touching semantics. Duplicate-hash `needs-look` is **not** dropped (prior OPEN may still matter). |
| **S1 — Artifact class** | Verified Solidity/Vyper vs unverified→decompile | Tag `src_confidence`: `high` (exact match) / `med` (partial) / `low` (decompile only). **Never discard on low.** Low → prefer `manual-review` path after S2 | Classifies trust of everything downstream. Decompile noise is huge; tagging early prevents treating Panoramix text like Solc AST later. |
| **S2 — IR confidence** | Build IR; record `ir_confidence`: `high` (Slither SSA **or** clear heuristic inventory on verified Solidity/Vyper) / `med` (partial / unparsed) / `low` (decompile CFG / failed lift) | If IR build **fails** or `ir_confidence=low` → **route to `manual-review`**, do **not** score as clean `no`. High/usable IR continues. Slither is optional. | Weak IR can hide auth gaps (Katana-style mismatch lesson). Auto-scoring low IR as safe is how real bugs slip out. A parsed verified surface should not sit in `manual-review` just because Slither is missing. |
| **S3 — Known-pattern skim** | Lane-A named patterns (§2.2) on high/med IR only | Pattern hit → lead list (not finding). Clean pattern skim ≠ safe; only reduces priority slightly when IR high | Patterns are cheap and catch named classes early, but a clean grep must not close the case — novel bugs live outside the list. |
| **S4 — Value-mover presence + scope** | IR: any external/public path that moves tokens/ETH/shares? Then classify **funds-at-risk regularity**: does this contract hold/account other people’s value? | **IN:** lending / vault / staking / AMM-with-reserves / bridge / Maker. **OUT (cool-archive, TVL does not promote):** plain ERC-20 / wrap-token / NFT collection / pass-through router / atomic NFT market. Hybrids (token+vault/pool/lending) stay IN. Imported IERC20 / pool-iface on a SwapRouter is still OUT (not `custody`). Uni V3 *pools* stay IN. **No value movers** + high IR + verified → candidate auto-`no` (still human stamp). Ingest/unpack incomplete → `manual-review` | Most noise is tokens and pass-throughs. Lane B is for venues with money at rest. Absence of movers is only a close when IR is strong and ingest completed. |
| **S5 — Outsider auth gate (cheap I1)** | For each value mover: is there an explicit caller/position binding nearby? wards/auth, AccessControl/onlyRole, Ownable, router `verifyCallback` → PRESENT. Self-scoped user ops → WEAK (not ambiguous). | Strong bind on all movers + high IR → cool. **Missing/weak bind** → heat score↑. *All* parses truly ambiguous → `manual-review`. Mixed clear+ambiguous on an in-scope family continues to S6. | Auth gaps are both common FPs and real bugs — weak/missing raises heat. True ambiguity never discards. Self-scoped (Aave withdraw) is a clear WEAK class so V2/V3 stay consistent. |
| **S6 — Deep-lane gate** | Promote to Lane B if: **funds-at-risk family** (lending/vault/staking/pool/bridge/maker) **OR** heat≥threshold **OR** TVL/funds≥floor **OR** weird fund-mover **OR** fork-family + missing/weak. Tokens and pass-throughs never reach S6. | Else stay Lane-A archive with score trail | Lane A picks venues that hold third-party value. Tokens/routers/atomic NFT markets are already archived. Low-confidence non-token code still gets a human-eyes bucket instead of silence. |
| **S7 — Deep invariants (Lane B)** | Full I1–I8 + fork-diff; score rubric §5 | HOLDS / BROKEN / OPEN per hypothesis. BROKEN→human `yes` path. OPEN≥8 or any low-confidence residual→`needs-look`. All HOLDS + high confidence→human `no` | Deep work only on S6 survivors (plus manual-review promotions). Preserves thoroughness where it pays. |

### Heat score (Lane A → S6)
Additive, capped; used only for ranking, **never for auto-dismiss**:
- +2 missing/weak auth on a value mover (high IR)
- +2 bridge mint/release / proof-shaped surface
- +2 ABI/proxy/implementation mismatch hint
- +1 accounting hotspot without paired update hint
- +1 fork-family with non-trivial diff in movers
- +1 first-deposit / empty-supply reachable hint
- **Override:** `ir_confidence=low` or `src_confidence=low` ⇒ force `manual-review` regardless of heat

### Buckets (automation outputs)
| Bucket | Meaning | Next action |
|---|---|---|
| `lane-a-cool` | High IR, movers gated or none | Archive; human spot-check sample |
| `lane-b-queue` | Passed S6 gate with heat/TVL/weirdness | Deep invariant pass |
| `manual-review` | Low/failed confidence or ambiguous cheap check | Human six-pass / read — **not discarded** |
| `human-no-candidate` | High-confidence all-clear after S7 | Human stamps `no` |
| `human-yes-candidate` | BROKEN hypothesis with exact locus | Human stamps `yes` only after path verify (no PoC) |

### Rationale summary (why this order)
1. **Kill empty/dupes first (S0)** — zero semantic risk, max waste removed.
2. **Tag confidence before judging safety (S1–S2)** — stops decompile theater from generating false `no`s or false greps.
3. **Patterns before deep invariants (S3)** — cheap named wins, but never a close.
4. **Require value movement before auth drama (S4–S5)** — most contracts aren’t custody; don’t deep-read libraries.
5. **Spend deep budget on money + weird + weak-IR (S6–S7)** — wide net at intake, sharp knife only where misses hurt.


## 6. Automated Ethereum pipeline architecture (new)

**Near-term scope:** build the runnable environment for **Ethereum only** first (ingestion → IR → invariant passes → triage UI). Multi-chain workers keep using the factory; ETH automation is the template to clone later.

### 6.1 Components & data flow

```
[Address / block / TVL feed]
        │
        ▼
┌───────────────────┐
│ 1. Ingestion      │  Etherscan API verified Solidity/Vyper
│                   │  → else Heimdall / Panoramix decompile (low confidence)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 2. Normalization  │  Common IR (CFG + fns + extcalls + storage writes + auth preds)
│                   │  Slither-class SSA for verified Solidity; thinner CFG for Vyper/decompile
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 3. Invariant passes│  Auth gates · conservation/value movers · first-deposit inflation
│                   │  Bridge mint-without-proof · ABI-vs-binary signer mismatch · fork-diff
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 4. Funnel + UX    │  §6.0 scoring funnel → buckets (not on the public website)
│                   │  Rate-limit Etherscan · store heat/confidence · humans do Lane B + manual-review
└───────────────────┘
```

**Output policy:** automation emits buckets (§6.0): `lane-a-cool` / `lane-b-queue` / `manual-review` / `human-no-candidate` / `human-yes-candidate`. **Never auto-`yes`.** **Never auto-`no` on low IR/decompile confidence.** Human closes BROKEN paths in prose (no PoC).

### 6.2 Invariant pass layer (ETH automation)
Map IR nodes to the same I1–I8 questions:
- Auth-gate detection on every value-moving external/public fn
- Conservation / value-mover imbalance leads
- First-deposit / empty-market share inflation patterns (as **hypotheses**)
- Bridge mint / release without proof or message binding
- ABI-versus-binary / proxy-implementation mismatches (signer & selector drift)
- Fork-diff against known canonical implementations when family detected

### 6.3 Two-lane execution (breadth vs depth) — driven by §6.0
| Lane | Runs stages | Cost |
|---|---|---|
| **A — Cheap skim** | S0–S5 across as many ETH contracts as rate limits allow; emit heat + bucket | High volume, low false-deep-reads |
| **B — Deep invariant** | S7 on `lane-b-queue` **and** promotions from `manual-review` | Human + CPU |

Lane A’s job is **noise kill + ranking**, not verdicts. Lane B’s job is **thoroughness on what might actually pay**. The `manual-review` bucket is the safety net that keeps real bugs from slipping through weak IR as a silent low score.

### 6.4 Hardest decisions (with recommendations)

1. **IR choice** — Slither-class SSA for verified Solidity; thinner CFG for Vyper/decompile; always set `ir_confidence`. Weak IR **cannot** claim `yes` **or** auto-`no` (Do Not Auto-Dismiss).
2. **Decompile trust** — Heimdall/Panoramix are hypothesis generators only. Decompile ⇒ `src_confidence=low` ⇒ `manual-review` path, never proof of safety or theft.
3. **Breadth vs depth** — Funnel §6.0: wide intake, cheap kills first, deep only on S6 survivors + manual-review. Prefer a slightly larger manual bucket over a false `no`.

### 6.5 ETH environment bootstrap (first cohesive stack)
Start with Ethereum-only:
- Secrets: Etherscan API key(s) in vault/env (rotate; respect rate limits)
- Workers: claim from an `ethereum` segment / ETH address queue
- Tooling: solc + Slither (verified path); Heimdall and/or Panoramix (unverified fallback)
- Storage: IR artifacts + pass JSON under `factory/artifacts/` or `factory/work/eth-invariant/`
- Triage: scores into `results/` + shared cumulative with `--agent invariant|ethereum`
- Website (if any): read-only triage UI — **not** the scanner runtime
- Fuzz / property lane (later, ETH-only first): invariant *hypothesis* checks that assert conservation/auth on local forks **without** encoding theft payloads; keep factory HARD RULES (no attack sims aimed at live funds)

---

## 7. Cross-cutting playbook (any contract)

1. **Identify chain + artifact** (verified source, repo, or binary dump).
2. **Deployed == reviewed?** (I4) — if no, flag before deep trust.
3. **Owner / upgrade / pause** — record; admin-only ≠ `yes`.
4. **Known-pattern skim** (§2.2).
5. **If valuable / novel / fork / closed:** invariant pass (§5) and/or ELF six-pass (§3).
6. **Run filtration funnel (§6.0)** — cheap stages first; ambiguous/low-confidence → `manual-review`, never silent discard.
7. **Score hypotheses** → deep-read ≥8 and all `manual-review` promotions.
8. **Verdict** with exact path or exact unread residual.
9. **Append cumulative** — never invent USD; use UNKNOWN.

### Anti-patterns learned the hard way
- Trusting IDL/docs over binary (Katana).
- Treating DefiLlama / supply×price as redeemable reserves (UTONIC false YES).
- Flipping `yes` when residual needs a forbidden tx (STRATO).
- Calling a grep hit a finding.
- Auto-dismissing low-confidence IR/decompile as `no` (real bugs hide there — use `manual-review`).
- Rebuilding `queue.csv` and wiping live claims.

---

## 8. Where to look next (prioritized)

1. Finish `invariant_pass.py` + wire WORKER_BRIEF §3b (in progress).
2. Stand up **Ethereum-only** ingestion → IR → Lane A/B workers.
3. Re-run Lane B on ETH `needs-look` / high-TVL custom forks from the board.
4. Keep Solana six-pass recipe for closed sBPF; escalate true decompile only when hypothesis is concrete.
5. STRATO: code-level report path only; do not probe constructors on live proxies.

---

## 9. Document map

| Topic | Canonical file |
|---|---|
| Worker claim/triage/HARD RULES | `WORKER_BRIEF.md` |
| Factory layout / segments | `README.md` |
| Invariant methodology | `INVARIANT_FRAMEWORK.md` |
| This master reference | `SWEEP_SCANNING_REFERENCE.md` (incl. §6.0 filtration funnel) |
| STRATO consolidated | `results/Q00342_strato_verdict.md` |
| YES/MAYBE board | `results/YES_MAYBE_recheck_2026-10-26.md` |
| Katana IDL≠binary | `deepdive/katana/instantWithdraw-signer-recheck.md` |
| Solstice sBPF deep | `results/Q00095_solstice_*.md`, `Q91842_solstice_yv_*.md` |

*Last compiled: 2026-10-27 (America/Chicago). Defensive analysis only.*
