import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RotateCcw, CalendarPlus, StopCircle, Trash2, FlaskConical, UserRound, Stethoscope, Headset, Crown } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, BottomSheet, Field, Pill, Reveal, Notice, EmptyState, cx } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";

const ROLES = [["owner", Crown, "Manager"], ["pro", Stethoscope, "Practitioner"], ["client", UserRound, "Client"], ["desk", Headset, "Reception"]];
const PRESETS = [[1, "24h"], [3, "3d"], [7, "7d"], [14, "14d"], [30, "30d"]];

function Ring({ value }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90"><circle cx="32" cy="32" r={r} stroke="#FDE68A" strokeWidth="6" fill="none" /><circle cx="32" cy="32" r={r} stroke="#F59E0B" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} style={{ transition: "stroke-dashoffset .7s ease" }} /></svg>
  );
}

export default function Training() {
  const { db, api, setRole } = usePreview();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", days: 7 });
  return (
    <div className="max-w-5xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Manage" title="Training Center" sub="Isolated scenarios — separate database, no real bookings or payments" right={<TopIcons base="/owner" />} />
      <div className="flex justify-end mb-4"><button data-testid="new-scenario-btn" onClick={() => setOpen(true)} className="nb-btn-primary h-11 text-sm"><Plus className="h-4 w-4" />New scenario</button></div>
      {db.scenarios.length === 0 && <EmptyState icon={FlaskConical} title="No scenarios" />}
      <div className="grid md:grid-cols-2 gap-4">
        {db.scenarios.map((s, i) => {
          const ms = new Date(s.expiresAt) - Date.now();
          const remaining = ms > 0 ? `${Math.floor(ms / 86400e3)}d ${Math.floor((ms % 86400e3) / 3600e3)}h left` : "Ended";
          const total = s.days * 86400e3;
          return (
            <Reveal key={s.id} i={i}>
              <div data-testid={`scenario-card-${s.id}`} className="nb-card p-5 border-amber-200">
                <div className="flex items-start gap-4">
                  <div className="relative"><Ring value={Math.max(0, Math.min(1, ms / total))} /><FlaskConical className="absolute inset-0 m-auto h-5 w-5 text-amber-600" /></div>
                  <div className="flex-1 min-w-0"><Pill tone={s.status === "active" ? "bg-amber-100 text-amber-800 ring-amber-300" : "bg-slate-100 text-nb-mute ring-slate-200"}>{s.status === "active" ? "Active" : "Ended"}</Pill><p className="font-semibold mt-1.5">{s.name}</p><p className="text-xs text-nb-mute">Created {new Date(s.createdAt).toLocaleDateString("en-CA")} · {remaining}</p></div>
                </div>
                <p className="nb-eyebrow mt-4 mb-2 !text-amber-700">Open a role</p>
                <div className="grid grid-cols-4 gap-2">
                  {ROLES.map(([k, I, l]) => <button key={k} data-testid={`scenario-${s.id}-open-${k}`} disabled={s.status !== "active"} onClick={() => { setRole("training"); nav(`/train?role=${k}`); }} className="rounded-2xl bg-amber-50 py-3 flex flex-col items-center gap-1 text-[11px] font-medium text-amber-900 active:scale-95 transition-transform disabled:opacity-40"><I className="h-4 w-4" />{l}</button>)}
                </div>
                <div className="flex gap-2 mt-4">
                  <button data-testid={`scenario-reset-${s.id}`} onClick={() => api.save("scenarios", s.id, { progress: 0 }, "Scenario reset")} className="nb-btn-ghost h-10 flex-1 text-xs"><RotateCcw className="h-3.5 w-3.5" />Reset</button>
                  <button data-testid={`scenario-extend-${s.id}`} onClick={() => api.save("scenarios", s.id, (x) => ({ status: "active", expiresAt: new Date(Math.max(Date.now(), new Date(x.expiresAt)) + 7 * 86400e3).toISOString() }), "Extended 7 days")} className="nb-btn-ghost h-10 flex-1 text-xs"><CalendarPlus className="h-3.5 w-3.5" />Extend</button>
                  <button data-testid={`scenario-end-${s.id}`} onClick={() => api.save("scenarios", s.id, { status: "ended", expiresAt: new Date().toISOString() }, "Scenario ended")} className="nb-btn-ghost h-10 px-3"><StopCircle className="h-4 w-4" /></button>
                  <button data-testid={`scenario-delete-${s.id}`} onClick={() => api.remove("scenarios", s.id, "Scenario deleted")} className="nb-btn-ghost h-10 px-3 text-nb-coral"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
      <BottomSheet open={open} onOpenChange={setOpen} title="New training scenario" testid="scenario-sheet" footer={<button data-testid="scenario-submit" disabled={!f.name} onClick={async () => { await api.create("scenarios", { id: `tr${Date.now()}`, name: f.name, status: "active", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + f.days * 86400e3).toISOString(), days: f.days, progress: 0, tasks: ["Book a visit", "Record cash"] }, "Scenario created with 4 fictional personas"); setOpen(false); }} className="nb-btn-primary w-full">Create scenario</button>}>
        <Field label="Scenario name"><input data-testid="scenario-name" className="nb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <p className="nb-label">Expires after</p>
        <div className="flex gap-2 flex-wrap mb-4">{PRESETS.map(([d, l]) => <button key={d} data-testid={`scenario-days-${d}`} onClick={() => setF({ ...f, days: d })} className={cx(f.days === d ? "nb-chip-on" : "nb-chip-off")}>{l}</button>)}</div>
        <Notice>One-time training passwords are shown once after creation. They are never stored in analytics.</Notice>
      </BottomSheet>
    </div>
  );
}
