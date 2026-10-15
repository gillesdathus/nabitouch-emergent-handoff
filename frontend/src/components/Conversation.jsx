import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { EmptyState } from "@/components/tide";

function stamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function receipt(message, role) {
  const readers = Object.keys(message.readBy || {}).filter((key) => key !== message.authorRole);
  if (readers.length) return "Read in the app";
  if (message.deliveredAt) return "Delivered in the app";
  return role === message.authorRole ? "Sent in the app" : "In the app";
}

export function Conversation({ appointmentId, viewerRole, title, counterpart }) {
  const [thread, setThread] = useState(null);
  const [presets, setPresets] = useState([]);
  const [body, setBody] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [reason, setReason] = useState("");
  const [presetId, setPresetId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState("connecting");

  const load = () => api.appointmentMessages(appointmentId).then(setThread).catch((err) => setError(apiError(err)));

  useEffect(() => {
    let alive = true;
    setThread(null);
    setError("");
    api.messagePresets().then((body) => { if (alive) setPresets(body.presets || []); }).catch(() => {});
    load();
    api.markMessagesRead(appointmentId).catch(() => {});
    const poll = setInterval(load, 8000);
    let source;
    const base = process.env.REACT_APP_BACKEND_URL;
    if (base && typeof EventSource !== "undefined") {
      source = new EventSource(`${base}/api/appointments/${appointmentId}/messages/stream`, { withCredentials: true });
      source.onopen = () => { if (alive) setConnected("live"); };
      source.onmessage = () => { if (alive) load(); };
      source.onerror = () => { if (alive) setConnected("reconnecting"); };
    } else setConnected("polling");
    return () => { alive = false; clearInterval(poll); if (source) source.close(); };
  }, [appointmentId]);

  const timed = presets.find((p) => p.id === presetId)?.minutes === true;
  const choose = (preset) => {
    setPresetId(preset.id);
    const text = preset.body.replace("{minutes}", String(minutes));
    setBody(reason && preset.minutes ? `${text} ${reason}` : text);
  };

  const send = async (recordDelay = false) => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.postMessage(appointmentId, { body: text, presetId: presetId || undefined, minutes: timed ? minutes : undefined, reason: reason || undefined, recordDelay, idempotencyKey: `${Date.now()}` });
      setBody("");
      setReason("");
      setPresetId("");
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const items = [
    ...(thread?.notices || []).map((row) => ({ ...row, kind: "notice", at: row.at })),
    ...(thread?.messages || []).map((row) => ({ ...row, kind: "chat", at: row.createdAt })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return (
    <section className="nb-card overflow-hidden" data-testid="conversation">
      <div className="border-b border-sky-100 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-nb-teal">In-app</p>
        <h2 className="text-lg font-semibold">{title || "Visit messages"}</h2>
        {counterpart && <p className="text-sm text-nb-mute">{counterpart}</p>}
        <p className="mt-1 text-xs text-nb-mute" data-testid="conversation-channel">In-app messages stay in this visit. Email is not sent from this screen. SMS is off. {connected === "live" ? "Updates are live." : "Updates refresh automatically."}</p>
      </div>
      <div className="max-h-[28rem] space-y-3 overflow-y-auto px-4 py-4" data-testid="conversation-log">
        {!thread && !error && <p className="text-sm text-nb-mute">Opening the conversation…</p>}
        {thread && items.length === 0 && <EmptyState icon={MessageCircle} title="No messages yet" body="Status updates and messages for this visit appear here. Nothing is sent by text." />}
        {items.map((item) => item.kind === "notice" ? (
          <p key={item.id} className="rounded-2xl bg-slate-100 px-3 py-2 text-center text-xs text-nb-mute" data-testid={`notice-${item.id}`}>{item.body}</p>
        ) : (
          <div key={item.id} className={`flex ${item.authorRole === viewerRole ? "justify-end" : "justify-start"}`} data-testid={`message-${item.id}`}>
            <div className={`max-w-[85%] rounded-3xl px-4 py-2 text-sm ${item.authorRole === viewerRole ? "bg-nb-ink text-white" : "bg-sky-50 text-nb-ink"}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{item.authorLabel}</p>
              <p>{item.body}</p>
              <p className="mt-1 text-[10px] opacity-70">{stamp(item.createdAt)} · {receipt(item, viewerRole)}</p>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="px-4 text-sm text-red-700" data-testid="conversation-error">{error}</p>}
      {thread?.canWrite && (
        <div className="space-y-3 border-t border-sky-100 px-4 py-3">
          {presets.length > 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar" data-testid="message-presets">
              {presets.map((preset) => <button key={preset.id} type="button" className={presetId === preset.id ? "nb-chip-on shrink-0" : "nb-chip-off shrink-0"} onClick={() => choose(preset)} data-testid={`preset-${preset.id}`}>{preset.body.replace("{minutes}", String(minutes))}</button>)}
            </div>
          )}
          {timed && (
            <div className="space-y-2" data-testid="delay-picker">
              <div className="flex gap-2">{[5, 10, 15, 20, 30].map((value) => <button key={value} type="button" className={minutes === value ? "nb-chip-on" : "nb-chip-off"} onClick={() => { setMinutes(value); setBody(`I'm running ${value} minutes late.${reason ? ` ${reason}` : ""}`); }} data-testid={`delay-${value}`}>{value} min</button>)}</div>
              <input className="nb-input h-10" placeholder="Optional reason" value={reason} onChange={(event) => setReason(event.target.value)} data-testid="delay-reason" />
            </div>
          )}
          <div className="flex gap-2">
            <textarea className="nb-input min-h-12 flex-1 py-2" rows={2} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a message" data-testid="message-composer" />
            <button type="button" className="nb-btn-primary h-12 px-4" disabled={busy || !body.trim()} onClick={() => send(false)} data-testid="message-send"><Send className="h-4 w-4" /></button>
          </div>
          {presetId === "late" && viewerRole === "practitioner" && <button type="button" className="nb-btn-ghost h-10 text-sm" disabled={busy} onClick={() => send(true)} data-testid="delay-save-and-send">Save the delay and send this in-app message</button>}
        </div>
      )}
    </section>
  );
}
