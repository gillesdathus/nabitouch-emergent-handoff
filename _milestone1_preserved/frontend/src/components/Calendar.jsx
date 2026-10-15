import { useEffect, useRef } from "react";
import { addDays, dayNum, weekdayShort, fromISO, minutesOf, hhmm, timeLabel, todayISO, toISO } from "@/lib/domain";
import { cx } from "@/components/ui-kit";

const HOUR = 64;

export function DayStrip({ value, onChange, start, count = 14, dark, dots, testid = "day-strip" }) {
  const ref = useRef(null);
  const first = start || addDays(todayISO(), -3);
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  useEffect(() => {
    ref.current?.querySelector("[data-on='true']")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value]);
  return (
    <div ref={ref} data-testid={testid} className="flex gap-2 overflow-x-auto no-scrollbar py-1 -mx-1 px-1 snap-x">
      {days.map((d) => {
        const on = d === value;
        const today = d === todayISO();
        return (
          <button key={d} data-on={on} data-testid={`${testid}-${d}`} onClick={() => onChange(d)} className={cx("snap-center shrink-0 w-[52px] h-[68px] rounded-[22px] flex flex-col items-center justify-center gap-0.5 transition-[background-color,transform,color] duration-200 active:scale-95", on ? "nb-lagoon text-white shadow-[0_10px_22px_-10px_rgba(21,101,240,.8)]" : dark ? "bg-white/5 text-white/80" : "bg-white text-nb-ink ring-1 ring-sky-100")}>
            <span className={cx("text-[11px] font-medium", on ? "text-white/80" : dark ? "text-white/50" : "text-nb-mute")}>{weekdayShort(d)}</span>
            <span className="text-lg font-semibold nb-num">{dayNum(d)}</span>
            <span className={cx("h-1 w-1 rounded-full", dots?.(d) ? (on ? "bg-white" : "bg-nb-turq") : "bg-transparent", today && !on && "ring-2 ring-nb-blue/40")} />
          </button>
        );
      })}
    </div>
  );
}

const SEG_STYLE = {
  available: "bg-white",
  break: "nb-hatch bg-slate-50",
  blocked: "nb-hatch bg-nb-coral/5",
  closed: "bg-slate-50",
};

export function Timeline({ date, appts, segments = [], onOpen, onSlot, startH = 8, endH = 20, lanes = [], lookup, testid = "timeline" }) {
  const toY = (t) => ((minutesOf(t) - startH * 60) / 60) * HOUR;
  const laneOf = (a) => Math.max(0, lanes.indexOf(a.practitionerId));
  const laneN = Math.max(1, lanes.length);
  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  const click = (e) => {
    if (!onSlot || e.target !== e.currentTarget) return;
    const y = e.nativeEvent.offsetY;
    const m = Math.floor((y / HOUR) * 2) * 30 + startH * 60;
    onSlot(hhmm(m));
  };
  return (
    <div data-testid={testid} className="relative flex">
      <div className="w-12 shrink-0">
        {Array.from({ length: endH - startH + 1 }, (_, i) => (
          <div key={i} style={{ height: i === endH - startH ? 0 : HOUR }} className="relative">
            <span className="absolute -top-2 text-[10.5px] text-nb-mute nb-num">{timeLabel(hhmm((startH + i) * 60)).replace(":00", "")}</span>
          </div>
        ))}
      </div>
      <div className="relative flex-1 rounded-2xl overflow-hidden ring-1 ring-sky-100 bg-slate-50/60" style={{ height: (endH - startH) * HOUR }}>
        {segments.map((s, i) => (
          <div key={i} className={cx("absolute inset-x-0 pointer-events-none", SEG_STYLE[s.state])} style={{ top: toY(s.start), height: toY(s.end) - toY(s.start) }}>
            {s.state !== "available" && <span className="absolute left-2 top-1 text-[10px] font-semibold uppercase tracking-wider text-nb-mute">{s.state === "break" ? "Break" : s.state === "blocked" ? "Blocked" : "Closed"}</span>}
          </div>
        ))}
        {Array.from({ length: endH - startH }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-dashed border-sky-100 pointer-events-none" style={{ top: i * HOUR }} />)}
        <div data-testid={`${testid}-slot-layer`} onClick={click} className={cx("absolute inset-0", onSlot && "cursor-copy")} />
        {date === todayISO() && nowM > startH * 60 && nowM < endH * 60 && (
          <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: ((nowM - startH * 60) / 60) * HOUR }}>
            <div className="h-[2px] bg-nb-coral" /><span className="absolute -left-1 -top-[5px] h-3 w-3 rounded-full bg-nb-coral ring-2 ring-white" />
          </div>
        )}
        {appts.map((a) => {
          const s = lookup.svc(a.serviceId);
          const p = lookup.pro(a.practitionerId);
          const c = lookup.cli(a.clientId);
          const l = laneOf(a);
          return (
            <button key={a.id} data-testid={`timeline-appt-${a.id}`} onClick={() => onOpen(a.id)} className={cx("absolute z-10 rounded-2xl px-2.5 py-1.5 text-left overflow-hidden transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]", a.status === "cancelled" ? "opacity-50" : "")} style={{ top: toY(a.time) + 2, height: (a.duration / 60) * HOUR - 4, left: `calc(${(l / laneN) * 100}% + 4px)`, width: `calc(${100 / laneN}% - 8px)`, background: `${p.color}18`, borderLeft: `3px solid ${p.color}` }}>
              <p className="text-[12px] font-semibold text-nb-ink truncate">{c.name}</p>
              <p className="text-[10.5px] text-nb-mute truncate">{timeLabel(a.time)} · {s.name}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WeekGrid({ start, appts, onOpen, lookup, testid = "week-grid" }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const startH = 8;
  const toY = (t) => ((minutesOf(t) - startH * 60) / 60) * 48;
  return (
    <div data-testid={testid}>
      <div className="lg:hidden space-y-4">
        {days.map((d) => {
          const list = appts.filter((a) => a.date === d).sort((x, y) => x.time.localeCompare(y.time));
          return (
            <div key={d}>
              <p className={cx("text-xs font-semibold uppercase tracking-wider mb-2", d === todayISO() ? "text-nb-blue" : "text-nb-mute")}>{fromISO(d).toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })}</p>
              {list.length === 0 ? <p className="text-sm text-nb-mute/70 pl-1">No visits</p> : list.map((a) => (
                <button key={a.id} onClick={() => onOpen(a.id)} className="w-full flex items-center gap-3 rounded-2xl bg-white ring-1 ring-sky-100 px-3 py-2.5 mb-2 text-left active:scale-[0.99] transition-transform">
                  <span className="h-8 w-1 rounded-full" style={{ background: lookup.pro(a.practitionerId).color }} />
                  <span className="text-sm font-semibold nb-num w-16">{timeLabel(a.time)}</span>
                  <span className="text-sm text-nb-ink truncate flex-1">{lookup.cli(a.clientId).name}</span>
                  <span className="text-xs text-nb-mute truncate">{lookup.svc(a.serviceId).name}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="hidden lg:grid grid-cols-[48px_repeat(7,1fr)] gap-x-1.5">
        <div />
        {days.map((d) => <div key={d} className={cx("text-center pb-2 text-xs font-semibold", d === todayISO() ? "text-nb-blue" : "text-nb-mute")}>{weekdayShort(d)} <span className="nb-num text-base text-nb-ink ml-1">{dayNum(d)}</span></div>)}
        <div className="relative" style={{ height: 12 * 48 }}>
          {Array.from({ length: 12 }, (_, i) => <span key={i} className="absolute text-[10px] text-nb-mute" style={{ top: i * 48 - 6 }}>{timeLabel(hhmm((startH + i) * 60)).replace(":00", "")}</span>)}
        </div>
        {days.map((d) => (
          <div key={d} className="relative rounded-2xl bg-white ring-1 ring-sky-100" style={{ height: 12 * 48 }}>
            {Array.from({ length: 12 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-dashed border-sky-100" style={{ top: i * 48 }} />)}
            {appts.filter((a) => a.date === d).map((a) => {
              const p = lookup.pro(a.practitionerId);
              return (
                <button key={a.id} onClick={() => onOpen(a.id)} className="absolute inset-x-1 rounded-xl px-1.5 py-1 text-left overflow-hidden hover:shadow-md transition-shadow" style={{ top: toY(a.time) + 1, height: (a.duration / 60) * 48 - 2, background: `${p.color}1c`, borderLeft: `3px solid ${p.color}` }}>
                  <p className="text-[11px] font-semibold truncate">{lookup.cli(a.clientId).name}</p>
                  <p className="text-[10px] text-nb-mute truncate">{timeLabel(a.time)}</p>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthGrid({ month, appts, value, onPick, testid = "month-grid" }) {
  const first = fromISO(month);
  first.setDate(1);
  const lead = first.getDay();
  const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => toISO(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
  return (
    <div data-testid={testid}>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-nb-mute mb-2">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const count = appts.filter((a) => a.date === d && a.status !== "cancelled").length;
          const on = d === value;
          return (
            <button key={d} data-testid={`${testid}-${d}`} onClick={() => onPick(d)} className={cx("aspect-square rounded-full flex flex-col items-center justify-center text-sm font-medium transition-[background-color,transform] active:scale-90", on ? "nb-lagoon text-white" : d === todayISO() ? "bg-nb-blue/10 text-nb-blue" : "bg-white ring-1 ring-sky-100 text-nb-ink hover:bg-sky-50")}>
              <span className="nb-num">{dayNum(d)}</span>
              {count > 0 && <span className="flex gap-0.5 mt-0.5">{Array.from({ length: Math.min(3, count) }, (_, k) => <span key={k} className={cx("h-1 w-1 rounded-full", on ? "bg-white" : "bg-nb-turq")} />)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
