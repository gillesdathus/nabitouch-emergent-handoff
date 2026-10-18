import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useDemo } from "@/store/DemoStore";
import { staffActor } from "@/lib/domain";

function useSave() {
  const { run, api, user } = useDemo();
  const [busy, setBusy] = useState(false);
  const save = async (patch, msg) => {
    setBusy(true);
    try { await run(() => api.patch("settings", "app", { ...patch, _audit: msg, _actor: staffActor(user) }), "Settings saved"); return true; }
    catch { return false; }
    finally { setBusy(false); }
  };
  return { save, busy };
}

function Card({ title, hint, editing, onEdit, testid, children, summary }) {
  return (
    <section className="nb-panel p-4 text-sm sm:p-5" data-testid={testid}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold">{title}</p>{hint && <p className="mt-0.5 text-xs text-nb-mute">{hint}</p>}</div>
        {!editing && <button type="button" onClick={onEdit} className="nb-btn-ghost h-9 shrink-0 px-3 text-xs" data-testid={`${testid}-edit`}><Pencil className="h-3.5 w-3.5" />Edit</button>}
      </div>
      <div className="mt-3">{editing ? children : summary}</div>
    </section>
  );
}

function Actions({ busy, onCancel, onSave, testid, disabled }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={onCancel} className="nb-btn-ghost h-9 px-4 text-xs" data-testid={`${testid}-cancel`}>Cancel</button>
      <button type="button" onClick={onSave} disabled={busy || disabled} className="nb-btn-primary h-9 px-4 text-xs" data-testid={`${testid}-save`}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
    </div>
  );
}

const BUFFERS = [["setupMin", "Setup", 180], ["cleanupMin", "Cleanup", 180], ["travelBufferMin", "Travel buffer", 180], ["leadMin", "Booking lead time", 1440]];

export function SchedulingEditor({ scheduling = {} }) {
  const { save, busy } = useSave();
  const [form, setForm] = useState(null);
  const invalid = form && BUFFERS.some(([k, , max]) => form[k] === "" || !Number.isInteger(Number(form[k])) || Number(form[k]) < 0 || Number(form[k]) > max);
  const submit = async () => {
    const body = Object.fromEntries(BUFFERS.map(([k]) => [k, Number(form[k])]));
    body.enforceAdjacentTravel = Boolean(form.enforceAdjacentTravel);
    if (await save({ scheduling: body }, `Scheduling buffers: setup ${body.setupMin}, cleanup ${body.cleanupMin}, travel ${body.travelBufferMin}, lead ${body.leadMin} min`)) setForm(null);
  };
  return (
    <Card title="Scheduling buffers" hint="Applied by the server to every new booking and reschedule." testid="settings-scheduling" editing={Boolean(form)}
      onEdit={() => setForm({ ...Object.fromEntries(BUFFERS.map(([k]) => [k, scheduling[k] ?? 0])), enforceAdjacentTravel: scheduling.enforceAdjacentTravel !== false })}
      summary={<p className="text-xs text-nb-mute" data-testid="settings-scheduling-summary">{BUFFERS.map(([k, l]) => `${l} ${scheduling[k] ?? 0} min`).join(" · ")}{scheduling.enforceAdjacentTravel === false ? " · adjacent travel not enforced" : ""}</p>}>
      {form && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BUFFERS.map(([k, l, max]) => (
            <label key={k} className="text-xs font-medium text-nb-mute">{l} (min)
              <input type="number" min="0" max={max} step="1" inputMode="numeric" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="nb-input mt-1 h-10" data-testid={`settings-${k}`} />
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={form.enforceAdjacentTravel} onChange={(e) => setForm({ ...form, enforceAdjacentTravel: e.target.checked })} data-testid="settings-enforce-travel" />Require drive time between back-to-back visits</label>
        {invalid && <p className="mt-2 text-xs text-rose-700" role="alert">Use whole minutes: up to 180 for buffers and 1440 for lead time.</p>}
        <Actions busy={busy} disabled={invalid} onCancel={() => setForm(null)} onSave={submit} testid="settings-scheduling" />
      </>}
    </Card>
  );
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);

export function AddonsEditor({ addons = [] }) {
  const { save, busy } = useSave();
  const [rows, setRows] = useState(null);
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const invalid = rows && rows.some((r) => !r.name.trim() || r.price === "" || Number(r.price) < 0 || Number(r.price) > 1000);
  const submit = async () => {
    const seen = new Set();
    const body = rows.map((r) => {
      let id = r.id || slugify(r.name) || "addon";
      while (seen.has(id)) id = `${id}-2`;
      seen.add(id);
      return { id, name: r.name.trim().slice(0, 60), price: Math.round(Number(r.price) * 100) / 100 };
    });
    if (await save({ addons: body }, `Enhancements updated (${body.length})`)) setRows(null);
  };
  return (
    <Card title="Enhancements (add-ons)" hint="Shown at booking. Prices are before GST. Existing bookings keep their stored price." testid="settings-addons" editing={Boolean(rows)} onEdit={() => setRows(addons.map((a) => ({ ...a, price: String(a.price) })))}
      summary={addons.length ? <ul className="space-y-1" data-testid="settings-addons-list">{addons.map((a) => <li key={a.id} className="flex justify-between gap-2 text-xs"><span>{a.name}</span><span className="nb-num font-semibold">${Number(a.price).toFixed(2)}</span></li>)}</ul> : <p className="text-xs text-nb-mute">No enhancements offered.</p>}>
      {rows && <>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.75rem_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_auto]" data-testid={`settings-addon-row-${i}`}>
              <input aria-label="Name" value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="nb-input h-10" placeholder="Name" data-testid={`settings-addon-name-${i}`} />
              <input aria-label="Price" type="number" min="0" step="0.5" inputMode="decimal" value={r.price} onChange={(e) => set(i, { price: e.target.value })} className="nb-input h-10" placeholder="$" data-testid={`settings-addon-price-${i}`} />
              <button type="button" aria-label={`Remove ${r.name || "enhancement"}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="nb-btn-ghost h-10 w-10 px-0" data-testid={`settings-addon-remove-${i}`}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows([...rows, { id: "", name: "", price: "" }])} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-nb-blue" data-testid="settings-addon-add"><Plus className="h-3.5 w-3.5" />Add enhancement</button>
        {invalid && <p className="mt-2 text-xs text-rose-700" role="alert">Each enhancement needs a name and a price between $0 and $1,000.</p>}
        <Actions busy={busy} disabled={invalid} onCancel={() => setRows(null)} onSave={submit} testid="settings-addons" />
      </>}
    </Card>
  );
}

export function ReminderDaysEditor({ days }) {
  const current = days?.length ? days : [60, 30, 14, 7];
  const { save, busy } = useSave();
  const [text, setText] = useState(null);
  const parsed = text == null ? [] : [...new Set(text.split(/[,\s]+/).filter(Boolean).map(Number))].sort((a, b) => b - a);
  const invalid = text != null && (!parsed.length || parsed.length > 8 || parsed.some((d) => !Number.isInteger(d) || d < 1 || d > 365));
  const submit = async () => { if (await save({ credentialReminderDays: parsed }, `Credential reminders: ${parsed.join(", ")} days before expiry`)) setText(null); };
  return (
    <Card title="Credential reminder days" hint="Days before a licence or insurance expiry when the owner and practitioner are reminded." testid="settings-reminders" editing={text != null} onEdit={() => setText(current.join(", "))}
      summary={<p className="text-xs text-nb-mute" data-testid="settings-reminders-summary">{current.join(", ")} days before expiry</p>}>
      {text != null && <>
        <input value={text} onChange={(e) => setText(e.target.value)} className="nb-input h-10" aria-label="Reminder days" placeholder="60, 30, 14, 7" data-testid="settings-reminders-input" />
        <p className="mt-1 text-[11px] text-nb-mute">Comma-separated whole days, 1–365, up to 8 values.</p>
        {invalid && <p className="mt-1 text-xs text-rose-700" role="alert">Enter between 1 and 8 whole numbers from 1 to 365.</p>}
        <Actions busy={busy} disabled={invalid} onCancel={() => setText(null)} onSave={submit} testid="settings-reminders" />
      </>}
    </Card>
  );
}

export function CancellationPolicyEditor({ policy = {} }) {
  const { save, busy } = useSave();
  const [form, setForm] = useState(null);
  const invalid = form && form.text.trim().length < 20;
  const submit = async () => { if (await save({ cancellationPolicy: { ...policy, text: form.text.trim().slice(0, 2000), status: form.status, automaticFee: false } }, `Cancellation policy wording saved (${form.status})`)) setForm(null); };
  return (
    <Card title="Cancellation policy" hint="Wording shown to clients. Automatic cancellation and no-show fees stay off until separately authorized." testid="cancellation-fee" editing={Boolean(form)} onEdit={() => setForm({ text: policy.text || "", status: policy.status || "pending" })}
      summary={<><p className="text-sm" data-testid="settings-cancellation-text">{policy.text || "No wording saved."}</p><p className="mt-2 text-xs text-nb-mute">Status: <b className="capitalize">{policy.status || "pending"}</b> · Automatic fee off</p></>}>
      {form && <>
        <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={5} maxLength={2000} className="nb-input h-auto py-3" aria-label="Cancellation policy wording" data-testid="settings-cancellation-input" />
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="nb-input mt-2 h-10" aria-label="Policy status" data-testid="settings-cancellation-status"><option value="pending">Pending review</option><option value="approved">Approved</option></select>
        {invalid && <p className="mt-1 text-xs text-rose-700" role="alert">Write at least 20 characters.</p>}
        <Actions busy={busy} disabled={invalid} onCancel={() => setForm(null)} onSave={submit} testid="settings-cancellation" />
      </>}
    </Card>
  );
}
