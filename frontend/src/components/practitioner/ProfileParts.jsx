import { useState } from "react";
import { BadgeCheck, CheckCircle2, Circle, FileBadge, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Pill } from "@/components/ui-kit";
import { Panel } from "@/components/ds";
import { GRACE_DAYS, REMINDER_DAYS } from "@/lib/practitionerStatus";
import { useDemo } from "@/store/DemoStore";

const CHIP_LABELS = [["account", "Account"], ["profile", "Profile"], ["booking", "Booking"], ["credentials", "Credentials"]];

export function StatusChips({ status, testid = "pr-status" }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid={testid}>
      {CHIP_LABELS.map(([key, label]) => {
        const [tone, text, reason] = status[key];
        return (
          <div key={key} className="min-w-0 rounded-2xl bg-white px-3 py-2 ring-1 ring-sky-100" data-testid={`${testid}-${key}`}>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-nb-mute">{label}</dt>
            <dd className="mt-1"><Pill tone={tone}>{text}</Pill>{reason && <span className="mt-1 block text-[11px] leading-snug text-nb-mute">{reason}</span>}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function CompletenessCard({ status, self }) {
  const pct = Math.round((status.done / status.items.length) * 100);
  const deadline = status.day == null ? "The 30-day window starts when the profile is activated."
    : status.complete ? "Profile complete." : status.overdue ? `The ${GRACE_DAYS}-day window ended ${status.day - GRACE_DAYS} day${status.day - GRACE_DAYS === 1 ? "" : "s"} ago. ${self ? "The owner has been alerted." : "Decide whether to keep booking open."}`
    : `${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left of ${GRACE_DAYS} to complete the profile.`;
  return (
    <Panel title="Profile completeness" action={<span className="nb-num text-sm font-semibold" data-testid="pr-complete-pct">{pct}%</span>} testid="pr-completeness">
      <div className="h-2 overflow-hidden rounded-full bg-sky-50"><div className="h-full rounded-full bg-gradient-to-r from-nb-blue via-nb-cyan to-nb-turq transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
      <p className={`mt-2 text-xs ${status.overdue ? "font-semibold text-rose-700" : "text-nb-mute"}`} data-testid="pr-deadline">{deadline}</p>
      <ul className="mt-3 space-y-1.5" data-testid="pr-checklist">
        {status.items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm" data-testid={`pr-item-${item.id}`}>
            {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" /> : <Circle className="h-4 w-4 shrink-0 text-slate-300" />}
            <span className={item.done ? "text-nb-mute line-through decoration-slate-300" : ""}>{item.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-nb-mute">Reminders on days {REMINDER_DAYS.join(", ")}. An incomplete profile does not close booking automatically; the owner decides.</p>
    </Panel>
  );
}

function CredentialRow({ kind, label, info, owner, personId, onChanged }) {
  const { api, run } = useDemo();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (fn, msg) => { setBusy(true); try { await run(fn, msg); setOpen(false); onChanged(); } catch { /* toast */ } setBusy(false); };
  const tone = { verified: "turq", attested: "amber", submitted: "blue", missing: "red" }[info.state];
  const text = { verified: "Verified", attested: "Owner attested", submitted: "Awaiting verification", missing: "Not on file" }[info.state];
  return (
    <li className="rounded-2xl bg-white p-3 ring-1 ring-sky-100" data-testid={`pr-cred-${kind}`}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">{info.state === "verified" ? <ShieldCheck className="h-4 w-4 text-teal-600" /> : <ShieldAlert className="h-4 w-4 text-amber-600" />}{label}</p>
        <Pill tone={tone} testid={`pr-cred-${kind}-state`}>{text}</Pill>
      </div>
      {info.record && <p className="mt-1 text-xs text-nb-mute">{info.record.identifier} · expires {info.record.expiresOn}{info.soon ? " · renew soon" : ""}</p>}
      {info.state === "attested" && <p className="mt-1 text-xs text-amber-800">Attested by {info.attestation.by} on {String(info.attestation.at).slice(0, 10)}{info.attestation.note ? ` · ${info.attestation.note}` : ""}. Booking is open; upload and verify the document to clear this alert.</p>}
      {owner && info.state !== "verified" && info.state !== "attested" && !open && <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-nb-blue" data-testid={`pr-attest-open-${kind}`}>I have seen this credential — open booking</button>}
      {owner && open && (
        <div className="mt-2 space-y-2 rounded-xl bg-amber-50 p-3">
          <p className="text-xs text-amber-900">You confirm the practitioner holds a current {label.toLowerCase()}. This is recorded in the audit log, and the document stays required.</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (e.g. seen original certificate, policy number)" className="nb-input h-10" data-testid={`pr-attest-note-${kind}`} />
          <div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="nb-btn-ghost h-9 px-3 text-xs">Cancel</button><button type="button" disabled={busy} onClick={() => act(() => api.attestCredential(personId, { kind, confirm: true, note }), "Attestation recorded — booking can open")} className="nb-btn-primary h-9 px-3 text-xs" data-testid={`pr-attest-confirm-${kind}`}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Confirm attestation</button></div>
        </div>
      )}
      {owner && info.state === "attested" && <button type="button" disabled={busy} onClick={() => act(() => api.revokeAttestation(personId, kind), "Attestation removed")} className="mt-2 text-xs font-semibold text-rose-700" data-testid={`pr-attest-revoke-${kind}`}>Remove attestation</button>}
    </li>
  );
}

const KINDS = [["registration", "Registration / licence"], ["liability", "Liability insurance"], ["association", "Association"], ["membership", "Membership"], ["municipal", "Municipal licence"], ["other", "Other / education"]];
const BLANK = { kind: "registration", identifier: "", issuingAuthority: "", province: "AB", provider: "", effectiveOn: "", expiresOn: "", documentNote: "" };

export function CredentialPanel({ person, status, credentials, owner, onChanged }) {
  const { api, run } = useDemo();
  const [form, setForm] = useState(null);
  const others = credentials.filter((c) => c.practitionerId === person.id && !["registration", "liability"].includes(c.kind));
  const pending = credentials.filter((c) => c.practitionerId === person.id && c.status !== "verified");
  const save = async (e) => {
    e.preventDefault();
    try { await run(() => api.addCredential({ ...form, practitionerId: person.id }), owner ? "Credential recorded" : "Credential submitted for review"); setForm(null); onChanged(); } catch { /* toast */ }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-3" data-testid="pr-credentials">
      <ul className="space-y-2">
        <CredentialRow kind="registration" label="Registration / licence" info={status.registration} owner={owner} personId={person.id} onChanged={onChanged} />
        <CredentialRow kind="liability" label="Liability insurance" info={status.liability} owner={owner} personId={person.id} onChanged={onChanged} />
        {others.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 text-sm ring-1 ring-sky-100" data-testid={`pr-cred-other-${c.id}`}><span className="min-w-0"><b className="capitalize">{c.kind}</b> · {c.identifier} · expires {c.expiresOn}</span><Pill tone={c.status === "verified" ? "turq" : "blue"}>{c.status === "verified" ? "Verified" : "Awaiting verification"}</Pill></li>)}
      </ul>
      {owner && pending.length > 0 && (
        <div className="rounded-2xl bg-sky-50 p-3" data-testid="pr-pending">
          <p className="text-xs font-semibold">Waiting for your verification</p>
          {pending.map((c) => <div key={c.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="min-w-0 capitalize">{c.kind} · {c.identifier} · expires {c.expiresOn}</span><button type="button" onClick={async () => { try { await run(() => api.verifyCredential(c.id), "Credential verified"); onChanged(); } catch { /* toast */ } }} className="nb-btn-dark h-8 px-3 text-xs" data-testid={`pr-verify-${c.id}`}><BadgeCheck className="h-3.5 w-3.5" />Mark verified</button></div>)}
        </div>
      )}
      {!form && <button type="button" onClick={() => setForm(BLANK)} className="nb-btn-ghost h-10 px-4 text-sm" data-testid="pr-cred-add"><FileBadge className="h-4 w-4" />Add licence or insurance details</button>}
      {form && (
        <form onSubmit={save} className="grid gap-2 rounded-2xl bg-white p-4 ring-1 ring-sky-100 sm:grid-cols-2" data-testid="pr-cred-form">
          <label className="text-xs text-nb-mute">Type<select className="nb-input mt-1 h-10" value={form.kind} onChange={set("kind")} data-testid="pr-cred-kind">{KINDS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
          <label className="text-xs text-nb-mute">Number / policy<input required className="nb-input mt-1 h-10" value={form.identifier} onChange={set("identifier")} data-testid="pr-cred-identifier" /></label>
          <label className="text-xs text-nb-mute">Issuing authority / college<input className="nb-input mt-1 h-10" value={form.issuingAuthority} onChange={set("issuingAuthority")} /></label>
          <label className="text-xs text-nb-mute">Insurance provider<input className="nb-input mt-1 h-10" value={form.provider} onChange={set("provider")} /></label>
          <label className="text-xs text-nb-mute">Province<input className="nb-input mt-1 h-10" value={form.province} onChange={set("province")} /></label>
          <label className="text-xs text-nb-mute">Effective<input type="date" className="nb-input mt-1 h-10" value={form.effectiveOn} onChange={set("effectiveOn")} /></label>
          <label className="text-xs text-nb-mute">Expires<input type="date" required className="nb-input mt-1 h-10" value={form.expiresOn} onChange={set("expiresOn")} data-testid="pr-cred-expires" /></label>
          <label className="text-xs text-nb-mute">Document note<input className="nb-input mt-1 h-10" value={form.documentNote} onChange={set("documentNote")} placeholder="Where the certificate is kept" /></label>
          <p className="text-[11px] text-nb-mute sm:col-span-2">Document file upload is turned off in this release. Keep the certificate on record and note where it is stored.</p>
          <div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => setForm(null)} className="nb-btn-ghost h-10 px-4 text-sm">Cancel</button><button type="submit" className="nb-btn-primary h-10 px-4 text-sm" data-testid="pr-cred-save">{owner ? "Save credential" : "Submit for verification"}</button></div>
        </form>
      )}
    </div>
  );
}
