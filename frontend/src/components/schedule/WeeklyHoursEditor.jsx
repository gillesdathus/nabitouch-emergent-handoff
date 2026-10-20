import { useEffect, useMemo, useState } from "react";
import { SaveStatus, formatSavedAt } from "./SaveStatus";

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function cloneWeekly(weekly) {
  return (weekly || []).map((row) => ({
    weekday: Number(row.weekday),
    start: row.start,
    end: row.end,
    ...(row.services?.length ? { services: [...row.services] } : {}),
  }));
}

function serializeWeekly(weekly) {
  return JSON.stringify(
    cloneWeekly(weekly).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
  );
}

function blocksForDay(weekly, day) {
  return weekly.filter((row) => row.weekday === day).sort((a, b) => a.start.localeCompare(b.start));
}

export default function WeeklyHoursEditor({
  schedule,
  services = [],
  onSave,
  conflicts,
  onKeepAppointments,
}) {
  const [draft, setDraft] = useState(() => cloneWeekly(schedule?.weekly));
  const [selected, setSelected] = useState([0, 1, 2, 3, 4]); // Mon–Fri (0 = Monday)
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [serviceFilter, setServiceFilter] = useState([]);
  const [status, setStatus] = useState(schedule ? "saved" : "loading");
  const [message, setMessage] = useState(schedule ? "Saved schedule loaded" : "Loading existing schedule…");
  const [lastSaved, setLastSaved] = useState(formatSavedAt(schedule?.updatedAt));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(cloneWeekly(schedule?.weekly));
    setStatus(schedule ? "saved" : "loading");
    setMessage(schedule ? (schedule.weekly?.length ? "Saved schedule loaded" : "No working hours set yet") : "Loading existing schedule…");
    setLastSaved(formatSavedAt(schedule?.updatedAt));
    setError("");
  }, [schedule]);

  const baseline = useMemo(() => serializeWeekly(schedule?.weekly), [schedule]);
  const dirty = serializeWeekly(draft) !== baseline;

  useEffect(() => {
    if (busy) return;
    if (dirty) {
      setStatus("dirty");
      setMessage("Unsaved changes");
    } else if (schedule) {
      setStatus("saved");
      setMessage(draft.length ? "Saved schedule loaded" : "No working hours set yet");
    }
  }, [dirty, busy, schedule, draft.length]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const toggleDay = (day) => {
    setSelected((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort()));
  };

  const applyToSelected = () => {
    if (!selected.length) {
      setError("Select at least one weekday.");
      return;
    }
    if (!start || !end || end <= start) {
      setError("Start must be before end.");
      return;
    }
    setError("");
    setDraft((current) => {
      const kept = current.filter((row) => !selected.includes(row.weekday));
      const next = selected.map((weekday) => {
        const row = { weekday, start, end };
        if (serviceFilter.length) row.services = [...serviceFilter];
        return row;
      });
      return [...kept, ...next].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    });
  };

  const addBlockToDay = (day) => {
    if (!start || !end || end <= start) {
      setError("Start must be before end.");
      return;
    }
    setError("");
    setDraft((current) => {
      const row = { weekday: day, start, end };
      if (serviceFilter.length) row.services = [...serviceFilter];
      return [...current, row].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    });
  };

  const removeBlock = (weekday, startTime, endTime) => {
    setDraft((current) => current.filter((row) => !(row.weekday === weekday && row.start === startTime && row.end === endTime)));
  };

  const markDayOff = (day) => {
    setDraft((current) => current.filter((row) => row.weekday !== day));
  };

  const copyDayToSelected = (sourceDay) => {
    const source = blocksForDay(draft, sourceDay);
    if (!source.length) {
      setError("That day has no hours to copy.");
      return;
    }
    const targets = selected.filter((day) => day !== sourceDay);
    if (!targets.length) {
      setError("Select other days to copy into.");
      return;
    }
    setError("");
    setDraft((current) => {
      const kept = current.filter((row) => !targets.includes(row.weekday));
      const copies = targets.flatMap((weekday) => source.map((row) => ({ ...row, weekday, services: row.services ? [...row.services] : undefined })));
      return [...kept, ...copies].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    });
  };

  const save = async (resolution) => {
    setBusy(true);
    setStatus("saving");
    setMessage("Saving…");
    setError("");
    try {
      const body = { weekly: draft };
      if (resolution) body.resolution = resolution;
      const result = await onSave(body);
      setDraft(cloneWeekly(result?.schedule?.weekly ?? draft));
      setStatus("success");
      setMessage("Schedule saved successfully");
      setLastSaved(formatSavedAt(result?.schedule?.updatedAt || new Date().toISOString()));
    } catch (err) {
      setStatus("error");
      setMessage("Save failed — retry");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const empty = !draft.length;

  return (
    <section className="space-y-4" data-testid="weekly-hours-editor">
      <div>
        <h2 className="text-lg font-semibold">Weekly Hours</h2>
        <p className="text-sm text-nb-mute">Edmonton local time. Select several days, apply the same hours, then save once.</p>
      </div>
      <SaveStatus status={status} message={message} lastSaved={lastSaved} testid="weekly-save-status" />
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="weekly-hours-error">{error}</p>}

      {empty && status !== "loading" && (
        <div className="rounded-3xl border border-dashed border-sky-200 bg-sky-50/50 p-4" data-testid="weekly-hours-empty">
          <p className="font-semibold">No working hours set yet</p>
          <p className="mt-1 text-sm text-nb-mute">Select weekdays below and apply a start and end time to get started.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2" data-testid="weekly-day-select">
        {WEEKDAY_LABELS.map((label, day) => (
          <button
            key={label}
            type="button"
            className={selected.includes(day) ? "nb-chip-on" : "nb-chip-off"}
            aria-pressed={selected.includes(day)}
            onClick={() => toggleDay(day)}
            data-testid={`weekly-select-${day}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-sm">Start
          <input className="nb-input" type="time" value={start} onChange={(event) => setStart(event.target.value)} data-testid="weekly-apply-start" />
        </label>
        <label className="text-sm">End
          <input className="nb-input" type="time" value={end} onChange={(event) => setEnd(event.target.value)} data-testid="weekly-apply-end" />
        </label>
        <button type="button" className="nb-btn-primary h-12 self-end" onClick={applyToSelected} data-testid="weekly-apply-selected">
          Apply to selected
        </button>
      </div>

      {services.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {services.map((service) => (
            <label key={service.slug} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={serviceFilter.includes(service.slug)}
                onChange={(event) => setServiceFilter((current) => (
                  event.target.checked ? [...current, service.slug] : current.filter((slug) => slug !== service.slug)
                ))}
              />
              {service.name} only
            </label>
          ))}
        </div>
      )}

      <div className="grid gap-3">
        {WEEKDAY_LABELS.map((label, day) => {
          const blocks = blocksForDay(draft, day);
          return (
            <article key={label} className="rounded-3xl border border-sky-100 bg-white p-4" data-testid={`weekly-day-${day}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{label}</h3>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => addBlockToDay(day)} data-testid={`weekly-add-block-${day}`}>Add block</button>
                  <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => copyDayToSelected(day)} data-testid={`weekly-copy-${day}`}>Copy to selected</button>
                  <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => markDayOff(day)} data-testid={`weekly-off-${day}`}>Off</button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!blocks.length && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Off</span>}
                {blocks.map((block) => (
                  <button
                    key={`${block.start}-${block.end}`}
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-950"
                    onClick={() => removeBlock(day, block.start, block.end)}
                    title="Remove this block"
                    data-testid={`weekly-block-${day}-${block.start}`}
                  >
                    {block.start}–{block.end}
                    {block.services?.length ? ` · ${block.services.join(", ")}` : ""}
                    <span aria-hidden>×</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {conflicts?.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4" data-testid="weekly-conflicts">
          <p className="font-semibold">These bookings stay where they are.</p>
          <ul className="mt-2 space-y-1 text-sm">{conflicts.map((row) => <li key={row.id}>{row.ref} · {row.date} {row.time}</li>)}</ul>
          <button type="button" className="nb-btn-primary mt-3 h-10" data-testid="weekly-keep" onClick={() => onKeepAppointments?.() || save("keep_appointments")}>
            Keep the bookings and save
          </button>
        </div>
      )}

      <button
        type="button"
        className="nb-btn-primary h-12 w-full sm:w-auto"
        disabled={busy || !dirty}
        onClick={() => save().catch(() => {})}
        data-testid="weekly-save"
      >
        {busy ? "Saving…" : "Save Schedule"}
      </button>
    </section>
  );
}
