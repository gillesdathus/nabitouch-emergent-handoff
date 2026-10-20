import { DayTimeline } from "./DayTimeline";
import { WeekOverview } from "./WeekOverview";
import { MonthOverview } from "./MonthOverview";

export function ScheduleCalendar({
  view,
  cursor,
  appointments,
  days,
  serviceName,
  onOpen,
  onPickDay,
  onQuickAvailability,
}) {
  return (
    <div className="nb-panel overflow-hidden" data-testid="schedule-calendar">
      <div className="nb-panel-body space-y-4">
        {view === "day" && (
          <DayTimeline
            date={cursor}
            appointments={appointments}
            days={days}
            serviceName={serviceName}
            onOpen={onOpen}
            onQuickAvailability={onQuickAvailability}
          />
        )}
        {view === "week" && (
          <WeekOverview
            cursor={cursor}
            appointments={appointments}
            days={days}
            onPickDay={onPickDay}
          />
        )}
        {view === "month" && (
          <MonthOverview
            cursor={cursor}
            appointments={appointments}
            days={days}
            onPickDay={onPickDay}
          />
        )}
      </div>
    </div>
  );
}
