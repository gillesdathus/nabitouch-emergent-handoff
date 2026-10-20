import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, HeartHandshake, Settings2 } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { EmptyState, Field, Notice, PageHeader, SaveFeedback, Segmented } from "@/components/tide";
import { fmtDate } from "@/lib/domain";

function SettingsForm({ cfg, onSaved }) {
  const [f, setF] = useState(cfg);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ state: "idle", message: "" });
  useEffect(() => setF(cfg), [cfg]);
  const set = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) });
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback({ state: "saving", message: "Saving rules…" });
    try {
      await api.saveWinbackSettings(f);
      toast.success("Winback settings saved");
      setFeedback({ state: "success", message: "Rules saved." });
      onSaved();
    } catch (e) {
      setFeedback({ state: "error", message: apiError(e) });
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="nb-card grid gap-3 p-5 sm:grid-cols-4 sm:items-end" data-testid="winback-settings">
      <p className="flex items-center gap-2 font-semibold sm:col-span-4"><Settings2 className="h-4 w-4" />Rules</p>
      <Field label="Inactive for (days)"><input type="number" className="nb-input h-11 w-full" value={f.inactiveDays} onChange={set("inactiveDays")} data-testid="winback-days" /></Field>
      <Field label="Discount on treatment (%)"><input type="number" className="nb-input h-11 w-full" value={f.percent} onChange={set("percent")} data-testid="winback-percent" /></Field>
      <Field label="Code valid for (days)"><input type="number" className="nb-input h-11 w-full" value={f.validDays} onChange={set("validDays")} data-testid="winback-valid" /></Field>
      <div className="sm:col-span-4 space-y-2">
        <SaveFeedback state={feedback.state} message={feedback.message} testid="winback-settings-feedback" />
        <button type="button" disabled={busy} onClick={save} data-testid="winback-settings-save" className="nb-btn-primary h-11 text-sm">{busy ? "Saving…" : "Save rules"}</button>
      </div>
    </section>
  );
}

const copy = (code) => navigator.clipboard?.writeText(code).then(() => toast.success(`${code} copied`)).catch(() => toast.message(code));

function Candidates({ rows, reload }) {
  const create = (c) => api.createWinback(c.clientId).then((r) => { copy(r.code); reload(); }).catch((e) => toast.error(apiError(e)));
  if (!rows.length) return <EmptyState icon={HeartHandshake} testid="winback-empty" title="Everyone is coming back" body="No clients are past the inactivity window right now." />;
  return (
    <div className="space-y-2" data-testid="winback-candidates">
      {rows.map((c) => (
        <div key={c.clientId} className="nb-card flex flex-wrap items-center gap-4 p-4" data-testid={`winback-candidate-${c.clientId}`}>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{c.name}</p><p className="text-xs text-nb-mute">Last visit {fmtDate(c.lastVisit)} · {c.daysInactive} days ago</p></div>
          {c.invite
            ? <button type="button" onClick={() => copy(c.invite.code)} data-testid={`winback-copy-${c.clientId}`} className="nb-chip-off h-9 text-xs"><Copy className="h-3.5 w-3.5" />{c.invite.code} · {c.invite.status}</button>
            : <button type="button" onClick={() => create(c)} data-testid={`winback-create-${c.clientId}`} className="nb-btn-primary h-9 px-4 text-xs">Create code</button>}
        </div>
      ))}
    </div>
  );
}

function Invites({ rows, reload }) {
  const voidIt = (i) => window.confirm(`Void ${i.code}? The client will no longer be able to use it.`) && api.voidWinback(i.id).then(() => { toast.success("Code voided"); reload(); }).catch((e) => toast.error(apiError(e)));
  return (
    <div className="nb-card divide-y divide-sky-100" data-testid="winback-invites">
      {rows.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid={`winback-invite-${i.id}`}>
          <button type="button" onClick={() => copy(i.code)} className="font-mono font-semibold text-nb-blue">{i.code}</button>
          <span className="flex-1 text-xs text-nb-mute">{i.clientName || i.clientId} · {i.percent}% off · expires {fmtDate(i.expiresAt.slice(0, 10))}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold capitalize">{i.status}</span>
          {i.status === "issued" && <button type="button" onClick={() => voidIt(i)} data-testid={`winback-void-${i.id}`} className="nb-btn-ghost h-8 px-3 text-xs">Void</button>}
        </div>
      ))}
      {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-nb-mute">No codes yet.</p>}
    </div>
  );
}

export default function Winback() {
  const [tab, setTab] = useState("candidates");
  const [data, setData] = useState(null);
  const [invites, setInvites] = useState([]);
  const load = useCallback(() => {
    api.winbackCandidates().then(setData).catch((e) => toast.error(apiError(e)));
    api.winbackInvites().then(setInvites).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="winback-page">
      <PageHeader eyebrow="Retention" title="Welcome-back invites" sub={data ? `${data.candidates.length} ${data.candidates.length === 1 ? "client" : "clients"} inactive for ${data.settings.inactiveDays}+ days` : "Loading…"} />
      <Notice testid="winback-copy-only">Codes are one-time and tied to one client. Nothing is emailed or texted; copy the code and share it yourself. Codes do not combine with other discounts, package credits or rewards.</Notice>
      {data && <SettingsForm cfg={data.settings} onSaved={load} />}
      <Segmented options={[{ value: "candidates", label: "Inactive clients" }, { value: "invites", label: "All codes" }]} value={tab} onChange={setTab} testid="winback-tab" />
      {tab === "candidates" && data && <Candidates rows={data.candidates} reload={load} />}
      {tab === "invites" && <Invites rows={invites} reload={load} />}
    </div>
  );
}
