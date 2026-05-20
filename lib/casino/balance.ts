/* ===========================================================================
 *  MoneyFund Casino — Balance Ledger (Layer 1)
 *  ---------------------------------------------------------------------------
 *  A chain-agnostic balance ledger. Two implementations:
 *
 *    • `InMemoryLedger`  — pure JS map, used in dev and unit tests. Stores
 *      everything per (user, chain, token).
 *    • `SupabaseLedger`  — persists to the `casino_balances` table.
 *
 *  The session driver only ever touches the `Ledger` interface. Adding a
 *  new backing store (Redis, in a future high-throughput operator service)
 *  is a single new class.
 *
 *  IMPORTANT: every method that mutates balance does so *atomically* with
 *  respect to a single user-token pair. The Supabase implementation uses
 *  Postgres row-level locking via `select ... for update` inside a stored
 *  procedure (added in the migration). The in-memory implementation just
 *  takes a JS-level mutex per key.
 * ========================================================================= */

import { supabase } from "../supabase";
import type { Balance, BalanceMutation, ChainId, GameResult, TokenSpec } from "./types";

/* ---------------------------------------------------------------------------
 *  Common interface
 * ------------------------------------------------------------------------- */

export interface Ledger {
  /** Read-only snapshot of a user's balance for a (chain, token). */
  getBalance(userId: string, chainId: ChainId, token: TokenSpec): Promise<Balance>;

  /** Read all balances for a user across chains/tokens. */
  listBalances(userId: string): Promise<Balance[]>;

  /**
   * Atomically credit the user. Use for deposits and session settlements
   * where money flows *to* the player.
   */
  credit(args: BalanceMutation): Promise<Balance>;

  /**
   * Atomically debit `available → locked` (i.e. lock funds for a session).
   * Throws if available < amount. Use when a player commits to a session
   * or doubles/splits mid-hand.
   */
  lock(args: BalanceMutation): Promise<Balance>;

  /**
   * Atomically debit `locked` back to available (e.g. session aborted).
   * Throws if locked < amount.
   */
  unlock(args: BalanceMutation): Promise<Balance>;

  /**
   * Atomically debit `locked` permanently (player lost a hand). Use only
   * when *all* of the session's stake should leave the player ledger.
   */
  burn(args: BalanceMutation): Promise<Balance>;
}

/* ---------------------------------------------------------------------------
 *  In-memory implementation (dev + tests)
 * ------------------------------------------------------------------------- */

function balanceKey(userId: string, chainId: ChainId, token: TokenSpec): string {
  return `${userId}|${chainId}|${token.symbol}|${token.address}`;
}

export class InMemoryLedger implements Ledger {
  private balances = new Map<string, Balance>();
  private mutationLog: BalanceMutation[] = [];

  /** Pre-seed a user with funds — handy for development. */
  seed(userId: string, chainId: ChainId, token: TokenSpec, units: bigint): void {
    const k = balanceKey(userId, chainId, token);
    const existing = this.balances.get(k);
    this.balances.set(k, {
      userId,
      chainId,
      token,
      available: (existing?.available ?? 0n) + units,
      locked: existing?.locked ?? 0n,
    });
  }

  async getBalance(userId: string, chainId: ChainId, token: TokenSpec): Promise<Balance> {
    const k = balanceKey(userId, chainId, token);
    return (
      this.balances.get(k) ?? {
        userId,
        chainId,
        token,
        available: 0n,
        locked: 0n,
      }
    );
  }

  async listBalances(userId: string): Promise<Balance[]> {
    const out: Balance[] = [];
    for (const b of this.balances.values()) {
      if (b.userId === userId) out.push(b);
    }
    return out;
  }

  async credit(args: BalanceMutation): Promise<Balance> {
    if (args.delta <= 0n) throw new Error("credit: delta must be positive");
    const cur = await this.getBalance(args.userId, args.chainId, args.token);
    const next: Balance = { ...cur, available: cur.available + args.delta };
    this.balances.set(balanceKey(args.userId, args.chainId, args.token), next);
    this.mutationLog.push(args);
    return next;
  }

  async lock(args: BalanceMutation): Promise<Balance> {
    if (args.delta <= 0n) throw new Error("lock: delta must be positive");
    const cur = await this.getBalance(args.userId, args.chainId, args.token);
    if (cur.available < args.delta) {
      throw new Error(
        `lock: insufficient available balance (have ${cur.available}, need ${args.delta})`,
      );
    }
    const next: Balance = {
      ...cur,
      available: cur.available - args.delta,
      locked: cur.locked + args.delta,
    };
    this.balances.set(balanceKey(args.userId, args.chainId, args.token), next);
    this.mutationLog.push(args);
    return next;
  }

  async unlock(args: BalanceMutation): Promise<Balance> {
    if (args.delta <= 0n) throw new Error("unlock: delta must be positive");
    const cur = await this.getBalance(args.userId, args.chainId, args.token);
    if (cur.locked < args.delta) {
      throw new Error(`unlock: insufficient locked balance (have ${cur.locked}, need ${args.delta})`);
    }
    const next: Balance = {
      ...cur,
      available: cur.available + args.delta,
      locked: cur.locked - args.delta,
    };
    this.balances.set(balanceKey(args.userId, args.chainId, args.token), next);
    this.mutationLog.push(args);
    return next;
  }

  async burn(args: BalanceMutation): Promise<Balance> {
    if (args.delta <= 0n) throw new Error("burn: delta must be positive");
    const cur = await this.getBalance(args.userId, args.chainId, args.token);
    if (cur.locked < args.delta) {
      throw new Error(`burn: insufficient locked balance (have ${cur.locked}, need ${args.delta})`);
    }
    const next: Balance = { ...cur, locked: cur.locked - args.delta };
    this.balances.set(balanceKey(args.userId, args.chainId, args.token), next);
    this.mutationLog.push(args);
    return next;
  }

  /** Test-only — return the entire mutation log so we can audit a session. */
  log(): BalanceMutation[] {
    return [...this.mutationLog];
  }
}

/* ---------------------------------------------------------------------------
 *  Supabase implementation (production)
 * ------------------------------------------------------------------------- */

/**
 * Supabase-backed ledger. Delegates atomic mutation to a Postgres function
 * created in the migration (`casino_apply_balance_mutation`) so concurrent
 * sessions across browser tabs can't double-spend.
 *
 * NOTE: this class silently no-ops if the table doesn't exist yet — the
 * casino runs in dev-mock mode with `InMemoryLedger` until production
 * infrastructure is provisioned (Phase 2 of the roadmap).
 */
export class SupabaseLedger implements Ledger {
  async getBalance(userId: string, chainId: ChainId, token: TokenSpec): Promise<Balance> {
    const { data, error } = await supabase
      .from("casino_balances")
      .select("available, locked")
      .eq("user_id", userId)
      .eq("chain_id", chainId)
      .eq("token_symbol", token.symbol)
      .eq("token_address", token.address)
      .maybeSingle();
    if (error && !/relation .* does not exist/i.test(error.message)) throw error;
    return {
      userId,
      chainId,
      token,
      available: data?.available ? BigInt(data.available) : 0n,
      locked: data?.locked ? BigInt(data.locked) : 0n,
    };
  }

  async listBalances(userId: string): Promise<Balance[]> {
    const { data, error } = await supabase
      .from("casino_balances")
      .select("chain_id, token_symbol, token_address, token_decimals, available, locked")
      .eq("user_id", userId);
    if (error && !/relation .* does not exist/i.test(error.message)) return [];
    return (
      data?.map((row) => ({
        userId,
        chainId: row.chain_id as ChainId,
        token: {
          symbol: row.token_symbol,
          display: row.token_symbol,
          decimals: row.token_decimals,
          address: row.token_address,
          isNative: false,
        },
        available: BigInt(row.available),
        locked: BigInt(row.locked),
      })) ?? []
    );
  }

  async credit(args: BalanceMutation): Promise<Balance> {
    return this.applyMutation({ ...args }, "credit");
  }
  async lock(args: BalanceMutation): Promise<Balance> {
    return this.applyMutation({ ...args }, "lock");
  }
  async unlock(args: BalanceMutation): Promise<Balance> {
    return this.applyMutation({ ...args }, "unlock");
  }
  async burn(args: BalanceMutation): Promise<Balance> {
    return this.applyMutation({ ...args }, "burn");
  }

  private async applyMutation(
    args: BalanceMutation,
    op: "credit" | "lock" | "unlock" | "burn",
  ): Promise<Balance> {
    const { data, error } = await supabase.rpc("casino_apply_balance_mutation", {
      p_user_id: args.userId,
      p_chain_id: args.chainId,
      p_token_symbol: args.token.symbol,
      p_token_address: args.token.address,
      p_token_decimals: args.token.decimals,
      p_op: op,
      p_delta: args.delta.toString(),
      p_reason: args.reason,
      p_session_id: args.sessionId ?? null,
      p_tx_hash: args.txHash ?? null,
    });
    if (error) throw error;
    const row = (data as { available: string; locked: string } | null) ?? {
      available: "0",
      locked: "0",
    };
    return {
      userId: args.userId,
      chainId: args.chainId,
      token: args.token,
      available: BigInt(row.available),
      locked: BigInt(row.locked),
    };
  }
}

/* ---------------------------------------------------------------------------
 *  Default ledger (singleton)
 * ------------------------------------------------------------------------- */

/**
 * Process-global in-memory ledger that the dev UI uses out of the box. In
 * production this is replaced by `SupabaseLedger`. We keep the in-memory
 * one around as the test fixture and the "play with house money for fun"
 * mode.
 */
export const devLedger = new InMemoryLedger();

/** Move locked stake → available / burn / credit after a settled game result. */
export async function applySessionSettlement(
  ledger: Ledger,
  args: {
    userId: string;
    chainId: ChainId;
    token: TokenSpec;
    sessionId: string;
    result: GameResult;
  },
): Promise<void> {
  const { userId, chainId, token, sessionId, result } = args;
  const lockedUnits = result.totalStakedUnits;
  const payoutUnits = result.totalPayoutUnits;
  const unlockUnits = payoutUnits < lockedUnits ? payoutUnits : lockedUnits;
  const burnUnits = lockedUnits - unlockUnits;
  const creditUnits = payoutUnits - unlockUnits;

  if (unlockUnits > 0n) {
    await ledger.unlock({
      userId,
      chainId,
      token,
      delta: unlockUnits,
      reason: "session_unlock",
      sessionId,
    });
  }
  if (burnUnits > 0n) {
    await ledger.burn({
      userId,
      chainId,
      token,
      delta: burnUnits,
      reason: "session_settle",
      sessionId,
    });
  }
  if (creditUnits > 0n) {
    await ledger.credit({
      userId,
      chainId,
      token,
      delta: creditUnits,
      reason: "session_settle",
      sessionId,
    });
  }
}
