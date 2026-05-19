# MoneyFund Casino — Smart contract specs

These files are **specifications**, not deployed contracts. They are
checked into the repo so the engineering team has a single source of
truth for what Phase 2 (Ethereum) and Phase 3 (Solana) will deploy. They
are referenced by `docs/CASINO_ARCHITECTURE.md` and by the chain adapters
in `lib/casino/chain-adapter.ts`.

| Path                                              | Purpose                                       |
| ------------------------------------------------- | --------------------------------------------- |
| `ethereum/CasinoVault.sol`                        | EVM vault — ERC-20 deposits + EIP-712 withdraws |
| `solana/casino-vault/src/lib.rs`                  | Anchor program — SPL deposits + Ed25519 withdraws |

## Deploy order

1. **Phase 2.0** — Wrap `CasinoVault.sol` in a Foundry workspace, write
   tests, run `slither` + `mythril`. Deploy to **Base Sepolia** first.
2. **Phase 2.1** — Independent audit. Deploy to **Base mainnet**. Wire
   `EthereumAdapter` in `chain-adapter.ts` to the live address.
3. **Phase 2.2** — Optional Chainlink VRF v2 module for "every-hand-on-
   chain" mode for whales.
4. **Phase 3.0** — Spin up Anchor workspace; `casino-vault/src/lib.rs`
   moves into `programs/casino-vault/`. Implement the
   `verify_operator_signature` helper. Tests + audit.
5. **Phase 3.1** — Deploy to **Solana devnet**. Wire `SolanaAdapter`.
6. **Phase 3.2** — Deploy to **Solana mainnet** after audit.

## What is OUT of scope here

- Hot-wallet operator service (separate Node process, signs EIP-712
  withdrawals; sees the off-chain ledger but never the vault private key
  directly — operator key lives in HSM).
- Front-end wallet adapters (Phantom / Solflare) — those will live next
  to the existing `WalletProvider` in `lib/wallet-context.tsx`.
- VRF integration — separate sub-contracts referenced by these vaults.

See `docs/CASINO_ARCHITECTURE.md` for the full rollout plan.
