import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Segmented } from "@/components/ds";
import { addDays, fmtDate, todayISO } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { TimeGrid } from "./calendar/TimeGrid";
import { MonthGrid } from "./calendar/MonthGrid";
import { AgendaList } from "./calendar/AgendaList";
import { shiftMonth, weekStart } from "./calendar/time";

const VIEWS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["list", "List"]];

function useDesktop() {
  const query = "(min-width: 768px)";
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const fn = () => setOn(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return on;
}

function rangeLabel(view, day, week) {
  if (view === "day") return fmtDate(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (view === "month") return fmtDate(day, { month: "long", year: "numeric" });
  if (view === "list") return `${fmtDate(day, { month: "short", day: "numeric" })} – ${fmtDate(addDays(day, 29), { month: "short", day: "numeric", year: "numeric" })}`;
  return `${fmtDate(week[0], { month: "short", day: "numeric" })} – ${fmtDate(week[6], { month: "short", day: "numeric", year: "numeric" })}`;
}

function PractitionerFilter({ practitioners, personId, onPerson }) {
  if (!onPerson || !practitioners.length) return null;
  const chip = (id, name, color) => (
    <button key={id || "all"} type="button" aria-pressed={personId === id} onClick={() => onPerson(id)} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 transition-colors", personId === id ? "bg-nb-ink text-white ring-nb-ink" : "bg-white text-nb-ink ring-sky-100 hover:ring-sky-300")} data-testid={`calendar-practitioner-${id || "all"}`}>
      {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />}{name}
    </button>
  );
  return (
    <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="Practitioner filter" data-testid="calendar-practitioner">
      {chip("", "All practitioners")}
      {practitioners.map((p) => chip(p.id, p.name, p.color || "#94A3B8"))}
    </div>
  );
}

function DayStrip({ week, day, onCursor }) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar" data-testid="calendar-day-strip">
      {week.map((d) => (
        <button key={d} type="button" onClick={() => onCursor(d)} aria-pressed={d === day} className={cn("min-w-[2.5rem] flex-1 rounded-2xl px-1 py-1.5 text-center ring-1 transition-colors", d === day ? "bg-nb-ink text-white ring-nb-ink" : "bg-white text-nb-ink ring-sky-100")}>
          <span className="block text-[10px] font-semibold uppercase">{fmtDate(d, { weekday: "short" })}</span>
          <span className="nb-num text-[15px] font-semibold">{Number(d.slice(-2))}</span>
        </button>
      ))}
    </div>
  );
}

export function VisualCalendar({ appointments = [], practitioners = [], services = {}, clients = {}, personId = "", onPerson, cursor, onCursor, onOpen, onSlot, onMove, onRequestMove, defaultView }) {
  const desktop = useDesktop();
  const [view, setView] = useState(defaultView || "day");
  const day = cursor || todayISO();
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i)), [day]);
  const visible = personId ? appointments.filter((a) => a.practitionerId === personId) : appointments;
  const byId = useMemo(() => Object.fromEntries(practitioners.map((p) => [p.id, p])), [practitioners]);
  const ctx = {
    onOpen, onSlot, onMove, onRequestMove,
    personFor: (id) => byId[id],
    clientName: (a) => { const c = clients[a.clientId]; return c ? `${c.firstName || "Client"} ${c.lastName || ""}`.trim() : "Client"; },
    serviceName: (a) => services[a.serviceSlug]?.name || a.serviceSlug,
    onPickDay: (d) => { onCursor(d); if (desktop) setView("day"); },
  };
  const step = (dir) => {
    if (view === "month") onCursor(shiftMonth(day, dir));
    else onCursor(addDays(day, dir * (view === "day" ? 1 : view === "list" ? 30 : 7)));
  };
  const listDays = Array.from({ length: 30 }, (_, i) => addDays(day, i));
  const [dragging, setDragging] = useState(null);
  const gridCtx = { ...ctx, dragging, setDragging };

  return (
    <div className="min-w-0 space-y-3" data-testid="visual-calendar">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Segmented options={VIEWS} value={view} onChange={setView} testid="calendar-view" label="Calendar view" />
        <div className="flex items-center gap-1">
          <button type="button" className="nb-btn-ghost h-9 w-9 px-0" aria-label="Previous" onClick={() => step(-1)} data-testid="calendar-prev"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className="nb-btn-ghost h-9 px-3 text-sm" onClick={() => onCursor(todayISO())} data-testid="calendar-today">Today</button>
          <button type="button" className="nb-btn-ghost h-9 w-9 px-0" aria-label="Next" onClick={() => step(1)} data-testid="calendar-next"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <p className="text-sm font-semibold text-nb-ink" aria-live="polite" data-testid="calendar-range-label">{rangeLabel(view, day, week)}</p>
      <PractitionerFilter practitioners={practitioners} personId={personId} onPerson={onPerson} />
      {view === "month" && <MonthGrid cursor={day} appointments={visible} ctx={ctx} compact={!desktop} />}
      {view === "month" && !desktop && <AgendaList days={[day]} appointments={visible} ctx={ctx} emptyLabel="No visits on this day" />}
      {view === "list" && <AgendaList days={listDays} appointments={visible} ctx={ctx} emptyLabel="No visits in the next 30 days" />}
      {(view === "day" || view === "week") && !desktop && <><DayStrip week={week} day={day} onCursor={onCursor} /><AgendaList days={view === "day" ? [day] : week} appointments={visible} ctx={ctx} emptyLabel={view === "day" ? "No visits on this day" : "No visits this week"} /></>}
      {(view === "day" || view === "week") && desktop && <TimeGrid days={view === "day" ? [day] : week} appointments={visible} ctx={gridCtx} />}
      {onMove && desktop && (view === "day" || view === "week") && <p className="text-[11px] text-nb-mute">Drag an upcoming visit to a new time to reschedule. The server checks availability, travel, and buffers before saving. Times are Edmonton local time.</p>}
    </div>
  );
}
