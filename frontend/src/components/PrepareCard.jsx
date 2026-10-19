import { useEffect, useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Check, ChevronDown, ClipboardCheck, ShieldCheck } from "lucide-react";
import { api, apiError } from "@/lib/api";

function Section({ s, open, onToggle }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100" data-testid={`prep-section-${s.id}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left" data-testid={`prep-section-${s.id}-toggle`} aria-expanded={open}>
        <span className="text-sm font-semibold">{s.title}</span>
        <ChevronDown className={`h-4 w-4 text-nb-mute transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <ul className="space-y-2">{s.items.map((t) => <li key={t} className="flex gap-2 text-sm leading-relaxed text-nb-ink"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-nb-turq" />{t}</li>)}</ul>
          {s.note && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{s.note}</p>}
        </div>
      )}
    </div>
  );
}

export function PrepareCard({ appt }) {
  const [prep, setPrep] = useState(null);
  const [items, setItems] = useState({});
  const [open, setOpen] = useState("space");
  const [expanded, setExpanded] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.preparation(appt.id).then((p) => {
      setPrep(p);
      setItems(p.readiness?.items || {});
      setExpanded(!p.readiness?.allReady);
    }).catch(() => setPrep(null));
  }, [appt.id]);
  if (!prep) return null;
  const done = prep.checklist.filter((c) => items[c.key]).length;
  const all = done === prep.checklist.length;
  const save = async (next) => {
    setItems(next); setSaving(true);
    try {
      const r = await api.saveReadiness(appt.id, next);
      setPrep({ ...prep, readiness: r });
      if (r.allReady) {
        toast.success("You're all set. Your therapist can see that your space is ready.");
        setExpanded(false);
      }
    } catch (e) { toast.error(apiError(e)); }
    setSaving(false);
  };
  if (all && !expanded) {
    return (
      <section className="rounded-2xl bg-emerald-50/80 p-4 ring-1 ring-emerald-100" data-testid="prepare-card">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-nb-teal"><ShieldCheck className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" data-testid="prepare-complete-title">Space preparation saved</p>
            <p className="mt-0.5 text-xs text-nb-mute" data-testid="prepare-progress">{done}/{prep.checklist.length} confirmed on your account. This is separate from visit status.</p>
            {prep.readiness?.updatedAt && <p className="mt-1 text-[11px] text-nb-mute" data-testid="readiness-updated">Saved {new Date(prep.readiness.updatedAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}.</p>}
          </div>
          <button type="button" className="nb-btn-ghost h-9 shrink-0 px-3 text-xs" data-testid="prepare-expand" onClick={() => setExpanded(true)}>Review</button>
        </div>
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-[32px] bg-white/70 ring-1 ring-sky-100 backdrop-blur-xl" data-testid="prepare-card">
      <div className="relative p-5 text-white nb-lagoon sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">Prepare for your massage</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <h3 className="text-xl font-semibold sm:text-2xl">{all ? "Your space is ready" : "A few things before we arrive"}</h3>
          <div className="text-right" data-testid="prepare-progress"><p className="nb-num text-3xl font-semibold leading-none">{done}/{prep.checklist.length}</p><p className="text-[11px] text-white/75">confirmed</p></div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20"><motion.div className="h-full rounded-full bg-gradient-to-r from-nb-turq to-white" animate={{ width: `${(done / prep.checklist.length) * 100}%` }} transition={{ duration: 0.5 }} /></div>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-2">{prep.sections.map((s) => <Section key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? "" : s.id)} />)}</div>
        <div>
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-nb-teal" />Readiness checklist</p>
          <p className="mb-2 text-[11px] text-nb-mute">Saved on this appointment. Checking items does not change visit status.</p>
          <div className="space-y-2" data-testid="readiness-checklist">
            {prep.checklist.map((c) => {
              const on = Boolean(items[c.key]);
              return (
                <button key={c.key} type="button" disabled={saving} onClick={() => save({ ...items, [c.key]: !on })} data-testid={`readiness-${c.key}`} aria-pressed={on}
                  className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-4 text-left text-sm ring-1 transition-[background-color,box-shadow] duration-200 ${on ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-sky-100 hover:ring-sky-200"}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors ${on ? "bg-nb-teal text-white" : "ring-2 ring-sky-200"}`}>{on && <Check className="h-3.5 w-3.5" />}</span>{c.label}
                </button>
              );
            })}
          </div>
          {prep.readiness?.updatedAt && <p className="mt-3 text-[11px] text-nb-mute" data-testid="readiness-updated">Saved {new Date(prep.readiness.updatedAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}. You can change it until the visit starts.</p>}
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-nb-mute"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />{prep.disclaimer}</p>
          {all && <button type="button" className="nb-btn-ghost mt-3 h-10 w-full text-sm" data-testid="prepare-collapse" onClick={() => setExpanded(false)}>Show compact summary</button>}
        </div>
      </div>
    </section>
  );
}

export function ReadinessBadge({ readiness }) {
  const n = readiness ? Object.values(readiness.items || {}).filter(Boolean).length : 0;
  const total = readiness ? Object.keys(readiness.items || {}).length || 6 : 6;
  const tone = readiness?.allReady ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : n ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-slate-50 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${tone}`} data-testid="readiness-badge">
      <ClipboardCheck className="h-3.5 w-3.5" />{readiness?.allReady ? "Client space ready" : n ? `Client readiness ${n}/${total}` : "Readiness not confirmed"}
    </span>
  );
}
