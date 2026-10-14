"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGameComments, postGameComment, SOCIAL_MAX_LEN, SOCIAL_THROTTLE_MS, type SocialMessage } from "@/lib/casino/social";
import { btnSecondary, card } from "./casino-ui";
import { currentIdentity, MessageRow, useIdentityName, useNow } from "./social-ui";

const PAGE = 20;

export function GameComments({ gameId, title }: { gameId: string; title: string }) {
  const [items, setItems] = useState<SocialMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastPost = useRef(0);
  const name = useIdentityName();
  const now = useNow();

  useEffect(() => {
    let alive = true;
    void fetchGameComments(gameId, undefined, PAGE).then((r) => {
      if (!alive) return;
      setUnavailable(r.unavailable || !!r.error);
      setItems(r.data);
      setHasMore(r.data.length === PAGE);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [gameId]);

  const loadMore = useCallback(async () => {
    const last = items[items.length - 1];
    if (!last) return;
    const r = await fetchGameComments(gameId, last.created_at, PAGE);
    setItems((prev) => [...prev, ...r.data.filter((m) => !prev.some((p) => p.id === m.id))]);
    setHasMore(r.data.length === PAGE);
  }, [gameId, items]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || posting) return;
    if (Date.now() - lastPost.current < SOCIAL_THROTTLE_MS) {
      setErr("Slow down: one message every few seconds.");
      return;
    }
    setPosting(true);
    setErr(null);
    const id = currentIdentity();
    const r = await postGameComment(gameId, id.username, id.posterId, body);
    setPosting(false);
    if (r.data) {
      lastPost.current = Date.now();
      setText("");
      setItems((prev) => [r.data as SocialMessage, ...prev]);
    } else {
      if (r.unavailable) setUnavailable(true);
      setErr(r.error ?? "Couldn't post right now.");
    }
  };

  return (
    <section className={card + " cz-comments p-4 sm:p-5 mt-6"} aria-labelledby="game-comments-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="game-comments-title" className="font-heading text-sm font-semibold tracking-wide text-[#f6f1e7]">
          {title} comments
        </h2>
        {!unavailable && items.length > 0 && <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">Newest first</span>}
      </div>

      {unavailable ? (
        <p className="mt-3 text-[13px] text-white/45">Comments are coming soon to this table.</p>
      ) : (
        <>
          <form onSubmit={submit} className="mt-3 space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, SOCIAL_MAX_LEN))}
              maxLength={SOCIAL_MAX_LEN}
              rows={2}
              placeholder={`Say something about ${title}…`}
              aria-label="Write a comment"
              className="w-full resize-y min-h-[3.5rem] px-3 py-2 rounded-lg bg-black/40 border border-[#c6a15b]/15 text-[#f6f1e7] text-sm placeholder:text-[#f6f1e7]/30 outline-none focus:border-[#e8d5a3]/55"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-white/40 truncate">
                Posting as <span className="text-[#e8d5a3]">{name || "Guest"}</span> · {text.length}/{SOCIAL_MAX_LEN}
              </span>
              <button type="submit" disabled={!text.trim() || posting} className={btnSecondary + " !min-h-9 !h-9 !px-4 !text-xs"}>
                {posting ? "Posting…" : "Post"}
              </button>
            </div>
            {err && <p className="text-[12px] text-[#c4938a]" role="alert">{err}</p>}
          </form>

          {loading ? (
            <p className="mt-4 text-[13px] text-white/40">Loading comments…</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-[13px] text-white/40">No comments yet. Be the first.</p>
          ) : (
            <ul className="mt-3">
              {items.map((m) => (
                <MessageRow key={m.id} m={m} now={now} />
              ))}
            </ul>
          )}
          {hasMore && (
            <button type="button" onClick={() => void loadMore()} className={btnSecondary + " mt-3 w-full !min-h-9 !h-9 !text-xs"}>
              Load more
            </button>
          )}
        </>
      )}
    </section>
  );
}
