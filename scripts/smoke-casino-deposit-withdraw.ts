/* ===========================================================================
 *  Smoke: dev-mock deposit-credit + withdraw-debit (in-memory Supabase mock)
 *  Run: npx tsx scripts/smoke-casino-deposit-withdraw.ts
 * ========================================================================= */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEV_TOKEN } from "../lib/casino";
import { serverCreditDeposit } from "../lib/casino/deposit-credit";
import { serverDebitWithdraw } from "../lib/casino/withdraw-debit";
import type { ChainId, TokenSpec } from "../lib/casino/types";

const USER = "11111111-1111-1111-1111-111111111111";
const CHAIN: ChainId = "dev-mock";
const TOKEN: TokenSpec = DEV_TOKEN;

type Bal = { available: bigint; locked: bigint; decimals: number };

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ FAIL: ${msg}`);
  process.exit(1);
}

function balKey(userId: string, chainId: string, token: TokenSpec) {
  return `${userId}|${chainId}|${token.symbol}|${token.address}`;
}

function makeMockSupabase(): SupabaseClient {
  const balances = new Map<string, Bal>();
  const deposits = new Map<string, { credited: boolean; amount: string }>();
  const withdrawals = new Map<string, { debited: boolean; amount: string }>();

  function getBal(userId: string, chainId: string, token: TokenSpec): Bal {
    const k = balKey(userId, chainId, token);
    let b = balances.get(k);
    if (!b) {
      b = { available: 0n, locked: 0n, decimals: token.decimals };
      balances.set(k, b);
    }
    return b;
  }

  const client = {
    from(table: string) {
      const chain = {
        filters: {} as Record<string, string>,
        select(_cols: string) {
          return chain;
        },
        eq(col: string, val: string) {
          chain.filters[col] = val;
          return chain;
        },
        async maybeSingle() {
          if (table === "casino_deposits") {
            const tx = chain.filters.tx_hash;
            const row = deposits.get(tx);
            return { data: row ?? null, error: null };
          }
          if (table === "casino_withdrawals") {
            const tx = chain.filters.tx_hash;
            const row = withdrawals.get(tx);
            return { data: row ?? null, error: null };
          }
          if (table === "casino_balances") {
            const uid = chain.filters.user_id;
            const cid = chain.filters.chain_id;
            const sym = chain.filters.token_symbol;
            const addr = chain.filters.token_address;
            const b = balances.get(`${uid}|${cid}|${sym}|${addr}`);
            return {
              data: b ? { locked: b.locked.toString() } : null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
        async upsert(row: Record<string, unknown>, _opts?: unknown) {
          if (table === "casino_deposits") {
            deposits.set(String(row.tx_hash), {
              credited: Boolean(row.credited),
              amount: String(row.amount),
            });
          }
          if (table === "casino_withdrawals") {
            withdrawals.set(String(row.tx_hash), {
              debited: Boolean(row.debited),
              amount: String(row.amount),
            });
          }
          return { error: null };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(_col: string, txHash: string) {
              if (table === "casino_deposits") {
                const d = deposits.get(txHash);
                if (d) deposits.set(txHash, { ...d, ...patch } as { credited: boolean; amount: string });
              }
              if (table === "casino_withdrawals") {
                const w = withdrawals.get(txHash);
                if (w) withdrawals.set(txHash, { ...w, ...patch } as { debited: boolean; amount: string });
              }
              return { error: null };
            },
          };
        },
      };
      return chain;
    },
    async rpc(
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: { message: string } | null }> {
      if (name !== "casino_apply_balance_mutation") {
        return { data: null, error: { message: "unknown rpc" } };
      }
      const userId = String(args.p_user_id);
      const chainId = String(args.p_chain_id);
      const token: TokenSpec = {
        symbol: String(args.p_token_symbol),
        address: String(args.p_token_address),
        decimals: Number(args.p_token_decimals),
        display: String(args.p_token_symbol),
        isNative: false,
      };
      const op = String(args.p_op);
      const delta = BigInt(String(args.p_delta));
      const b = getBal(userId, chainId, token);
      if (op === "credit") b.available += delta;
      else if (op === "lock") {
        if (b.available < delta) return { data: null, error: { message: "insufficient available" } };
        b.available -= delta;
        b.locked += delta;
      } else if (op === "unlock") {
        if (b.locked < delta) return { data: null, error: { message: "insufficient locked" } };
        b.locked -= delta;
        b.available += delta;
      } else if (op === "burn") {
        if (b.locked < delta) return { data: null, error: { message: "insufficient locked" } };
        b.locked -= delta;
      } else {
        return { data: null, error: { message: "unknown op" } };
      }
      return {
        data: { available: b.available.toString(), locked: b.locked.toString() },
        error: null,
      };
    },
  };

  return client as unknown as SupabaseClient;
}

(async () => {
  console.log("=== smoke-casino-deposit-withdraw ===\n");
  const supabase = makeMockSupabase();
  const wallet = "0xsmoke0000000000000000000000000000000001";

  const depTx = "0xdevdeposit00000000000000000000000001";
  const depAmt = 5_000n;

  const c1 = await serverCreditDeposit(supabase, USER, {
    chainId: CHAIN,
    token: TOKEN,
    txHash: depTx,
    walletAddress: wallet,
    amountUnits: depAmt,
  });
  if ("error" in c1) fail(`deposit: ${c1.error}`);
  if (c1.amount !== depAmt) fail(`deposit amount ${c1.amount}`);
  pass("deposit credits ledger");

  const c2 = await serverCreditDeposit(supabase, USER, {
    chainId: CHAIN,
    token: TOKEN,
    txHash: depTx,
    walletAddress: wallet,
    amountUnits: depAmt,
  });
  if ("error" in c2) fail(`deposit idempotent: ${c2.error}`);
  if (!c2.alreadyCredited) fail("second deposit should be alreadyCredited");
  pass("deposit idempotent by tx hash");

  const lock = await supabase.rpc("casino_apply_balance_mutation", {
    p_user_id: USER,
    p_chain_id: CHAIN,
    p_token_symbol: TOKEN.symbol,
    p_token_address: TOKEN.address,
    p_token_decimals: TOKEN.decimals,
    p_op: "lock",
    p_delta: "2000",
    p_reason: "withdraw",
    p_session_id: null,
    p_tx_hash: null,
  });
  if (lock.error) fail(`lock: ${lock.error.message}`);
  pass("locked 2000 for withdraw");

  const wTx = "0xdevwithdraw0000000000000000000001";
  const w1 = await serverDebitWithdraw(supabase, USER, {
    chainId: CHAIN,
    token: TOKEN,
    txHash: wTx,
    walletAddress: wallet,
    amountUnits: 2000n,
  });
  if ("error" in w1) fail(`withdraw: ${w1.error}`);
  if (w1.amount !== 2000n) fail(`withdraw amount ${w1.amount}`);
  pass("withdraw burns locked balance");

  const w2 = await serverDebitWithdraw(supabase, USER, {
    chainId: CHAIN,
    token: TOKEN,
    txHash: wTx,
    walletAddress: wallet,
    amountUnits: 2000n,
  });
  if ("error" in w2) fail(`withdraw idempotent: ${w2.error}`);
  if (!w2.alreadyDebited) fail("second withdraw should be alreadyDebited");
  pass("withdraw idempotent by tx hash");

  const over = await serverDebitWithdraw(supabase, USER, {
    chainId: CHAIN,
    token: TOKEN,
    txHash: "0xdevwithdraw0000000000000000000002",
    walletAddress: wallet,
    amountUnits: 9999n,
  });
  if (!("error" in over) || over.status !== 409) {
    fail("withdraw without lock should 409");
  }
  pass("withdraw rejects insufficient locked");

  console.log("\nAll deposit/withdraw smoke tests passed ✓");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
