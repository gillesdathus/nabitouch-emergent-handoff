import { Building2, CarFront } from "lucide-react";
import { addDays, fmtDate } from "@/lib/domain";
import { weekStart } from "@/components/ops/calendar/time";
import { cn } from "@/lib/utils";
import {
  appointmentsOnDate,
  dayAvailabilityTone,
  dayKnown,
  daySegments,
  isClinicVisit,
  workingWindow,
  timeRangeLabel,
} from "./scheduleUtils";

const TONE = {
  open: "bg-teal-50 text-teal-900 ring-teal-100",
  partial: "bg-amber-50 text-amber-950 ring-amber-100",
  blocked: "bg-slate-100 text-slate-600 ring-slate-200",
  off: "bg-slate-50 text-slate-500 ring-slate-200",
  pending: "bg-sky-50 text-nb-mute ring-sky-100",
};

const TONE_LABEL = {
  open: "Available",
  partial: "Partial",
  blocked: "Blocked",
  off: "Off",
  pending: "…",
};

export function WeekOverview({ cursor, appointments, days, onPickDay }) {
  const start = weekStart(cursor);
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7" data-testid="schedule-week-overview">
      {week.map((date) => {
        const known = dayKnown(days, date);
        const segs = daySegments(days, date);
        const tone = dayAvailabilityTone(segs, { known });
        const window = known ? workingWindow(segs) : null;
        const visits = appointmentsOnDate(appointments, date);
        const selected = date === cursor;
        return (
          <button
            key={date}
            type="button"
            onClick={() => onPickDay(date)}
            className={cn(
              "flex min-h-[7.5rem] flex-col rounded-2xl border border-sky-100 bg-white p-3 text-left transition-[box-shadow,transform] hover:shadow-md active:scale-[0.99]",
              selected && "ring-2 ring-nb-blue/40"
            )}
            data-testid={`schedule-week-day-${date}`}
            aria-label={`${fmtDate(date, { weekday: "long", month: "short", day: "numeric" })}, ${visits.length} appointments, ${TONE_LABEL[tone]}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-nb-mute">
                {fmtDate(date, { weekday: "short" })}
              </span>
              <span className="nb-num text-lg font-semibold text-nb-ink">{Number(date.slice(-2))}</span>
            </div>
            <span className={cn("mt-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", TONE[tone])}>
              {TONE_LABEL[tone]}
            </span>
            <p className="mt-2 text-[11px] text-nb-mute">
              {!known ? "Updating…" : window ? timeRangeLabel(window.start, window.end) : "No working hours"}
            </p>
            <div className="mt-auto flex flex-wrap gap-1 pt-3">
              {visits.slice(0, 4).map((appt) => {
                const clinic = isClinicVisit(appt);
                const Icon = clinic ? Building2 : CarFront;
                return (
                  <span
                    key={appt.id}
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-md ring-1",
                      clinic ? "bg-blue-50 text-nb-blue ring-blue-100" : "bg-teal-50 text-nb-teal ring-teal-100"
                    )}
                    title={`${appt.time} ${clinic ? "Clinic" : "Mobile"}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                );
              })}
              {visits.length > 4 && (
                <span className="text-[11px] font-semibold text-nb-blue">+{visits.length - 4}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
