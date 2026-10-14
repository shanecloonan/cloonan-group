"use client";

import { useEffect, useRef, useState } from "react";
import { fetchChatMessages, postChatMessage, SOCIAL_MAX_LEN, SOCIAL_THROTTLE_MS, subscribeChat, type SocialMessage } from "@/lib/casino/social";
import { card } from "./casino-ui";
import { currentIdentity, MessageRow, useIdentityName, useNow } from "./social-ui";

/** Global casino live chat: inline card on the lobby page. */
export function CasinoChat() {
  const [msgs, setMsgs] = useState<SocialMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const lastPost = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const name = useIdentityName();
  const now = useNow();

  // Load recent history once, then subscribe to inserts.
  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;
    void fetchChatMessages(50).then((r) => {
      if (!alive) return;
      setLoaded(true);
      if (r.unavailable || r.error) {
        setUnavailable(true);
        return;
      }
      setMsgs(r.data);
      unsub = subscribeChat((m) => {
        setMsgs((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m].slice(-200)));
      });
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs]);

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
    const r = await postChatMessage(id.username, id.posterId, body);
    setPosting(false);
    if (r.data) {
      lastPost.current = Date.now();
      setText("");
      const m = r.data;
      setMsgs((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    } else {
      if (r.unavailable) setUnavailable(true);
      setErr(r.error ?? "Couldn't send.");
    }
  };

  return (
    <section className={card + " cz-chat cz-chat-panel mt-6 flex flex-col"} aria-labelledby="casino-live-chat-title">
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.06]">
        <div>
          <h2 id="casino-live-chat-title" className="text-[10px] uppercase tracking-[0.24em] text-[#c6a15b] font-semibold">Live chat</h2>
          <p className="text-[11px] text-white/40">The whole floor, in real time</p>
        </div>
      </div>
      {unavailable ? (
        <p className="px-4 sm:px-5 py-4 text-[13px] text-white/45">Live chat is coming soon.</p>
      ) : (
        <>
          <ul ref={listRef} className="h-72 sm:h-80 overflow-y-auto px-4 sm:px-5 py-2" aria-live="polite">
            {!loaded && <li className="text-[13px] text-white/40 py-2">Loading…</li>}
            {loaded && msgs.length === 0 && <li className="text-[13px] text-white/40 py-2">No messages yet. Say hi.</li>}
            {msgs.map((m) => (
              <MessageRow key={m.id} m={m} now={now} compact />
            ))}
          </ul>
          <form onSubmit={submit} className="px-4 sm:px-5 py-3 border-t border-white/[0.06] space-y-1.5">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, SOCIAL_MAX_LEN))}
                maxLength={SOCIAL_MAX_LEN}
                placeholder="Message the floor…"
                aria-label="Chat message"
                className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-black/40 border border-[#c6a15b]/15 text-[#f6f1e7] text-sm placeholder:text-[#f6f1e7]/30 outline-none focus:border-[#e8d5a3]/55"
              />
              <button type="submit" disabled={!text.trim() || posting} className="h-9 px-4 rounded-lg text-xs font-semibold border border-[#c6a15b]/30 text-[#e8dcc0] bg-[#c6a15b]/10 hover:bg-[#c6a15b]/20 disabled:opacity-40 cursor-pointer">
                Send
              </button>
            </div>
            <p className="text-[10px] text-white/35 truncate">
              as <span className="text-[#e8d5a3]">{name || "Guest"}</span>
            </p>
            {err && <p className="text-[11px] text-[#c4938a]" role="alert">{err}</p>}
          </form>
        </>
      )}
    </section>
  );
}
