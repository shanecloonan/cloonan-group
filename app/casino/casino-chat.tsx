"use client";

import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchChatMessages, postChatMessage, SOCIAL_MAX_LEN, SOCIAL_THROTTLE_MS, subscribeChat, type SocialMessage } from "@/lib/casino/social";
import { currentIdentity, MessageRow, useIdentityName, useNow } from "./social-ui";

const OPEN_KEY = "mf_casino_chat_open_v1";

/** Global casino live chat: collapsible panel available on every casino page. */
export function CasinoChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<SocialMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const lastPost = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const openRef = useRef(open);
  const name = useIdentityName();
  const now = useNow();

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (window.localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    openRef.current = open;
    try {
      window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

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
        if (!openRef.current) setUnread((n) => Math.min(99, n + 1));
      });
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, open]);

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
    <div className="cz-chat fixed right-3 sm:right-5 bottom-20 lg:bottom-5 z-50 flex flex-col items-end gap-2">
      {open && (
        <div
          role="dialog"
          aria-label="Casino live chat"
          className={"cz-chat-panel w-[min(92vw,340px)] " + (unavailable ? "" : "h-[min(65vh,460px)] ") + "flex flex-col rounded-xl border border-[#c6a15b]/25 bg-[#0c0e0a]/95 backdrop-blur-xl shadow-[0_18px_44px_rgba(0,0,0,0.6)]"}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#c6a15b] font-semibold">Live chat</p>
              <p className="text-[11px] text-white/40">The whole floor</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="h-8 w-8 inline-flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/[0.05] cursor-pointer">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {unavailable ? (
            <p className="p-4 text-[13px] text-white/45">Live chat is coming soon.</p>
          ) : (
            <>
              <ul ref={listRef} className="flex-1 overflow-y-auto px-4 py-2" aria-live="polite">
                {!loaded && <li className="text-[13px] text-white/40 py-2">Loading…</li>}
                {loaded && msgs.length === 0 && <li className="text-[13px] text-white/40 py-2">No messages yet. Say hi.</li>}
                {msgs.map((m) => (
                  <MessageRow key={m.id} m={m} now={now} compact />
                ))}
              </ul>
              <form onSubmit={submit} className="p-3 border-t border-white/[0.06] space-y-1.5">
                <div className="flex gap-2">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, SOCIAL_MAX_LEN))}
                    maxLength={SOCIAL_MAX_LEN}
                    placeholder="Message the floor…"
                    aria-label="Chat message"
                    className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-black/40 border border-[#c6a15b]/15 text-[#f6f1e7] text-sm placeholder:text-[#f6f1e7]/30 outline-none focus:border-[#e8d5a3]/55"
                  />
                  <button type="submit" disabled={!text.trim() || posting} className="h-9 px-3 rounded-lg text-xs font-semibold border border-[#c6a15b]/30 text-[#e8dcc0] bg-[#c6a15b]/10 hover:bg-[#c6a15b]/20 disabled:opacity-40 cursor-pointer">
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
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setUnread(0);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-label={open ? "Hide live chat" : "Open live chat"}
        className="cz-chat-fab relative inline-flex items-center gap-2 h-11 px-4 rounded-full border border-[#c6a15b]/35 bg-[#0c0e0a]/95 text-[#e8dcc0] text-[11px] tracking-[0.16em] uppercase font-medium shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:border-[#e8d5a3]/60 cursor-pointer"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        <span>Chat</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#c6a15b] text-[#1c1508] text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
    </div>
  );
}
