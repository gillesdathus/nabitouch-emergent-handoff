import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { fmtDate, fmtTime, todayISO } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { edmontonNow, fromMin } from "@/components/ops/calendar/time";

const GROUPS = [["Morning", 7 * 60, 12 * 60], ["Afternoon", 12 * 60, 17 * 60], ["Evening", 17 * 60, 21 * 60]];

export function RescheduleSheet({ appt, label, onPick, onClose, cta = "Review move to" }) {
  const [date, setDate] = useState(appt.date >= todayISO() ? appt.date : todayISO());
  const [time, setTime] = useState(appt.time);
  const now = edmontonNow();
  const times = useMemo(() => GROUPS.map(([name, a, b]) => [name, Array.from({ length: (b - a) / 15 }, (_, i) => fromMin(a + i * 15)).filter((t) => date > now.date || t > now.time)]), [date, now.date, now.time]);
  const offered = times.some(([, list]) => list.includes(time));
  const changed = offered && (date !== appt.date || time !== appt.time);
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-lg rounded-t-[28px] bg-nb-canvas" data-testid="reschedule-sheet">
        <div className="overflow-y-auto px-5 pb-[calc(1.5rem+var(--nb-safe-b))] pt-2">
          <DrawerTitle className="flex items-center gap-2 text-lg"><CalendarClock className="h-5 w-5 text-nb-blue" />Move visit</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-nb-mute">{label} · now {fmtDate(appt.date)} {fmtTime(appt.time)} · {appt.duration} min</DrawerDescription>
          <label className="mt-4 block text-xs font-semibold text-nb-mute">New date
            <input type="date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); }} className="nb-input mt-1 h-11" data-testid="reschedule-date" />
          </label>
          <div className="mt-4 space-y-3" data-testid="reschedule-times">
            {times.map(([name, list]) => list.length > 0 && (
              <div key={name}>
                <p className="mb-1.5 text-xs font-semibold text-nb-mute">{name}</p>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {list.map((t) => <button key={t} type="button" aria-pressed={t === time} onClick={() => setTime(t)} className={cn("nb-num h-10 rounded-xl text-xs font-semibold ring-1 transition-colors", t === time ? "bg-nb-ink text-white ring-nb-ink" : "bg-white text-nb-ink ring-sky-100 hover:ring-sky-300")} data-testid={`reschedule-time-${t}`}>{fmtTime(t)}</button>)}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-nb-mute">Edmonton local time. The server checks the practitioner's hours, travel and buffers before saving.</p>
          <div className="sticky bottom-0 -mx-5 mt-4 border-t border-sky-100 bg-nb-canvas/95 px-5 pb-1 pt-3 backdrop-blur"><button type="button" disabled={!changed || !time} onClick={() => onPick(date, time)} className="nb-btn-primary h-12 w-full" data-testid="reschedule-continue">{offered ? `${cta} · ${fmtDate(date)} ${fmtTime(time)}` : "Choose a time"}</button></div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
