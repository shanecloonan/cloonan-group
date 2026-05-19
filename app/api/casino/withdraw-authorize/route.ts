/**
 * Server-side EIP-712 voucher signing endpoint.
 *
 * POST /api/casino/withdraw-authorize
 *   {
 *     "chainId": "ethereum-base",
 *     "user":    "0x…",
 *     "token":   "0x…",        // ERC-20 contract (or zero address for native)
 *     "amount":  "1000000",    // stringified bigint in token base units
 *     "sessionId": "uuid…",    // optional — becomes the bytes32 sessionRef
 *     "expiresAt": 1234567890  // optional — defaults to now + 10 min
 *   }
 * → { signature: "0x…", operator: "0x…", voucher: { … }, domain: { … } }
 *
 * The signer key is read from the env var `CASINO_OPERATOR_KEY`. When the
 * key is unset (i.e. local dev), we sign with the well-known
 * `DEV_OPERATOR_KEY` so the UI flow is fully exercisable end-to-end — but
 * any contract that accepts this dev address as `operator` is by
 * definition not in production.
 *
 * This route never touches the user's wallet. The browser submits the
 * returned `voucher + signature` to the deployed `CasinoVault.withdraw`
 * via the user's signer, which is the actual sender of funds.
 */

import { NextResponse } from "next/server";
import {
  DEV_OPERATOR_KEY,
  DEV_OPERATOR_ADDRESS,
  getOperatorKeyFromEnv,
  signWithdrawalVoucher,
  type SigningDomain,
  type WithdrawalVoucher,
} from "@/lib/casino/operator";
import { ethers } from "ethers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_TO_EVM_ID: Record<string, number> = {
  "ethereum-mainnet": 1,
  "ethereum-base": 8453,
  "ethereum-arbitrum": 42161,
  "ethereum-sepolia": 11155111,
};

function vaultAddressFor(chainId: string): string | null {
  const map: Record<string, string | undefined> = {
    "ethereum-mainnet": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_MAINNET,
    "ethereum-base": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_BASE,
    "ethereum-arbitrum": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_ARBITRUM,
    "ethereum-sepolia": process.env.NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_SEPOLIA,
  };
  const v = map[chainId];
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
}

interface AuthorizeRequest {
  chainId?: string;
  user?: string;
  token?: string;
  amount?: string;
  /** Used to derive the bytes32 sessionRef in the voucher. */
  sessionId?: string;
  /** Unix seconds. */
  expiresAt?: number;
  /** Optional explicit nonce override; otherwise the API leaves nonce=0 and
   *  the caller is expected to populate it client-side from the contract. */
  nonce?: string;
}

export async function POST(req: Request) {
  let body: AuthorizeRequest;
  try {
    body = (await req.json()) as AuthorizeRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const chainId = body.chainId;
  if (!chainId || !(chainId in CHAIN_TO_EVM_ID)) {
    return NextResponse.json(
      { error: `unsupported chainId: ${chainId}` },
      { status: 400 },
    );
  }
  if (!body.user || !/^0x[0-9a-fA-F]{40}$/.test(body.user)) {
    return NextResponse.json({ error: "invalid user address" }, { status: 400 });
  }
  if (!body.token || !/^0x[0-9a-fA-F]{40}$/.test(body.token)) {
    return NextResponse.json({ error: "invalid token address" }, { status: 400 });
  }
  if (!body.amount || !/^\d+$/.test(body.amount)) {
    return NextResponse.json({ error: "amount must be a stringified integer" }, { status: 400 });
  }

  const verifyingContract = vaultAddressFor(chainId);
  if (!verifyingContract) {
    return NextResponse.json(
      {
        error: `no vault address configured for ${chainId}. ` +
          `Set NEXT_PUBLIC_CASINO_VAULT_${chainId.toUpperCase().replaceAll("-", "_")}`,
      },
      { status: 412 },
    );
  }

  // Resolve the bytes32 sessionRef.
  const sessionRef = body.sessionId
    ? ethers.utils.sha256(ethers.utils.toUtf8Bytes(body.sessionId))
    : "0x" + "0".repeat(64);

  const expiresAt = Number(body.expiresAt) || Math.floor(Date.now() / 1000) + 600;
  const nonce = body.nonce ?? "0";

  const domain: SigningDomain = {
    chainId: CHAIN_TO_EVM_ID[chainId],
    verifyingContract,
  };

  const voucher: WithdrawalVoucher = {
    user: body.user,
    token: body.token,
    amount: BigInt(body.amount),
    nonce: BigInt(nonce),
    sessionRef,
    expiresAt,
  };

  // ────────────────────────────────────────────────────────────────────
  //  Sign with the env operator key when set; otherwise dev fallback.
  // ────────────────────────────────────────────────────────────────────
  //
  //  PRODUCTION DEPLOYMENT NOTE
  //  Set the env var `CASINO_OPERATOR_KEY=0x<64-hex>` server-side. It must
  //  match the `operator` configured on the deployed `CasinoVault.sol`
  //  (call `rotateOperator(newAddress)` post-deploy to set it).
  //
  //  Never set NEXT_PUBLIC_ for this variable — that would expose the
  //  private key to the browser bundle.
  // ────────────────────────────────────────────────────────────────────

  let operatorKey: string;
  let isDevFallback = false;
  try {
    const envKey = getOperatorKeyFromEnv();
    if (envKey) {
      operatorKey = envKey;
    } else {
      operatorKey = DEV_OPERATOR_KEY;
      isDevFallback = true;
    }
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }

  const { signature, operatorAddress } = await signWithdrawalVoucher({
    operatorKey,
    domain,
    voucher,
  });

  return NextResponse.json({
    signature,
    operator: operatorAddress,
    isDevFallback,
    devOperatorAddress: DEV_OPERATOR_ADDRESS,
    domain,
    voucher: {
      user: voucher.user,
      token: voucher.token,
      amount: voucher.amount.toString(),
      nonce: voucher.nonce.toString(),
      sessionRef: voucher.sessionRef,
      expiresAt: voucher.expiresAt,
    },
  });
}

/**
 * GET — handy diagnostic endpoint that returns whether the operator key is
 * configured (without revealing it) and the operator address the contract
 * should be configured against. Useful when wiring up a deployment.
 */
export async function GET() {
  let configured = false;
  let operator: string | null = null;
  let isDevFallback = false;
  try {
    const k = getOperatorKeyFromEnv();
    if (k) {
      configured = true;
      operator = new ethers.Wallet(k).address;
    } else {
      configured = false;
      isDevFallback = true;
      operator = DEV_OPERATOR_ADDRESS;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    configured,
    isDevFallback,
    operator,
    devOperatorAddress: DEV_OPERATOR_ADDRESS,
    supportedChains: Object.keys(CHAIN_TO_EVM_ID),
    note: configured
      ? "Production operator key is set."
      : "No CASINO_OPERATOR_KEY in env — falling back to dev key. Do not use in production.",
  });
}
