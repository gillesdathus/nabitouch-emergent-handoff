import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCircle2, Clock, CloudOff, MapPin, Navigation, Pause, Play, Sparkles, PhoneCall, CalendarClock, MessageCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useNow } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { tap } from "@/lib/haptics";
import { NEXT_STATE, fmtClockTime, fmtSpan, sendSessionOp, treatmentClock, useOnline, usePendingOps } from "@/lib/turnaround";

const CHECK_LABEL = { linens: "Fresh linens", sanitize: "Table & face cradle sanitized", oils: "Oils & lotions capped", equipment: "Equipment stowed", hands: "Hands washed", packed: "Bag packed" };

function useAlertOnce(apptId) {
  const key = (mark) => `nb.alert.${apptId}.${mark}`;
  return (mark) => {
    if (localStorage.getItem(key(mark))) return false;
    localStorage.setItem(key(mark), "1");
    return true;
  };
}

export function SyncStrip({ apptId, error, lastSync, onRetry }) {
  const online = useOnline();
  const pending = usePendingOps(apptId);
  if (online && !pending.length && !error) return <p className="text-center text-[11px] text-nb-mute" data-testid="session-sync-ok">Clock synced with Nabitouch{lastSync ? ` · ${lastSync.toLocaleTimeString("en-CA", { timeZone: "America/Edmonton" })}` : ""}</p>;
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200" data-testid="session-sync-warning">
      <CloudOff className="h-4 w-4 shrink-0" />
      <span className="flex-1">{!online ? "Offline. The clock keeps running from the server start time." : error}{pending.length ? ` ${pending.length} action${pending.length > 1 ? "s" : ""} waiting to sync. Not confirmed yet.` : ""}</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold" data-testid="session-sync-retry"><RefreshCw className="h-3.5 w-3.5" />Retry</button>
    </div>
  );
}

function Ring({ pct, warn, over }) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
      <circle cx="50" cy="50" r="44" fill="none" stroke="#E0F2FE" strokeWidth="5" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={over ? "#F43F5E" : warn ? "#F59E0B" : "url(#smart-ring)"} strokeWidth="5" strokeLinecap="round" strokeDasharray={276.5} strokeDashoffset={276.5 * (1 - (over ? 1 : pct))} style={{ transition: "stroke-dashoffset 1s linear, stroke 0.4s ease" }} />
      <defs><linearGradient id="smart-ring"><stop offset="0" stopColor="#1565F0" /><stop offset="1" stopColor="#14D8C4" /></linearGradient></defs>
    </svg>
  );
}

export function TreatmentTimer({ appt, snap, serverNow, reload, clientName, serviceName }) {
  const t = snap?.treatment;
  const live = appt.status === "in_session" && !t?.paused;
  const tick = useNow(1000, live);
  const now = serverNow ? serverNow() : tick;
  const clock = treatmentClock(t, now);
  const once = useAlertOnce(appt.id);
  const [notice, setNotice] = useState("");
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!clock || appt.status !== "in_session") return;
    const mins = clock.remaining / 60000;
    const marks = [[0, "Scheduled time reached. Treatment continues until you end it.", "warning"], [5, "5 minutes remaining", "medium"], [10, "10 minutes remaining", "light"]];
    for (const [mark, text, kind] of marks) {
      if (mins <= mark && mins > mark - 1.5 && once(mark)) { setNotice(text); tap(kind); break; }
      if (mins <= mark) break;
    }
  });
  if (!clock) return null;
  const warn = clock.remaining <= 5 * 60000;
  const scheduledEnd = t ? new Date(new Date(t.startedAt).getTime() + clock.booked + (t.pausedMs || 0) + (t.pausedAt ? Math.max(0, now - new Date(t.pausedAt).getTime()) : 0)).toISOString() : null;
  const pause = async () => {
    const res = await sendSessionOp({ kind: "pause", apptId: appt.id, reason }).catch((err) => { toast.error(err?.response?.data?.detail || "Not paused"); return null; });
    if (!res) return;
    setPausing(false); setReason("");
    toast[res.synced ? "success" : "warning"](res.synced ? "Treatment paused and documented" : "Pause saved on this phone. Waiting to sync, not confirmed yet.");
    reload();
  };
  const resume = async () => {
    const res = await sendSessionOp({ kind: "resume", apptId: appt.id }).catch((err) => { toast.error(err?.response?.data?.detail || "Not resumed"); return null; });
    if (res) { toast[res.synced ? "success" : "warning"](res.synced ? "Treatment resumed" : "Resume saved on this phone. Waiting to sync."); reload(); }
  };
  return (
    <div className="nb-card relative overflow-hidden p-6" data-testid="smart-session-timer">
      <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-sky-100 to-teal-50 opacity-70 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div><p className="nb-eyebrow">Treatment</p><p className="text-base font-semibold" data-testid="smart-session-client">{clientName}</p><p className="text-xs text-nb-mute">{serviceName} · {t.bookedMin} min booked</p></div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${clock.overtime ? "bg-rose-50 text-rose-700" : t.paused ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`} data-testid="smart-session-phase">{t.endedAt ? "Ended" : clock.overtime ? "Overtime" : t.paused ? "Paused" : "In session"}</span>
      </div>
      <div className="relative mx-auto mt-4 h-60 w-60">
        <Ring pct={clock.pct} warn={warn} over={clock.overtime} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-nb-mute">{clock.overtime ? "Overtime" : "Remaining"}</span>
          <span className={`nb-num text-5xl font-semibold tabular-nums ${clock.overtime ? "text-rose-600" : ""}`} data-testid="smart-session-remaining">{fmtSpan(clock.remaining)}</span>
          <span className="mt-1 text-xs text-nb-mute" data-testid="smart-session-elapsed">{fmtSpan(clock.elapsed)} elapsed</span>
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-2xl bg-slate-50 p-2"><p className="text-nb-mute">Started</p><p className="font-semibold" data-testid="smart-session-started">{fmtClockTime(t.startedAt)}</p></div>
        <div className="rounded-2xl bg-slate-50 p-2"><p className="text-nb-mute">Scheduled end</p><p className="font-semibold" data-testid="smart-session-scheduled-end">{fmtClockTime(scheduledEnd)}</p></div>
        <div className="rounded-2xl bg-slate-50 p-2"><p className="text-nb-mute">Start vs booked</p><p className="font-semibold" data-testid="smart-session-start-delay">{t.startDelayMin == null ? "—" : Math.abs(t.startDelayMin) > 600 ? "Off-day" : t.startDelayMin > 0 ? `+${Math.round(t.startDelayMin)} min` : "On time"}</p></div>
      </div>
      <AnimatePresence>{notice && appt.status === "in_session" && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative mt-3 flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900" data-testid="smart-session-alert"><Bell className="h-3.5 w-3.5" />{notice}<button type="button" onClick={() => setNotice("")} className="ml-auto text-amber-700" data-testid="smart-session-alert-dismiss">Dismiss</button></motion.p>}</AnimatePresence>
      {appt.status === "in_session" && (
        <div className="relative mt-4">
          {t.paused ? <button type="button" onClick={resume} className="nb-btn-ghost h-11 w-full" data-testid="smart-session-resume"><Play className="h-4 w-4" />Resume treatment</button>
            : pausing ? (
              <div className="space-y-2 rounded-2xl bg-slate-50 p-3" data-testid="smart-session-pause-sheet">
                <input className="nb-input h-10" placeholder="Why is treatment paused?" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="smart-session-pause-reason" />
                <div className="flex gap-2"><button type="button" disabled={reason.trim().length < 3} onClick={pause} className="nb-btn-primary h-10 px-4 text-sm" data-testid="smart-session-pause-confirm">Pause and document</button><button type="button" onClick={() => setPausing(false)} className="nb-btn-ghost h-10 text-sm">Cancel</button></div>
              </div>
            ) : <button type="button" onClick={() => setPausing(true)} className="nb-btn-ghost h-11 w-full" data-testid="smart-session-pause"><Pause className="h-4 w-4" />Pause treatment</button>}
        </div>
      )}
      {t.endedAt && <p className="relative mt-3 text-center text-sm" data-testid="smart-session-summary">Treatment {fmtSpan(t.actualMin * 60000)} of {t.bookedMin}:00 booked{t.overtimeMin > 0 ? ` · ${fmtSpan(t.overtimeMin * 60000)} overtime` : ""}</p>}
      <p className="relative mt-3 text-center text-[11px] text-nb-mute">Treatment never ends automatically.</p>
    </div>
  );
}

export function CleanupPanel({ appt, snap, serverNow, reload }) {
  const c = snap?.cleanup;
  const tick = useNow(1000, !!c && !c.completedAt);
  const now = serverNow ? serverNow() : tick;
  const [checked, setChecked] = useState([]);
  const [busy, setBusy] = useState(false);
  const once = useAlertOnce(`${appt.id}.cleanup`);
  const remaining = c ? (c.completedAt ? new Date(c.dueAt) - new Date(c.completedAt) : new Date(c.dueAt).getTime() - now) : 0;
  useEffect(() => { if (c && !c.completedAt && remaining <= 0 && once("due")) tap("warning"); });
  if (!c) return null;
  const items = snap.checklist || [];
  const ready = async () => {
    setBusy(true);
    try {
      const res = await sendSessionOp({ kind: "ready", apptId: appt.id, checklist: checked });
      tap("success");
      toast[res.synced ? "success" : "warning"](res.synced ? "Ready for your next appointment" : "Saved on this phone. Waiting to sync, not confirmed yet.");
      reload();
    } catch (err) { toast.error(err?.response?.data?.detail || "Not saved"); } finally { setBusy(false); }
  };
  const pct = Math.min(1, Math.max(0, 1 - remaining / (c.bufferMin * 60000)));
  return (
    <div className="nb-card space-y-4 p-5" data-testid="cleanup-panel">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-50 text-cyan-700"><Sparkles className="h-5 w-5" /></span>
        <div className="flex-1"><p className="nb-eyebrow">Cleanup & preparation</p><p className="text-sm font-semibold">{c.completedAt ? "Ready for next appointment" : "Cleanup in progress"}</p></div>
        <span className={`nb-num text-3xl font-semibold tabular-nums ${!c.completedAt && remaining < 0 ? "text-rose-600" : ""}`} data-testid="cleanup-remaining">{c.completedAt ? <><span className="mr-1 text-xs font-medium text-nb-mute">took</span>{fmtSpan(c.actualMin * 60000)}</> : fmtSpan(remaining)}</span>
      </div>
      {!c.completedAt && <div className="h-2 overflow-hidden rounded-full bg-cyan-50"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-400" style={{ width: `${pct * 100}%`, transition: "width 1s linear" }} /></div>}
      <p className="text-xs text-nb-mute" data-testid="cleanup-buffer">{c.bufferMin} min buffer ({c.source}) · started {fmtClockTime(c.startedAt)}{!c.completedAt && remaining < 0 ? " · overrun. Cleanup is not completed automatically." : ""}{c.completedAt ? ` · completed ${fmtClockTime(c.completedAt)}${c.overrunMin > 0 ? ` · ${c.overrunMin} min over` : ""}` : ""}</p>
      {!c.completedAt && (
        <>
          <div className="flex flex-wrap gap-2" data-testid="cleanup-checklist">{items.map((item) => <button key={item} type="button" onClick={() => setChecked((cur) => (cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item]))} className={checked.includes(item) ? "nb-chip-on h-9 text-xs" : "nb-chip-off h-9 text-xs"} data-testid={`cleanup-item-${item}`}>{checked.includes(item) && <CheckCircle2 className="h-3.5 w-3.5" />}{CHECK_LABEL[item] || item}</button>)}</div>
          <button type="button" disabled={busy} onClick={ready} className="nb-btn-primary h-14 w-full text-base" data-testid="cleanup-ready-btn">{busy ? "Saving…" : "Ready for Next Appointment"}</button>
        </>
      )}
    </div>
  );
}

export function NextBookingCard({ snap, idx }) {
  const n = snap?.next;
  const [sending, setSending] = useState("");
  if (!snap) return null;
  if (!n) return <div className="nb-soft rounded-3xl p-4 text-sm text-nb-mute" data-testid="next-booking-none">No more bookings today after this visit.</div>;
  const st = NEXT_STATE[n.state] || NEXT_STATE.on_schedule;
  const service = idx?.services?.[n.serviceSlug];
  const client = idx?.clients?.[n.clientId];
  const escalate = async (kind) => {
    setSending(kind);
    try { await api.escalateTurnaround(snap.appointmentId, { kind }); toast.success(kind === "reception" ? "Reception alerted in the app" : "Schedule adjustment requested. Nothing changes until the office decides."); }
    catch (err) { toast.error(err?.response?.data?.detail || "Not sent"); } finally { setSending(""); }
  };
  const risky = ["at_risk", "running_late"].includes(n.state);
  return (
    <div className={`nb-card space-y-3 p-5 ${risky ? "ring-2 ring-rose-200" : ""}`} data-testid="next-booking-card">
      <div className="flex items-center justify-between gap-2"><p className="nb-eyebrow flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Next appointment</p><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${st.tone}`} data-testid="next-booking-state">{st.label}</span></div>
      <div><p className="text-lg font-semibold" data-testid="next-booking-time">{fmtClockTime(n.startAt)} · {client?.preferredName || client?.firstName || n.ref}</p><p className="text-xs text-nb-mute">{service?.name || "Visit"} · {n.duration} min · {n.ref}</p></div>
      <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 text-nb-teal" /><span data-testid="next-booking-location">{n.locationType === "clinic" ? "Clinic" : n.addressLine || "Mobile visit"}</span></p>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-2"><p className="text-nb-mute">Travel</p><p className="font-semibold" data-testid="next-booking-travel">{n.travelKnown ? `${n.travelMin} min` : "Unavailable"}</p><p className="text-[10px] text-nb-mute">{n.travelKnown ? (n.travelProvider === "same-location" ? "same location" : n.travelProvider === "same-stop" ? "same stop" : "Mapbox road ETA") : "No road estimate"}</p></div>
        <div className="rounded-2xl bg-slate-50 p-2"><p className="text-nb-mute">Setup</p><p className="font-semibold">{n.setupMin} min</p></div>
        <div className="rounded-2xl bg-slate-50 p-2"><p className="text-nb-mute">Leave by</p><p className="font-semibold" data-testid="next-booking-depart">{fmtClockTime(n.departBy)}</p>{!n.travelKnown && <p className="text-[10px] text-amber-700">excludes travel</p>}</div>
        <div className="rounded-2xl bg-slate-50 p-2"><p className="text-nb-mute">Buffer</p><p className={`font-semibold ${n.bufferMin < 0 ? "text-rose-600" : ""}`} data-testid="next-booking-buffer">{n.bufferMin < 0 ? `${Math.abs(Math.round(n.bufferMin))} min short` : `${Math.round(n.bufferMin)} min`}</p></div>
      </div>
      {risky && <p className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-900" data-testid="next-booking-warning">{n.state === "running_late" ? "You are past the departure time for the next booking." : "The next booking is at risk at the current pace."} The office can see this. Nothing is shortened, cancelled or rescheduled automatically.</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Link to={`/pro/visit/${n.id}/messages`} className="nb-btn-ghost h-11 text-sm" data-testid="next-booking-notify"><MessageCircle className="h-4 w-4" />Notify client</Link>
        <button type="button" disabled={!!sending} onClick={() => escalate("reception")} className="nb-btn-ghost h-11 text-sm" data-testid="next-booking-reception"><PhoneCall className="h-4 w-4" />Alert reception</button>
        <button type="button" disabled={!!sending} onClick={() => escalate("adjustment")} className="nb-btn-ghost h-11 text-sm" data-testid="next-booking-adjust"><Clock className="h-4 w-4" />Request adjustment</button>
      </div>
      {snap.cleanup?.completedAt && <Link to={`/pro/visit/${n.id}`} className="nb-btn-primary h-12 w-full" data-testid="next-booking-open"><Navigation className="h-4 w-4" />Open next visit · Start trip</Link>}
    </div>
  );
}
