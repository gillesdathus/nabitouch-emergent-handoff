import { useEffect, useMemo, useState } from "react";
import { VisualCalendar } from "@/components/ops/VisualCalendar";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { useDemo } from "@/store/DemoStore";
import { addDays, fmtDate, todayISO } from "@/lib/domain";

const KINDS = [
  ["break", "Break"],
  ["vacation", "Vacation"],
  ["sick", "Sick leave"],
  ["emergency", "Emergency closure"],
  ["closed", "Closed"],
  ["open", "Open override"],
];
const TONE = {
  available: "bg-teal-100 text-teal-900",
  booked: "bg-sky-200 text-sky-950",
  blocked: "bg-amber-100 text-amber-950",
  unavailable: "bg-slate-100 text-slate-500",
};

function monthStart(day) {
  return `${day.slice(0, 8)}01`;
}

function monthEnd(day) {
  const [year, month] = day.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${day.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

export default function Availability({ mode = "pro" }) {
  const { state, api, user, practitionerId, idx } = useDemo();
  const people = state.practitioners || [];
  const [personId, setPersonId] = useState(mode === "pro" ? practitionerId : people[0]?.id || "");
  const [cursor, setCursor] = useState(todayISO());
  const [view, setView] = useState("week");
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState(null);
  const [pending, setPending] = useState(null);
  const [form, setForm] = useState({ weekday: "1", start: "", end: "", kind: "break", startDate: todayISO(), endDate: todayISO(), slotStart: "", slotEnd: "", services: [] });
  const [buffers, setBuffers] = useState({ setupMin: "", cleanupMin: "", travelBufferMin: "" });
  const [openId, setOpenId] = useState(null);
  const [editor, setEditor] = useState(false);
  const range = useMemo(() => {
    if (view === "day") return [cursor, cursor];
    if (view === "month") return [monthStart(cursor), monthEnd(cursor)];
    return [cursor, addDays(cursor, 6)];
  }, [cursor, view]);
  const load = () => {
    if (!personId) return;
    api.schedule(personId, { start: range[0], end: range[1] }).then(setPayload).catch((err) => setError(err?.response?.data?.detail || "The schedule could not be loaded."));
  };
  useEffect(() => { load(); }, [personId, range[0], range[1]]); // eslint-disable-line
  const send = async (body, retry) => {
    setError("");
    try {
      if (body.weekly) await api.saveWeekly(personId, body);
      else await api.addException(personId, body);
      setConflicts(null);
      setPending(null);
      setEditor(false);
      load();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.conflicts) {
        setConflicts(detail.conflicts);
        setPending(retry || body);
        return;
      }
      const message = typeof detail === "string" ? detail : detail?.message;
      const gapText = Array.isArray(detail?.gaps) ? detail.gaps.map((gap) => `${gap.label}: ${gap.status}`).join(" ") : "";
      setError([message, gapText].filter(Boolean).join(" ") || "The schedule was not changed.");
    }
  };
  const schedule = payload?.schedule;
  const policy = state.settings?.[0]?.cancellationPolicy;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="availability-page">
      <div>
        <p className="nb-eyebrow">Schedule</p>
        <h1 className="text-3xl font-semibold tracking-tight">Availa<span className="font-display font-normal italic nb-gradient-text">bility</span></h1>
        <p className="text-sm text-nb-mute">Times use Edmonton local time. A new practitioner stays closed until onboarding and the schedule are approved. Existing visits are never cancelled from this screen.</p>
      </div>
      {mode === "owner" && (
        <label className="block text-sm"><span className="nb-label">Practitioner</span>
          <select className="nb-input" value={personId} onChange={(event) => setPersonId(event.target.value)} data-testid="availability-practitioner">
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.onboardingStatus === "draft" ? " · draft" : ""}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {["day", "week", "month"].map((item) => <button key={item} type="button" className={view === item ? "nb-chip-on" : "nb-chip-off"} onClick={() => setView(item)} data-testid={`availability-view-${item}`}>{item}</button>)}
        <button type="button" className="nb-btn-ghost h-10" onClick={() => setCursor(addDays(cursor, view === "month" ? -30 : view === "day" ? -1 : -7))}>Previous</button>
        <button type="button" className="nb-btn-ghost h-10" onClick={() => setCursor(todayISO())}>Today</button>
        <button type="button" className="nb-btn-ghost h-10" onClick={() => setCursor(addDays(cursor, view === "month" ? 30 : view === "day" ? 1 : 7))}>Next</button>
        <button type="button" className="nb-btn-ghost h-10" data-testid="availability-pause" onClick={async () => { await api.pauseBookings(personId, !schedule?.acceptingBookings); load(); }}>{schedule?.acceptingBookings ? "Pause new bookings" : "Paused"}</button>
        {user?.role === "owner" && <button type="button" className="nb-btn-primary h-10" data-testid="availability-approve" onClick={async () => { try { await api.approveSchedule(personId); load(); } catch (err) { const detail = err?.response?.data?.detail; const message = typeof detail === "string" ? detail : detail?.message; const gapText = Array.isArray(detail?.gaps) ? detail.gaps.map((gap) => `${gap.label}: ${gap.status}`).join(" ") : ""; setError([message, gapText].filter(Boolean).join(" ") || "Approval was not saved."); } }}>Approve schedule</button>}
      </div>
      {schedule && <p className="text-sm text-nb-mute" data-testid="availability-status">Status: {schedule.status}. {schedule.acceptingBookings ? "Accepting new bookings." : "Not accepting new bookings."} Onboarding: {payload?.onboardingStatus}.</p>}
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="availability-error">{error}</p>}
      <VisualCalendar appointments={(state.appointments || []).filter((item) => !personId || item.practitionerId === personId)} practitioners={people} services={idx?.services || {}} clients={idx?.clients || {}} cursor={cursor} onCursor={setCursor} onOpen={setOpenId} onSlot={(slot) => { setForm((current) => ({ ...current, startDate: slot.date, endDate: slot.date, slotStart: slot.time, kind: "break" })); setEditor(true); }} />
      {openId && <AppointmentSheet apptId={openId} role={mode === "owner" ? "owner" : "pro"} onClose={() => setOpenId(null)} />}
      <details className="nb-card p-4" data-testid="availability-editor" open={editor} onToggle={(event) => setEditor(event.currentTarget.open)}>
        <summary className="cursor-pointer font-semibold">Edit hours, breaks, and buffers</summary>
        <div className="mt-4 space-y-4">
      <div className="grid gap-3">
        {(payload?.days || []).map((day) => (
          <article key={day.date} className="nb-card p-4" data-testid={`availability-day-${day.date}`}>
            <h2 className="text-sm font-semibold">{fmtDate(day.date, { weekday: "long", month: "long", day: "numeric" })}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {day.segments.length === 0 && <span className={`rounded-full px-3 py-1 text-xs ${TONE.unavailable}`}>Unavailable</span>}
              {day.segments.map((segment) => <span key={`${segment.start}-${segment.state}`} className={`rounded-full px-3 py-1 text-xs font-medium ${TONE[segment.state] || TONE.unavailable}`}>{segment.state} {segment.start}–{segment.end}</span>)}
            </div>
          </article>
        ))}
      </div>
      <form className="nb-card grid gap-3 p-4 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); if (!form.start || !form.end) { setError("Enter the start and end in Edmonton time."); return; } const row = { weekday: Number(form.weekday), start: form.start, end: form.end }; if (form.services.length) row.services = form.services; const weekly = [...(schedule?.weekly || []), row]; send({ weekly }); }}>
        <p className="sm:col-span-4 text-sm font-semibold">Add a weekly interval</p>
        <p className="sm:col-span-4 text-xs text-nb-mute">Hours are not saved until you enter them. Edmonton time is displayed here and stored as UTC instants when a visit is booked.</p>
        <select className="nb-input" value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => <option key={label} value={index}>{label}</option>)}</select>
        <input className="nb-input" type="time" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} aria-label="Weekly start" />
        <input className="nb-input" type="time" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} aria-label="Weekly end" />
        <button className="nb-btn-primary h-12" data-testid="availability-weekly">Add hours</button>
        <div className="sm:col-span-4 flex flex-wrap gap-3 text-sm">
          {(state.services || []).map((service) => (
            <label key={service.slug} className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.services.includes(service.slug)} onChange={(event) => setForm({ ...form, services: event.target.checked ? [...form.services, service.slug] : form.services.filter((slug) => slug !== service.slug) })} />
              {service.name} only
            </label>
          ))}
        </div>
      </form>
      {user?.role === "owner" && (
        <form className="nb-card grid gap-3 p-4 sm:grid-cols-4" data-testid="availability-buffers" onSubmit={async (event) => { event.preventDefault(); const body = {}; ["setupMin", "cleanupMin", "travelBufferMin"].forEach((key) => { if (buffers[key] !== "") body[key] = Number(buffers[key]); }); try { await api.patch("settings", "app", { scheduling: body }); setError(""); setEditor(false); } catch (err) { setError(err?.response?.data?.detail || "The buffers were not saved."); } }}>
          <p className="sm:col-span-4 text-sm font-semibold">Travel buffers</p>
          <p className="sm:col-span-4 text-xs text-nb-mute">Setup, cleanup, and the extra travel buffer apply to every mobile visit. Leave a field blank to keep its current value.</p>
          <label className="text-sm">Setup minutes<input className="nb-input" inputMode="numeric" value={buffers.setupMin} onChange={(event) => setBuffers({ ...buffers, setupMin: event.target.value })} data-testid="buffer-setup" /></label>
          <label className="text-sm">Cleanup minutes<input className="nb-input" inputMode="numeric" value={buffers.cleanupMin} onChange={(event) => setBuffers({ ...buffers, cleanupMin: event.target.value })} data-testid="buffer-cleanup" /></label>
          <label className="text-sm">Travel buffer<input className="nb-input" inputMode="numeric" value={buffers.travelBufferMin} onChange={(event) => setBuffers({ ...buffers, travelBufferMin: event.target.value })} data-testid="buffer-travel" /></label>
          <button className="nb-btn-dark h-12" data-testid="buffer-save">Save buffers</button>
        </form>
      )}
      <form className="nb-card grid gap-3 p-4 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); send({ kind: form.kind, startDate: form.startDate, endDate: form.endDate, start: form.slotStart, end: form.slotEnd, ownerOverride: form.kind === "open" && user?.role === "owner" }); }}>
        <p className="sm:col-span-4 text-sm font-semibold">Open, close, or block time</p>
        <select className="nb-input" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <input className="nb-input" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
        <input className="nb-input" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
        <button className="nb-btn-dark h-12" data-testid="availability-exception">Save change</button>
        <input className="nb-input" type="time" value={form.slotStart} onChange={(event) => setForm({ ...form, slotStart: event.target.value })} aria-label="Start time" />
        <input className="nb-input" type="time" value={form.slotEnd} onChange={(event) => setForm({ ...form, slotEnd: event.target.value })} aria-label="End time" />
        <p className="sm:col-span-2 text-xs text-nb-mute">Leave the times empty to cover the full day. An open override cannot remove leave, a booking, or a travel constraint.</p>
      </form>
      {conflicts && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4" data-testid="availability-conflicts">
          <p className="font-semibold">These bookings stay where they are.</p>
          <ul className="mt-2 space-y-1 text-sm">{conflicts.map((row) => <li key={row.id}>{row.ref} · {row.date} {row.time}</li>)}</ul>
          <p className="mt-2 text-sm text-nb-mute">Closing the open time does not cancel or move a client. Confirm only if the existing visits should remain booked.</p>
          <button type="button" className="nb-btn-primary mt-3 h-10" data-testid="availability-keep" onClick={() => send({ ...pending, resolution: "keep_appointments" }, pending)}>Keep the bookings and save</button>
        </div>
      )}
      {mode === "owner" && policy?.status === "pending" && <p className="nb-card p-4 text-sm" data-testid="policy-pending"><b>Cancellation policy pending approval.</b> It is not shown to customers. {policy.text}</p>}
        </div>
      </details>
    </div>
  );
}
