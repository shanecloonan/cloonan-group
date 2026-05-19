# MoneyFund Casino — Architecture & Roadmap

> "Build the foundation right and the second game ships in a week.
>  Build it wrong and every game is its own snowflake."

This document is the source-of-truth design for the `/casino` product. It
describes **the layered abstractions, the chain-adapter pattern, the
provable-fairness scheme, the data model, and the multi-phase build order**
we will follow. Code in `lib/casino/` and `infra/contracts/casino/` is the
implementation of this document. If the two ever disagree, this document
wins until updated.

---

## 0. Design Goals (non-negotiable)

1. **Provably fair, always.** Every random outcome must be reproducible by
   the player from public inputs *after* settlement. No trust required.
2. **Chain-agnostic core.** The blackjack rules engine should not know
   what coin it's denominated in. The same engine settles a hand against an
   ETH USDC balance, a SOL USDC balance, or a fake in-memory ledger in dev.
3. **Off-chain hot loop, on-chain settlement.** A blackjack hand takes 15
   seconds; settling each `hit` on-chain would be unusable. We settle the
   net result of a hand to the on-chain vault, not every action.
4. **Append-only audit log.** Every action a player or dealer takes is
   stored as an immutable row. We can reconstruct any hand bit-for-bit.
5. **Add a new game in one PR.** Game logic is a single self-contained
   module implementing the `Game<Action, State, Result>` interface. Nothing
   else changes.
6. **Add a new chain in one PR.** Same idea — implement `ChainAdapter`,
   register it, done.
7. **Survive a hostile auditor.** All hand histories, seed reveals, vault
   balances, and house-edge accounting must be inspectable by any user.

---

## 1. The Five Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  L5 · UI         app/casino/* — React, table renderer, sounds   │
├─────────────────────────────────────────────────────────────────┤
│  L4 · Session    lib/casino/session.ts — state machine, audit   │
│                  log, bet lifecycle, dispute resolution         │
├─────────────────────────────────────────────────────────────────┤
│  L3 · Game       lib/casino/blackjack.ts (+ later: dice, crash, │
│                  roulette, slots, poker, sports-via-parlay)     │
│                  pure deterministic rules — zero IO.            │
├─────────────────────────────────────────────────────────────────┤
│  L2 · Provable   lib/casino/rng.ts + lib/casino/deck.ts         │
│       Randomness HMAC-SHA256 commit-reveal seeds, byte streams, │
│                  deterministic Fisher-Yates shuffle.            │
├─────────────────────────────────────────────────────────────────┤
│  L1 · Settlement lib/casino/balance.ts + chain-adapter.ts       │
│                  on-chain vault contracts + off-chain ledger    │
└─────────────────────────────────────────────────────────────────┘
```

Every line crossed is a typed interface. Higher layers never reach down
more than one level.

---

## 2. Provable Fairness (Layer 2 in detail)

Industry-standard commit-reveal scheme as used by Stake / BC.Game /
Crash.com — but we publish *every* server-seed reveal automatically when a
user rotates their client seed, and we expose a `verify` endpoint that
anyone (not just the player) can replay.

### 2.1 Seed pair lifecycle

```
                ┌─────────────────────────────────────────┐
                │  Per-user, mutable until rotated        │
                │  ┌───────────────────────────────────┐  │
                │  │ server_seed     (private, 32B)    │  │
                │  │ server_seed_hash = sha256(seed)   │  │  ← shown to user up-front
                │  │ client_seed     (user can set)    │  │
                │  │ nonce           (per-action++)    │  │
                │  └───────────────────────────────────┘  │
                └─────────────────────────────────────────┘
```

1. Server generates `server_seed` and publishes `server_seed_hash`.
2. Client supplies (or accepts a default) `client_seed`.
3. Each card / dice / roll uses `nonce = nonce + 1`.
4. **Anytime** the user can rotate their `client_seed`. At rotation we
   reveal the old `server_seed`, generate a fresh one, and publish its
   hash.

### 2.2 Output derivation

For every random byte stream needed:

```
key      = server_seed
message  = client_seed || ":" || nonce || ":" || cursor
stream   = HMAC-SHA256(key, message)
```

We pull 32 bytes per HMAC call, then increment `cursor` when we need more.

Cards from the stream:
```
remaining_cards = [0..51]  # 0=2♣, 1=3♣, ..., 12=A♣, 13=2♦, ...
for each card draw:
    while True:
        b = next 4 bytes from stream as uint32 BE
        if b < (2^32 - (2^32 mod n))  # rejection sampling
            idx = b mod n
            yield remaining_cards.pop(idx)
            break
```

Rejection sampling kills modulo bias. The deck size `n` shrinks as cards
are drawn so the rejection bound is recomputed each step.

### 2.3 Verification UX

Every settled hand exposes:

- `server_seed` (revealed once rotated)
- `server_seed_hash` (still verifiable: `sha256(seed) == hash`)
- `client_seed`
- `start_nonce`, `end_nonce`
- The full action list

A user clicks **Verify** and a client-side worker replays the deal. If our
result differs, we eat the loss publicly.

---

## 3. Game Layer (L3)

```ts
interface Game<Action, State, Result> {
  id: GameId;                            // "blackjack" | "dice" | ...
  initialState(bet: Bet, rng: RngStream): State;
  legalActions(state: State): Action[];
  step(state: State, action: Action, rng: RngStream): State;
  isTerminal(state: State): boolean;
  settle(state: State, bet: Bet): Result; // payout / loss
}
```

Every game is a single self-contained module that exports a `Game`. The
session layer doesn't know what blackjack is — it just calls
`legalActions`, sends the user's choice to `step`, and asks `isTerminal`.

### 3.1 Blackjack rules baked in
- 6-deck shoe (configurable 1-8)
- Dealer hits on soft 17 (S17 toggle for later)
- Blackjack pays 3:2 (toggle for 6:5 promo)
- Double allowed on any 2; double-after-split allowed
- Split up to 4 hands; split aces get 1 card each (no BJ on split)
- Insurance pays 2:1 when dealer shows Ace
- Surrender (late) — toggle for v2

House edge with these rules ≈ 0.42%. We will publish the exact RTP per
table on each table card.

---

## 4. Settlement Layer (L1)

### 4.1 The chain-adapter pattern

```ts
interface ChainAdapter {
  id: ChainId;             // 'ethereum-mainnet' | 'solana-mainnet' | 'dev-mock'
  display: string;
  nativeCurrency: TokenSpec;
  supportedTokens: TokenSpec[];

  getVaultAddress(): string;

  buildDepositTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
  }): Promise<UnsignedTx>;

  pollDeposit(txHash: string): Promise<DepositReceipt | null>;

  buildWithdrawTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
    sessionId?: string;
    serverSignature: string; // operator-signed authorization
  }): Promise<UnsignedTx>;

  pollWithdraw(txHash: string): Promise<WithdrawReceipt | null>;

  /** Optional: on-chain VRF (Chainlink VRF / Switchboard / Pyth Entropy). */
  requestRandomness?(args: { sessionId: string }): Promise<RandomnessRequest>;
}
```

Today: `DevMockAdapter` for dev (instant deposits to in-memory balance).
Phase 2: `EthereumAdapter` wrapping the `CasinoVault.sol` ERC-20 vault.
Phase 3: `SolanaAdapter` wrapping the Anchor `casino-vault` program.

### 4.2 ETH vs SOL — concrete differences

| Concern                | Ethereum (L1 / L2)                         | Solana                                       |
| ---------------------- | ------------------------------------------ | -------------------------------------------- |
| Deposit settle time    | ~12s (mainnet) / ~2s (Base, Arbitrum)      | ~400ms                                       |
| Withdraw cost          | $0.20–$2 (L2)                              | <$0.01                                       |
| Native token           | ETH                                        | SOL                                          |
| Preferred stablecoin   | USDC (mainnet/Base)                        | USDC (SPL)                                   |
| Contract language      | Solidity                                   | Rust + Anchor                                |
| Wallet adapter         | MetaMask / WalletConnect (already wired)   | Phantom / Solflare (new)                     |
| VRF provider           | Chainlink VRF v2                           | Switchboard On-Demand or Pyth Entropy        |
| Signature scheme       | secp256k1 + EIP-712                        | Ed25519                                      |
| Best for…              | Large bets, high-trust audit trail         | Hot loop, micro-bets, slot pulls             |

The vault contracts are **independent per chain** — we never bridge mid-
session. A user's ETH-USDC balance and SOL-USDC balance are two distinct
ledgers in our DB. They can deposit/withdraw on either side at any time.

### 4.3 The vault contracts (spec)

**Ethereum — `CasinoVault.sol`** (lives in `infra/contracts/ethereum/`):

- Stores ERC-20 (USDC, USDT, WETH) balances credited to user addresses.
- `deposit(IERC20 token, uint256 amount)` — pulls tokens, emits
  `Deposited(user, token, amount, nonce)`.
- `withdraw(IERC20 token, uint256 amount, uint256 nonce,
  bytes calldata operatorSig)` — verifies an EIP-712 signature from the
  operator wallet authorising the withdrawal, then pays out. Replay-
  protected by nonce.
- `operatorAddress` is the casino's hot signer (rotatable by owner).
- `owner` is a multisig with a 48-hour timelock for any admin action.
- Per-user, per-token withdrawal *daily cap* (defense in depth).
- Pause switch (multisig-only) that blocks deposits but never withdrawals.

**Solana — `casino-vault` Anchor program** (lives in
`infra/contracts/solana/`):

- One PDA per (user, token mint) holding the user's balance.
- `deposit` instruction transfers SPL tokens into a vault PDA, increments
  the user PDA balance.
- `withdraw` instruction verifies an Ed25519 signature from the operator
  PDA authorising the withdraw, then debits + transfers.
- Operator key rotation via on-chain governance instruction (multisig).
- Replay protection via a per-user nonce account.

Both contracts target USDC first because price stability matters for
gambling UX. Native ETH / SOL betting is phase-3.

---

## 5. Session Layer (L4)

The session layer is the *only* place where bets, balances, RNG, and game
logic meet. It is responsible for:

1. **Bet placement** — debit user balance, lock funds in the session.
2. **State machine** — `dealing → player_turn → dealer_turn → settled`.
3. **Action validation** — only forward `legalActions(state)` to the game.
4. **Audit logging** — append every action and state hash.
5. **Settlement** — call `game.settle()`, credit user balance.
6. **Emergency abort** — refund stake if anything inconsistent.

State transitions and durations are bounded: a hand has a 90-second
total timeout. Player inaction past 30 seconds = auto-stand.

---

## 6. Data Model (Supabase)

| table                  | purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `casino_users`         | per-user KYC level, default seeds, banned flag          |
| `casino_seed_pairs`    | server seed (hashed when active, revealed when retired) |
| `casino_balances`      | (user, chain, token) → amount                           |
| `casino_deposits`      | each on-chain deposit, with confirmations               |
| `casino_withdrawals`   | each on-chain withdrawal request                        |
| `casino_sessions`      | one row per game session (hand, dice roll, slot pull)   |
| `casino_actions`       | append-only action log; PK is (session_id, ordinal)     |
| `casino_settlements`   | net P/L per session, for reporting                      |
| `casino_house_pnl`     | rolling P/L by game/day                                 |

All tables are **append-only where possible**. `casino_actions` cannot be
updated or deleted at the SQL policy level — only the operator can insert,
and inserts must monotonically increment `ordinal`.

### 6.1 RLS posture

- A player can read their own rows in every table.
- A player can read `server_seed_hash` for their *active* seed pair.
- A player can read `server_seed` only for *retired* seed pairs.
- Nobody (not even via anon key) can write to `casino_settlements` or
  `casino_house_pnl` — those are server-role only via edge functions.

---

## 7. Roadmap (the actual build order)

We sequence carefully so every phase is shippable in isolation.

### Phase 0 — Foundation **← this PR**

- Architecture doc (this file).
- `lib/casino/types.ts`: every shared type.
- `lib/casino/rng.ts`: commit-reveal HMAC RNG with rejection sampling.
- `lib/casino/deck.ts`: deterministic shoe shuffler.
- `lib/casino/blackjack.ts`: full rules engine + smoke test.
- `lib/casino/balance.ts`: in-memory + Supabase-backed ledger.
- `lib/casino/chain-adapter.ts`: interface + `DevMockAdapter`. Eth/Sol
  classes exist as stubs that throw `NotImplemented` for now.
- `lib/casino/session.ts`: state-machine session driver.
- `infra/contracts/ethereum/CasinoVault.sol`: contract spec (not
  deployed).
- `infra/contracts/solana/casino-vault/src/lib.rs`: Anchor program spec.
- Supabase migration `2026-05-19-casino-tables.sql` (applied).
- `/casino` page with a working dev-money blackjack table.
- Smoke test `scripts/smoke-casino-blackjack.ts`.

**Exit criteria:** play a blackjack hand in the browser against dev money,
verify the seed reveal, settle to the in-memory ledger. Zero on-chain
dependency.

### Phase 1 — Provable fairness UI polish

- "Verify this hand" modal with a client-side replay worker.
- Seed rotation flow (player can demand fresh server seed any time).
- Public verification page `/casino/verify` that anyone can paste a hand
  into.
- Daily seed-pair archive published to Arweave (we already have the
  infra for permaweb writes).

### Phase 2 — Ethereum settlement

- Deploy `CasinoVault.sol` to Base Sepolia → Base mainnet.
- Implement `EthereumAdapter`.
- Deposit / withdraw flow wired into existing `/wallets` UI.
- Hot-wallet operator service that signs withdraw EIP-712 messages.
- Chainlink VRF v2 path optional ("on-chain mode") for whales.

### Phase 3 — Solana adapter

- Anchor program for SPL deposits/withdrawals (USDC first).
- Phantom + Solflare wallet adapter (new context provider, mirrors the
  existing `WalletProvider`).
- Switchboard On-Demand integration for optional on-chain randomness.
- Per-chain balance UI: user sees both ETH-USDC and SOL-USDC, can swap
  between chains at will.

### Phase 4 — More games

In order of complexity / variance / dev cost:

1. **Dice / Limbo** — trivially derived from the same RNG.
2. **Coin flip** — useful as a tutorial game.
3. **Crash** — one server-side seeded number per round, multiplayer.
4. **Roulette** — Euro single-zero (2.7% edge).
5. **Plinko** — visual-heavy; rules are simple.
6. **Slots** — math is easy, art is hard.
7. **Sports betting** — hook the `parlay-engine` into a casino-style bet
   slip. We already have the +EV scanner.
8. **Video poker** — same RNG primitives as blackjack.
9. **Multiplayer poker** — last because real-time tables, anti-collusion,
   rake, and shuffle commitments are their own multi-month project.

### Phase 5 — Compliance + jurisdictional gating

- Geo-IP blocking for restricted regions.
- KYC tiers (none / soft / hard) gating max bet & withdrawal velocity.
- Self-exclusion + cooldown timers.
- 7-year audit log retention.

### Phase 6 — House risk & profit accounting

- Real-time RTP dashboard per game (target ≈ 99.5% for blackjack).
- Variance-adjusted bankroll model: how much float we hold per chain.
- Hedge bot: when player open exposure breaches a threshold, place an
  offsetting hedge on Polymarket / DeFi options (out of scope of this
  doc but a known phase).

---

## 8. Threat Model & Mitigations

| Threat                                            | Mitigation                                               |
| ------------------------------------------------- | -------------------------------------------------------- |
| Operator forges card outcomes                     | Commit-reveal + replay verification + public seed log    |
| Operator changes seed after seeing bet            | `server_seed_hash` published at session open             |
| Withdrawal replay                                 | EIP-712 nonces (ETH) / Anchor nonce accounts (SOL)       |
| Hot wallet compromise                             | Daily cap + multisig owner + auto-pause                  |
| Player double-spends across sessions              | Balance locked into session on bet placement             |
| RNG byte-mod bias                                 | Rejection sampling (`while b < ceiling`)                 |
| Front-running deposits                            | Deposit credit on N confirmations, not 0                 |
| Cross-chain accounting drift                      | Per-chain ledgers, never auto-bridge                     |
| Database compromise alters history                | Append-only + daily Arweave archive of action log hashes |
| Malicious tx in withdraw queue                    | Operator service hand-signs every withdraw with EIP-712  |
| Player claims hand was unfair                     | One-click client-side replay produces identical output   |

---

## 9. Glossary

- **RTP** — return-to-player, the long-run % of money returned to bettors.
  Casino edge = 100% − RTP.
- **Shoe** — the physical pile of multiple decks blackjack is dealt from.
- **Soft 17** — a 17 containing an ace counted as 11.
- **Commit-reveal** — protocol where one party commits to a value via its
  hash, then reveals the value later for verification.
- **VRF** — verifiable random function; cryptographic proof that a random
  output was generated honestly from a public input.
- **PDA** — Solana program-derived address; deterministic owned-by-
  program account.
