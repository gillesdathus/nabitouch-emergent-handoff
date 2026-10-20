import { cn } from "@/lib/utils";

export function ScheduleHeader({
  practitionerName,
  acceptingBookings,
  scheduleStatus,
  onToggleBookings,
  ownerControls,
}) {
  const accepting = acceptingBookings === true;
  return (
    <header className="flex min-w-0 flex-col gap-3" data-testid="schedule-header">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-nb-ink sm:text-3xl">My Schedule</h1>
        {practitionerName && (
          <p className="mt-1 truncate text-sm text-nb-mute" data-testid="schedule-practitioner-context">
            {practitionerName}
            {scheduleStatus ? ` · ${scheduleStatus === "approved" ? "Approved" : "Awaiting approval"}` : ""}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
            accepting ? "bg-teal-50 text-teal-900 ring-1 ring-teal-100" : "bg-amber-50 text-amber-950 ring-1 ring-amber-100"
          )}
          data-testid="availability-status"
        >
          <span className={cn("h-2 w-2 rounded-full", accepting ? "bg-nb-teal" : "bg-amber-500")} aria-hidden="true" />
          {accepting ? "Accepting bookings" : "Not accepting bookings"}
        </span>
        {onToggleBookings && (
          <button
            type="button"
            className="nb-btn-ghost h-10 px-3 text-sm"
            onClick={onToggleBookings}
            data-testid="availability-pause"
          >
            {accepting ? "Pause bookings" : "Resume bookings"}
          </button>
        )}
      </div>
      {ownerControls}
    </header>
  );
}
