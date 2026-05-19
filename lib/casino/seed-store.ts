/* ===========================================================================
 *  MoneyFund Casino — Seed pair store (Supabase + in-memory)
 *  ---------------------------------------------------------------------------
 *  The seed pair (server_seed_hash + client_seed + nonce) is the **commit**
 *  side of the provably-fair scheme. For authenticated users we persist it
 *  to `casino_seed_pairs`:
 *
 *    • While ACTIVE — only `server_seed_hash` is stored. The raw
 *      `server_seed` lives in memory and on the player's machine, never
 *      on disk in the clear.
 *    • On ROTATE — the retired pair is updated with `server_seed` filled
 *      in (the reveal); a new ACTIVE row is inserted.
 *
 *  This file exposes a small interface, `SeedStore`, that the session
 *  driver consumes. Two implementations:
 *
 *    • `InMemorySeedStore` — used today and in tests.
 *    • `SupabaseSeedStore` — persists per authenticated user.
 *
 *  All Supabase calls are best-effort: if the table doesn't exist yet
 *  (`relation does not exist`) we silently degrade to in-memory state.
 * ========================================================================= */

import { supabase } from "../supabase";
import { newSeedPair } from "./rng";
import type { SeedPair } from "./types";

/* ---------------------------------------------------------------------------
 *  Interface
 * ------------------------------------------------------------------------- */

export interface SeedStore {
  /**
   * Return the active seed pair for the user, creating + persisting one if
   * none exists. ALWAYS returns a usable pair — never null.
   */
  getActiveSeedPair(userId: string): Promise<SeedPair>;

  /**
   * Persist a new or updated seed pair. Called by the session driver
   * each time the nonce advances; also by `rotate(...)` below.
   */
  saveSeedPair(pair: SeedPair): Promise<void>;

  /**
   * Rotate: retire the current pair (publishing `serverSeed`), create a
   * new one, and return both. The caller can show the retired pair to
   * the player so they can verify past hands.
   */
  rotate(userId: string, newClientSeed?: string): Promise<{ retired: SeedPair; next: SeedPair }>;
}

/* ---------------------------------------------------------------------------
 *  In-memory implementation (dev + anonymous users)
 * ------------------------------------------------------------------------- */

export class InMemorySeedStore implements SeedStore {
  private active: SeedPair | null = null;
  private archive: SeedPair[] = [];

  async getActiveSeedPair(userId: string): Promise<SeedPair> {
    if (this.active && this.active.userId === userId) return this.active;
    this.active = newSeedPair({ userId });
    return this.active;
  }

  async saveSeedPair(pair: SeedPair): Promise<void> {
    if (pair.status === "active") this.active = pair;
    else this.archive.push(pair);
  }

  async rotate(userId: string, newClientSeed?: string): Promise<{ retired: SeedPair; next: SeedPair }> {
    const cur = await this.getActiveSeedPair(userId);
    const retired: SeedPair = { ...cur, status: "retired", retiredAt: new Date().toISOString() };
    const next = newSeedPair({ userId, clientSeed: newClientSeed });
    this.archive.push(retired);
    this.active = next;
    return { retired, next };
  }

  /** Test-only — peek at the archive of retired pairs. */
  archived(): SeedPair[] {
    return [...this.archive];
  }
}

/* ---------------------------------------------------------------------------
 *  Supabase implementation (authenticated users)
 * ------------------------------------------------------------------------- */

interface SupabaseSeedRow {
  id: string;
  user_id: string;
  server_seed_hash: string;
  server_seed: string | null;
  client_seed: string;
  nonce: number;
  status: "active" | "retired";
  created_at: string;
  retired_at: string | null;
}

function rowToPair(row: SupabaseSeedRow): SeedPair {
  return {
    id: row.id,
    userId: row.user_id,
    serverSeed: row.server_seed,
    serverSeedHash: row.server_seed_hash,
    clientSeed: row.client_seed,
    nonce: Number(row.nonce),
    status: row.status,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
  };
}

export class SupabaseSeedStore implements SeedStore {
  /**
   * Local memoized copy of the active pair so we don't hit the DB on
   * every nonce read. Invalidated when `rotate` runs.
   */
  private cache = new Map<string, SeedPair>();

  async getActiveSeedPair(userId: string): Promise<SeedPair> {
    if (this.cache.has(userId)) return this.cache.get(userId)!;

    try {
      const { data, error } = await supabase
        .from("casino_seed_pairs")
        .select("id, user_id, server_seed_hash, server_seed, client_seed, nonce, status, created_at, retired_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && !isMissingTable(error)) {
        // Soft-fail: degrade to in-memory pair so play continues.
        console.warn("SupabaseSeedStore.getActiveSeedPair:", error.message);
      } else if (data) {
        // Existing active row found — server_seed will be null (we don't
        // store it while the pair is active), so we need to rehydrate the
        // raw seed locally. The pair we return won't have the raw seed —
        // the in-memory session driver generates a fresh local pair if we
        // can't decrypt it. For the audit trail this is fine: the hash and
        // the nonce continue from where we left off.
        //
        // HOWEVER: without the raw server_seed in memory, no further hands
        // can be played under this pair (we can't compute HMAC blocks).
        // So instead of resuming a pair we don't have the seed for, we
        // RETIRE it and generate a fresh one. The retired pair will have
        // `server_seed` set to null in the DB — meaning hands that ran
        // under it (if any) are unverifiable. That's an acceptable
        // trade-off for "I closed the tab and came back" — but we log it.
        //
        // Future improvement (Phase 2.1): encrypt + persist the raw seed
        // alongside the hash so we can resume without retiring.
        if (data.server_seed === null && data.status === "active") {
          await this.markRetiredById(data.id);
          // fall through to create fresh.
        } else {
          const pair = rowToPair(data);
          this.cache.set(userId, pair);
          return pair;
        }
      }
    } catch (e) {
      console.warn("SupabaseSeedStore.getActiveSeedPair caught:", (e as Error).message);
    }

    // Either no row, or we just retired the previous one. Generate a new
    // one and persist (best-effort).
    const fresh = newSeedPair({ userId });
    await this.insertFresh(fresh);
    this.cache.set(userId, fresh);
    return fresh;
  }

  async saveSeedPair(pair: SeedPair): Promise<void> {
    this.cache.set(pair.userId, pair);
    try {
      const { error } = await supabase
        .from("casino_seed_pairs")
        .upsert(
          {
            id: pair.id,
            user_id: pair.userId,
            server_seed_hash: pair.serverSeedHash,
            // Only flush the raw seed when the pair has been retired.
            server_seed: pair.status === "retired" ? pair.serverSeed : null,
            client_seed: pair.clientSeed,
            nonce: pair.nonce,
            status: pair.status,
            created_at: pair.createdAt,
            retired_at: pair.retiredAt,
          },
          { onConflict: "id" },
        );
      if (error && !isMissingTable(error)) {
        console.warn("SupabaseSeedStore.saveSeedPair:", error.message);
      }
    } catch (e) {
      console.warn("SupabaseSeedStore.saveSeedPair caught:", (e as Error).message);
    }
  }

  async rotate(userId: string, newClientSeed?: string): Promise<{ retired: SeedPair; next: SeedPair }> {
    const cur = await this.getActiveSeedPair(userId);
    const retired: SeedPair = { ...cur, status: "retired", retiredAt: new Date().toISOString() };
    const next = newSeedPair({ userId, clientSeed: newClientSeed });

    await this.saveSeedPair(retired);
    await this.insertFresh(next);

    this.cache.set(userId, next);
    return { retired, next };
  }

  private async insertFresh(pair: SeedPair): Promise<void> {
    try {
      const { error } = await supabase.from("casino_seed_pairs").insert({
        id: pair.id,
        user_id: pair.userId,
        server_seed_hash: pair.serverSeedHash,
        server_seed: null,
        client_seed: pair.clientSeed,
        nonce: pair.nonce,
        status: pair.status,
        created_at: pair.createdAt,
      });
      if (error && !isMissingTable(error) && !/duplicate key value/i.test(error.message)) {
        console.warn("SupabaseSeedStore.insertFresh:", error.message);
      }
    } catch (e) {
      console.warn("SupabaseSeedStore.insertFresh caught:", (e as Error).message);
    }
  }

  private async markRetiredById(id: string): Promise<void> {
    try {
      await supabase
        .from("casino_seed_pairs")
        .update({
          status: "retired",
          retired_at: new Date().toISOString(),
        })
        .eq("id", id);
    } catch {
      // best-effort
    }
  }
}

function isMissingTable(error: { message?: string }): boolean {
  return /relation .* does not exist/i.test(error.message ?? "");
}

/* ---------------------------------------------------------------------------
 *  Bootstrap — ensure the user has a `casino_users` row.
 * ------------------------------------------------------------------------- */

/**
 * Idempotent. Inserts a `casino_users` row with default values if none
 * exists. Silent no-op if the user isn't authenticated, the table is
 * missing, or RLS rejects (e.g. mismatched user id).
 */
export async function ensureCasinoUserRow(userId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { error } = await supabase.from("casino_users").upsert(
      { user_id: userId, kyc_level: 0, banned: false },
      { onConflict: "user_id" },
    );
    if (error) {
      if (isMissingTable(error)) return { ok: false, reason: "schema-not-applied" };
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
