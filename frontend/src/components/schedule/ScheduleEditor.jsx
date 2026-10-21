import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { fmtDate, fmtTime } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { SCHEDULE_ACTIONS } from "./ScheduleQuickActions";
import {
  conflictingAppointments,
  validateTimeRange,
  WEEKDAY_LABELS,
  weeklyDefaults,
} from "./scheduleUtils";

function useDesktopEditor() {
  const query = "(min-width: 768px)";
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

function EditorShell({ open, onClose, title, description, children, footer, testid }) {
  const desktop = useDesktopEditor();
  if (!open) return null;

  if (desktop) {
    return (
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-lg" data-testid={testid}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-4 py-1">{children}</div>
          {footer && <DialogFooter className="gap-2 sm:gap-2" data-testid={`${testid}-actions`}>{footer}</DialogFooter>}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open onOpenChange={(next) => !next && onClose()}>
      <DrawerContent className="mx-auto flex max-h-[92dvh] max-w-lg flex-col rounded-t-[28px] bg-nb-canvas" data-testid={testid}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1">
          <DrawerHeader className="px-0 text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <div className="space-y-4 pb-2">{children}</div>
        </div>
        {footer && (
          <DrawerFooter
            className="mt-0 shrink-0 gap-2 border-t border-sky-100 bg-nb-canvas px-5 pb-[calc(1.25rem+var(--nb-safe-b))] pt-3"
            data-testid={`${testid}-actions`}
          >
            {footer}
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function FooterButtons({ onCancel, onSave, saveLabel = "Save", disabled, saving, testid, secondaryLabel, onSecondary }) {
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
      {onSecondary && (
        <button type="button" className="nb-btn-ghost h-12 w-full sm:w-auto" onClick={onSecondary} disabled={saving} data-testid={`${testid}-back`}>
          {secondaryLabel || "Back"}
        </button>
      )}
      <button type="button" className="nb-btn-ghost h-12 w-full sm:w-auto" onClick={onCancel} disabled={saving} data-testid={`${testid}-cancel`}>
        Cancel
      </button>
      <button type="button" className="nb-btn-primary h-12 w-full sm:w-auto" onClick={onSave} disabled={disabled || saving} data-testid={`${testid}-save`}>
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}

function ChangeHoursSheet({ open, onClose, date, initialStart, initialEnd, onSave, saving }) {
  const [start, setStart] = useState(initialStart || "09:00");
  const [end, setEnd] = useState(initialEnd || "17:00");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStart(initialStart || "09:00");
    setEnd(initialEnd || "17:00");
    setError("");
    setDirty(false);
  }, [open, initialStart, initialEnd]);

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved hour changes?")) return;
    onClose();
  };

  const save = () => {
    const message = validateTimeRange(start, end);
    if (message) { setError(message); return; }
    onSave({ start, end });
  };

  return (
    <EditorShell
      open={open}
      onClose={close}
      title="Change hours"
      description={`Applies to ${fmtDate(date, { weekday: "long", month: "short", day: "numeric" })} only.`}
      testid="schedule-editor-hours"
      footer={<FooterButtons onCancel={close} onSave={save} saving={saving} disabled={!start || !end} testid="schedule-editor-hours" />}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="nb-label">Start</span>
          <input type="time" className="nb-input" value={start} onChange={(e) => { setStart(e.target.value); setDirty(true); setError(""); }} data-testid="hours-start" />
        </label>
        <label className="text-sm">
          <span className="nb-label">End</span>
          <input type="time" className="nb-input" value={end} onChange={(e) => { setEnd(e.target.value); setDirty(true); setError(""); }} data-testid="hours-end" />
        </label>
      </div>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
    </EditorShell>
  );
}

function AddBreakSheet({ open, onClose, date, onSave, saving }) {
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [breaks, setBreaks] = useState([]);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStart("12:00");
    setEnd("13:00");
    setBreaks([]);
    setError("");
    setDirty(false);
  }, [open]);

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved breaks?")) return;
    onClose();
  };

  const addLocal = () => {
    const message = validateTimeRange(start, end);
    if (message) { setError(message); return; }
    setBreaks((list) => [...list, { start, end }]);
    setDirty(true);
    setError("");
  };

  const save = () => {
    const pending = [...breaks];
    if (!pending.length) {
      const message = validateTimeRange(start, end);
      if (message) { setError(message); return; }
      pending.push({ start, end });
    }
    onSave(pending);
  };

  return (
    <EditorShell
      open={open}
      onClose={close}
      title="Add a break"
      description={`Blocked time on ${fmtDate(date, { weekday: "short", month: "short", day: "numeric" })}.`}
      testid="schedule-editor-break"
      footer={<FooterButtons onCancel={close} onSave={save} saving={saving} saveLabel="Save break" testid="schedule-editor-break" />}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="nb-label">Start</span>
          <input type="time" className="nb-input" value={start} onChange={(e) => { setStart(e.target.value); setDirty(true); setError(""); }} data-testid="break-start" />
        </label>
        <label className="text-sm">
          <span className="nb-label">End</span>
          <input type="time" className="nb-input" value={end} onChange={(e) => { setEnd(e.target.value); setDirty(true); setError(""); }} data-testid="break-end" />
        </label>
      </div>
      <button type="button" className="nb-btn-ghost h-10 w-full text-sm" onClick={addLocal} data-testid="break-add-another">
        Add another break
      </button>
      {breaks.length > 0 && (
        <ul className="space-y-2" data-testid="break-preview-list">
          {breaks.map((row, index) => (
            <li key={`${row.start}-${row.end}-${index}`} className="rounded-2xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
              Break {fmtTime(row.start)} – {fmtTime(row.end)}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
    </EditorShell>
  );
}

function TimeOffSheet({ open, onClose, date, appointments, onSave, saving }) {
  const [mode, setMode] = useState("full");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("full");
    setStart("09:00");
    setEnd("17:00");
    setError("");
    setDirty(false);
  }, [open]);

  const conflicts = useMemo(
    () => conflictingAppointments(appointments, date, start, end, mode === "full"),
    [appointments, date, start, end, mode]
  );

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved time off?")) return;
    onClose();
  };

  const save = () => {
    if (mode === "partial") {
      const message = validateTimeRange(start, end);
      if (message) { setError(message); return; }
    }
    onSave({ mode, start, end, conflicts });
  };

  return (
    <EditorShell
      open={open}
      onClose={close}
      title="Take time off"
      description="Existing bookings are never cancelled from this screen."
      testid="schedule-editor-off"
      footer={<FooterButtons onCancel={close} onSave={save} saving={saving} saveLabel={conflicts.length ? "Keep bookings & save" : "Save time off"} testid="schedule-editor-off" />}
    >
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Time off type">
        {[["full", "Full day"], ["partial", "Partial day"]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => { setMode(id); setDirty(true); }}
            className={cn("h-11 rounded-2xl text-sm font-semibold ring-1", mode === id ? "bg-nb-ink text-white ring-nb-ink" : "bg-white text-nb-ink ring-sky-100")}
            data-testid={`timeoff-mode-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "partial" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="nb-label">Start</span>
            <input type="time" className="nb-input" value={start} onChange={(e) => { setStart(e.target.value); setDirty(true); setError(""); }} data-testid="timeoff-start" />
          </label>
          <label className="text-sm">
            <span className="nb-label">End</span>
            <input type="time" className="nb-input" value={end} onChange={(e) => { setEnd(e.target.value); setDirty(true); setError(""); }} data-testid="timeoff-end" />
          </label>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3" data-testid="timeoff-conflicts">
          <p className="text-sm font-semibold text-amber-950">These bookings stay where they are</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {conflicts.map((row) => (
              <li key={row.id}>{row.ref || row.id} · {fmtTime(row.time)} · {row.duration || 60} min</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">Closing availability does not cancel or move a client.</p>
        </div>
      )}
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
    </EditorShell>
  );
}

function WeeklyHoursSheet({ open, onClose, schedule, onSave, saving }) {
  const [days, setDays] = useState(() => weeklyDefaults(schedule));
  const [phase, setPhase] = useState("days");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDays(weeklyDefaults(schedule));
    setPhase("days");
    setError("");
    setDirty(false);
  }, [open, schedule]);

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved weekly hours?")) return;
    onClose();
  };

  const patchDay = (weekday, next) => {
    setDays((current) => ({ ...current, [weekday]: { ...current[weekday], ...next } }));
    setDirty(true);
    setError("");
  };

  const workingDays = WEEKDAY_LABELS
    .map((label, weekday) => ({ label, weekday, row: days[weekday] || { on: false, start: "09:00", end: "17:00" } }))
    .filter((item) => item.row.on);

  const save = () => {
    const weekly = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const row = days[weekday];
      if (!row?.on) continue;
      const message = validateTimeRange(row.start, row.end);
      if (message) {
        setError(`${WEEKDAY_LABELS[weekday]}: ${message}`);
        return;
      }
      weekly.push({ weekday, start: row.start, end: row.end });
    }
    onSave({ weekly });
  };

  const footer = phase === "days"
    ? (
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="nb-btn-ghost h-12 w-full sm:w-auto" onClick={close} data-testid="schedule-editor-weekly-cancel">
          Cancel
        </button>
        <button type="button" className="nb-btn-primary h-12 w-full sm:w-auto" onClick={() => setPhase("hours")} data-testid="schedule-editor-weekly-continue">
          Set hours
        </button>
      </div>
    )
    : (
      <FooterButtons
        onCancel={close}
        onSecondary={() => setPhase("days")}
        secondaryLabel="Back"
        onSave={save}
        saving={saving}
        saveLabel="Save weekly hours"
        testid="schedule-editor-weekly"
      />
    );

  return (
    <EditorShell
      open={open}
      onClose={close}
      title="Weekly hours"
      description={phase === "days" ? "Which days do you work? Date exceptions stay separate." : "Set start and end for each working day."}
      testid="schedule-editor-weekly"
      footer={footer}
    >
      {phase === "days" ? (
        <ul className="space-y-2" data-testid="weekly-days-phase">
          {WEEKDAY_LABELS.map((label, weekday) => {
            const row = days[weekday] || { on: false, start: "09:00", end: "17:00" };
            return (
              <li key={label} className="rounded-2xl border border-sky-100 bg-white p-3">
                <label className="flex items-center justify-between gap-3 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.on}
                      onChange={(e) => patchDay(weekday, { on: e.target.checked })}
                      data-testid={`weekly-day-${weekday}`}
                    />
                    {label}
                  </span>
                  <span className="text-[11px] font-normal text-nb-mute">{row.on ? "Working" : "Off"}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="space-y-2" data-testid="weekly-hours-phase">
          {workingDays.length === 0 && (
            <li className="rounded-2xl bg-sky-50 p-4 text-sm text-nb-mute">No working days selected. Go back to choose days, or save an empty week.</li>
          )}
          {workingDays.map(({ label, weekday, row }) => (
            <li key={label} className="rounded-2xl border border-sky-100 bg-white p-3">
              <p className="mb-2 text-sm font-semibold">{label}</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="time" className="nb-input h-11" value={row.start} onChange={(e) => patchDay(weekday, { start: e.target.value })} aria-label={`${label} start`} data-testid={`weekly-start-${weekday}`} />
                <input type="time" className="nb-input h-11" value={row.end} onChange={(e) => patchDay(weekday, { end: e.target.value })} aria-label={`${label} end`} data-testid={`weekly-end-${weekday}`} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
    </EditorShell>
  );
}

export function ScheduleEditor({
  editor,
  onClose,
  date,
  schedule,
  appointments,
  hoursDefaults,
  onChangeHours,
  onAddBreaks,
  onTimeOff,
  onWeeklyHours,
  saving,
}) {
  const meta = SCHEDULE_ACTIONS.find((row) => row.id === editor);
  if (!meta) return null;

  return (
    <>
      <ChangeHoursSheet
        open={editor === "hours"}
        onClose={onClose}
        date={date}
        initialStart={hoursDefaults?.start}
        initialEnd={hoursDefaults?.end}
        onSave={onChangeHours}
        saving={saving}
      />
      <AddBreakSheet
        open={editor === "break"}
        onClose={onClose}
        date={date}
        onSave={onAddBreaks}
        saving={saving}
      />
      <TimeOffSheet
        open={editor === "off"}
        onClose={onClose}
        date={date}
        appointments={appointments}
        onSave={onTimeOff}
        saving={saving}
      />
      <WeeklyHoursSheet
        open={editor === "weekly"}
        onClose={onClose}
        schedule={schedule}
        onSave={onWeeklyHours}
        saving={saving}
      />
    </>
  );
}
