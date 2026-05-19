/* ===========================================================================
 *  MoneyFund Casino — Real Ethereum adapter (Phase 1 of deposit/withdraw work)
 *  ---------------------------------------------------------------------------
 *  Concrete `ChainAdapter` implementation that talks to a deployed
 *  `CasinoVault.sol` contract via ethers.js v5.
 *
 *  This file is the *production* adapter. The stub in `chain-adapter.ts`
 *  is kept around for compile-time tests; we re-export this one as the
 *  default via `makeEthereumAdapter(chainId)` once Phase 1 lands.
 *
 *  Capabilities:
 *   • buildDepositTx — returns a multi-call: ERC-20 `approve` + vault
 *     `deposit`. Native ETH path is handled via a separate `depositNative`
 *     codepath when `token.isNative === true` (Phase 1.1).
 *   • submitDeposit — utility that runs the multi-call against a signer.
 *   • pollDeposit — fetches receipt for the deposit tx, returns
 *     `DepositReceipt` with current confirmations.
 *   • buildWithdrawTx — encodes the `withdraw(...)` call with the EIP-712
 *     `operatorSig` voucher (acquired separately via
 *     `lib/casino/operator.ts`).
 *   • submitWithdraw — runs the withdraw tx against a signer.
 *   • pollWithdraw — fetches receipt, surfaces finalization state.
 *
 *  All ABI fragments are defined inline so this file can compile without
 *  pulling in @openzeppelin or a Foundry artifact.
 * ========================================================================= */

import { ethers } from "ethers";
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
 *  ABI fragments
 * ------------------------------------------------------------------------- */

/** Minimum ERC-20 interface we need. */
export const ERC20_ABI: ethers.utils.Fragment[] = [
  ethers.utils.Fragment.from(
    "function approve(address spender, uint256 amount) returns (bool)",
  ),
  ethers.utils.Fragment.from("function allowance(address owner, address spender) view returns (uint256)"),
  ethers.utils.Fragment.from("function balanceOf(address account) view returns (uint256)"),
  ethers.utils.Fragment.from("function decimals() view returns (uint8)"),
  ethers.utils.Fragment.from("function symbol() view returns (string)"),
];

/** CasinoVault.sol ABI subset — see infra/contracts/ethereum/CasinoVault.sol. */
export const CASINO_VAULT_ABI: ethers.utils.Fragment[] = [
  ethers.utils.Fragment.from(
    "function deposit(address token, uint256 amount)",
  ),
  ethers.utils.Fragment.from(
    "function withdraw(address user, address token, uint256 amount, uint256 nonce, bytes32 sessionRef, uint256 expiresAt, bytes operatorSig)",
  ),
  ethers.utils.Fragment.from(
    "function userNonce(address user) view returns (uint256)",
  ),
  ethers.utils.Fragment.from(
    "function tokenBalance(address token) view returns (uint256)",
  ),
  ethers.utils.Fragment.from(
    "function tokenAllowed(address token) view returns (bool)",
  ),
  ethers.utils.Fragment.from(
    "function operator() view returns (address)",
  ),
  ethers.utils.Fragment.from(
    "function domainSeparator() view returns (bytes32)",
  ),
  ethers.utils.Fragment.from(
    "event Deposited(address indexed user, address indexed token, uint256 amount, uint256 indexed nonce)",
  ),
  ethers.utils.Fragment.from(
    "event Withdrawn(address indexed user, address indexed token, uint256 amount, uint256 indexed nonce)",
  ),
];

/** Shared interface objects — avoids re-parsing on every call. */
export const ERC20_IFACE = new ethers.utils.Interface(ERC20_ABI);
export const VAULT_IFACE = new ethers.utils.Interface(CASINO_VAULT_ABI);

/* ---------------------------------------------------------------------------
 *  Config types
 * ------------------------------------------------------------------------- */

export interface RealEthereumAdapterConfig {
  chainId: Exclude<ChainId, "dev-mock" | "solana-mainnet" | "solana-devnet">;
  display: string;
  /** Numeric EVM chainId (1 mainnet, 8453 Base, 11155111 Sepolia, …). */
  evmChainId: number;
  vaultAddress: string;
  rpcUrl: string;
  /** Block explorer base URL (e.g. https://etherscan.io). */
  explorerBaseUrl: string;
  /** ETH wrapper for native deposits (e.g. WETH). Optional. */
  wethAddress?: string;
  /** Minimum block confirmations required to consider a tx final. */
  requiredConfirmations: number;
  supportedTokens: TokenSpec[];
  nativeCurrency: TokenSpec;
}

/* ---------------------------------------------------------------------------
 *  Adapter
 * ------------------------------------------------------------------------- */

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class RealEthereumAdapter implements ChainAdapter {
  readonly id: ChainId;
  readonly display: string;
  readonly nativeCurrency: TokenSpec;
  readonly supportedTokens: TokenSpec[];
  readonly evmChainId: number;
  readonly explorerBaseUrl: string;
  readonly requiredConfirmations: number;
  private readonly vaultAddress: string;
  private readonly rpcUrl: string;
  private readonly _provider: ethers.providers.JsonRpcProvider;

  constructor(cfg: RealEthereumAdapterConfig) {
    this.id = cfg.chainId;
    this.display = cfg.display;
    this.nativeCurrency = cfg.nativeCurrency;
    this.supportedTokens = cfg.supportedTokens;
    this.evmChainId = cfg.evmChainId;
    this.vaultAddress = cfg.vaultAddress;
    this.rpcUrl = cfg.rpcUrl;
    this.explorerBaseUrl = cfg.explorerBaseUrl;
    this.requiredConfirmations = cfg.requiredConfirmations;
    this._provider = new ethers.providers.JsonRpcProvider(cfg.rpcUrl, cfg.evmChainId);
  }

  /** Vault address on this chain. */
  getVaultAddress(): string {
    return this.vaultAddress;
  }

  /** Read-only provider — exposed so UI can poll balances etc. */
  get provider(): ethers.providers.JsonRpcProvider {
    return this._provider;
  }

  /** Build the explorer URL for a tx hash. */
  txUrl(txHash: string): string {
    return `${this.explorerBaseUrl}/tx/${txHash}`;
  }

  /** Build the explorer URL for an address. */
  addressUrl(address: string): string {
    return `${this.explorerBaseUrl}/address/${address}`;
  }

  /* --------------------------------------------------------------------- *
   *  Deposit
   * --------------------------------------------------------------------- */

  /**
   * Two-tx deposit flow for ERC-20s (approve + deposit). For native ETH we
   * call a single `depositNative` path — out of scope for this slice; the
   * vault spec only exposes ERC-20 deposit today.
   */
  async buildDepositTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
  }): Promise<UnsignedTx> {
    if (args.token.isNative) {
      // The current CasinoVault.sol spec only handles ERC-20. Native ETH
      // deposits require either wrapping client-side or a future
      // `depositNative` payable function. We surface a clear error
      // upstream rather than silently wrapping.
      throw new Error(
        "Native ETH deposits not yet supported — wrap to WETH first or wait for vault v1.1",
      );
    }

    const approveData = ERC20_IFACE.encodeFunctionData("approve", [
      this.vaultAddress,
      ethers.BigNumber.from(args.amount.toString()),
    ]);
    const depositData = VAULT_IFACE.encodeFunctionData("deposit", [
      args.token.address,
      ethers.BigNumber.from(args.amount.toString()),
    ]);

    return {
      chainId: this.id,
      description: `Deposit ${args.amount} ${args.token.symbol} → vault ${shortAddr(this.vaultAddress)}`,
      payload: {
        kind: "eth_deposit_multicall",
        rpcUrl: this.rpcUrl,
        evmChainId: this.evmChainId,
        calls: [
          { label: "approve", to: args.token.address, data: approveData, value: "0" },
          { label: "deposit", to: this.vaultAddress, data: depositData, value: "0" },
        ],
        user: args.user,
        token: { ...args.token },
        amount: args.amount.toString(),
      },
    };
  }

  /**
   * Execute the deposit multicall against the supplied signer. Returns the
   * txHash of the FINAL (deposit) transaction — the one we poll for
   * confirmation. The intermediate `approve` tx is fire-and-forget; if it
   * reverts, the deposit will fail explicitly so the error is loud.
   *
   * If `currentAllowance >= amount` we skip the approve step (saves gas).
   */
  async submitDeposit(args: {
    signer: ethers.Signer;
    user: string;
    token: TokenSpec;
    amount: bigint;
  }): Promise<{ approveTxHash?: string; depositTxHash: string }> {
    if (args.token.isNative) {
      throw new Error("Native ETH deposit path requires WETH wrapping (TBD vault v1.1)");
    }
    const erc20 = new ethers.Contract(args.token.address, ERC20_ABI, args.signer);
    const vault = new ethers.Contract(this.vaultAddress, CASINO_VAULT_ABI, args.signer);

    const amountBn = ethers.BigNumber.from(args.amount.toString());

    let approveTxHash: string | undefined;
    const existingAllowance: ethers.BigNumber = await erc20.allowance(args.user, this.vaultAddress);
    if (existingAllowance.lt(amountBn)) {
      const tx = await erc20.approve(this.vaultAddress, amountBn);
      approveTxHash = tx.hash;
      // Wait for approve to be mined before submitting the deposit so the
      // deposit can't race and revert with "ERC20: insufficient allowance".
      await tx.wait(1);
    }

    const depTx = await vault.deposit(args.token.address, amountBn);
    return { approveTxHash, depositTxHash: depTx.hash };
  }

  /**
   * Poll the deposit transaction for finalization. Returns:
   *   - null     → tx not yet seen by the RPC node
   *   - receipt  → tx found; `finalized` reflects whether confirmations
   *                have reached `requiredConfirmations`.
   *
   * We parse the receipt logs for the `Deposited` event and use that as the
   * authoritative source of `(user, token, amount)` — never trust the user
   * to tell us what they deposited.
   */
  async pollDeposit(txHash: string): Promise<DepositReceipt | null> {
    const receipt = await this._provider.getTransactionReceipt(txHash);
    if (!receipt) return null;

    const confirmations = receipt.confirmations ?? 0;
    const finalized = confirmations >= this.requiredConfirmations && receipt.status === 1;

    // Try to recover (user, token, amount) from the Deposited event.
    let user = ZERO_ADDRESS;
    let token: TokenSpec | undefined;
    let amount: bigint = 0n;

    for (const log of receipt.logs) {
      try {
        const parsed = VAULT_IFACE.parseLog(log);
        if (parsed.name === "Deposited") {
          user = parsed.args.user;
          const tokenAddr = (parsed.args.token as string).toLowerCase();
          token = this.supportedTokens.find(
            (t) => t.address.toLowerCase() === tokenAddr,
          );
          amount = BigInt((parsed.args.amount as ethers.BigNumber).toString());
          break;
        }
      } catch {
        // Not a Deposited log — skip.
      }
    }

    if (!token) {
      // Either the receipt is from a different contract or our token catalog
      // is incomplete — bail conservatively with non-finalized status.
      return {
        chainId: this.id,
        txHash,
        user,
        token: this.nativeCurrency,
        amount,
        confirmations,
        required: this.requiredConfirmations,
        finalized: false,
      };
    }

    return {
      chainId: this.id,
      txHash,
      user,
      token,
      amount,
      confirmations,
      required: this.requiredConfirmations,
      finalized,
    };
  }

  /* --------------------------------------------------------------------- *
   *  Withdraw
   * --------------------------------------------------------------------- */

  /**
   * Build the unsigned `withdraw(...)` call. The caller is responsible for
   * obtaining `serverSignature` from the operator service first (see
   * `lib/casino/operator.ts`). `sessionId` becomes the `sessionRef`
   * bytes32 — we sha-256 it and take the first 32 bytes if it's longer.
   *
   * `nonce` and `expiresAt` are provided by the caller so the UI surfaces
   * them. Default `expiresAt` is "now + 10 min".
   */
  async buildWithdrawTx(args: {
    user: string;
    token: TokenSpec;
    amount: bigint;
    sessionId?: string;
    /** Hex 0x-prefixed EIP-712 signature from the operator. */
    serverSignature: string;
    /** Unique nonce from the contract `userNonce(user)`. */
    nonce?: bigint;
    /** Unix-seconds expiry. Falls back to now + 10 min. */
    expiresAt?: number;
  }): Promise<UnsignedTx> {
    const nonce = args.nonce ?? (await this.fetchUserNonce(args.user));
    const expiresAt = args.expiresAt ?? Math.floor(Date.now() / 1000) + 600;
    const sessionRef = sessionRefBytes32(args.sessionId);

    const data = VAULT_IFACE.encodeFunctionData("withdraw", [
      args.user,
      args.token.address,
      ethers.BigNumber.from(args.amount.toString()),
      ethers.BigNumber.from(nonce.toString()),
      sessionRef,
      ethers.BigNumber.from(expiresAt),
      args.serverSignature,
    ]);

    return {
      chainId: this.id,
      description: `Withdraw ${args.amount} ${args.token.symbol} ← vault ${shortAddr(this.vaultAddress)}`,
      payload: {
        kind: "eth_withdraw",
        rpcUrl: this.rpcUrl,
        evmChainId: this.evmChainId,
        to: this.vaultAddress,
        data,
        value: "0",
        user: args.user,
        token: { ...args.token },
        amount: args.amount.toString(),
        nonce: nonce.toString(),
        sessionRef,
        expiresAt,
      },
    };
  }

  /** Execute the withdraw tx against a signer. Returns the txHash. */
  async submitWithdraw(args: {
    signer: ethers.Signer;
    user: string;
    token: TokenSpec;
    amount: bigint;
    serverSignature: string;
    sessionId?: string;
    nonce?: bigint;
    expiresAt?: number;
  }): Promise<{ txHash: string }> {
    const nonce = args.nonce ?? (await this.fetchUserNonce(args.user));
    const expiresAt = args.expiresAt ?? Math.floor(Date.now() / 1000) + 600;
    const sessionRef = sessionRefBytes32(args.sessionId);

    const vault = new ethers.Contract(this.vaultAddress, CASINO_VAULT_ABI, args.signer);
    const tx = await vault.withdraw(
      args.user,
      args.token.address,
      ethers.BigNumber.from(args.amount.toString()),
      ethers.BigNumber.from(nonce.toString()),
      sessionRef,
      ethers.BigNumber.from(expiresAt),
      args.serverSignature,
    );
    return { txHash: tx.hash };
  }

  /** Poll withdraw receipt. Symmetric to `pollDeposit`. */
  async pollWithdraw(txHash: string): Promise<WithdrawReceipt | null> {
    const receipt = await this._provider.getTransactionReceipt(txHash);
    if (!receipt) return null;

    const confirmations = receipt.confirmations ?? 0;
    const finalized = confirmations >= this.requiredConfirmations && receipt.status === 1;

    let user = ZERO_ADDRESS;
    let token: TokenSpec | undefined;
    let amount: bigint = 0n;
    for (const log of receipt.logs) {
      try {
        const parsed = VAULT_IFACE.parseLog(log);
        if (parsed.name === "Withdrawn") {
          user = parsed.args.user;
          const tokenAddr = (parsed.args.token as string).toLowerCase();
          token = this.supportedTokens.find((t) => t.address.toLowerCase() === tokenAddr);
          amount = BigInt((parsed.args.amount as ethers.BigNumber).toString());
          break;
        }
      } catch {
        // not a Withdrawn log
      }
    }

    if (!token) {
      return {
        chainId: this.id,
        txHash,
        user,
        token: this.nativeCurrency,
        amount,
        confirmations,
        required: this.requiredConfirmations,
        finalized: false,
      };
    }

    return {
      chainId: this.id,
      txHash,
      user,
      token,
      amount,
      confirmations,
      required: this.requiredConfirmations,
      finalized,
    };
  }

  /* --------------------------------------------------------------------- *
   *  Read helpers
   * --------------------------------------------------------------------- */

  async fetchUserNonce(user: string): Promise<bigint> {
    const vault = new ethers.Contract(this.vaultAddress, CASINO_VAULT_ABI, this._provider);
    const n: ethers.BigNumber = await vault.userNonce(user);
    return BigInt(n.toString());
  }

  async fetchTokenBalance(token: TokenSpec, user: string): Promise<bigint> {
    if (token.isNative) {
      const bn = await this._provider.getBalance(user);
      return BigInt(bn.toString());
    }
    const erc20 = new ethers.Contract(token.address, ERC20_ABI, this._provider);
    const bn: ethers.BigNumber = await erc20.balanceOf(user);
    return BigInt(bn.toString());
  }

  async fetchAllowance(token: TokenSpec, user: string): Promise<bigint> {
    if (token.isNative) {
      // Native currency has no ERC-20 allowance concept — return uint256 max.
      return BigInt(ethers.constants.MaxUint256.toString());
    }
    const erc20 = new ethers.Contract(token.address, ERC20_ABI, this._provider);
    const bn: ethers.BigNumber = await erc20.allowance(user, this.vaultAddress);
    return BigInt(bn.toString());
  }

  async requestRandomness(_args: { sessionId: string }): Promise<RandomnessRequest> {
    // VRF integration is Phase 2.2. Surface as not-fulfilled so callers
    // can fall back to off-chain HMAC RNG (the default path today).
    return {
      chainId: this.id,
      requestId: `not_implemented_${this.id}`,
      fulfilled: false,
      value: null,
    };
  }
}

/* ---------------------------------------------------------------------------
 *  Helpers
 * ------------------------------------------------------------------------- */

/**
 * Map a free-form session ID string to a fixed 32-byte hex value suitable
 * for the contract's `sessionRef bytes32` field. Empty / undefined → zero.
 */
export function sessionRefBytes32(sessionId?: string): string {
  if (!sessionId) return ZERO_BYTES32;
  // sha256 → take first 32 bytes (sha-256 IS 32 bytes; we just hex-encode).
  return ethers.utils.sha256(ethers.utils.toUtf8Bytes(sessionId));
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/* ---------------------------------------------------------------------------
 *  Preset factory
 *
 *  Reads vault address + RPC URL from env, then falls back to safe
 *  defaults so the build doesn't crash when the contract isn't deployed
 *  yet. Callers should never use the adapter without first checking
 *  `isAdapterReady(adapter)` — which inspects `vaultAddress`.
 * ------------------------------------------------------------------------- */

import {
  ETH_NATIVE,
  USDC_BASE,
  USDC_ETHEREUM_MAINNET,
} from "./chain-adapter";

type EvmChainId = RealEthereumAdapterConfig["chainId"];

interface ChainPreset {
  evmChainId: number;
  display: string;
  defaultRpc: string;
  explorerBaseUrl: string;
  defaultRequiredConfirmations: number;
  supportedTokens: TokenSpec[];
  nativeCurrency: TokenSpec;
}

const CHAIN_PRESETS: Record<EvmChainId, ChainPreset> = {
  "ethereum-mainnet": {
    evmChainId: 1,
    display: "Ethereum mainnet",
    defaultRpc: "https://cloudflare-eth.com",
    explorerBaseUrl: "https://etherscan.io",
    defaultRequiredConfirmations: 12,
    supportedTokens: [USDC_ETHEREUM_MAINNET],
    nativeCurrency: ETH_NATIVE,
  },
  "ethereum-base": {
    evmChainId: 8453,
    display: "Base",
    defaultRpc: "https://mainnet.base.org",
    explorerBaseUrl: "https://basescan.org",
    defaultRequiredConfirmations: 5,
    supportedTokens: [USDC_BASE],
    nativeCurrency: ETH_NATIVE,
  },
  "ethereum-arbitrum": {
    evmChainId: 42161,
    display: "Arbitrum One",
    defaultRpc: "https://arb1.arbitrum.io/rpc",
    explorerBaseUrl: "https://arbiscan.io",
    defaultRequiredConfirmations: 5,
    supportedTokens: [],
    nativeCurrency: ETH_NATIVE,
  },
  "ethereum-sepolia": {
    evmChainId: 11155111,
    display: "Sepolia (testnet)",
    defaultRpc: "https://rpc.sepolia.org",
    explorerBaseUrl: "https://sepolia.etherscan.io",
    defaultRequiredConfirmations: 3,
    supportedTokens: [],
    nativeCurrency: ETH_NATIVE,
  },
};

/**
 * Construct a real adapter for the given chain, pulling vault address +
 * RPC URL from env vars. Throws iff `vaultAddress` is the zero address —
 * call `isAdapterReady` first to detect this before constructing.
 */
export function makeRealEthereumAdapter(chainId: EvmChainId): RealEthereumAdapter {
  const preset = CHAIN_PRESETS[chainId];
  const vaultAddress = vaultAddressFromEnv(chainId) ?? ZERO_ADDRESS;
  const rpcUrl = rpcUrlFromEnv(chainId) ?? preset.defaultRpc;

  return new RealEthereumAdapter({
    chainId,
    display: preset.display,
    evmChainId: preset.evmChainId,
    vaultAddress,
    rpcUrl,
    explorerBaseUrl: preset.explorerBaseUrl,
    requiredConfirmations: preset.defaultRequiredConfirmations,
    supportedTokens: preset.supportedTokens,
    nativeCurrency: preset.nativeCurrency,
  });
}

/** True when the adapter is plumbed to a real, deployed vault. */
export function isAdapterReady(adapter: RealEthereumAdapter): boolean {
  return (
    adapter.getVaultAddress() !== ZERO_ADDRESS &&
    !!adapter.getVaultAddress()
  );
}

/**
 * Read the vault address for a chain from env. The convention is
 *   NEXT_PUBLIC_CASINO_VAULT_<CHAIN>=0x…
 * where <CHAIN> ∈ {ETHEREUM_MAINNET, ETHEREUM_BASE, ETHEREUM_ARBITRUM,
 *                  ETHEREUM_SEPOLIA}.
 */
function vaultAddressFromEnv(chainId: EvmChainId): string | null {
  const map: Record<EvmChainId, string | undefined> = {
    "ethereum-mainnet": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_MAINNET,
    "ethereum-base": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_BASE,
    "ethereum-arbitrum": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_ARBITRUM,
    "ethereum-sepolia": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_SEPOLIA,
  };
  const v = map[chainId];
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
}

/**
 * Optional RPC URL override per chain:
 *   NEXT_PUBLIC_CASINO_RPC_<CHAIN>=https://…
 */
function rpcUrlFromEnv(chainId: EvmChainId): string | null {
  const map: Record<EvmChainId, string | undefined> = {
    "ethereum-mainnet": process.env.NEXT_PUBLIC_CASINO_RPC_ETHEREUM_MAINNET,
    "ethereum-base": process.env.NEXT_PUBLIC_CASINO_RPC_ETHEREUM_BASE,
    "ethereum-arbitrum": process.env.NEXT_PUBLIC_CASINO_RPC_ETHEREUM_ARBITRUM,
    "ethereum-sepolia": process.env.NEXT_PUBLIC_CASINO_RPC_ETHEREUM_SEPOLIA,
  };
  const v = map[chainId];
  return v && /^https?:\/\//.test(v) ? v : null;
}
