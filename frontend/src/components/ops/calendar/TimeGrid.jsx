import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { fmtDate, fmtTime } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { MOVABLE, STATUS_FILL, edmontonNow, fromMin, layoutLanes, toMin } from "./time";

const START = 7 * 60;
const END = 21 * 60;
const HOUR = 64;
const SNAP = 15;
const px = (mins) => ((mins - START) / 60) * HOUR;
const HOURS = Array.from({ length: (END - START) / 60 }, (_, i) => START + i * 60);

function Block({ item, ctx }) {
  const { appt, start, end, lane, lanes } = item;
  const person = ctx.personFor(appt.practitionerId);
  const movable = ctx.onMove && MOVABLE.includes(appt.status) && `${appt.date}${appt.time}` >= `${ctx.now.date}${ctx.now.time}`;
  const height = Math.max(26, px(Math.min(end, END)) - px(Math.max(start, START)) - 3);
  const width = 100 / lanes;
  return (
    <button
      type="button"
      draggable={Boolean(movable)}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", appt.id); e.dataTransfer.effectAllowed = "move"; ctx.setDragging(appt); }}
      onDragEnd={() => ctx.setDragging(null)}
      onClick={() => ctx.onOpen?.(appt.id)}
      title={`${fmtTime(appt.time)} · ${ctx.clientName(appt)} · ${ctx.serviceName(appt)} · ${person?.name || "Unassigned"}`}
      className={cn("group absolute z-10 overflow-hidden rounded-lg px-2 py-1 text-left text-[11px] leading-tight ring-1 transition-shadow hover:z-20 hover:shadow-md focus-visible:z-20", STATUS_FILL[appt.status] || "bg-sky-50 ring-sky-200", movable && "cursor-grab active:cursor-grabbing")}
      style={{ top: px(Math.max(start, START)) + 1, height, left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)`, borderLeft: `3px solid ${person?.color || "#94A3B8"}` }}
      data-testid={`calendar-appointment-${appt.id}`}
    >
      <span className="flex items-center gap-1 font-semibold"><span className="nb-num">{fmtTime(appt.time)}</span>{movable && <GripVertical className="ml-auto h-3 w-3 opacity-0 group-hover:opacity-60" aria-hidden="true" />}</span>
      <span className="block truncate font-medium">{ctx.clientName(appt)}</span>
      {height > 52 && <span className="block truncate opacity-75">{ctx.serviceName(appt)}</span>}
      {height > 70 && <span className="block truncate opacity-60">{person?.name || "Unassigned"}</span>}
    </button>
  );
}

function DayColumn({ date, items, ctx, ghost, setGhost }) {
  const ref = useRef(null);
  const minuteAt = (clientY) => {
    const rect = ref.current.getBoundingClientRect();
    const raw = START + ((clientY - rect.top) / HOUR) * 60;
    return Math.max(START, Math.min(END - SNAP, Math.round(raw / SNAP) * SNAP));
  };
  const isToday = date === ctx.now.date;
  const nowTop = isToday && ctx.now.minutes >= START && ctx.now.minutes <= END ? px(ctx.now.minutes) : null;
  return (
    <div
      ref={ref}
      className={cn("relative border-l border-sky-100", isToday && "bg-sky-50/40")}
      style={{ height: px(END) }}
      onDragOver={(e) => { if (!ctx.dragging) return; e.preventDefault(); setGhost({ date, minute: minuteAt(e.clientY) }); }}
      onDragLeave={() => setGhost(null)}
      onDrop={(e) => { e.preventDefault(); const appt = ctx.dragging; setGhost(null); ctx.setDragging(null); if (appt) ctx.onMove(appt, date, fromMin(minuteAt(e.clientY))); }}
      data-testid={`calendar-column-${date}`}
    >
      {HOURS.map((h) => (
        <button key={h} type="button" aria-label={`${fmtDate(date)} ${fmtTime(fromMin(h))}`} className="absolute inset-x-0 border-t border-sky-100/70 hover:bg-sky-50" style={{ top: px(h), height: HOUR }} onClick={() => ctx.onSlot?.({ date, time: fromMin(h) })} />
      ))}
      {ghost?.date === date && ctx.dragging && (
        <div className="pointer-events-none absolute inset-x-1 z-30 rounded-lg border-2 border-dashed border-nb-blue bg-nb-blue/10 px-2 py-0.5 text-[11px] font-semibold text-nb-blue" style={{ top: px(ghost.minute), height: Math.max(24, (Number(ctx.dragging.duration || 60) / 60) * HOUR - 3) }} data-testid="calendar-drop-ghost">
          {fmtTime(fromMin(ghost.minute))}
        </div>
      )}
      {items.map((item) => <Block key={item.appt.id} item={item} ctx={ctx} />)}
      {nowTop != null && <div className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-rose-500" style={{ top: nowTop }} data-testid="calendar-now-line"><span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-rose-500" /></div>}
    </div>
  );
}

export function TimeGrid({ days, appointments, ctx }) {
  const scroller = useRef(null);
  const [ghost, setGhost] = useState(null);
  const now = edmontonNow();
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = px(8 * 60) - 16;
    const idx = days.indexOf(now.date);
    if (idx > 0 && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, 56 + idx * ((el.scrollWidth - 56) / days.length) - el.clientWidth / 2);
  }, [days.length, days[0]]); // eslint-disable-line
  const cols = `3.5rem repeat(${days.length}, minmax(${days.length > 1 ? "7.5rem" : "0"}, 1fr))`;
  const full = { ...ctx, now };
  return (
    <div ref={scroller} className="nb-panel relative max-h-[max(26rem,calc(100dvh-17rem))] overflow-auto" data-testid="calendar-grid-wrap">
      <div className="min-w-0" style={{ minWidth: days.length > 1 ? "56rem" : undefined }}>
        <div className="sticky top-0 z-40 grid border-b border-sky-100 bg-white/95 backdrop-blur" style={{ gridTemplateColumns: cols }}>
          <div className="sticky left-0 z-10 bg-white/95" />
          {days.map((d) => (
            <div key={d} className={cn("px-2 py-2 text-center", d === now.date && "text-nb-blue")}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-nb-mute">{fmtDate(d, { weekday: "short" })}</p>
              <p className={cn("mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold", d === now.date && "bg-nb-blue text-white")}>{Number(d.slice(-2))}</p>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: cols }} data-testid="calendar-grid">
          <div className="sticky left-0 z-30 bg-white" style={{ height: px(END) }}>
            {HOURS.map((h) => <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-nb-mute" style={{ top: px(h) }}>{h === START ? "" : fmtTime(fromMin(h))}</span>)}
          </div>
          {days.map((d) => <DayColumn key={d} date={d} items={layoutLanes(appointments.filter((a) => a.date === d))} ctx={full} ghost={ghost} setGhost={setGhost} />)}
        </div>
      </div>
    </div>
  );
}
