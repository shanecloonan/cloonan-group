/* ===========================================================================
 *  MoneyFund Casino — Chain Adapters (Layer 1, settlement plumbing)
 *  ---------------------------------------------------------------------------
 *  Three adapters total today:
 *
 *    • DevMockAdapter      — in-memory, instant deposits; the default in
 *                            local dev. Backs `chainId: "dev-mock"`.
 *    • EthereumAdapter     — wraps `CasinoVault.sol` on Base / mainnet /
 *                            Arbitrum / Sepolia. STUB in this phase: deposit
 *                            and withdraw build tx-shaped objects but the
 *                            polling methods return `null` until phase 2.
 *    • SolanaAdapter       — wraps the Anchor `casino-vault` program.
 *                            STUB in this phase: returns adapter metadata
 *                            and well-shaped errors. Phase 3 implements
 *                            real Phantom / Solflare integration.
 *
 *  Both EVM and Solana adapters share the same `ChainAdapter` interface,
 *  which is the entire point of the architecture: the session driver and
 *  UI write to one interface; the rest is configuration.
 * ========================================================================= */

import type {
  ChainAdapter,
  ChainId,
  DepositReceipt,
  RandomnessRequest,
  TokenSpec,
  UnsignedTx,
  WithdrawReceipt,
} from "./types";

/* ---------------------------------------------------------------------------
 *  Token catalog
 * ------------------------------------------------------------------------- */

/** Native ETH on the dev-mock chain — used for the "play money" tutorial. */
export const DEV_TOKEN: TokenSpec = {
  symbol: "DEV",
  display: "Dev Money",
  decimals: 6,
  address: "0x0000000000000000000000000000000000000000",
  isNative: true,
};

/** USDC on Ethereum mainnet. */
export const USDC_ETHEREUM_MAINNET: TokenSpec = {
  symbol: "USDC",
  display: "USD Coin (Ethereum)",
  decimals: 6,
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  isNative: false,
  coingeckoId: "usd-coin",
};

/** USDC on Base. */
export const USDC_BASE: TokenSpec = {
  symbol: "USDC",
  display: "USD Coin (Base)",
  decimals: 6,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  isNative: false,
  coingeckoId: "usd-coin",
};

/** Native ETH on Ethereum mainnet. Represented as the zero address. */
export const ETH_NATIVE: TokenSpec = {
  symbol: "ETH",
  display: "Ether",
  decimals: 18,
  address: "0x0000000000000000000000000000000000000000",
  isNative: true,
  coingeckoId: "ethereum",
};

/** USDC on Solana (canonical SPL mint). */
export const USDC_SOLANA: TokenSpec = {
  symbol: "USDC",
  display: "USD Coin (Solana)",
  decimals: 6,
  address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  isNative: false,
  coingeckoId: "usd-coin",
};

/** Native SOL. */
export const SOL_NATIVE: TokenSpec = {
  symbol: "SOL",
  display: "Solana",
  decimals: 9,
  address: "So11111111111111111111111111111111111111112",
  isNative: true,
  coingeckoId: "solana",
};

/* ---------------------------------------------------------------------------
 *  Dev mock adapter
 * ------------------------------------------------------------------------- */

/**
 * Treats the casino as a standalone closed system. Deposits "complete"
 * instantly without any RPC call; withdrawals do the same. Used in dev,
 * unit tests, and the "play money" mode on `/casino` when the user
 * hasn't connected a real wallet.
 */
export class DevMockAdapter implements ChainAdapter {
  readonly id: ChainId = "dev-mock";
  readonly display = "Dev (play money)";
  readonly nativeCurrency = DEV_TOKEN;
  readonly supportedTokens: TokenSpec[] = [DEV_TOKEN];

  getVaultAddress(): string {
    return "0xdevmock0000000000000000000000000000000000";
  }

  async buildDepositTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
  }): Promise<UnsignedTx> {
    return {
      chainId: this.id,
      description: `(dev) deposit ${args.amount} ${args.token.symbol}`,
      payload: { kind: "dev_deposit", ...args, amount: args.amount.toString() },
    };
  }

  async pollDeposit(txHash: string): Promise<DepositReceipt | null> {
    // In dev mode every "tx" is finalized immediately.
    return {
      chainId: this.id,
      txHash,
      user: "dev",
      token: DEV_TOKEN,
      amount: 0n,
      confirmations: 1,
      required: 1,
      finalized: true,
    };
  }

  async buildWithdrawTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
    sessionId?: string;
    serverSignature: string;
  }): Promise<UnsignedTx> {
    return {
      chainId: this.id,
      description: `(dev) withdraw ${args.amount} ${args.token.symbol}`,
      payload: { kind: "dev_withdraw", ...args, amount: args.amount.toString() },
    };
  }

  async pollWithdraw(txHash: string): Promise<WithdrawReceipt | null> {
    return {
      chainId: this.id,
      txHash,
      user: "dev",
      token: DEV_TOKEN,
      amount: 0n,
      confirmations: 1,
      required: 1,
      finalized: true,
    };
  }

  async requestRandomness(_args: { sessionId: string }): Promise<RandomnessRequest> {
    // Dev mock — pretends randomness was already on-chain.
    return {
      chainId: this.id,
      requestId: `dev_${Date.now()}`,
      fulfilled: true,
      value: "0x" + Math.floor(Math.random() * 1e16).toString(16).padStart(64, "0"),
    };
  }
}

/* ---------------------------------------------------------------------------
 *  Ethereum adapter — stub for Phase 2
 * ------------------------------------------------------------------------- */

export interface EthereumAdapterConfig {
  chainId: Exclude<ChainId, "dev-mock" | "solana-mainnet" | "solana-devnet">;
  display: string;
  vaultAddress: string;
  rpcUrl: string;
  supportedTokens: TokenSpec[];
}

/**
 * Wraps the `CasinoVault.sol` contract (see
 * `infra/contracts/ethereum/CasinoVault.sol`).
 *
 * Phase 1 (this PR): exposes the right interface shape, builds well-formed
 * unsigned tx objects (consumable by ethers.js once we wire it), and
 * surfaces clear NotImplemented errors from `pollDeposit/Withdraw`.
 *
 * Phase 2 (TBD): connect to the deployed contract, listen for `Deposited`
 * events, and implement the operator-side EIP-712 signing service.
 */
export class EthereumAdapter implements ChainAdapter {
  readonly id: ChainId;
  readonly display: string;
  readonly nativeCurrency = ETH_NATIVE;
  readonly supportedTokens: TokenSpec[];
  private readonly vaultAddress: string;
  private readonly rpcUrl: string;

  constructor(cfg: EthereumAdapterConfig) {
    this.id = cfg.chainId;
    this.display = cfg.display;
    this.vaultAddress = cfg.vaultAddress;
    this.rpcUrl = cfg.rpcUrl;
    this.supportedTokens = cfg.supportedTokens;
  }

  getVaultAddress(): string {
    return this.vaultAddress;
  }

  async buildDepositTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
  }): Promise<UnsignedTx> {
    // Two-tx flow: ERC-20 `approve(vault, amount)` then `vault.deposit(token, amount)`.
    // Phase 2 will return a multicall; for now we emit the call params as JSON.
    return {
      chainId: this.id,
      description: `deposit ${args.amount} ${args.token.symbol} → vault ${this.vaultAddress}`,
      payload: {
        rpcUrl: this.rpcUrl,
        calls: [
          {
            to: args.token.address,
            data: "0x095ea7b3" /* approve(address,uint256) */,
            args: { spender: this.vaultAddress, amount: args.amount.toString() },
          },
          {
            to: this.vaultAddress,
            data: "0x47e7ef24" /* deposit(address,uint256) */,
            args: { token: args.token.address, amount: args.amount.toString() },
          },
        ],
      },
    };
  }

  async pollDeposit(_txHash: string): Promise<DepositReceipt | null> {
    throw notImplemented("EthereumAdapter.pollDeposit");
  }

  async buildWithdrawTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
    sessionId?: string;
    serverSignature: string;
  }): Promise<UnsignedTx> {
    return {
      chainId: this.id,
      description: `withdraw ${args.amount} ${args.token.symbol} ← vault ${this.vaultAddress}`,
      payload: {
        rpcUrl: this.rpcUrl,
        to: this.vaultAddress,
        data: "0xb2bb52b4" /* withdraw(address,address,uint256,uint256,bytes) */,
        args: {
          user: args.user,
          token: args.token.address,
          amount: args.amount.toString(),
          sessionId: args.sessionId,
          operatorSig: args.serverSignature,
        },
      },
    };
  }

  async pollWithdraw(_txHash: string): Promise<WithdrawReceipt | null> {
    throw notImplemented("EthereumAdapter.pollWithdraw");
  }
}

/* ---------------------------------------------------------------------------
 *  Solana adapter — stub for Phase 3
 * ------------------------------------------------------------------------- */

export interface SolanaAdapterConfig {
  chainId: "solana-mainnet" | "solana-devnet";
  display: string;
  vaultProgramId: string;
  rpcUrl: string;
  supportedTokens: TokenSpec[];
}

/**
 * Wraps the Anchor `casino-vault` program (see
 * `infra/contracts/solana/casino-vault/`).
 *
 * Why Solana, given we already have Ethereum?
 *   • ~400ms slot times → micro-bet game loop feels instant.
 *   • Sub-cent fees → "every roll on chain" is actually viable.
 *   • Mature stable-coin ecosystem (Solana USDC) so dollar-denominated
 *     gambling UX works without wrapping fees.
 *
 * Where it differs:
 *   • Wallets are Phantom / Solflare — we'll add a parallel WalletProvider
 *     in Phase 3.
 *   • Anchor accounts are PDA-based (one PDA per (user, mint) balance).
 *   • Signatures are Ed25519 (the operator service signs withdraws and the
 *     Anchor program verifies via the `sysvar/ed25519` mechanism).
 */
export class SolanaAdapter implements ChainAdapter {
  readonly id: ChainId;
  readonly display: string;
  readonly nativeCurrency = SOL_NATIVE;
  readonly supportedTokens: TokenSpec[];
  private readonly vaultProgramId: string;
  private readonly rpcUrl: string;

  constructor(cfg: SolanaAdapterConfig) {
    this.id = cfg.chainId;
    this.display = cfg.display;
    this.vaultProgramId = cfg.vaultProgramId;
    this.rpcUrl = cfg.rpcUrl;
    this.supportedTokens = cfg.supportedTokens;
  }

  getVaultAddress(): string {
    return this.vaultProgramId;
  }

  async buildDepositTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
  }): Promise<UnsignedTx> {
    return {
      chainId: this.id,
      description: `deposit ${args.amount} ${args.token.symbol} → Anchor vault ${this.vaultProgramId}`,
      payload: {
        rpcUrl: this.rpcUrl,
        programId: this.vaultProgramId,
        instruction: "deposit",
        accounts: { user: args.user, mint: args.token.address },
        data: { amount: args.amount.toString() },
      },
    };
  }

  async pollDeposit(_txHash: string): Promise<DepositReceipt | null> {
    throw notImplemented("SolanaAdapter.pollDeposit");
  }

  async buildWithdrawTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
    sessionId?: string;
    serverSignature: string;
  }): Promise<UnsignedTx> {
    return {
      chainId: this.id,
      description: `withdraw ${args.amount} ${args.token.symbol} ← Anchor vault ${this.vaultProgramId}`,
      payload: {
        rpcUrl: this.rpcUrl,
        programId: this.vaultProgramId,
        instruction: "withdraw",
        accounts: { user: args.user, mint: args.token.address },
        data: {
          amount: args.amount.toString(),
          sessionId: args.sessionId,
          operatorSig: args.serverSignature,
        },
      },
    };
  }

  async pollWithdraw(_txHash: string): Promise<WithdrawReceipt | null> {
    throw notImplemented("SolanaAdapter.pollWithdraw");
  }
}

/* ---------------------------------------------------------------------------
 *  Registry — single source of truth for available chains in the UI
 * ------------------------------------------------------------------------- */

export const CHAIN_ADAPTERS: Record<string, ChainAdapter> = {
  "dev-mock": new DevMockAdapter(),
  // Live adapters get constructed on first use so we don't fire any RPC at
  // module-load time. Wire these up in Phase 2/3 with real config.
};

/** Construct an Ethereum adapter for a specific chain on demand. */
export function makeEthereumAdapter(chainId: EthereumAdapterConfig["chainId"]): EthereumAdapter {
  const presets: Record<EthereumAdapterConfig["chainId"], Omit<EthereumAdapterConfig, "chainId">> = {
    "ethereum-mainnet": {
      display: "Ethereum (mainnet)",
      vaultAddress: "0x0000000000000000000000000000000000000000",
      rpcUrl: "https://cloudflare-eth.com",
      supportedTokens: [ETH_NATIVE, USDC_ETHEREUM_MAINNET],
    },
    "ethereum-base": {
      display: "Base",
      vaultAddress: "0x0000000000000000000000000000000000000000",
      rpcUrl: "https://mainnet.base.org",
      supportedTokens: [ETH_NATIVE, USDC_BASE],
    },
    "ethereum-arbitrum": {
      display: "Arbitrum",
      vaultAddress: "0x0000000000000000000000000000000000000000",
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      supportedTokens: [ETH_NATIVE],
    },
    "ethereum-sepolia": {
      display: "Sepolia (testnet)",
      vaultAddress: "0x0000000000000000000000000000000000000000",
      rpcUrl: "https://rpc.sepolia.org",
      supportedTokens: [ETH_NATIVE],
    },
  };
  const preset = presets[chainId];
  return new EthereumAdapter({ chainId, ...preset });
}

/** Construct a Solana adapter on demand. */
export function makeSolanaAdapter(chainId: SolanaAdapterConfig["chainId"]): SolanaAdapter {
  const presets: Record<SolanaAdapterConfig["chainId"], Omit<SolanaAdapterConfig, "chainId">> = {
    "solana-mainnet": {
      display: "Solana (mainnet)",
      vaultProgramId: "11111111111111111111111111111111",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      supportedTokens: [SOL_NATIVE, USDC_SOLANA],
    },
    "solana-devnet": {
      display: "Solana (devnet)",
      vaultProgramId: "11111111111111111111111111111111",
      rpcUrl: "https://api.devnet.solana.com",
      supportedTokens: [SOL_NATIVE],
    },
  };
  const preset = presets[chainId];
  return new SolanaAdapter({ chainId, ...preset });
}

/* ---------------------------------------------------------------------------
 *  Helpers
 * ------------------------------------------------------------------------- */

function notImplemented(label: string): Error {
  return new Error(
    `${label} is not implemented yet — see docs/CASINO_ARCHITECTURE.md Phase 2/3 roadmap`,
  );
}
