import { addDays } from "@/lib/domain";
import { weekStart, shiftMonth, edmontonNow } from "@/components/ops/calendar/time";
import { cn } from "@/lib/utils";
import {
  appointmentsOnDate,
  dayAvailabilityTone,
  dayKnown,
  daySegments,
  isClinicVisit,
} from "./scheduleUtils";

const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CELL_TONE = {
  open: "bg-teal-50/70",
  partial: "bg-amber-50/80",
  blocked: "bg-slate-100/80",
  off: "",
  pending: "bg-sky-50/50",
};

export function MonthOverview({ cursor, appointments, days, onPickDay }) {
  const first = weekStart(`${cursor.slice(0, 8)}01`);
  const lastDay = addDays(shiftMonth(cursor, 1), -1);
  const weeks = Math.ceil((Math.round((new Date(`${lastDay}T12:00:00`) - new Date(`${first}T12:00:00`)) / 86400000) + 1) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
  const today = edmontonNow().date;
  const month = cursor.slice(0, 7);

  return (
    <div className="nb-panel p-2 sm:p-3" data-testid="schedule-month-overview">
      <div className="grid grid-cols-7 gap-1">
        {NAMES.map((n) => (
          <p key={n} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-nb-mute">
            <span className="sm:hidden">{n[0]}</span>
            <span className="hidden sm:inline">{n}</span>
          </p>
        ))}
        {cells.map((date) => {
          const visits = appointmentsOnDate(appointments, date);
          const known = dayKnown(days, date);
          const tone = dayAvailabilityTone(daySegments(days, date), { known });
          const selected = date === cursor;
          const outside = date.slice(0, 7) !== month;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPickDay(date)}
              aria-label={`${date}, ${visits.length} appointments`}
              aria-current={date === today ? "date" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center rounded-xl p-1 transition-colors sm:min-h-[4.75rem]",
                !selected && CELL_TONE[tone],
                selected ? "bg-sky-50 ring-2 ring-nb-blue/40" : "hover:bg-sky-50/60",
                outside && "opacity-40"
              )}
              data-testid={`schedule-month-${date}`}
            >
              <span className={cn("grid h-7 w-7 place-items-center rounded-full text-xs font-semibold", date === today && "bg-nb-blue text-white")}>
                {Number(date.slice(-2))}
              </span>
              <span className="mt-1 flex min-h-[0.375rem] items-center gap-0.5">
                {visits.slice(0, 3).map((appt) => (
                  <span
                    key={appt.id}
                    className={cn("h-1.5 w-1.5 rounded-full", isClinicVisit(appt) ? "bg-nb-blue" : "bg-nb-teal")}
                    aria-hidden="true"
                  />
                ))}
                {tone === "partial" && visits.length === 0 && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                )}
              </span>
              {visits.length > 0 && (
                <span className="mt-0.5 hidden text-[10px] font-semibold text-nb-mute sm:block">
                  {visits.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
