import { Clock3, Coffee, CalendarOff, CalendarRange } from "lucide-react";

export const SCHEDULE_ACTIONS = [
  { id: "hours", label: "Change hours", hint: "Today only", icon: Clock3 },
  { id: "break", label: "Add a break", hint: "Block time", icon: Coffee },
  { id: "off", label: "Take time off", hint: "Day or partial", icon: CalendarOff },
  { id: "weekly", label: "Weekly hours", hint: "Recurring", icon: CalendarRange },
];

export function ScheduleQuickActions({ onOpen }) {
  return (
    <section className="pb-2" data-testid="schedule-quick-actions">
      <h2 className="mb-3 text-base font-semibold text-nb-ink">Quick actions</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SCHEDULE_ACTIONS.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            className="flex min-h-[5.5rem] flex-col items-start justify-center gap-2 rounded-2xl border border-sky-100 bg-white p-4 text-left transition hover:border-nb-blue/40 hover:shadow-sm active:scale-[0.99]"
            data-testid={`schedule-action-${id}`}
          >
            <Icon className="h-5 w-5 text-nb-blue" aria-hidden="true" />
            <span className="text-sm font-semibold text-nb-ink">{label}</span>
            <span className="text-[11px] text-nb-mute">{hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
