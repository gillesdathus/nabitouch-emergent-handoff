import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, fmtDate, fmtTime, money, todayISO } from "@/lib/domain";

const START = 8 * 60;
const END = 20 * 60;
const HOUR = 56;

function minutes(value) {
  if (!value) return START;
  const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(hour)) return START;
  return hour * 60 + (minute || 0);
}

function topFor(value) {
  return ((Math.max(START, Math.min(END, minutes(value))) - START) / 60) * HOUR;
}

function heightFor(start, duration) {
  const end = minutes(start) + Number(duration || 60);
  return Math.max(28, ((Math.min(END, end) - Math.max(START, minutes(start))) / 60) * HOUR - 4);
}

const FILL = {
  requested: "bg-amber-100 text-amber-950",
  confirmed: "bg-sky-100 text-sky-950",
  assigned: "bg-sky-100 text-sky-950",
  preparing: "bg-cyan-100 text-cyan-950",
  en_route: "bg-cyan-100 text-cyan-950",
  arrived: "bg-teal-100 text-teal-950",
  in_session: "bg-teal-200 text-teal-950",
  completed: "bg-slate-100 text-slate-700",
  closed: "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-50 text-rose-800",
};

export function VisualCalendar({ appointments = [], practitioners = [], services = {}, clients = {}, personId = "", onPerson, cursor, onCursor, onOpen, onSlot }) {
  const [view, setView] = useState("day");
  const day = cursor || todayISO();
  const week = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(day, index - ((new Date(`${day}T12:00:00`).getDay() + 6) % 7))), [day]);
  const month = useMemo(() => {
    const start = `${day.slice(0, 8)}01`;
    const first = new Date(`${start}T12:00:00`);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => addDays(start, index - offset));
  }, [day]);
  const visible = personId ? appointments.filter((item) => item.practitionerId === personId) : appointments;
  const hours = Array.from({ length: (END - START) / 60 }, (_, index) => START + index * 60);
  const label = (mins) => fmtTime(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);

  return (
    <div className="space-y-4" data-testid="visual-calendar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-sky-100" role="tablist" aria-label="Calendar view">
          {["day", "week", "month"].map((item) => (
            <button key={item} type="button" role="tab" aria-selected={view === item} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${view === item ? "bg-nb-ink text-white" : "text-nb-mute"}`} onClick={() => setView(item)} data-testid={`calendar-view-${item}`}>{item}</button>
          ))}
        </div>
        <button type="button" className="nb-btn-ghost h-10 w-10 px-0" aria-label="Previous" onClick={() => onCursor(addDays(day, view === "month" ? -30 : view === "week" ? -7 : -1))}><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" className="nb-btn-ghost h-10" onClick={() => onCursor(todayISO())} data-testid="calendar-today">Today</button>
        <button type="button" className="nb-btn-ghost h-10 w-10 px-0" aria-label="Next" onClick={() => onCursor(addDays(day, view === "month" ? 30 : view === "week" ? 7 : 1))}><ChevronRight className="h-4 w-4" /></button>
        <p className="text-sm font-semibold text-nb-ink">{fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}</p>
        {onPerson && (
          <select className="nb-input h-10 w-auto" value={personId} onChange={(event) => onPerson(event.target.value)} aria-label="Practitioner" data-testid="calendar-practitioner">
            <option value="">All practitioners</option>
            {practitioners.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto md:hidden" data-testid="calendar-day-strip">
        {(view === "month" ? month.filter((item) => item.slice(0, 7) === day.slice(0, 7)) : week).map((item) => (
          <button key={item} type="button" onClick={() => { onCursor(item); setView("day"); }} className={`min-w-14 rounded-2xl px-3 py-2 text-center ${item === day ? "text-white nb-gradient" : "bg-white text-nb-ink ring-1 ring-sky-100"}`}>
            <span className="block text-[10px] uppercase">{fmtDate(item, { weekday: "short" })}</span>
            <span className="text-lg font-semibold">{item.slice(-2)}</span>
          </button>
        ))}
      </div>

      {view !== "month" && (
        <div className="md:hidden" data-testid="calendar-mobile-day">
          <div className="relative ml-12 rounded-2xl bg-white ring-1 ring-sky-100" style={{ height: ((END - START) / 60) * HOUR }}>
            {hours.map((hour) => <button key={hour} type="button" aria-label={`Open ${day} ${label(hour)}`} className="absolute inset-x-0 border-t border-sky-50" style={{ top: ((hour - START) / 60) * HOUR, height: HOUR }} onClick={() => onSlot?.({ date: day, time: `${String(hour / 60).padStart(2, "0")}:00` })} />)}
            {visible.filter((appointment) => appointment.date === day).map((appointment) => (
              <button key={appointment.id} type="button" onClick={() => onOpen?.(appointment.id)} className={`absolute inset-x-1 z-10 overflow-hidden rounded-xl px-2 py-1 text-left text-xs ${FILL[appointment.status] || "bg-sky-100"}`} style={{ top: topFor(appointment.time), height: heightFor(appointment.time, appointment.duration) }}>
                <b>{fmtTime(appointment.time)} {clients[appointment.clientId]?.firstName || "Client"}</b>
                <span className="block truncate">{services[appointment.serviceSlug]?.name}</span>
              </button>
            ))}
            {!visible.some((appointment) => appointment.date === day) && <p className="pointer-events-none absolute left-3 top-3 text-sm text-nb-mute">No visits on this day.</p>}
          </div>
        </div>
      )}
      {view === "month" ? (
        <div className="grid grid-cols-7 gap-1" data-testid="calendar-month">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <p key={name} className="px-1 text-center text-[10px] font-semibold uppercase text-nb-mute">{name}</p>)}
          {month.map((item) => {
            const rows = visible.filter((appointment) => appointment.date === item && appointment.status !== "cancelled");
            return (
              <button key={item} type="button" onClick={() => { onCursor(item); setView("day"); }} className={`min-h-16 rounded-2xl p-1 text-left md:min-h-24 ${item === day ? "bg-sky-50 ring-2 ring-sky-300" : "bg-white ring-1 ring-sky-100"} ${item.slice(5, 7) !== day.slice(5, 7) ? "opacity-40" : ""}`} data-testid={`calendar-month-${item}`}>
                <span className="text-xs font-semibold">{Number(item.slice(-2))}</span>
                <span className="mt-1 block space-y-0.5">{rows.slice(0, 3).map((appointment) => <span key={appointment.id} className="block truncate rounded-md bg-sky-100 px-1 text-[10px]">{fmtTime(appointment.time)} {clients[appointment.clientId]?.firstName || "Visit"}</span>)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={`${view === "week" ? "md:grid-cols-[52px_repeat(7,minmax(0,1fr))]" : "md:grid-cols-[52px_minmax(0,1fr)]"} hidden md:grid`} data-testid="calendar-grid">
          <div />
          {(view === "week" ? week : [day]).map((item) => <p key={item} className="px-1 pb-2 text-center text-xs font-semibold">{fmtDate(item, { weekday: "short", day: "numeric" })}</p>)}
          <div className="relative" style={{ height: ((END - START) / 60) * HOUR }}>
            {hours.map((hour) => <p key={hour} className="absolute left-0 text-[10px] text-nb-mute" style={{ top: ((hour - START) / 60) * HOUR }}>{label(hour)}</p>)}
          </div>
          {(view === "week" ? week : [day]).map((item) => (
            <div key={item} className="relative rounded-2xl bg-white ring-1 ring-sky-100" style={{ height: ((END - START) / 60) * HOUR }} data-testid={`calendar-column-${item}`}>
              {hours.map((hour) => <button key={hour} type="button" aria-label={`Open ${item} ${label(hour)}`} className="absolute inset-x-0 border-t border-sky-50" style={{ top: ((hour - START) / 60) * HOUR, height: HOUR }} onClick={() => onSlot?.({ date: item, time: `${String(hour / 60).padStart(2, "0")}:00` })} />)}
              {visible.filter((appointment) => appointment.date === item).map((appointment) => (
                <button key={appointment.id} type="button" onClick={() => onOpen?.(appointment.id)} className={`absolute inset-x-1 z-10 overflow-hidden rounded-xl px-2 py-1 text-left text-[11px] shadow-sm ${FILL[appointment.status] || "bg-sky-100"}`} style={{ top: topFor(appointment.time), height: heightFor(appointment.time, appointment.duration), borderLeft: `3px solid ${practitioners.find((person) => person.id === appointment.practitionerId)?.color || "#1565F0"}` }} data-testid={`calendar-appointment-${appointment.id}`}>
                  <b className="block truncate">{fmtTime(appointment.time)} {clients[appointment.clientId]?.firstName || "Client"}</b>
                  <span className="block truncate">{services[appointment.serviceSlug]?.name || appointment.serviceSlug} · {money(appointment.pricing?.total || 0)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
