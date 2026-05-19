/* ===========================================================================
 *  MoneyFund Casino — Supabase persistence (best-effort, fail-silent)
 *  ---------------------------------------------------------------------------
 *  Writes settled sessions + their action logs to Supabase. Called from the
 *  blackjack table after every settle. We treat this as **optional**:
 *
 *   • Anonymous users → no writes attempted, no error.
 *   • DB unavailable / table missing → log + swallow.
 *   • RLS rejects (because the dev userId isn't the auth user) → swallow.
 *
 *  The game never blocks on this code path.
 *
 *  Why: the Supabase table is the long-term audit substrate. But the engine
 *  must work in offline / unauthenticated / dev-mock scenarios identically,
 *  so we can't make persistence required.
 * ========================================================================= */

import { supabase } from "../supabase";
import type { BlackjackAction, BlackjackState } from "./blackjack";
import type { SeedPair, Session } from "./types";

/* ---------------------------------------------------------------------------
 *  Public surface
 * ------------------------------------------------------------------------- */

/**
 * Persist a *settled* blackjack session and its full audit log. Best-effort.
 *
 * Returns:
 *   • `{ persisted: true }` if everything was written.
 *   • `{ persisted: false, reason }` otherwise — never throws.
 */
export async function persistSettledSession(
  session: Session<BlackjackAction, BlackjackState>,
  seedPair: SeedPair,
): Promise<{ persisted: true } | { persisted: false; reason: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { persisted: false, reason: "anonymous" };

    // 1. Upsert the seed pair under the auth user id. We deliberately
    //    rewrite `user_id` so the row passes RLS (the dev placeholder
    //    userId would have been rejected). Server seed only flushed when
    //    the pair is retired — otherwise we publish only the hash.
    {
      const { error } = await supabase
        .from("casino_seed_pairs")
        .upsert(
          {
            id: seedPair.id,
            user_id: user.id,
            server_seed_hash: seedPair.serverSeedHash,
            server_seed: seedPair.status === "retired" ? seedPair.serverSeed : null,
            client_seed: seedPair.clientSeed,
            nonce: seedPair.nonce,
            status: seedPair.status,
            created_at: seedPair.createdAt,
            retired_at: seedPair.retiredAt,
          },
          { onConflict: "id" },
        );
      if (error) {
        if (/relation .* does not exist/i.test(error.message)) {
          return { persisted: false, reason: "schema-not-applied" };
        }
        return { persisted: false, reason: `seed: ${error.message}` };
      }
    }

    // 2. Insert the session row. State + result both JSONB (we coerce
    //    bigints to strings on the way in so JSON.stringify is happy).
    {
      const stateJson = jsonReplace(session.state);
      const resultJson = jsonReplace(session.result);
      const { error } = await supabase.from("casino_sessions").insert({
        id: session.id,
        user_id: user.id,
        game_id: session.gameId,
        chain_id: session.chainId,
        token_symbol: session.token.symbol,
        token_address: session.token.address,
        stake: session.stake.toString(),
        seed_pair_id: seedPair.id,
        server_seed_hash: session.serverSeedHash,
        client_seed: session.clientSeed,
        start_nonce: session.startNonce,
        end_nonce: session.endNonce,
        status: session.status,
        state: stateJson,
        result: resultJson,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      });
      if (error) {
        if (/relation .* does not exist/i.test(error.message)) {
          return { persisted: false, reason: "schema-not-applied" };
        }
        if (/duplicate key value/i.test(error.message)) {
          // Session already persisted — that's fine.
          return { persisted: true };
        }
        return { persisted: false, reason: `session: ${error.message}` };
      }
    }

    // 3. Bulk-insert the actions.
    {
      const rows = session.actions.map((a) => ({
        session_id: session.id,
        ordinal: a.ordinal,
        actor: a.actor,
        action: jsonReplace(a.action),
        nonce_after: a.nonceAfter,
        state_hash: a.stateHash ?? null,
        created_at: a.at,
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from("casino_actions").insert(rows);
        if (error && !/duplicate key value/i.test(error.message)) {
          return { persisted: false, reason: `actions: ${error.message}` };
        }
      }
    }

    return { persisted: true };
  } catch (err) {
    return { persisted: false, reason: (err as Error).message };
  }
}

/* ---------------------------------------------------------------------------
 *  Helpers
 * ------------------------------------------------------------------------- */

/**
 * Recursively coerce bigints → strings so JSONB inserts don't throw on
 * "Do not know how to serialize a BigInt".
 */
function jsonReplace<T>(v: T): unknown {
  return JSON.parse(
    JSON.stringify(v, (_k, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}
