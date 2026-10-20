import { CalendarClock, CalendarX2 } from "lucide-react";
import { EmptyState } from "@/components/ds";
import { StatusPill } from "@/components/ui-kit";
import { endTime, fmtDate, fmtTime, money } from "@/lib/domain";
import { MOVABLE, edmontonNow } from "./time";

function AgendaRow({ appt, ctx }) {
  const person = ctx.personFor(appt.practitionerId);
  const now = edmontonNow();
  const movable = ctx.onRequestMove && MOVABLE.includes(appt.status) && `${appt.date}${appt.time}` >= `${now.date}${now.time}`;
  return (
    <li className="flex min-w-0 items-start gap-1">
      <button type="button" onClick={() => ctx.onOpen?.(appt.id)} className="nb-row items-start" data-testid={`calendar-appointment-${appt.id}`}>
        <span className="w-16 shrink-0">
          <span className="nb-num block text-sm font-semibold">{fmtTime(appt.time)}</span>
          <span className="nb-num block text-[11px] text-nb-mute">{fmtTime(endTime(appt.time, appt.duration || 60))}</span>
        </span>
        <span className="mt-0.5 h-10 w-1 shrink-0 rounded-full" style={{ background: person?.color || "#CBD5E1" }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{ctx.clientName(appt)}</span>
          <span className="block truncate text-xs text-nb-mute">{ctx.serviceName(appt)} · {appt.duration} min · {money(appt.pricing?.total || 0)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5"><StatusPill status={appt.status} /><span className="truncate text-[11px] text-nb-mute">{person?.name || "Unassigned"}</span></span>
        </span>
      </button>
      {movable && <button type="button" onClick={() => ctx.onRequestMove(appt)} aria-label={`Move ${appt.ref}`} className="mt-2 inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-nb-blue ring-1 ring-sky-200 hover:bg-sky-50" data-testid={`calendar-move-${appt.id}`}><CalendarClock className="h-3.5 w-3.5" />Move</button>}
    </li>
  );
}

export function AgendaList({ days, appointments, ctx, emptyLabel = "No visits in this range" }) {
  const today = edmontonNow().date;
  const groups = days.map((d) => [d, appointments.filter((a) => a.date === d).sort((a, b) => a.time.localeCompare(b.time))]).filter(([, rows]) => rows.length);
  if (!groups.length) return <EmptyState icon={CalendarX2} title={emptyLabel} body="Use the arrows to move through dates, or tap a time on desktop to block it." testid="calendar-empty" />;
  return (
    <div className="space-y-4" data-testid="calendar-list">
      {groups.map(([d, rows]) => (
        <section key={d} className="nb-panel" data-testid={`calendar-list-day-${d}`}>
          <h3 className="sticky top-[calc(var(--nb-header-h)+var(--nb-safe-t))] z-10 flex items-baseline justify-between gap-2 rounded-t-[var(--nb-r-lg)] border-b border-sky-50 bg-white/95 px-4 py-2.5 backdrop-blur lg:top-0">
            <span className="text-sm font-semibold">{d === today ? "Today · " : ""}{fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}</span>
            <span className="text-xs text-nb-mute">{rows.length} visit{rows.length === 1 ? "" : "s"}</span>
          </h3>
          <ul className="p-1.5">{rows.map((a) => <AgendaRow key={a.id} appt={a} ctx={ctx} />)}</ul>
        </section>
      ))}
    </div>
  );
}
