import { addDays, fmtTime } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { edmontonNow, weekStart } from "./time";

const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({ cursor, appointments, ctx, compact }) {
  const first = weekStart(`${cursor.slice(0, 8)}01`);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const today = edmontonNow().date;
  const month = cursor.slice(0, 7);
  return (
    <div className="nb-panel p-2 sm:p-3" data-testid="calendar-month">
      <div className="grid grid-cols-7 gap-1">
        {NAMES.map((n) => <p key={n} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-nb-mute">{compact ? n[0] : n}</p>)}
        {cells.map((d) => {
          const rows = appointments.filter((a) => a.date === d && a.status !== "cancelled").sort((a, b) => a.time.localeCompare(b.time));
          const selected = d === cursor;
          return (
            <button key={d} type="button" onClick={() => ctx.onPickDay(d)} aria-label={`${d}, ${rows.length} visits`} aria-current={d === today ? "date" : undefined}
              className={cn("flex min-w-0 flex-col rounded-xl p-1 text-left transition-colors", compact ? "h-12 items-center" : "min-h-[6.5rem]", selected ? "bg-sky-50 ring-2 ring-nb-blue/40" : "hover:bg-sky-50/60", d.slice(0, 7) !== month && "opacity-40")}
              data-testid={`calendar-month-${d}`}>
              <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs font-semibold", d === today && "bg-nb-blue text-white")}>{Number(d.slice(-2))}</span>
              {compact ? (
                rows.length > 0 && <span className="mt-0.5 flex gap-0.5">{rows.slice(0, 3).map((a) => <span key={a.id} className="h-1.5 w-1.5 rounded-full" style={{ background: ctx.personFor(a.practitionerId)?.color || "#94A3B8" }} />)}</span>
              ) : (
                <span className="mt-1 block w-full min-w-0 space-y-0.5">
                  {rows.slice(0, 3).map((a) => <span key={a.id} className="block truncate rounded-md bg-white px-1.5 py-0.5 text-[10.5px] ring-1 ring-sky-100" style={{ borderLeft: `3px solid ${ctx.personFor(a.practitionerId)?.color || "#94A3B8"}` }}><b className="nb-num font-semibold">{fmtTime(a.time)}</b> {ctx.clientName(a)}</span>)}
                  {rows.length > 3 && <span className="block px-1 text-[10px] font-semibold text-nb-blue">+{rows.length - 3} more</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
