import { useEffect, useState } from "react";
import { Clock3, Coffee, CalendarOff, CalendarRange, SlidersHorizontal } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { StickyActionBar } from "@/components/StickyActionBar";

export const SCHEDULE_ACTIONS = [
  { id: "hours", label: "Change hours", hint: "Today only", icon: Clock3 },
  { id: "break", label: "Add a break", hint: "Block time", icon: Coffee },
  { id: "off", label: "Take time off", hint: "Day or partial", icon: CalendarOff },
  { id: "weekly", label: "Weekly hours", hint: "Recurring", icon: CalendarRange },
];

function useCompactActions() {
  const query = "(max-width: 767px)";
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return compact;
}

function ActionGrid({ onOpen, className = "" }) {
  return (
    <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${className}`.trim()}>
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
  );
}

export function ScheduleQuickActions({ onOpen, hidden = false }) {
  const compact = useCompactActions();
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (hidden) setPickerOpen(false);
  }, [hidden]);

  const openAction = (id) => {
    setPickerOpen(false);
    onOpen(id);
  };

  if (hidden) return null;

  if (!compact) {
    return (
      <section className="pb-2" data-testid="schedule-quick-actions">
        <h2 className="mb-3 text-base font-semibold text-nb-ink">Quick actions</h2>
        <ActionGrid onOpen={onOpen} />
      </section>
    );
  }

  return (
    <section data-testid="schedule-quick-actions">
      <StickyActionBar testid="schedule-adjust-actions" liftAt="md">
        <button
          type="button"
          className="nb-btn-primary h-12 w-full"
          data-testid="schedule-adjust"
          onClick={() => setPickerOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Adjust schedule
        </button>
      </StickyActionBar>

      <Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
        <DrawerContent className="mx-auto max-h-[85dvh] max-w-lg rounded-t-[28px] bg-nb-canvas" data-testid="schedule-action-picker">
          <div className="px-5 pb-[calc(1.25rem+var(--nb-safe-b))] pt-1">
            <DrawerHeader className="px-0 text-left">
              <DrawerTitle>Adjust schedule</DrawerTitle>
              <DrawerDescription>Choose one change. Existing bookings are never moved from here.</DrawerDescription>
            </DrawerHeader>
            <ActionGrid onOpen={openAction} className="pb-2" />
          </div>
        </DrawerContent>
      </Drawer>
    </section>
  );
}
