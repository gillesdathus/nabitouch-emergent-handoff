import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarPlus, Ban } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Segmented, PageHeader, BottomSheet, Avatar, Notice, cx } from "@/components/ui-kit";
import { DayStrip, Timeline, WeekGrid, MonthGrid } from "@/components/Calendar";
import { TopIcons } from "@/components/shells";
import { daySegments } from "@/lib/schedule";
import { todayISO, addDays, fmtDate, timeLabel, fromISO, toISO } from "@/lib/domain";

export function ProFilter({ value, onChange, pros }) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
      <button data-testid="pro-filter-all" onClick={() => onChange("all")} className={value === "all" ? "nb-chip-on" : "nb-chip-off"}>All</button>
      {pros.map((p) => <button key={p.id} data-testid={`pro-filter-${p.id}`} onClick={() => onChange(p.id)} className={cx(value === p.id ? "nb-chip-on" : "nb-chip-off", "pl-1")}><Avatar src={p.photo} name={p.name} size={26} className="!ring-0" />{p.name.split(" ")[0]}</button>)}
    </div>
  );
}

export default function Schedule() {
  const { db, svc, pro, cli, openAppt, openNewBooking, api } = usePreview();
  const [sp] = useSearchParams();
  const [view, setView] = useState(sp.get("view") || "day");
  const [date, setDate] = useState(sp.get("date") || todayISO());
  const pros = db.practitioners.filter((p) => p.status === "active");
  const [pid, setPid] = useState(sp.get("block") ? "p1" : "all");
  const [slot, setSlot] = useState(null);
  const appts = db.appointments.filter((a) => pid === "all" || a.practitionerId === pid);
  const lookup = { svc, pro, cli };
  const weekStart = addDays(date, -fromISO(date).getDay());
  const shiftMonth = (n) => { const d = fromISO(date); d.setMonth(d.getMonth() + n, 1); setDate(toISO(d)); };
  return (
    <div className="max-w-6xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Schedule" sub="Edmonton local time · tap an empty slot to book or block" right={<TopIcons base="/owner" />} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented testid="schedule-view" value={view} onChange={setView} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <button data-testid="schedule-new-booking" onClick={() => openNewBooking({ date })} className="nb-btn-primary h-11 text-sm"><CalendarPlus className="h-4 w-4" />New booking</button>
      </div>
      <ProFilter value={pid} onChange={setPid} pros={pros} />
      <div className="mt-4">
        {view === "day" && (
          <div className="grid lg:grid-cols-[1fr_320px] gap-5">
            <div>
              <DayStrip value={date} onChange={setDate} dots={(d) => appts.some((a) => a.date === d)} />
              <p className="text-sm font-semibold mt-4 mb-3">{fmtDate(date, { weekday: "long", month: "long", day: "numeric" })}</p>
              <Timeline date={date} lookup={lookup} lanes={pid === "all" ? pros.map((p) => p.id) : [pid]} appts={appts.filter((a) => a.date === date)} segments={pid === "all" ? [] : daySegments(db, pid, date)} onOpen={openAppt} onSlot={(t) => setSlot(t)} />
            </div>
            <div className="hidden lg:block space-y-3">
              <div className="nb-card p-5"><p className="font-semibold mb-3">Legend</p>{[["bg-white ring-1 ring-sky-200", "Available"], ["nb-hatch bg-slate-50", "Break"], ["nb-hatch bg-nb-coral/5 ring-1 ring-nb-coral/20", "Blocked"], ["bg-slate-50 ring-1 ring-slate-200", "Closed"]].map(([c, l]) => <p key={l} className="flex items-center gap-2 text-sm py-1"><span className={`h-4 w-6 rounded ${c}`} />{l}</p>)}<p className="text-xs text-nb-mute mt-2">Choose one practitioner to see their hours, breaks and blocked time.</p></div>
              {pros.map((p) => <div key={p.id} className="flex items-center gap-3 nb-card p-3"><Avatar src={p.photo} name={p.name} size={36} /><p className="text-sm font-medium flex-1">{p.name}</p><span className="text-xs text-nb-mute nb-num">{db.appointments.filter((a) => a.date === date && a.practitionerId === p.id).length} visits</span></div>)}
            </div>
          </div>
        )}
        {view === "week" && (
          <div>
            <div className="flex items-center gap-2 mb-4"><button data-testid="week-prev" onClick={() => setDate(addDays(date, -7))} className="h-10 w-10 grid place-items-center rounded-full bg-white ring-1 ring-sky-100"><ChevronLeft className="h-4 w-4" /></button><p className="text-sm font-semibold flex-1 text-center">{fmtDate(weekStart, { month: "short", day: "numeric" })} – {fmtDate(addDays(weekStart, 6), { month: "short", day: "numeric" })}</p><button data-testid="week-next" onClick={() => setDate(addDays(date, 7))} className="h-10 w-10 grid place-items-center rounded-full bg-white ring-1 ring-sky-100"><ChevronRight className="h-4 w-4" /></button></div>
            <WeekGrid start={weekStart} appts={appts} onOpen={openAppt} lookup={lookup} />
          </div>
        )}
        {view === "month" && (
          <div className="nb-card p-5 max-w-xl">
            <div className="flex items-center justify-between mb-4"><button data-testid="month-prev" onClick={() => shiftMonth(-1)} className="h-10 w-10 grid place-items-center rounded-full bg-sky-50"><ChevronLeft className="h-4 w-4" /></button><p className="font-semibold">{fromISO(date).toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</p><button data-testid="month-next" onClick={() => shiftMonth(1)} className="h-10 w-10 grid place-items-center rounded-full bg-sky-50"><ChevronRight className="h-4 w-4" /></button></div>
            <MonthGrid month={date} appts={appts} value={date} onPick={(d) => { setDate(d); setView("day"); }} />
          </div>
        )}
      </div>
      <BottomSheet open={!!slot} onOpenChange={(o) => !o && setSlot(null)} testid="slot-sheet" title={slot ? `${fmtDate(date)} · ${timeLabel(slot)}` : ""} sub={pid === "all" ? "All practitioners" : pro(pid).name}>
        <div className="grid grid-cols-2 gap-3">
          <button data-testid="slot-book-btn" onClick={() => { openNewBooking({ date, practitionerId: pid === "all" ? "p1" : pid }); setSlot(null); }} className="rounded-3xl tint-lagoon p-5 text-left active:scale-[0.98] transition-transform"><CalendarPlus className="h-6 w-6 text-nb-blue" /><p className="font-semibold mt-3">Create booking</p><p className="text-xs text-nb-mute">From this time</p></button>
          <button data-testid="slot-block-btn" disabled={pid === "all"} onClick={async () => { await api.block(pid, date, slot); setSlot(null); }} className="rounded-3xl bg-nb-coral/10 p-5 text-left active:scale-[0.98] transition-transform disabled:opacity-50"><Ban className="h-6 w-6 text-nb-coral" /><p className="font-semibold mt-3">Block 1 hour</p><p className="text-xs text-nb-mute">Existing visits stay in place</p></button>
        </div>
        {pid === "all" && <Notice className="mt-3">Pick a practitioner first to block time.</Notice>}
      </BottomSheet>
    </div>
  );
}
