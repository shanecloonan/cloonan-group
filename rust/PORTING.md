# TS → Rust Porting Tracker

Source of truth: `lib/network/*.ts`. Each module below maps a TypeScript
file to its Rust counterpart. Mark `[x]` only when the Rust impl is
**byte-for-byte compatible** with the TS reference (verified by shared
test vectors).

## Crates and modules

### `mfn-crypto` — discrete-log primitives (ed25519)

| TS file (`lib/network/`)   | Rust module (`mfn-crypto/src/`) | Status      |
| -------------------------- | ------------------------------- | ----------- |
| `primitives.ts` (encoding) | `scalar.rs`, `point.rs`         | [x] live    |
| `primitives.ts` (hashes)   | `hash.rs`                       | [x] live    |
| `primitives.ts` (Schnorr)  | `schnorr.rs`                    | [x] live    |
| `primitives.ts` (Pedersen) | `pedersen.rs`                   | [x] live    |
| `primitives.ts` (stealth)  | `stealth.rs`                    | [x] live    |
| `primitives.ts` (enc amt)  | `encrypted_amount.rs`           | [x] live    |
| `primitives.ts` (LSAG)     | `lsag.rs`                       | [x] live    |
| `codec.ts` (Writer/Reader) | `codec.rs`                      | [x] live    |
| `codec.ts` (DOMAIN tags)   | `domain.rs`                     | [x] live    |
| `clsag.ts`                 | `clsag.rs`                      | [x] live    |
| `range.ts`                 | `range.rs`                      | [x] live    |
| `bulletproofs.ts`          | `bulletproofs.rs`               | [ ] pending |
| `oom.ts`                   | `oom.rs`                        | [x] live    |
| `vrf.ts`                   | `vrf.rs`                        | [x] live    |
| `decoy.ts`                 | `decoy.rs`                      | [ ] pending |

### `mfn-bls` — BLS12-381 signatures (planned crate)

| TS file       | Rust module     | Status      |
| ------------- | --------------- | ----------- |
| `bls.ts`      | `lib.rs`        | [ ] pending |
| `kzg.ts`      | `kzg.rs`        | [ ] pending |

### `mfn-wire` — canonical binary codec (planned crate)

| TS file   | Rust module | Status      |
| --------- | ----------- | ----------- |
| `wire.ts` | `lib.rs`    | [ ] pending |

### `mfn-storage` — SPoRA + endowment math (planned crate)

| TS file        | Rust module       | Status      |
| -------------- | ----------------- | ----------- |
| `storage.ts`   | `spora.rs`        | [ ] pending |
| `endowment.ts` | `endowment.rs`    | [ ] pending |
| `utxo-tree.ts` | `utxo_tree.rs`    | [ ] pending |

### `mfn-consensus` — state transition function (planned crate)

| TS file          | Rust module       | Status      |
| ---------------- | ----------------- | ----------- |
| `block.ts`       | `block.rs`        | [ ] pending |
| `transaction.ts` | `transaction.rs`  | [ ] pending |
| `coinbase.ts`    | `coinbase.rs`     | [ ] pending |
| `consensus.ts`   | `consensus.rs`    | [ ] pending |
| `emission.ts`    | `emission.rs`     | [ ] pending |
| `slashing.ts`    | `slashing.rs`     | [ ] pending |

### `mfn-node` — daemon binary (planned crate)

| TS file (`lib/node/`) | Rust impl                   | Status      |
| --------------------- | --------------------------- | ----------- |
| `rpc.ts`              | `rpc.rs` (JSON-RPC over HTTP) | [ ] pending |
| `store.ts`            | `store.rs` (RocksDB-backed)   | [ ] pending |
| `mempool.ts`          | `mempool.rs`                | [ ] pending |
| —                     | `network.rs` (libp2p gossip)| [ ] pending |
| —                     | `bin/mfnd.rs` (daemon entry)| [ ] pending |

### `mfn-wallet` — wallet binary (planned crate)

| TS file (`lib/wallet/`) | Rust impl       | Status      |
| ----------------------- | --------------- | ----------- |
| `wallet.ts`             | `wallet.rs`     | [ ] pending |
| `rpc-client.ts`         | `rpc_client.rs` | [ ] pending |
| —                       | `bin/mfn-cli.rs`| [ ] pending |

### `mfn-wasm` — WebAssembly bindings (planned crate)

WASM-bindgen wrappers so the Next.js `/blockchain` page can call the
real Rust primitives instead of the TS reference. Same UI, faster +
real crypto.

## Verification: shared test vectors

Each Rust module ships unit tests that include known test vectors
produced by the TS reference. CI runs both:

```bash
npm test                       # TS smokes
cargo test --workspace         # Rust unit + integration tests
```

When a vector diverges, the TS reference is wrong; fix it before
merging.
