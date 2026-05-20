/**
 * Server-side lock / unlock before on-chain withdraw (JWT-authenticated RPC).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ledgerApply } from "./ledger-rpc";
import { ensureCasinoUserRow } from "./seed-store";
import type { ChainId, TokenSpec } from "./types";

export async function serverLockWithdrawBalance(
  supabase: SupabaseClient,
  userId: string,
  input: { chainId: ChainId; token: TokenSpec; amountUnits: bigint },
): Promise<{ locked: string } | { error: string; status: number }> {
  if (input.amountUnits <= 0n) {
    return { error: "amountUnits must be positive", status: 400 };
  }
  await ensureCasinoUserRow(userId);
  const result = await ledgerApply(supabase, {
    userId,
    chainId: input.chainId,
    token: input.token,
    op: "lock",
    delta: input.amountUnits,
    reason: "withdraw",
  });
  if ("error" in result) {
    const status = /insufficient/i.test(result.error) ? 409 : 500;
    return { error: result.error, status };
  }
  return { locked: input.amountUnits.toString() };
}

export async function serverUnlockWithdrawBalance(
  supabase: SupabaseClient,
  userId: string,
  input: { chainId: ChainId; token: TokenSpec; amountUnits: bigint },
): Promise<{ unlocked: string } | { error: string; status: number }> {
  if (input.amountUnits <= 0n) {
    return { error: "amountUnits must be positive", status: 400 };
  }
  const result = await ledgerApply(supabase, {
    userId,
    chainId: input.chainId,
    token: input.token,
    op: "unlock",
    delta: input.amountUnits,
    reason: "manual_adjustment",
  });
  if ("error" in result) {
    const status = /insufficient/i.test(result.error) ? 409 : 500;
    return { error: result.error, status };
  }
  return { unlocked: input.amountUnits.toString() };
}
