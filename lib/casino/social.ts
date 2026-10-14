/**
 * Casino social layer: per-game comments + global live chat (Supabase).
 * Tables come from infra/supabase/migrations/2026-10-13-casino-comments-chat.sql.
 * Every call degrades gracefully: a missing table yields { unavailable: true } instead of throwing.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const SOCIAL_MAX_LEN = 500;
export const SOCIAL_THROTTLE_MS = 4000;

export interface SocialMessage {
  id: number;
  username: string;
  body: string;
  created_at: string;
  game_id?: string;
}

export interface SocialResult<T> {
  data: T;
  unavailable: boolean;
  error?: string;
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

export async function fetchGameComments(gameId: string, before?: string, limit = 20): Promise<SocialResult<SocialMessage[]>> {
  let q = supabase
    .from("casino_game_comments")
    .select("id, game_id, username, body, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) return { data: [], unavailable: isMissingTable(error), error: error.message };
  return { data: (data ?? []) as SocialMessage[], unavailable: false };
}

export async function fetchChatMessages(limit = 50): Promise<SocialResult<SocialMessage[]>> {
  const { data, error } = await supabase
    .from("casino_chat_messages")
    .select("id, username, body, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return { data: [], unavailable: isMissingTable(error), error: error.message };
  return { data: ((data ?? []) as SocialMessage[]).reverse(), unavailable: false };
}

function cleanBody(body: string): string {
  return body.replace(/\s+\n/g, "\n").trim().slice(0, SOCIAL_MAX_LEN);
}

export async function postGameComment(gameId: string, username: string, posterId: string, body: string): Promise<SocialResult<SocialMessage | null>> {
  const { data, error } = await supabase
    .from("casino_game_comments")
    .insert({ game_id: gameId, username: username.slice(0, 40), poster_id: posterId, body: cleanBody(body) })
    .select("id, game_id, username, body, created_at")
    .single();
  if (error) return { data: null, unavailable: isMissingTable(error), error: friendly(error.message) };
  return { data: data as SocialMessage, unavailable: false };
}

export async function postChatMessage(username: string, posterId: string, body: string): Promise<SocialResult<SocialMessage | null>> {
  const { data, error } = await supabase
    .from("casino_chat_messages")
    .insert({ username: username.slice(0, 40), poster_id: posterId, body: cleanBody(body) })
    .select("id, username, body, created_at")
    .single();
  if (error) return { data: null, unavailable: isMissingTable(error), error: friendly(error.message) };
  return { data: data as SocialMessage, unavailable: false };
}

function friendly(msg: string): string {
  if (/slow down/i.test(msg)) return "Slow down: one message every few seconds.";
  if (/check constraint/i.test(msg)) return "Messages must be 1–500 characters.";
  return "Couldn't post right now. Try again.";
}

export function subscribeChat(onInsert: (m: SocialMessage) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel("casino-live-chat")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "casino_chat_messages" }, (payload) => {
      const r = payload.new as SocialMessage & { poster_id?: string };
      onInsert({ id: r.id, username: r.username, body: r.body, created_at: r.created_at });
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
