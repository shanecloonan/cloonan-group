/* ===========================================================================
 *  MoneyFund Casino — Operator service (EIP-712 voucher signing)
 *  ---------------------------------------------------------------------------
 *  The "operator" is the trusted off-chain signer the contract accepts as
 *  the authority for withdrawals. It can never move funds directly — its
 *  only power is signing `Withdrawal` vouchers; the *user* submits those
 *  vouchers to the contract via their own wallet.
 *
 *  This file is the production-grade signing implementation. It is used in
 *  two places:
 *
 *    1. The Next.js API route `/api/casino/withdraw-authorize` calls
 *       `signWithdrawalVoucher` on the server using the env-var operator
 *       key. The browser never sees this key.
 *
 *    2. The smoke test (`scripts/smoke-casino-operator.ts`) calls the same
 *       function with a deterministic key and asserts the signature
 *       recovers correctly via `verifyWithdrawalVoucher`.
 *
 *  The signing scheme matches the EIP-712 typed data spec in
 *  `infra/contracts/ethereum/CasinoVault.sol`:
 *
 *     domain  = ("MoneyFundCasinoVault", "1", chainId, verifyingContract)
 *     type    = Withdrawal(address user, address token, uint256 amount,
 *                          uint256 nonce, bytes32 sessionRef,
 *                          uint256 expiresAt)
 *
 *  The contract recovers `ecrecover(digest, sig) === operator()`.
 * ========================================================================= */

import { ethers } from "ethers";

/* ---------------------------------------------------------------------------
 *  Types
 * ------------------------------------------------------------------------- */

export interface WithdrawalVoucher {
  user: string;
  token: string;
  amount: bigint;
  nonce: bigint;
  sessionRef: string; // bytes32 hex string
  expiresAt: number;  // unix-seconds
}

export interface SigningDomain {
  /** EVM chain id this voucher targets. */
  chainId: number;
  /** The CasinoVault contract address. */
  verifyingContract: string;
}

/** The EIP-712 type definition mirroring the CasinoVault `Withdrawal` struct. */
export const WITHDRAWAL_EIP712_TYPES: Record<string, { name: string; type: string }[]> = {
  Withdrawal: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "sessionRef", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
  ],
};

const DOMAIN_NAME = "MoneyFundCasinoVault";
const DOMAIN_VERSION = "1";

function buildDomain(d: SigningDomain) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: d.chainId,
    verifyingContract: d.verifyingContract,
  };
}

function toMessage(v: WithdrawalVoucher) {
  return {
    user: v.user,
    token: v.token,
    amount: ethers.BigNumber.from(v.amount.toString()),
    nonce: ethers.BigNumber.from(v.nonce.toString()),
    sessionRef: v.sessionRef,
    expiresAt: ethers.BigNumber.from(v.expiresAt),
  };
}

/* ---------------------------------------------------------------------------
 *  Signing & verification
 * ------------------------------------------------------------------------- */

/**
 * Sign a withdrawal voucher with the operator key. Returns the 0x-prefixed
 * hex signature suitable for `vault.withdraw(...operatorSig)`.
 *
 * `operatorKey` is a 32-byte hex private key (env var on the server). It
 * never crosses the network. Generate one with
 *
 *   require("ethers").Wallet.createRandom().privateKey
 */
export async function signWithdrawalVoucher(args: {
  operatorKey: string;
  domain: SigningDomain;
  voucher: WithdrawalVoucher;
}): Promise<{ signature: string; operatorAddress: string }> {
  const wallet = new ethers.Wallet(args.operatorKey);
  const domain = buildDomain(args.domain);
  const message = toMessage(args.voucher);

  // ethers v5 `_signTypedData` is the EIP-712 implementation. The `_`
  // prefix indicates "experimental" upstream — but it's stable since
  // 5.0.5 and matches what every wallet does today.
  const signature = await wallet._signTypedData(
    domain,
    WITHDRAWAL_EIP712_TYPES,
    message,
  );

  return { signature, operatorAddress: wallet.address };
}

/**
 * Locally verify a voucher signature. Useful for client-side preview
 * ("would this be accepted by the contract?") and for the smoke test.
 */
export function verifyWithdrawalVoucher(args: {
  domain: SigningDomain;
  voucher: WithdrawalVoucher;
  signature: string;
  expectedOperator: string;
}): { ok: boolean; recovered: string } {
  const recovered = ethers.utils.verifyTypedData(
    buildDomain(args.domain),
    WITHDRAWAL_EIP712_TYPES,
    toMessage(args.voucher),
    args.signature,
  );
  return {
    ok: recovered.toLowerCase() === args.expectedOperator.toLowerCase(),
    recovered,
  };
}

/* ---------------------------------------------------------------------------
 *  Server-side helpers (read env)
 * ------------------------------------------------------------------------- */

/**
 * Read the operator private key from env. Server-side only — this MUST
 * never be exposed to the browser, so we look at `CASINO_OPERATOR_KEY`
 * (no NEXT_PUBLIC_ prefix). Returns null when unset.
 */
export function getOperatorKeyFromEnv(): string | null {
  const k = process.env.CASINO_OPERATOR_KEY;
  if (!k) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error(
      "CASINO_OPERATOR_KEY must be a 0x-prefixed 64-hex-char private key",
    );
  }
  return k;
}

/**
 * Derive the operator's public address from the env key. Returns null when
 * key is unset.
 */
export function getOperatorAddressFromEnv(): string | null {
  const k = getOperatorKeyFromEnv();
  if (!k) return null;
  return new ethers.Wallet(k).address;
}

/* ---------------------------------------------------------------------------
 *  Dev-mode (no operator key) fallback
 * ------------------------------------------------------------------------- */

/**
 * Dev-only "operator" with a deterministic well-known key. Useful when the
 * developer hasn't set `CASINO_OPERATOR_KEY` yet — the API route falls
 * back to this so the UI can be exercised end-to-end against the dev mock
 * adapter without ever touching real funds.
 *
 * This key MUST NOT be used in production. Any contract deploy that
 * accepts it as `operator` is by definition not secure.
 */
export const DEV_OPERATOR_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export const DEV_OPERATOR_ADDRESS = new ethers.Wallet(DEV_OPERATOR_KEY).address;
