import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, ArrowLeft, Route as RouteIcon } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { TrainingBanner } from "@/components/shells";
import { Segmented, ProgressRail, Notice, Pill } from "@/components/ui-kit";
import { DayStrip, Timeline } from "@/components/Calendar";
import { todayISO } from "@/lib/domain";

const T = todayISO();
const TRAIN_APPTS = [
  { id: "t1", date: T, time: "09:00", duration: 60, serviceId: "s1", practitionerId: "p1", clientId: "tc1", status: "confirmed" },
  { id: "t2", date: T, time: "11:30", duration: 75, serviceId: "s5", practitionerId: "p1", clientId: "tc2", status: "requested" },
  { id: "t3", date: T, time: "15:00", duration: 90, serviceId: "s3", practitionerId: "p1", clientId: "tc1", status: "confirmed" },
];
const TRAIN_CLIENTS = { tc1: { name: "Trainee Client A" }, tc2: { name: "Trainee Client B" } };
const PERSONA = { owner: "Training manager", pro: "Practice practitioner", client: "Practice client", desk: "Practice receptionist" };

export default function TrainWorkspace() {
  const { db, svc, pro, api } = usePreview();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [role, setRole] = useState(sp.get("role") || "desk");
  const [date, setDate] = useState(T);
  const s = db.scenarios.find((x) => x.status === "active");
  const [done, setDone] = useState([]);
  const tasks = s?.tasks || [];
  const toggle = (t) => {
    const n = done.includes(t) ? done.filter((x) => x !== t) : [...done, t];
    setDone(n);
    if (s) api.save("scenarios", s.id, { progress: n.length / tasks.length });
  };
  return (
    <div className="min-h-screen bg-amber-50/40">
      <TrainingBanner />
      <div className="max-w-4xl mx-auto px-5 pt-5 pb-16">
        <div className="flex items-center gap-3 mb-4">
          <button data-testid="train-exit" onClick={() => nav("/owner/training")} className="h-11 w-11 grid place-items-center rounded-full bg-white ring-1 ring-amber-200"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex-1"><p className="text-xs text-amber-700 font-semibold">{s?.name || "No active scenario"}</p><h1 className="text-2xl font-semibold">{PERSONA[role]}</h1></div>
          <Pill tone="bg-amber-100 text-amber-800 ring-amber-300">DEMO</Pill>
        </div>
        <Segmented testid="train-role" value={role} onChange={setRole} options={[{ value: "owner", label: "Manager" }, { value: "pro", label: "Practitioner" }, { value: "desk", label: "Reception" }, { value: "client", label: "Client" }]} className="mb-5 max-w-full overflow-x-auto no-scrollbar" />
        <div className="nb-card p-5 mb-5 border-amber-200">
          <div className="flex items-center justify-between mb-2"><p className="font-semibold">Guided tasks</p><span className="text-xs text-nb-mute nb-num">{done.length}/{tasks.length}</span></div>
          <ProgressRail value={tasks.length ? done.length / tasks.length : 0} />
          <div className="mt-3 space-y-1">{tasks.map((t) => <button key={t} data-testid={`train-task-${t.replace(/\s/g, "-").toLowerCase()}`} onClick={() => toggle(t)} className="w-full flex items-center gap-2 py-2 text-sm text-left">{done.includes(t) ? <CheckCircle2 className="h-5 w-5 text-nb-teal" /> : <Circle className="h-5 w-5 text-nb-mute" />}{t}</button>)}</div>
          <p className="text-[11px] text-nb-mute mt-2">Progress is stored on the training scenario only.</p>
        </div>
        <DayStrip value={date} onChange={setDate} />
        <div className="mt-4"><Timeline date={date} lookup={{ svc, pro, cli: (id) => TRAIN_CLIENTS[id] }} lanes={["p1"]} appts={TRAIN_APPTS.filter((a) => a.date === date)} segments={[]} onOpen={() => {}} testid="train-timeline" /></div>
        <Notice className="mt-4" icon={RouteIcon}>Training route is an estimate. Mapbox isn't configured, so no route or moving practitioner is drawn.</Notice>
        <Notice className="mt-2">Training writes use training endpoints only — no operational bookings, payments, messages or analytics.</Notice>
      </div>
    </div>
  );
}
