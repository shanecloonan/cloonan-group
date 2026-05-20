/**
 * Supabase balance mutations via authenticated client (user JWT or service).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BalanceMutation, ChainId, TokenSpec } from "./types";

export async function ledgerApply(
  supabase: SupabaseClient,
  args: {
    userId: string;
    chainId: ChainId;
    token: TokenSpec;
    op: "credit" | "lock" | "unlock" | "burn";
    delta: bigint;
    reason: BalanceMutation["reason"];
    sessionId?: string;
    txHash?: string;
  },
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase.rpc("casino_apply_balance_mutation", {
    p_user_id: args.userId,
    p_chain_id: args.chainId,
    p_token_symbol: args.token.symbol,
    p_token_address: args.token.address,
    p_token_decimals: args.token.decimals,
    p_op: args.op,
    p_delta: args.delta.toString(),
    p_reason: args.reason,
    p_session_id: args.sessionId ?? null,
    p_tx_hash: args.txHash ?? null,
  });

  if (error) {
    const msg = error.message ?? "ledger mutation failed";
    if (/duplicate|unique|already/i.test(msg)) return { ok: true };
    return { error: msg };
  }
  return { ok: true };
}
