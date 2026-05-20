/**
 * Idempotent on-chain withdraw → burn locked casino balance.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ledgerApply } from "./ledger-rpc";
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

export async function serverDebitWithdraw(
  supabase: SupabaseClient,
  userId: string,
  input: {
    chainId: ChainId;
    token: TokenSpec;
    txHash: string;
    walletAddress: string;
    amountUnits?: bigint;
  },
): Promise<
  | { amount: bigint; alreadyDebited: boolean }
  | { error: string; status: number }
> {
  const txHash = input.txHash.trim().toLowerCase();
  if (!txHash) return { error: "txHash required", status: 400 };

  const { data: existing } = await supabase
    .from("casino_withdrawals")
    .select("debited, amount")
    .eq("tx_hash", txHash)
    .maybeSingle();

  if (existing?.debited) {
    return {
      amount: BigInt(existing.amount ?? "0"),
      alreadyDebited: true,
    };
  }

  let amount = input.amountUnits ?? 0n;

  if (input.chainId === "dev-mock") {
    if (amount <= 0n) return { error: "amountUnits required for dev withdraw", status: 400 };
  } else if (EVM_CHAINS.has(input.chainId)) {
    const adapter = makeRealEthereumAdapter(input.chainId as EvmChainKind);
    if (!adapter) return { error: "chain not supported", status: 400 };

    const receipt = await adapter.pollWithdraw(txHash);
    if (!receipt) return { error: "transaction not found yet", status: 404 };
    if (!receipt.finalized) return { error: "withdraw not finalized", status: 409 };

    const want = input.walletAddress.toLowerCase();
    const got = receipt.user.toLowerCase();
    if (got !== want) {
      return { error: "withdraw recipient does not match wallet", status: 403 };
    }
    if (receipt.token.address.toLowerCase() !== input.token.address.toLowerCase()) {
      return { error: "token mismatch", status: 400 };
    }
    amount = receipt.amount;
    if (amount <= 0n) return { error: "zero withdraw amount", status: 400 };
  } else {
    return { error: "unsupported chain", status: 400 };
  }

  await ensureCasinoUserRow(userId);

  const { data: bal } = await supabase
    .from("casino_balances")
    .select("locked")
    .eq("user_id", userId)
    .eq("chain_id", input.chainId)
    .eq("token_symbol", input.token.symbol)
    .eq("token_address", input.token.address)
    .maybeSingle();

  const locked = bal?.locked ? BigInt(bal.locked) : 0n;
  if (locked < amount) {
    return {
      error: `insufficient locked balance (have ${locked}, need ${amount}) — lock funds before withdrawing`,
      status: 409,
    };
  }

  await supabase.from("casino_withdrawals").upsert(
    {
      user_id: userId,
      chain_id: input.chainId,
      token_symbol: input.token.symbol,
      token_address: input.token.address,
      amount: amount.toString(),
      tx_hash: txHash,
      finalized: true,
      debited: false,
    },
    { onConflict: "tx_hash" },
  );

  const burned = await ledgerApply(supabase, {
    userId,
    chainId: input.chainId,
    token: input.token,
    op: "burn",
    delta: amount,
    reason: "withdraw",
    txHash,
  });

  if ("error" in burned) {
    return { error: burned.error, status: 500 };
  }

  await supabase
    .from("casino_withdrawals")
    .update({ debited: true })
    .eq("tx_hash", txHash);

  return { amount, alreadyDebited: false };
}
