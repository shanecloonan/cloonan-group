/**
 * Idempotent on-chain deposit → Supabase ledger credit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { makeRealEthereumAdapter } from "./ethereum-adapter";
import { ensureCasinoUserRow } from "./seed-store";
import type { ChainId, TokenSpec } from "./types";

type EvmChainKind =
  | "ethereum-mainnet"
  | "ethereum-base"
  | "ethereum-arbitrum"
  | "ethereum-sepolia";

const EVM_CHAINS = new Set<string>([
  "ethereum-mainnet",
  "ethereum-base",
  "ethereum-arbitrum",
  "ethereum-sepolia",
]);

export async function serverCreditDeposit(
  supabase: SupabaseClient,
  userId: string,
  input: {
    chainId: ChainId;
    token: TokenSpec;
    txHash: string;
    walletAddress: string;
    /** Required for dev-mock; optional hint for EVM (verified from receipt). */
    amountUnits?: bigint;
  },
): Promise<
  | { amount: bigint; alreadyCredited: boolean }
  | { error: string; status: number }
> {
  const txHash = input.txHash.trim().toLowerCase();
  if (!txHash) return { error: "txHash required", status: 400 };

  const { data: existing } = await supabase
    .from("casino_deposits")
    .select("credited, amount")
    .eq("tx_hash", txHash)
    .maybeSingle();

  if (existing?.credited) {
    return {
      amount: BigInt(existing.amount ?? "0"),
      alreadyCredited: true,
    };
  }

  let amount = input.amountUnits ?? 0n;

  if (input.chainId === "dev-mock") {
    if (!txHash.startsWith("0xdev") && !txHash.startsWith("0x")) {
      return { error: "invalid dev deposit tx", status: 400 };
    }
    if (amount <= 0n) return { error: "amountUnits required for dev deposit", status: 400 };
  } else if (EVM_CHAINS.has(input.chainId)) {
    const adapter = makeRealEthereumAdapter(input.chainId as EvmChainKind);
    if (!adapter) return { error: "chain not supported", status: 400 };

    const receipt = await adapter.pollDeposit(txHash);
    if (!receipt) return { error: "transaction not found yet", status: 404 };
    if (!receipt.finalized) return { error: "deposit not finalized", status: 409 };

    const want = input.walletAddress.toLowerCase();
    const got = receipt.user.toLowerCase();
    if (got !== want) {
      return { error: "deposit sender does not match wallet", status: 403 };
    }
    if (receipt.token.address.toLowerCase() !== input.token.address.toLowerCase()) {
      return { error: "token mismatch", status: 400 };
    }
    amount = receipt.amount;
    if (amount <= 0n) return { error: "zero deposit amount", status: 400 };
  } else {
    return { error: "unsupported chain", status: 400 };
  }

  await ensureCasinoUserRow(userId);

  await supabase.from("casino_deposits").upsert(
    {
      user_id: userId,
      chain_id: input.chainId,
      token_symbol: input.token.symbol,
      token_address: input.token.address,
      amount: amount.toString(),
      tx_hash: txHash,
      finalized: true,
      credited: false,
    },
    { onConflict: "tx_hash", ignoreDuplicates: false },
  );

  try {
    const { error: rpcErr } = await supabase.rpc("casino_apply_balance_mutation", {
      p_user_id: userId,
      p_chain_id: input.chainId,
      p_token_symbol: input.token.symbol,
      p_token_address: input.token.address,
      p_token_decimals: input.token.decimals,
      p_op: "credit",
      p_delta: amount.toString(),
      p_reason: "deposit",
      p_session_id: null,
      p_tx_hash: txHash,
    });
    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      if (!/duplicate|unique|already/i.test(msg)) {
        return { error: msg || "ledger credit failed", status: 500 };
      }
    }
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (!/duplicate|unique|already/i.test(msg)) {
      return { error: msg || "ledger credit failed", status: 500 };
    }
  }

  await supabase
    .from("casino_deposits")
    .update({ credited: true })
    .eq("tx_hash", txHash);

  return { amount, alreadyCredited: false };
}
