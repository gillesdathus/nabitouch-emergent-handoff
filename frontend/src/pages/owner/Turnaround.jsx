import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Timer, BarChart3 } from "lucide-react";
import { DateField } from "@/components/DateField";
import { PageHeader } from "@/components/tide";
import { TurnaroundBoard } from "@/components/session/TurnaroundBoard";
import { api } from "@/lib/api";
import { addDays, todayISO } from "@/lib/domain";
import { useDemo } from "@/store/DemoStore";

const BASE = [["clinicCleanupMin", "Clinic treatment"], ["equipmentCleanupMin", "Extra equipment prep"], ["mobileCleanupMin", "Mobile packing"], ["departureSoonMin", "‘Departure soon’ warning"]];
const num = (value) => (value === "" || value == null ? null : Number(value));

function ConfigCard() {
  const { state } = useDemo();
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.turnaroundConfig().then(setCfg).catch(() => {}); }, []);
  if (!cfg) return <div className="nb-card h-40 animate-pulse" />;
  const table = (key, id, value) => setCfg({ ...cfg, [key]: { ...cfg[key], [id]: value } });
  const save = async () => {
    setBusy(true);
    try {
      const clean = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, Number(v)]));
      setCfg(await api.saveTurnaroundConfig({ ...Object.fromEntries(BASE.map(([k]) => [k, num(cfg[k])])), byService: clean(cfg.byService), byPractitioner: clean(cfg.byPractitioner), equipmentServices: cfg.equipmentServices }));
      toast.success("Cleanup buffers saved. Existing bookings are not changed.");
    } catch (err) { toast.error(err?.response?.data?.detail || "Not saved"); } finally { setBusy(false); }
  };
  return (
    <section className="nb-card space-y-4 rounded-[28px] p-5" data-testid="turnaround-config">
      <p className="nb-eyebrow flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" />Cleanup & turnaround buffers (minutes)</p>
      <div className="grid gap-3 sm:grid-cols-4">{BASE.map(([key, label]) => <label key={key} className="text-sm">{label}<input className="nb-input mt-1" inputMode="numeric" value={cfg[key] ?? ""} onChange={(e) => setCfg({ ...cfg, [key]: e.target.value })} data-testid={`turnaround-${key}`} /></label>)}</div>
      <div><p className="nb-label">By service (overrides appointment type)</p><div className="grid gap-2 sm:grid-cols-3">{state.services.filter((s) => !s.archived).map((s) => (
        <label key={s.slug} className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs"><span className="flex-1">{s.name}</span>
          <button type="button" onClick={() => setCfg({ ...cfg, equipmentServices: cfg.equipmentServices.includes(s.slug) ? cfg.equipmentServices.filter((x) => x !== s.slug) : [...cfg.equipmentServices, s.slug] })} className={cfg.equipmentServices.includes(s.slug) ? "nb-chip-on h-7 px-2 text-[10px]" : "nb-chip-off h-7 px-2 text-[10px]"} data-testid={`turnaround-equipment-${s.slug}`}>Equipment</button>
          <input className="nb-input h-8 w-16 text-xs" inputMode="numeric" placeholder="—" value={cfg.byService[s.slug] ?? ""} onChange={(e) => table("byService", s.slug, e.target.value)} data-testid={`turnaround-service-${s.slug}`} /></label>))}</div></div>
      <div><p className="nb-label">By practitioner (overrides service)</p><div className="grid gap-2 sm:grid-cols-3">{state.practitioners.map((p) => (
        <label key={p.id} className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs"><span className="flex-1">{p.name}</span><input className="nb-input h-8 w-16 text-xs" inputMode="numeric" placeholder="—" value={cfg.byPractitioner[p.id] ?? ""} onChange={(e) => table("byPractitioner", p.id, e.target.value)} data-testid={`turnaround-practitioner-${p.id}`} /></label>))}</div></div>
      <p className="text-[11px] text-nb-mute">Order: appointment override → practitioner → service → appointment type. New availability uses these buffers. Confirmed bookings are never moved.</p>
      <button type="button" disabled={busy} onClick={save} className="nb-btn-primary h-11 px-5" data-testid="turnaround-config-save">{busy ? "Saving…" : "Save buffers"}</button>
    </section>
  );
}

const Stat = ({ label, value, testid }) => <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[11px] text-nb-mute">{label}</p><p className="nb-num text-lg font-semibold" data-testid={testid}>{value ?? "—"}</p></div>;

function ReportCard() {
  const { state } = useDemo();
  const [range, setRange] = useState({ start: addDays(todayISO(), -30), end: todayISO(), practitionerId: "" });
  const [data, setData] = useState(null);
  useEffect(() => { api.turnaroundReport(range).then(setData).catch(() => setData(null)); }, [range]);
  const s = data?.summary;
  return (
    <section className="nb-card space-y-4 rounded-[28px] p-5" data-testid="turnaround-report">
      <p className="nb-eyebrow flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Turnaround report</p>
      <div className="flex flex-wrap items-end gap-2">
        <DateField value={range.start} onChange={(v) => setRange({ ...range, start: v })} testid="turnaround-report-start" />
        <DateField value={range.end} onChange={(v) => setRange({ ...range, end: v })} testid="turnaround-report-end" />
        <select className="nb-input h-11 w-auto" value={range.practitionerId} onChange={(e) => setRange({ ...range, practitionerId: e.target.value })} data-testid="turnaround-report-practitioner"><option value="">All practitioners</option>{state.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {!s ? <p className="text-sm text-nb-mute">Loading…</p> : s.sessions === 0 ? <p className="text-sm text-nb-mute" data-testid="turnaround-report-empty">No timed sessions in this period yet. Figures appear once practitioners use Start Session and End Treatment.</p> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Timed sessions" value={s.sessions} testid="tr-sessions" />
            <Stat label="Booked vs actual (avg)" value={s.avgBookedMin != null ? `${s.avgBookedMin} / ${s.avgActualMin} min` : null} testid="tr-booked-actual" />
            <Stat label="Overtime" value={`${s.overtimeCount}${s.avgOvertimeMin ? ` · avg ${s.avgOvertimeMin} min` : ""}`} testid="tr-overtime" />
            <Stat label="Avg cleanup (buffer)" value={s.avgCleanupMin != null ? `${s.avgCleanupMin} (${s.avgCleanupBufferMin}) min` : null} testid="tr-cleanup" />
            <Stat label="Cleanup overruns" value={s.cleanupOverruns} testid="tr-overruns" />
            <Stat label="On-time starts" value={`${s.onTimeStarts} of ${s.onTimeStarts + s.lateStarts}`} testid="tr-punctuality" />
            <Stat label="Travel delays" value={`${s.travelDelays}${s.avgTravelDelayMin ? ` · avg ${s.avgTravelDelayMin} min` : ""}`} testid="tr-travel" />
            <Stat label="Scheduling conflicts" value={s.conflicts} testid="tr-conflicts" />
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs" data-testid="turnaround-report-table"><thead className="text-nb-mute"><tr><th className="py-2">Visit</th><th>Practitioner</th><th>Booked</th><th>Actual</th><th>Overtime</th><th>Start delay</th><th>Cleanup</th><th>Travel delay</th></tr></thead>
            <tbody>{data.visits.map((v) => <tr key={v.id} className="border-t border-sky-50"><td className="py-2">{v.ref} · {v.date} {v.time}</td><td>{v.practitioner}</td><td>{v.bookedMin}</td><td>{v.actualMin ?? "—"}</td><td>{v.overtimeMin ?? "—"}</td><td>{v.startDelayMin == null ? "—" : Math.round(v.startDelayMin)}</td><td>{v.cleanupMin ?? "—"}{v.cleanupBufferMin ? ` / ${v.cleanupBufferMin}` : ""}</td><td>{v.travelDelayMin || "—"}</td></tr>)}</tbody></table></div>
        </>
      )}
    </section>
  );
}

export default function Turnaround() {
  const { idx } = useDemo();
  return (
    <div className="space-y-6" data-testid="owner-turnaround">
      <PageHeader eyebrow="Operations" title="Session turnaround" sub="Treatment timing, cleanup buffers and next-booking readiness from real session records." />
      <TurnaroundBoard people={idx.practitioners} />
      <ConfigCard />
      <ReportCard />
    </div>
  );
}
