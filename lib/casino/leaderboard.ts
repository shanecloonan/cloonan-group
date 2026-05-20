import { supabase } from "../supabase";

export type LeaderboardRow = {
  user_id: string;
  display_label: string;
  total_pnl: string;
  session_count: number;
  token_symbol: string;
};

export type RecordRow = {
  session_id: string;
  user_id: string;
  display_label: string;
  game_id: string;
  stake: string;
  pnl: string;
  token_symbol: string;
  settled_at: string;
};

export type FeedRow = {
  session_id: string;
  game_id: string;
  stake: string;
  pnl: string;
  token_symbol: string;
  display_label: string;
  settled_at: string;
};

export async function fetchLeaderboardWinners(limit = 25): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc("casino_leaderboard_overall", {
    p_limit: limit,
    p_winners: true,
  });
  if (error) return [];
  return (data ?? []) as LeaderboardRow[];
}

export async function fetchLeaderboardLosers(limit = 25): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc("casino_leaderboard_losers", { p_limit: limit });
  if (error) {
    const fallback = await supabase.rpc("casino_leaderboard_overall", {
      p_limit: limit,
      p_winners: false,
    });
    if (fallback.error) return [];
    const rows = (fallback.data ?? []) as LeaderboardRow[];
    return [...rows].sort((a, b) => Number(a.total_pnl) - Number(b.total_pnl));
  }
  return (data ?? []) as LeaderboardRow[];
}

export async function fetchRecordBets(
  kind: "biggest_win" | "biggest_loss",
  limit = 25,
): Promise<RecordRow[]> {
  const { data, error } = await supabase.rpc("casino_leaderboard_records", {
    p_limit: limit,
    p_kind: kind,
  });
  if (error) return [];
  return (data ?? []) as RecordRow[];
}

export async function fetchPublicBetFeed(limit = 50): Promise<FeedRow[]> {
  const { data, error } = await supabase.rpc("casino_public_bet_feed", { p_limit: limit });
  if (error) return [];
  return (data ?? []) as FeedRow[];
}

export async function upsertCasinoProfile(input: {
  displayName?: string;
  showOnLeaderboard?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to save your profile." };

  const row: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (input.displayName !== undefined) row.display_name = input.displayName;
  if (input.showOnLeaderboard !== undefined) row.show_on_leaderboard = input.showOnLeaderboard;

  const { error } = await supabase.from("casino_profiles").upsert(row, { onConflict: "user_id" });
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      return { ok: false, error: "Leaderboard schema not applied yet." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type DashboardSessionRow = {
  id: string;
  game_id: string;
  stake: string;
  pnl: string;
  token_symbol: string;
  updated_at: string;
  result: unknown;
  state: unknown;
};

export async function fetchOwnDashboardSessions(limit = 80): Promise<DashboardSessionRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("casino_sessions")
    .select("id, game_id, stake, result, token_symbol, updated_at, state")
    .eq("user_id", user.id)
    .eq("status", "settled")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((d) => {
    const result = d.result as { pnlUnits?: string | number } | null;
    const pnl =
      result?.pnlUnits !== undefined ? String(result.pnlUnits) : "0";
    return {
      id: d.id,
      game_id: d.game_id,
      stake: String(d.stake),
      pnl,
      token_symbol: d.token_symbol,
      updated_at: d.updated_at,
      result: d.result,
      state: d.state,
    };
  });
}

/** Display names for seated poker players (and similar UIs). */
export async function fetchCasinoProfilesForUsers(
  userIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from("casino_profiles")
    .select("user_id, display_name")
    .in("user_id", unique);

  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.display_name) out[row.user_id] = row.display_name;
  }
  return out;
}

export async function fetchOwnProfile(): Promise<{
  displayName: string;
  showOnLeaderboard: boolean;
} | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("casino_profiles")
    .select("display_name, show_on_leaderboard")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return { displayName: "", showOnLeaderboard: true };
  return {
    displayName: data.display_name ?? "",
    showOnLeaderboard: data.show_on_leaderboard ?? true,
  };
}
