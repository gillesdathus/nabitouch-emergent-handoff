import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/store/DemoStore";
import { addDays, todayISO, fmtDate } from "@/lib/domain";
import { EmptyState, PageHeader } from "@/components/tide";

export default function Plans() {
  const { state, idx, practitionerId, run, api } = useDemo();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ clientId: state.clients[0].id, title: "", frequency: "Every 2 weeks", sessionsTotal: 6, homeCare: "" });
  const plans = state.plans.filter((p) => p.practitionerId === practitionerId);
  const save = async () => { await run(() => api.create("plans", { ...f, practitionerId, sessionsTotal: Number(f.sessionsTotal), sessionsDone: 0, homeCare: f.homeCare.split(",").map((x) => x.trim()).filter(Boolean), nextReview: addDays(todayISO(), 28), visibleToClient: true }), "Plan created"); setOpen(false); };
  return (
    <div className="mx-auto max-w-3xl" data-testid="pro-plans">
      <PageHeader eyebrow="Care" title="Treatment plans" right={<button type="button" onClick={() => setOpen(true)} data-testid="plan-new-btn" className="nb-btn-primary h-10 text-sm"><Plus className="h-4 w-4" />New plan</button>} />
      <div className="space-y-3">
        {plans.map((p) => (
          <div key={p.id} className="nb-card p-5" data-testid={`plan-${p.id}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{p.title}</p><p className="text-xs text-nb-mute">{idx.clients[p.clientId]?.firstName} {idx.clients[p.clientId]?.lastName} · {p.frequency} · review {fmtDate(p.nextReview)}</p></div>
              <div className="flex items-center gap-2"><button type="button" onClick={() => run(() => api.patch("plans", p.id, { sessionsDone: Math.max(0, p.sessionsDone - 1) }))} data-testid={`plan-dec-${p.id}`} className="rounded-full bg-sky-50 p-2" aria-label="Decrease"><Minus className="h-4 w-4" /></button><span className="w-12 text-center text-sm font-semibold">{p.sessionsDone}/{p.sessionsTotal}</span><button type="button" onClick={() => run(() => api.patch("plans", p.id, { sessionsDone: Math.min(p.sessionsTotal, p.sessionsDone + 1) }))} data-testid={`plan-inc-${p.id}`} className="rounded-full bg-sky-50 p-2" aria-label="Increase"><Plus className="h-4 w-4" /></button></div></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100"><div className="nb-gradient h-full transition-[width] duration-500" style={{ width: `${(p.sessionsDone / p.sessionsTotal) * 100}%` }} /></div>
            <p className="mt-2 text-xs text-nb-mute">Home care: {p.homeCare.join(", ") || "—"}</p>
          </div>))}
        {plans.length === 0 && (
          <EmptyState title="No plans yet" body="Create a treatment plan to track sessions and home care for a client." action={<button type="button" onClick={() => setOpen(true)} className="nb-btn-primary h-11 px-5" data-testid="plan-empty-new"><Plus className="mr-1 inline h-4 w-4" />New plan</button>} testid="pro-plans-empty" />
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl" data-testid="plan-dialog">
          <DialogTitle>New treatment plan</DialogTitle>
          <select className="nb-input" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} data-testid="plan-client-select">{state.clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select>
          <input className="nb-input" placeholder="Plan title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="plan-title-input" />
          <div className="grid grid-cols-2 gap-2"><input className="nb-input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} data-testid="plan-frequency-input" /><input type="number" className="nb-input" value={f.sessionsTotal} onChange={(e) => setF({ ...f, sessionsTotal: e.target.value })} data-testid="plan-sessions-input" /></div>
          <input className="nb-input" placeholder="Home care (comma separated)" value={f.homeCare} onChange={(e) => setF({ ...f, homeCare: e.target.value })} data-testid="plan-homecare-input" />
          <button disabled={!f.title} onClick={save} data-testid="plan-save-btn" className="nb-btn-primary w-full">Create plan</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
