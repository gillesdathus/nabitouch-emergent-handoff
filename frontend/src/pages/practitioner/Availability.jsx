import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { StickyActionBar } from "@/components/StickyActionBar";
import { ErrorState } from "@/components/ds";
import { ScheduleHeader } from "@/components/schedule/ScheduleHeader";
import { CalendarToolbar } from "@/components/schedule/CalendarToolbar";
import { ScheduleCalendar } from "@/components/schedule/ScheduleCalendar";
import { ScheduleQuickActions } from "@/components/schedule/ScheduleQuickActions";
import { ScheduleEditor } from "@/components/schedule/ScheduleEditor";
import {
  daySegments,
  rangeForView,
  stepCursor,
  workingWindow,
} from "@/components/schedule/scheduleUtils";
import { useDemo } from "@/store/DemoStore";
import { todayISO } from "@/lib/domain";

function usePreferDayView() {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export default function Availability({ mode = "pro" }) {
  const { state, api, user, practitionerId, idx } = useDemo();
  const people = state.practitioners || [];
  const mobile = usePreferDayView();
  const [personId, setPersonId] = useState(mode === "pro" ? practitionerId : people[0]?.id || "");
  const [cursor, setCursor] = useState(todayISO());
  const [view, setView] = useState(mobile ? "day" : "week");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState(null);
  const [pending, setPending] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  /** Local-only preview overlays — never presented as booking-engine saves. */
  const [localPreview, setLocalPreview] = useState({ note: "", at: null });

  useEffect(() => {
    setView((current) => {
      if (mobile && current === "week") return "day";
      return current;
    });
  }, [mobile]);

  useEffect(() => {
    if (mode === "pro" && practitionerId) setPersonId(practitionerId);
  }, [mode, practitionerId]);

  const range = useMemo(() => rangeForView(view, cursor), [view, cursor]);

  const load = () => {
    if (!personId) return;
    setLoading(true);
    setError("");
    api.schedule(personId, { start: range[0], end: range[1] })
      .then(setPayload)
      .catch((err) => {
        setError(err?.response?.data?.detail || "The schedule could not be loaded.");
        // Keep the prior payload so week/month do not flash every day as Off.
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [personId, range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body, retry) => {
    setError("");
    setSaving(true);
    try {
      if (body.weekly) await api.saveWeekly(personId, body);
      else await api.addException(personId, body);
      setConflicts(null);
      setPending(null);
      setEditor(null);
      setLocalPreview({ note: "", at: null });
      toast.success("Schedule updated");
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
      const text = [message, gapText].filter(Boolean).join(" ") || "The schedule was not changed.";
      setError(text);
      toast.error(text);
    } finally {
      setSaving(false);
    }
  };

  const schedule = payload?.schedule;
  const person = people.find((row) => row.id === personId);
  const appointments = useMemo(
    () => (state.appointments || []).filter((item) => !personId || item.practitionerId === personId),
    [state.appointments, personId]
  );
  const serviceName = (appt) => idx?.services?.[appt.serviceSlug]?.name || appt.serviceSlug;
  const hoursDefaults = workingWindow(daySegments(payload?.days, cursor));

  const pickDay = (date) => {
    setCursor(date);
    setView("day");
  };

  const onChangeHours = ({ start, end }) => send({
    kind: "open",
    startDate: cursor,
    endDate: cursor,
    start,
    end,
    ownerOverride: user?.role === "owner",
  });

  const onAddBreaks = async (rows) => {
    setSaving(true);
    setError("");
    try {
      for (const row of rows) {
        await api.addException(personId, {
          kind: "break",
          startDate: cursor,
          endDate: cursor,
          start: row.start,
          end: row.end,
        });
      }
      setEditor(null);
      toast.success(rows.length > 1 ? "Breaks saved" : "Break saved");
      load();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.conflicts) {
        setConflicts(detail.conflicts);
        setPending({ kind: "break", startDate: cursor, endDate: cursor, start: rows[0]?.start, end: rows[0]?.end });
        return;
      }
      const text = (typeof detail === "string" ? detail : detail?.message) || "The break was not saved.";
      setError(text);
      toast.error(text);
    } finally {
      setSaving(false);
    }
  };

  const onTimeOff = ({ mode: offMode, start, end, conflicts: localConflicts }) => {
    if (localConflicts?.length) {
      setConflicts(localConflicts.map((row) => ({ id: row.id, ref: row.ref, date: row.date, time: row.time })));
      setPending({
        kind: "closed",
        startDate: cursor,
        endDate: cursor,
        start: offMode === "partial" ? start : undefined,
        end: offMode === "partial" ? end : undefined,
        resolution: "keep_appointments",
      });
      return;
    }
    send({
      kind: "closed",
      startDate: cursor,
      endDate: cursor,
      start: offMode === "partial" ? start : undefined,
      end: offMode === "partial" ? end : undefined,
    });
  };

  const onWeeklyHours = ({ weekly }) => send({ weekly });

  const needsApprove = mode === "owner" && user?.role === "owner" && Boolean(schedule?.status) && schedule.status !== "approved";
  const dockBusy = Boolean(editor || conflicts);

  const approveSchedule = async () => {
    try {
      await api.approveSchedule(personId);
      toast.success("Schedule approved");
      load();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const message = typeof detail === "string" ? detail : detail?.message;
      const gapText = Array.isArray(detail?.gaps) ? detail.gaps.map((gap) => `${gap.label}: ${gap.status}`).join(" ") : "";
      toast.error([message, gapText].filter(Boolean).join(" ") || "Approval was not saved.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" data-testid="availability-page">
      <ScheduleHeader
        practitionerName={person?.name || (mode === "pro" ? user?.name : "")}
        acceptingBookings={schedule?.acceptingBookings}
        scheduleStatus={schedule?.status}
        onToggleBookings={async () => {
          try {
            await api.pauseBookings(personId, !schedule?.acceptingBookings);
            toast.success(schedule?.acceptingBookings ? "New bookings paused" : "Now accepting bookings");
            load();
          } catch (err) {
            toast.error(err?.response?.data?.detail || "Booking status was not changed.");
          }
        }}
        ownerControls={mode === "owner" && (
          <div className="flex w-full min-w-0 flex-wrap items-end gap-3">
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="nb-label">Practitioner</span>
              <select className="nb-input" value={personId} onChange={(event) => setPersonId(event.target.value)} data-testid="availability-practitioner">
                {people.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}{row.onboardingStatus === "draft" ? " · draft" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      />

      <CalendarToolbar
        view={view}
        onView={setView}
        cursor={cursor}
        onStep={(dir) => setCursor(stepCursor(view, cursor, dir))}
        onToday={() => setCursor(todayISO())}
      />

      {error && (
        <ErrorState message={error} onRetry={load} testid="availability-error" />
      )}

      {localPreview.note && (
        <p className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="schedule-local-preview">
          Preview only — not saved to the booking system. {localPreview.note}
        </p>
      )}

      {loading && !payload ? (
        <div className="nb-panel p-8 text-center text-sm text-nb-mute" data-testid="schedule-loading">Loading schedule…</div>
      ) : (
        <div className={loading ? "opacity-70 transition-opacity" : undefined} aria-busy={loading || undefined}>
          <ScheduleCalendar
            view={view}
            cursor={cursor}
            appointments={appointments}
            days={payload?.days || []}
            serviceName={serviceName}
            onOpen={setOpenId}
            onPickDay={pickDay}
            onQuickAvailability={() => setEditor("hours")}
          />
        </div>
      )}

      <ScheduleQuickActions onOpen={setEditor} hidden={dockBusy || needsApprove} />

      {needsApprove && !dockBusy && (
        <StickyActionBar testid="availability-approve-actions" liftAt="md">
          <button type="button" className="nb-btn-primary h-12 w-full" data-testid="availability-approve" onClick={approveSchedule}>
            Approve schedule
          </button>
        </StickyActionBar>
      )}

      {conflicts && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4" data-testid="availability-conflicts">
          <p className="font-semibold">These bookings stay where they are.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {conflicts.map((row) => (
              <li key={row.id}>{row.ref} · {row.date || cursor} {row.time}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-nb-mute">Closing open time does not cancel or move a client. Confirm only if existing visits should remain booked.</p>
          <StickyActionBar testid="availability-conflict-actions" liftAt="md" stacked>
            <button
              type="button"
              className="nb-btn-ghost h-12 w-full"
              data-testid="availability-conflict-cancel"
              onClick={() => { setConflicts(null); setPending(null); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="nb-btn-primary h-12 w-full"
              data-testid="availability-keep"
              onClick={() => send({ ...pending, resolution: "keep_appointments" }, pending)}
            >
              Keep the bookings and save
            </button>
          </StickyActionBar>
        </div>
      )}

      {openId && (
        <AppointmentSheet
          apptId={openId}
          role={mode === "owner" ? "owner" : "pro"}
          onClose={() => setOpenId(null)}
        />
      )}

      <ScheduleEditor
        editor={editor}
        onClose={() => setEditor(null)}
        date={cursor}
        schedule={schedule}
        appointments={appointments}
        hoursDefaults={hoursDefaults}
        onChangeHours={onChangeHours}
        onAddBreaks={onAddBreaks}
        onTimeOff={onTimeOff}
        onWeeklyHours={onWeeklyHours}
        saving={saving}
      />
    </div>
  );
}
