# MoneyFund Network — Rust Core

> This directory is the **production-grade Rust implementation** of the MoneyFund
> Network protocol. The TypeScript code in `../lib/network/` is the executable
> spec + in-browser demo lab. **This is the chain.**

## Why two languages

The original prototype was built in TypeScript because the surrounding repo is a
Next.js app, but TypeScript is the wrong language for a real blockchain:

- ~50–100× slower than Rust for curve operations and hashing
- JavaScript's garbage collector introduces non-deterministic pauses (bad for
  consensus latency)
- Cannot reliably implement constant-time cryptography in V8 (timing leaks ⇒
  key leaks)
- No good path to a deployable native daemon or `libp2p` peer

The architectural split is therefore:

| Concern                            | Where it lives                | Why                                                                            |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| Protocol spec, in-browser demos    | `lib/network/*.ts` (existing) | Renders inside the Next.js `/blockchain` page; fast to iterate on protocol design. |
| Wallet / RPC client / Next.js UI   | `lib/`, `app/`                | Stays in TS forever.                                                           |
| **Real cryptographic primitives**  | `rust/mfn-crypto`             | Audited Rust libs (`curve25519-dalek`, `blstrs`).                              |
| **Consensus engine / block apply** | `rust/mfn-consensus` (planned)| Deterministic, native-speed state transitions.                                 |
| **Storage / SPoRA prover**         | `rust/mfn-storage` (planned)  | Hash-heavy, must be fast.                                                      |
| **Node daemon (`mfnd`)**           | `rust/mfn-node` (planned)     | `tokio` async runtime, `libp2p` networking.                                    |
| **Wire codec**                     | `rust/mfn-wire`               | Single canonical encoding shared by all crates. Byte-for-byte compatible with TS. |
| **WASM bindings for browser demo** | `rust/mfn-wasm` (planned)     | Replace the TS in-browser primitives with the actual Rust impl via `wasm-bindgen`. |

The TS implementation is the **reference**; the Rust implementation is the
**ground truth**. When they disagree, the TS is wrong by definition. Test
vectors flow TS → Rust at first (to bootstrap), then Rust → TS once each
primitive is ported.

## Build & test

```bash
# install rustup first if you haven't: https://rustup.rs
cd rust
cargo build --release
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```

## Porting status

Tracked in `PORTING.md` at the workspace root.

## Audited dependencies (and why)

- **`curve25519-dalek`** — the canonical Rust ed25519 implementation. Used by
  Signal, Zcash, Monero (Salvium fork), Solana, and is the reference impl
  cited by RFC 8032. Constant-time, no `unsafe`, formally verified subsections.
- **`sha2`** — RustCrypto's SHA-2 family. Constant-time.
- **`subtle`** — constant-time equality comparisons (used everywhere we'd
  otherwise compare secret material with `==`).
- **`zeroize`** — wipes secret material from memory on drop.
- **`rand_core` + `getrandom`** — OS CSPRNG.

No `unsafe` is permitted in this workspace (enforced via lints).

## What this is NOT

- Not a re-implementation of an existing chain. MoneyFund's design (endowment
  storage rewards, OoM-based log-size ring signatures, hybrid emission +
  fee-treasury tokenomics) is novel; see the `/blockchain` page in the web UI
  and `lib/network/*.ts` for the spec.
- Not audited. This is production-*grade* code (constant-time, no unsafe,
  proper error handling), but a real network deployment requires a third-party
  security review.
- Not feature-complete. See `PORTING.md`.
