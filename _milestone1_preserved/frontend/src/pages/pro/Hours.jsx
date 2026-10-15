import { useState } from "react";
import { Pencil, CheckCircle2, Coffee, CalendarOff } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, BottomSheet, Stepper, Notice, Pill, cx } from "@/components/ui-kit";
import { Switch } from "@/components/ui/switch";
import { DayStrip, Timeline } from "@/components/Calendar";
import { ProFilter } from "@/pages/owner/Schedule";
import { TopIcons } from "@/components/shells";
import { daySegments } from "@/lib/schedule";
import { todayISO, timeLabel } from "@/lib/domain";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Editor({ open, onOpenChange, pid }) {
  const { db, api, role } = usePreview();
  const sch = db.schedules[pid];
  const [step, setStep] = useState(0);
  const [weekly, setWeekly] = useState(sch.weekly);
  const [exc, setExc] = useState([]);
  const toggle = (i) => setWeekly((w) => { const n = { ...w }; if (n[i]) delete n[i]; else n[i] = ["09:00", "17:00"]; return n; });
  const setT = (i, k, v) => setWeekly((w) => ({ ...w, [i]: k === 0 ? [v, w[i][1]] : [w[i][0], v] }));
  const save = async () => {
    await api.schedule(pid, { weekly, status: role === "owner" ? "approved" : "pending" }, role === "owner" ? "Hours saved and approved" : "Hours submitted for owner approval");
    setStep(0); onOpenChange(false);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Edit hours" testid="hours-editor" full
      footer={<div className="flex gap-2">{step > 0 && <button data-testid="hours-back" onClick={() => setStep(step - 1)} className="nb-btn-ghost h-12">Back</button>}<button data-testid="hours-next" onClick={() => (step === 2 ? save() : setStep(step + 1))} className="nb-btn-primary flex-1">{step === 2 ? "Save hours" : "Continue"}</button></div>}>
      <div className="mb-6"><Stepper steps={["Weekly pattern", "Exceptions", "Review"]} current={step} testid="hours-stepper" /></div>
      {step === 0 && DAYS.map((d, i) => (
        <div key={d} className="flex items-center gap-3 py-2.5 border-b border-sky-100">
          <Switch data-testid={`hours-day-${i}`} checked={!!weekly[i]} onCheckedChange={() => toggle(i)} />
          <span className="w-10 text-sm font-medium">{d}</span>
          {weekly[i] ? <div className="flex items-center gap-2 flex-1"><input type="time" className="nb-input h-10 px-2 text-sm" value={weekly[i][0]} onChange={(e) => setT(i, 0, e.target.value)} /><span className="text-nb-mute">–</span><input type="time" className="nb-input h-10 px-2 text-sm" value={weekly[i][1]} onChange={(e) => setT(i, 1, e.target.value)} /></div> : <span className="text-sm text-nb-mute">Closed</span>}
        </div>
      ))}
      {step === 1 && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            <button data-testid="exc-add-break" onClick={() => setExc([...exc, "Break · Fri 12:00–13:00"])} className="rounded-3xl tint-ice p-4 text-left"><Coffee className="h-5 w-5 text-nb-blue" /><p className="font-semibold text-sm mt-2">Add break</p></button>
            <button data-testid="exc-add-close" onClick={() => setExc([...exc, "Closed · next Monday"])} className="rounded-3xl bg-nb-coral/10 p-4 text-left"><CalendarOff className="h-5 w-5 text-nb-coral" /><p className="font-semibold text-sm mt-2">Close a day</p></button>
          </div>
          {exc.map((e, i) => <p key={i} className="text-sm mt-3 rounded-2xl ring-1 ring-sky-100 px-4 py-3">{e}</p>)}
          <Notice className="mt-4">If an exception overlaps booked visits, the server returns a conflict. You can keep those visits in place — nothing moves automatically.</Notice>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-2">
          {DAYS.map((d, i) => <div key={d} className="flex justify-between text-sm rounded-2xl bg-sky-50/60 px-4 h-11 items-center"><span className="font-medium">{d}</span><span className="text-nb-mute nb-num">{weekly[i] ? `${timeLabel(weekly[i][0])} – ${timeLabel(weekly[i][1])}` : "Closed"}</span></div>)}
          {role !== "owner" && <Notice tone="info">New hours become bookable after the owner approves them.</Notice>}
        </div>
      )}
    </BottomSheet>
  );
}

export default function Hours({ owner }) {
  const { db, me, api, svc, pro, cli, openAppt } = usePreview();
  const [pid, setPid] = useState(owner ? "p1" : me.pro);
  const [date, setDate] = useState(todayISO());
  const [edit, setEdit] = useState(false);
  const p = pro(pid);
  const sch = db.schedules[pid];
  return (
    <div className="max-w-4xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Hours" sub="Availability in Edmonton time" right={<TopIcons base={owner ? "/owner" : "/pro"} />} />
      {owner && <div className="mb-4"><ProFilter value={pid} onChange={(v) => v !== "all" && setPid(v)} pros={db.practitioners} /></div>}
      <div className="nb-card p-4 flex items-center gap-3 mb-4">
        <div className="flex-1"><p className="font-semibold text-sm">Accepting new bookings</p><p className="text-xs text-nb-mute">Pause to stop new requests. Existing visits stay.</p></div>
        <Switch data-testid="accepting-toggle" checked={p.accepting} onCheckedChange={(v) => api.save("practitioners", pid, { accepting: v }, v ? "Bookings resumed" : "Bookings paused")} />
      </div>
      <div className="nb-card p-4 mb-5">
        <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><p className="font-semibold text-sm">Weekly pattern</p><Pill tone={sch.status === "approved" ? "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30" : "bg-sky-50 text-nb-blue ring-sky-200"}>{sch.status === "approved" ? "Approved" : "Pending approval"}</Pill></div><button data-testid="edit-hours-btn" onClick={() => setEdit(true)} className="nb-btn-ghost h-10 text-sm"><Pencil className="h-4 w-4" />Edit</button></div>
        <div className="grid grid-cols-7 gap-1.5">{DAYS.map((d, i) => <div key={d} className={cx("rounded-2xl py-2 text-center", sch.weekly[i] ? "nb-lagoon text-white" : "bg-slate-100 text-nb-mute")}><p className="text-[11px] font-semibold">{d}</p><p className="text-[9.5px] nb-num mt-0.5 opacity-80">{sch.weekly[i] ? `${sch.weekly[i][0].slice(0, 2)}–${sch.weekly[i][1].slice(0, 2)}` : "off"}</p></div>)}</div>
        {owner && sch.status !== "approved" && <button data-testid="approve-schedule-btn" onClick={() => api.schedule(pid, { status: "approved" }, "Schedule approved")} className="nb-btn-primary w-full h-11 mt-4 text-sm"><CheckCircle2 className="h-4 w-4" />Approve schedule</button>}
      </div>
      <DayStrip value={date} onChange={setDate} />
      <div className="mt-4"><Timeline date={date} lookup={{ svc, pro, cli }} lanes={[pid]} appts={db.appointments.filter((a) => a.practitionerId === pid && a.date === date)} segments={daySegments(db, pid, date)} onOpen={openAppt} /></div>
      <Editor key={pid} open={edit} onOpenChange={setEdit} pid={pid} />
    </div>
  );
}
