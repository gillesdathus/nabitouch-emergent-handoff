import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, ShieldAlert, TriangleAlert, UserCheck } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { EmptyState, Notice, PageHeader, Reveal, Segmented } from "@/components/tide";

const OUTCOMES = [["resume", "Resume visit"], ["resume_session", "Resume session"], ["leave", "Practitioner leaves"], ["cancel", "Cancel visit"]];
const stamp = (iso) => new Date(iso).toLocaleString("en-CA", { timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Managers() {
  const [data, setData] = useState(null);
  useEffect(() => { api.safetyManagers().then(setData).catch(() => setData(null)); }, []);
  if (!data) return null;
  const toggle = (id) => {
    const next = data.managers.includes(id) ? data.managers.filter((x) => x !== id) : [...data.managers, id];
    api.saveSafetyManagers(next).then((r) => { setData({ ...data, managers: r.managers }); toast.success("Safety managers saved"); }).catch((e) => toast.error(apiError(e)));
  };
  return (
    <section className="nb-card p-5" data-testid="safety-managers">
      <p className="flex items-center gap-2 font-semibold"><UserCheck className="h-4 w-4 text-nb-teal" />Safety managers</p>
      <p className="mt-1 text-xs text-nb-mute">The owner always receives alerts. Add staff who should also see them in the app.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.staff.map((u) => <button key={u.id} type="button" onClick={() => toggle(u.id)} data-testid={`safety-manager-${u.id}`} className={data.managers.includes(u.id) ? "nb-chip-on h-9 text-xs" : "nb-chip-off h-9 text-xs"}>{u.name} · {u.role === "desk" ? "Reception" : "Practitioner"}</button>)}
        {data.staff.length === 0 && <p className="text-xs text-nb-mute">No staff accounts yet.</p>}
      </div>
    </section>
  );
}

function PushStatus() {
  const [s, setS] = useState(null);
  useEffect(() => { api.pushStatus().then(setS).catch(() => {}); }, []);
  if (!s) return null;
  return <Notice testid="push-status">{s.pushEnabled ? `Push is on. ${s.outbox.sent} sent, ${s.outbox.failed} failed.` : `Push is off${s.flag ? "" : " (PUSH_ENABLED=false)"}${s.firebaseConfigured ? "" : ` · Firebase credentials: ${s.credentials.replace(/_/g, " ")}`}. ${s.outbox.held} alert${s.outbox.held === 1 ? "" : "s"} held for ${s.devices} registered phone${s.devices === 1 ? "" : "s"}.`}</Notice>;
}

function EventCard({ e, onChange }) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState(null);
  const hold = e.kind === "incident" && e.action === "cannot_proceed";
  const act = (p) => p.then(() => { toast.success("Saved"); onChange(); }).catch((err) => toast.error(apiError(err)));
  const Icon = e.kind === "assist" ? LifeBuoy : TriangleAlert;
  return (
    <div className={`nb-card p-5 ${e.status === "open" ? "ring-2 ring-rose-200" : ""}`} data-testid={`safety-event-${e.id}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${e.kind === "assist" ? "tint-lagoon text-nb-blue" : "bg-amber-50 text-amber-700"}`}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{e.kind === "assist" ? "Assistance requested" : `Space reported: ${e.incidentKind}`}{hold ? " · cannot proceed" : e.action ? " · fix requested" : ""}</p>
          <p className="text-xs text-nb-mute">{e.practitionerName} · {e.ref} · {stamp(e.at)}</p>
          {e.note && <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs">“{e.note}”</p>}
          {e.acks?.length > 0 && <p className="mt-2 text-[11px] text-nb-mute">Acknowledged by {e.acks.map((a) => a.by).join(", ")}</p>}
          {e.status === "resolved" && <p className="mt-2 text-[11px] text-teal-700">Resolved by {e.resolvedBy}{e.outcome ? ` · ${e.outcome.replace("_", " ")}` : ""}{e.resolution ? ` · ${e.resolution}` : ""}</p>}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${e.status === "open" ? "bg-rose-50 text-rose-700" : e.status === "acknowledged" ? "bg-amber-50 text-amber-800" : "bg-teal-50 text-teal-700"}`} data-testid={`safety-event-status-${e.id}`}>{e.status}</span>
      </div>
      {e.status !== "resolved" && (
        <div className="mt-4 space-y-2 border-t border-sky-100 pt-3">
          {hold && <div className="flex flex-wrap gap-2">{OUTCOMES.map(([k, l]) => <button key={k} type="button" onClick={() => setOutcome(k)} data-testid={`safety-outcome-${k}-${e.id}`} className={outcome === k ? "nb-chip-on h-8 text-xs" : "nb-chip-off h-8 text-xs"}>{l}</button>)}</div>}
          <input className="nb-input h-10 w-full text-sm" placeholder="Resolution note" value={note} onChange={(ev) => setNote(ev.target.value)} data-testid={`safety-note-${e.id}`} />
          <div className="flex gap-2">
            {e.status === "open" && <button type="button" onClick={() => act(api.safetyAck(e.id))} data-testid={`safety-ack-${e.id}`} className="nb-btn-ghost h-10 flex-1 text-sm">Acknowledge</button>}
            <button type="button" onClick={() => act(api.safetyResolve(e.id, { note, outcome: hold ? outcome : undefined }))} disabled={hold && !outcome} data-testid={`safety-resolve-${e.id}`} className="nb-btn-primary h-10 flex-1 text-sm">{hold && !outcome ? "Choose how the visit continues" : "Resolve"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Safety() {
  const { user } = useDemo();
  const [filter, setFilter] = useState("open");
  const [data, setData] = useState(undefined);
  const [allowed, setAllowed] = useState(null);
  useEffect(() => { api.safetyMe().then((r) => setAllowed(r.manager)).catch(() => setAllowed(false)); }, []);
  const load = useCallback(() => allowed !== true ? Promise.resolve() : api.safetyEvents(filter === "all" ? "" : filter).then(setData).catch((e) => setData({ error: apiError(e), events: [] })), [filter, allowed]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  if (allowed === false) return <div className="mx-auto max-w-3xl space-y-6" data-testid="safety-page"><PageHeader eyebrow="Practitioner safety" title="Safety alerts" /><Notice testid="safety-not-manager">Safety alerts are shared with the owner and the staff the owner names as safety managers. Ask the owner to add you if you should receive them.</Notice></div>;
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="safety-page">
      <PageHeader eyebrow="Practitioner safety" title="Safety alerts" sub={data?.open ? `${data.open} open alert${data.open > 1 ? "s" : ""}` : "In-app alerts from practitioners in the field."} />
      <Notice icon={ShieldAlert} tone="warn" testid="safety-not-dispatch">{data?.assistLabel || "These are in-app alerts only. They are not emergency dispatch."}</Notice>
      {user?.role === "owner" && <Managers />}
      {user?.role === "owner" && <PushStatus />}
      <Segmented options={[{ value: "open", label: "Open" }, { value: "acknowledged", label: "Acknowledged" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }]} value={filter} onChange={setFilter} testid="safety-filter" />
      {data?.error && <Notice testid="safety-error">{data.error}</Notice>}
      <div className="space-y-3">
        {data === undefined && [0, 1].map((n) => <div key={n} className="h-28 rounded-3xl nb-skeleton" />)}
        {data?.events?.map((e, i) => <Reveal key={e.id} i={i}><EventCard e={e} onChange={load} /></Reveal>)}
        {data && !data.error && data.events.length === 0 && <EmptyState icon={ShieldAlert} testid="safety-empty" title="Nothing here" body="Alerts from practitioners appear here as they happen." />}
      </div>
    </div>
  );
}
