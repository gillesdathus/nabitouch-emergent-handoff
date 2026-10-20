import { useState } from "react";
import { todayISO } from "@/lib/domain";

const KINDS = [
  ["vacation", "Vacation"],
  ["sick", "Sick leave"],
  ["emergency", "Emergency closure"],
  ["closed", "Closed"],
  ["open", "Open override"],
];

export default function TimeOffEditor({ exceptions = [], onSave, conflicts, onKeep, canOwnerOverride = false }) {
  const [form, setForm] = useState({
    kind: "vacation",
    startDate: todayISO(),
    endDate: todayISO(),
    start: "",
    end: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  const rows = (exceptions || []).filter((row) => row.kind !== "break");

  const submit = async (resolution) => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const body = {
        kind: form.kind,
        startDate: form.startDate,
        endDate: form.endDate,
        start: form.start,
        end: form.end,
        ownerOverride: form.kind === "open" && canOwnerOverride,
      };
      if (resolution) body.resolution = resolution;
      await onSave(body);
      setSaved("Time off saved");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.conflicts) throw err;
      setError(typeof detail === "string" ? detail : detail?.message || "The change was not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" data-testid="time-off-editor">
      <div>
        <h2 className="text-lg font-semibold">Time Off / Exceptions</h2>
        <p className="text-sm text-nb-mute">Vacation, sick leave, closures, and intentional open overrides. Confirmed visits stay booked.</p>
      </div>
      {saved && <p className="rounded-2xl bg-teal-50 px-3 py-2 text-sm text-teal-900" data-testid="time-off-saved">{saved}</p>}
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {rows.length > 0 && (
        <ul className="space-y-2 text-sm" data-testid="time-off-list">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-sky-100 px-3 py-2">
              <span className="font-medium capitalize">{row.kind}</span>
              {" · "}
              {row.startDate}{row.endDate !== row.startDate ? ` → ${row.endDate}` : ""}
              {row.start && row.end ? ` · ${row.start}–${row.end}` : " · Full day"}
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit().catch(() => {});
        }}
      >
        <label className="text-sm sm:col-span-2">Type
          <select className="nb-input" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })} data-testid="time-off-kind">
            {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm">Start date
          <input className="nb-input" type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} data-testid="time-off-start-date" />
        </label>
        <label className="text-sm">End date
          <input className="nb-input" type="date" required value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} data-testid="time-off-end-date" />
        </label>
        <label className="text-sm">Start time
          <input className="nb-input" type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} data-testid="time-off-start" />
        </label>
        <label className="text-sm">End time
          <input className="nb-input" type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} data-testid="time-off-end" />
        </label>
        <p className="sm:col-span-2 text-xs text-nb-mute">Leave times empty to cover the full day. An open override cannot remove leave or a booking.</p>
        <button type="submit" className="nb-btn-dark h-12 sm:col-span-2" disabled={busy} data-testid="time-off-save">
          {busy ? "Saving…" : "Save exception"}
        </button>
      </form>

      {conflicts?.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4" data-testid="time-off-conflicts">
          <p className="font-semibold">These bookings stay where they are.</p>
          <ul className="mt-2 space-y-1 text-sm">{conflicts.map((row) => <li key={row.id}>{row.ref} · {row.date} {row.time}</li>)}</ul>
          <button type="button" className="nb-btn-primary mt-3 h-10" onClick={() => onKeep?.() || submit("keep_appointments")}>
            Keep the bookings and save
          </button>
        </div>
      )}
    </section>
  );
}
