import { ChevronLeft, ChevronRight } from "lucide-react";
import { Segmented } from "@/components/ds";
import { addDays, fmtDate, todayISO } from "@/lib/domain";
import { weekStart } from "@/components/ops/calendar/time";
import { CALENDAR_VIEWS } from "./scheduleUtils";

function rangeLabel(view, cursor) {
  if (view === "day") return fmtDate(cursor, { weekday: "long", month: "short", day: "numeric" });
  if (view === "month") return fmtDate(cursor, { month: "long", year: "numeric" });
  const start = weekStart(cursor);
  const end = addDays(start, 6);
  return `${fmtDate(start, { month: "short", day: "numeric" })} – ${fmtDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function CalendarToolbar({ view, onView, cursor, onStep, onToday }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="calendar-toolbar">
      <Segmented options={CALENDAR_VIEWS} value={view} onChange={onView} testid="availability-view" label="Calendar view" />
      <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
        <button type="button" className="nb-btn-ghost h-10 w-10 shrink-0 px-0" aria-label="Previous" onClick={() => onStep(-1)} data-testid="schedule-prev">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 truncate text-center text-sm font-semibold text-nb-ink" aria-live="polite" data-testid="schedule-range-label">
          {rangeLabel(view, cursor)}
        </p>
        <button type="button" className="nb-btn-ghost h-10 w-10 shrink-0 px-0" aria-label="Next" onClick={() => onStep(1)} data-testid="schedule-next">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="nb-btn-ghost h-10 shrink-0 px-3 text-sm"
          onClick={onToday}
          disabled={cursor === todayISO()}
          data-testid="schedule-today"
        >
          Today
        </button>
      </div>
    </div>
  );
}
