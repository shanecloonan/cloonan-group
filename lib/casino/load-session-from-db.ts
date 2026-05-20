/**
 * Reconstruct a settled Session from Supabase for verify / share links.
 * Requires RLS: caller must own the session row.
 */

import { supabase } from "../supabase";
import type { ChainId, GameResult, Session, SessionAction, TokenSpec } from "./types";

const BIGINT_FIELD = /Units$|^stake$|^amount$|^locked$|^available$|^delta$/;

function reviveBigInts<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => reviveBigInts(v)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && BIGINT_FIELD.test(k) && /^-?\d+$/.test(v)) {
        out[k] = BigInt(v);
      } else {
        out[k] = reviveBigInts(v);
      }
    }
    return out as T;
  }
  return value;
}

type DbSession = {
  id: string;
  user_id: string;
  game_id: string;
  chain_id: string;
  token_symbol: string;
  token_address: string;
  stake: string;
  seed_pair_id: string;
  server_seed_hash: string;
  client_seed: string;
  start_nonce: number;
  end_nonce: number;
  status: string;
  state: unknown;
  result: unknown;
  created_at: string;
  updated_at: string;
};

type DbAction = {
  ordinal: number;
  actor: "player" | "dealer" | "system";
  action: unknown;
  nonce_after: number;
  state_hash: string | null;
  created_at: string;
};

export async function fetchSessionForVerify(
  sessionId: string,
): Promise<
  | { session: Session<unknown, unknown>; revealedServerSeed: string | null }
  | { error: string }
> {
  const { data: row, error: sessErr } = await supabase
    .from("casino_sessions")
    .select(
      "id, user_id, game_id, chain_id, token_symbol, token_address, stake, seed_pair_id, server_seed_hash, client_seed, start_nonce, end_nonce, status, state, result, created_at, updated_at",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (sessErr) return { error: sessErr.message };
  if (!row) return { error: "session not found" };

  const s = row as DbSession;

  const { data: actions, error: actErr } = await supabase
    .from("casino_actions")
    .select("ordinal, actor, action, nonce_after, state_hash, created_at")
    .eq("session_id", sessionId)
    .order("ordinal", { ascending: true });

  if (actErr) return { error: actErr.message };

  const { data: seedRow } = await supabase
    .from("casino_seed_pairs")
    .select("server_seed, server_seed_hash, status")
    .eq("id", s.seed_pair_id)
    .maybeSingle();

  const isNative = isNativeTokenAddress(s.token_address);
  const token: TokenSpec = {
    symbol: s.token_symbol,
    display: s.token_symbol,
    address: s.token_address,
    decimals: tokenDecimalsFromRow(s.token_symbol, s.token_address),
    isNative,
  };

  const sessionActions: SessionAction<unknown>[] = ((actions ?? []) as DbAction[]).map((a) => ({
    ordinal: a.ordinal,
    actor: a.actor,
    action: reviveBigInts(a.action),
    nonceAfter: a.nonce_after,
    stateHash: a.state_hash ?? undefined,
    at: a.created_at,
  }));

  const session: Session<unknown, unknown> = {
    id: s.id,
    userId: s.user_id,
    gameId: s.game_id as Session["gameId"],
    chainId: s.chain_id as ChainId,
    token,
    stake: BigInt(s.stake),
    state: reviveBigInts(s.state),
    status: s.status as Session["status"],
    seedPairId: s.seed_pair_id,
    serverSeedHash: s.server_seed_hash,
    clientSeed: s.client_seed,
    startNonce: Number(s.start_nonce),
    endNonce: Number(s.end_nonce),
    actions: sessionActions,
    result: s.result ? (reviveBigInts(s.result) as GameResult) : undefined,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };

  let revealedServerSeed: string | null = null;
  if (seedRow && typeof seedRow === "object") {
    const sr = seedRow as { server_seed: string | null; server_seed_hash: string; status: string };
    if (sr.status === "retired" && sr.server_seed && sr.server_seed_hash === s.server_seed_hash) {
      revealedServerSeed = sr.server_seed;
    }
  }

  return { session, revealedServerSeed };
}

function isNativeTokenAddress(address: string): boolean {
  const addr = address.toLowerCase();
  return (
    addr === "0x0000000000000000000000000000000000000000" ||
    addr === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  );
}

function tokenDecimalsFromRow(symbol: string, address: string): number {
  if (symbol === "ETH" || isNativeTokenAddress(address)) return 18;
  return 6;
}
