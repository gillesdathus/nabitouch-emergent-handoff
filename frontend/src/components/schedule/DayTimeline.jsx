import { Clock3 } from "lucide-react";
import { EmptyState } from "@/components/ds";
import { CalendarX2 } from "lucide-react";
import { fmtTime } from "@/lib/domain";
import { AppointmentCard } from "./AppointmentCard";
import { appointmentsOnDate, daySegments, timeRangeLabel, workingWindow } from "./scheduleUtils";

function blockItems(segments) {
  return (segments || [])
    .filter((s) => s.state === "blocked" || s.state === "unavailable")
    .map((s) => ({
      id: `seg-${s.state}-${s.start}-${s.end}`,
      kind: s.state === "blocked" ? "break" : "unavailable",
      state: s.state,
      start: s.start,
      end: s.end,
      title: s.state === "blocked" ? "Break" : "Unavailable",
    }));
}

export function DayTimeline({
  date,
  appointments,
  days,
  serviceName,
  onOpen,
  onQuickAvailability,
}) {
  const segments = daySegments(days, date);
  const window = workingWindow(segments);
  const visits = appointmentsOnDate(appointments, date);
  const blocks = blockItems(segments);
  const timeline = [...visits, ...blocks].sort((a, b) => String(a.time || a.start).localeCompare(String(b.time || b.start)));

  return (
    <section className="space-y-4" data-testid="schedule-day-timeline">
      <div className="rounded-2xl bg-teal-50/80 p-4 ring-1 ring-teal-100" data-testid="schedule-availability-banner">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-teal-900">
            <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {window ? (
              <p className="text-sm font-semibold">
                Available {timeRangeLabel(window.start, window.end)}
              </p>
            ) : (
              <p className="text-sm font-semibold">Not working this day</p>
            )}
          </div>
          {onQuickAvailability && (
            <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={onQuickAvailability} data-testid="schedule-quick-hours">
              Change hours
            </button>
          )}
        </div>
        {segments.filter((s) => s.state === "available").length > 1 && (
          <p className="mt-2 line-clamp-2 text-xs text-teal-800/80">
            {segments.filter((s) => s.state === "available").length} open windows
            <span className="hidden sm:inline">
              : {segments.filter((s) => s.state === "available").map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)}`).join(", ")}
            </span>
          </p>
        )}
      </div>

      {timeline.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="No appointments today"
          body="Your day is clear. Use quick actions to adjust hours, add a break, or take time off."
          testid="schedule-day-empty"
          action={onQuickAvailability && (
            <button type="button" className="nb-btn-primary h-10 px-4 text-sm" onClick={onQuickAvailability}>
              Set hours for this day
            </button>
          )}
        />
      ) : (
        <ul className="space-y-3">
          {timeline.map((item) => (
            <li key={item.id || `${item.start}-${item.end}-${item.kind}`}>
              <AppointmentCard
                item={item}
                serviceName={item.serviceSlug ? serviceName(item) : undefined}
                onOpen={item.serviceSlug || item.clientId ? () => onOpen?.(item.id) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
