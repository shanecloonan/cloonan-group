/* ===========================================================================
 *  MoneyFund Casino — shared types
 *  ---------------------------------------------------------------------------
 *  Single source of truth for the type interfaces that connect the five
 *  casino layers (UI ↔ Session ↔ Game ↔ Provable RNG ↔ Settlement).
 *
 *  Read `docs/CASINO_ARCHITECTURE.md` first. If a type defined here doesn't
 *  match the doc, the doc wins — update one or the other.
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 *  Chains & tokens
 * ------------------------------------------------------------------------- */

/**
 * Chain identifiers. Production has `ethereum-*` and `solana-*`. Dev has
 * `dev-mock` which is an in-memory ledger so the entire casino works in
 * the browser without any RPC connectivity at all.
 */
export type ChainId =
  | "dev-mock"
  | "ethereum-mainnet"
  | "ethereum-base"
  | "ethereum-arbitrum"
  | "ethereum-sepolia"
  | "solana-mainnet"
  | "solana-devnet";

/**
 * A token specification. `address` is the ERC-20 / SPL mint address; for
 * native currency (ETH, SOL) it is the zero address or wrapped-native
 * mint depending on adapter conventions.
 */
export interface TokenSpec {
  /** Canonical identifier across chains, e.g. "USDC". */
  symbol: string;
  display: string;
  decimals: number;
  /** On-chain contract / mint address. */
  address: string;
  /** Whether this is the chain's native currency (ETH, SOL). */
  isNative: boolean;
  /** Coingecko id (for UI price display). Optional. */
  coingeckoId?: string;
}

/* ---------------------------------------------------------------------------
 *  Money — fixed-precision integer amounts
 * ------------------------------------------------------------------------- */

/**
 * Internally, ALL money is `bigint` in the token's smallest unit (wei for
 * ETH, 6dp for USDC). Floats never touch a balance. The UI converts to a
 * human-readable string at the display boundary.
 */
export type AmountUnits = bigint;

export interface MoneyAmount {
  units: AmountUnits;
  token: TokenSpec;
}

/* ---------------------------------------------------------------------------
 *  Provable RNG
 * ------------------------------------------------------------------------- */

/**
 * A long-lived (per-user) commit-reveal seed pair. The server seed lives
 * privately while in use; its hash is published up-front. When the player
 * rotates their client seed, the old server seed is revealed and a new
 * pair is generated.
 */
export interface SeedPair {
  id: string;
  userId: string;
  /** Hex string. Only present after the pair is *retired*. */
  serverSeed: string | null;
  /** Hex sha-256 of `serverSeed`. Published from the moment the pair is created. */
  serverSeedHash: string;
  /** Player-supplied (or default) client seed. UTF-8, max 64 chars. */
  clientSeed: string;
  /** Monotonic nonce per action under this pair. */
  nonce: number;
  status: "active" | "retired";
  createdAt: string;
  retiredAt: string | null;
}

/**
 * A handle to draw bytes from the deterministic HMAC stream for a *single*
 * action (one card, one dice roll, one slot pull). Internally it pulls
 * 32-byte HMAC blocks as needed.
 */
export interface RngStream {
  pair: SeedPair;
  /** Nonce used for this specific draw — usually `pair.nonce + 1`. */
  nonce: number;
  /** Pull the next byte from the stream. */
  nextByte(): number;
  /** Pull a 4-byte big-endian unsigned integer. */
  nextUint32(): number;
  /** Pick an unbiased integer in [0, max) via rejection sampling. */
  nextInt(maxExclusive: number): number;
  /** Total bytes consumed so far (for debugging). */
  bytesConsumed(): number;
}

/* ---------------------------------------------------------------------------
 *  Cards & decks
 * ------------------------------------------------------------------------- */

export type Suit = "♣" | "♦" | "♥" | "♠";
/** 2..10, J, Q, K, A */
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
  /** 0..51 canonical index. 0 = 2♣, 51 = A♠. Used by the RNG mapping. */
  index: number;
}

export interface Shoe {
  /** Number of 52-card decks. */
  numDecks: number;
  /** All remaining cards in deal order (top = index 0). */
  cards: Card[];
}

/* ---------------------------------------------------------------------------
 *  Generic game contract
 * ------------------------------------------------------------------------- */

export type GameId =
  | "blackjack"
  | "baccarat"
  | "coinflip"
  | "dice"
  | "crash"
  | "roulette"
  | "plinko"
  | "slots"
  | "mines"
  | "hilo"
  | "poker"
  | "video-poker"
  | "keno"
  | "wheel"
  | "sic-bo"
  | "dragon-tiger"
  | "casino-war"
  | "red-dog"
  | "three-card-poker"
  | "andar-bahar"
  | "caribbean-stud"
  | "casino-holdem";

export interface Bet {
  sessionId: string;
  userId: string;
  gameId: GameId;
  /** What chain / token the wager is denominated in. */
  chainId: ChainId;
  token: TokenSpec;
  /** Wager in smallest token units. */
  stake: AmountUnits;
  /** Game-specific config (number of decks, dice target, etc.). */
  config?: Record<string, unknown>;
}

export interface GameResult {
  /**
   * Total money the player committed during the session, in the bet's
   * token units. Always >= the original stake; may be greater because of
   * doubles / splits / insurance add-ons that debited extra from balance
   * mid-session.
   */
  totalStakedUnits: AmountUnits;
  /**
   * Total money the casino pays back to the player. Includes any
   * returning-of-stake (pushes pay back the original wager; wins pay back
   * stake + winnings).
   */
  totalPayoutUnits: AmountUnits;
  /**
   * Signed net change to player balance over the whole session.
   * `pnlUnits = totalPayoutUnits - totalStakedUnits`. Positive = player
   * gained, negative = player lost, 0 = push.
   */
  pnlUnits: bigint;
  /** Optional human breakdown (e.g. per-hand for split blackjack). */
  breakdown?: { label: string; stakedUnits: AmountUnits; payoutUnits: AmountUnits; pnlUnits: bigint }[];
}

/**
 * Contract every game module implements. The session driver only ever
 * touches a `Game<...>` interface — it never imports blackjack-specific
 * logic directly. This is what makes the casino extensible.
 */
export interface Game<Action, State> {
  id: GameId;
  display: string;
  /** Build the opening state of a new round. */
  initialState(bet: Bet, rng: RngStream): State;
  /** What can the player legally do right now? Empty == terminal. */
  legalActions(state: State): Action[];
  /** Apply an action; some actions consume RNG bytes. */
  step(state: State, action: Action, rng: RngStream): State;
  isTerminal(state: State): boolean;
  settle(state: State, bet: Bet): GameResult;
}

/* ---------------------------------------------------------------------------
 *  Sessions & audit log
 * ------------------------------------------------------------------------- */

export type SessionStatus =
  | "open"           // accepting actions
  | "settled"        // resolved, balances updated
  | "voided";        // refunded due to error / dispute

export interface Session<Action = unknown, State = unknown> {
  id: string;
  userId: string;
  gameId: GameId;
  chainId: ChainId;
  token: TokenSpec;
  stake: AmountUnits;
  state: State;
  status: SessionStatus;
  /** Snapshot of the seed pair at session open. */
  seedPairId: string;
  serverSeedHash: string;
  clientSeed: string;
  startNonce: number;
  endNonce: number;
  /** Append-only list of actions ever applied. */
  actions: SessionAction<Action>[];
  /** Final settlement, populated when status === 'settled'. */
  result?: GameResult;
  createdAt: string;
  updatedAt: string;
}

export interface SessionAction<Action = unknown> {
  ordinal: number;
  /** Whose turn it represents: 'player', 'dealer', or 'system' (auto-stand). */
  actor: "player" | "dealer" | "system";
  action: Action;
  /** Nonce at the moment this action was applied (for replay determinism). */
  nonceAfter: number;
  /** Optional opaque hash of game state after this step — for forensics. */
  stateHash?: string;
  at: string;
}

/* ---------------------------------------------------------------------------
 *  Balance ledger
 * ------------------------------------------------------------------------- */

export interface Balance {
  userId: string;
  chainId: ChainId;
  token: TokenSpec;
  /** Total credited but not in-session. */
  available: AmountUnits;
  /** Funds locked into open sessions. */
  locked: AmountUnits;
}

export interface BalanceMutation {
  userId: string;
  chainId: ChainId;
  token: TokenSpec;
  delta: bigint; // positive = credit, negative = debit
  reason:
    | "deposit"
    | "withdraw"
    | "session_lock"
    | "session_unlock"
    | "session_settle"
    | "manual_adjustment";
  /** Optional foreign keys for audit. */
  sessionId?: string;
  txHash?: string;
}

/* ---------------------------------------------------------------------------
 *  Chain adapter
 * ------------------------------------------------------------------------- */

export interface UnsignedTx {
  chainId: ChainId;
  /** Opaque blob — bytes for Solana, JSON-RPC tx params for EVM. */
  payload: unknown;
  description: string;
}

export interface DepositReceipt {
  chainId: ChainId;
  txHash: string;
  user: string;
  token: TokenSpec;
  amount: AmountUnits;
  confirmations: number;
  /** Minimum confirmations the adapter requires before crediting. */
  required: number;
  finalized: boolean;
}

export interface WithdrawReceipt {
  chainId: ChainId;
  txHash: string;
  user: string;
  token: TokenSpec;
  amount: AmountUnits;
  confirmations: number;
  required: number;
  finalized: boolean;
}

export interface RandomnessRequest {
  chainId: ChainId;
  requestId: string;
  fulfilled: boolean;
  /** Hex-encoded random value when fulfilled. */
  value: string | null;
}

export interface ChainAdapter {
  id: ChainId;
  display: string;
  nativeCurrency: TokenSpec;
  supportedTokens: TokenSpec[];

  getVaultAddress(): string;

  buildDepositTx(args: {
    user: string;
    token: TokenSpec;
    amount: AmountUnits;
  }): Promise<UnsignedTx>;

  pollDeposit(txHash: string): Promise<DepositReceipt | null>;

  buildWithdrawTx(args: {
    user: string;
    token: TokenSpec;
    amount: AmountUnits;
    sessionId?: string;
    serverSignature: string;
  }): Promise<UnsignedTx>;

  pollWithdraw(txHash: string): Promise<WithdrawReceipt | null>;

  /** On-chain VRF, for "every-hand-on-chain" mode. Optional per adapter. */
  requestRandomness?(args: { sessionId: string }): Promise<RandomnessRequest>;
}
