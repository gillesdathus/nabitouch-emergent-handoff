import { useEffect, useRef, useState } from "react";
import { MessageCircle, RotateCcw, Send } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { EmptyState } from "@/components/tide";
import { notifyUnreadRefresh } from "@/lib/team-connect";

function stamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-CA", { timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit" });
}

function receipt(message, meId) {
  if (message.status === "failed") return "Failed — tap retry";
  const readers = Object.keys(message.readBy || {}).filter((id) => id !== message.authorId);
  if (readers.length) return "Read in the app";
  if (message.deliveredAt) return "Delivered in the app";
  return message.authorId === meId ? "Sent in the app" : "In the app";
}

export function StaffConversation({ threadId, meId, title, counterpart, onRead }) {
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState("connecting");
  const onReadRef = useRef(onRead);
  useEffect(() => { onReadRef.current = onRead; }, [onRead]);

  const load = () => api.teamMessages(threadId).then(setThread).catch((err) => setError(apiError(err)));

  useEffect(() => {
    let alive = true;
    setThread(null);
    setError("");
    load();
    api.teamMarkRead(threadId)
      .then(() => {
        if (!alive) return;
        notifyUnreadRefresh("team");
        if (onReadRef.current) onReadRef.current();
      })
      .catch(() => {});
    const poll = setInterval(load, 8000);
    let source;
    const base = process.env.REACT_APP_BACKEND_URL;
    if (base && typeof EventSource !== "undefined") {
      source = new EventSource(`${base}/api/team/threads/${threadId}/messages/stream`, { withCredentials: true });
      source.onopen = () => { if (alive) setConnected("live"); };
      source.onmessage = () => { if (alive) load(); };
      source.onerror = () => { if (alive) setConnected("reconnecting"); };
    } else setConnected("polling");
    return () => { alive = false; clearInterval(poll); if (source) source.close(); };
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.teamPostMessage(threadId, { body: text, idempotencyKey: `${Date.now()}` });
      setBody("");
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (messageId) => {
    setBusy(true);
    try {
      await api.teamRetryMessage(threadId, messageId);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const messages = thread?.messages || [];

  return (
    <section className="nb-card overflow-hidden" data-testid="staff-conversation">
      <div className="border-b border-sky-100 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-nb-teal">Team Connect</p>
        <h2 className="text-lg font-semibold">{title || "Staff chat"}</h2>
        {counterpart && <p className="text-sm text-nb-mute">{counterpart}</p>}
        <p className="mt-1 text-xs text-nb-mute" data-testid="staff-conversation-channel">
          Invitation-only staff messages. Not visible to clients. {connected === "live" ? "Updates are live." : "Updates refresh automatically."}
        </p>
      </div>
      <div className="max-h-[28rem] space-y-3 overflow-y-auto px-4 py-4" data-testid="staff-conversation-log">
        {!thread && !error && <p className="text-sm text-nb-mute">Opening the conversation…</p>}
        {thread && messages.length === 0 && (
          <EmptyState icon={MessageCircle} title="No messages yet" body="Say hello. Only invited members can read this thread." />
        )}
        {messages.map((item) => {
          const mine = item.authorId === meId;
          return (
            <div key={item.id} className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`staff-message-${item.id}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? "bg-nb-navy text-white" : "bg-sky-50 text-nb-ink"} ${item.status === "failed" ? "ring-1 ring-rose-300" : ""}`}>
                {!mine && <p className="mb-0.5 text-[11px] font-semibold opacity-80">{item.authorName}</p>}
                <p className="whitespace-pre-wrap break-words">{item.body}</p>
                <p className={`mt-1 flex items-center gap-2 text-[10px] ${mine ? "text-white/70" : "text-nb-mute"}`}>
                  <span>{stamp(item.createdAt)}</span>
                  <span>· {receipt(item, meId)}</span>
                  {item.status === "failed" && mine && (
                    <button type="button" disabled={busy} onClick={() => retry(item.id)} className="inline-flex items-center gap-1 font-semibold underline" data-testid={`staff-retry-${item.id}`}>
                      <RotateCcw className="h-3 w-3" />Retry
                    </button>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="px-4 text-sm text-rose-700" data-testid="staff-conversation-error">{error}</p>}
      <div className="border-t border-sky-100 p-3 safe-bottom">
        <div className="flex items-end gap-2">
          <textarea
            className="nb-input min-h-[48px] flex-1 resize-none py-3 text-sm"
            rows={2}
            maxLength={2000}
            placeholder="Write a message…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            data-testid="staff-composer"
          />
          <button type="button" disabled={busy || !body.trim()} onClick={send} className="nb-btn-primary h-12 w-12 shrink-0 px-0" data-testid="staff-send-btn" aria-label="Send">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
