import { useEffect, useState } from "react";
import { Check, MapPin, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { AddressPicker } from "@/components/AddressPicker";
import { api, apiError } from "@/lib/api";
import { staffActor } from "@/lib/domain";
import { useDemo } from "@/store/DemoStore";

const SECTIONS = [
  ["personal", "Personal Information"],
  ["contact", "Contact Information"],
  ["addresses", "Saved Addresses"],
  ["insurance", "Insurance"],
  ["prefs", "Communication Preferences"],
  ["history", "Change History"],
];

const IDENTITY_METHODS = [
  ["government_id_sighted", "Government ID sighted (not stored)"],
  ["verbal_confirmed", "Verbal confirmation"],
  ["prior_record_match", "Matched prior clinic record"],
  ["guardian_confirmed", "Guardian / authorized person"],
  ["other", "Other"],
];

const blankPolicy = () => ({
  id: `ins-${Date.now()}`,
  insurer: "",
  policy: "",
  memberId: "",
  groupNumber: "",
  holderName: "",
  relationship: "Self",
  secondary: "",
  extra: "",
  primary: false,
});

function Field({ label, children, hint }) {
  return (
    <label className="block min-w-0">
      <span className="nb-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-nb-mute">{hint}</span>}
    </label>
  );
}

function verificationLabel(state) {
  return ({
    verified: "Verified",
    needs_confirmation: "Needs confirmation",
    manual_review: "Manual review",
    invalid: "Invalid",
  })[state] || (state || "Unconfirmed");
}

export function ClientProfileEditor({ client, access, onSaved, onClose }) {
  const { run, user, refresh } = useDemo();
  const [section, setSection] = useState("personal");
  const [form, setForm] = useState(() => ({
    firstName: client.firstName || "",
    lastName: client.lastName || "",
    preferredName: client.preferredName || "",
    dob: client.dob || "",
    phone: client.phone || "",
    altPhone: client.altPhone || "",
    email: client.email || "",
    language: client.language || "English",
    contactMethod: client.contactMethod || "Text",
    emergencyContact: client.emergencyContact || "",
    marketingConsent: !!client.marketingConsent,
    smsConsent: !!client.smsConsent,
    addresses: [...(client.addresses || [])],
    insurance: [...(client.insurance || [])],
    noInsurance: !!client.noInsurance,
  }));
  const [identity, setIdentity] = useState({ method: "", reason: "" });
  const [addrQuery, setAddrQuery] = useState("");
  const [addrPick, setAddrPick] = useState(null);
  const [addrMeta, setAddrMeta] = useState({ label: "Home", purpose: "home", unit: "", access: "" });
  const [history, setHistory] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState("");

  const canProfile = access?.editProfile;
  const canAddresses = access?.editAddresses;
  const canInsurance = access?.editInsurance;
  const canIdentity = access?.correctIdentity;
  const canHistory = access?.viewHistory;

  useEffect(() => {
    if (section !== "history" || !canHistory) return undefined;
    let live = true;
    api.clientProfileHistory(client.id)
      .then((body) => { if (live) setHistory(body.history || []); })
      .catch(() => { if (live) setHistory([]); });
    return () => { live = false; };
  }, [section, canHistory, client.id]);

  const set = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
    setOk("");
  };

  const identityChanged =
    form.firstName.trim() !== (client.firstName || "")
    || form.lastName.trim() !== (client.lastName || "")
    || form.dob !== (client.dob || "");

  const save = async (patch) => {
    setErr("");
    setOk("");
    setSaving(true);
    try {
      const body = {
        ...patch,
        _audit: `Administrative profile update for ${client.firstName} ${client.lastName}`,
        _actor: staffActor(user),
      };
      if (identityChanged && (patch.firstName != null || patch.lastName != null || patch.dob != null)) {
        body._identityCorrection = { method: identity.method, reason: identity.reason };
      }
      await run(() => api.patch("clients", client.id, body), "Client profile saved");
      await refresh?.();
      setOk("Saved");
      onSaved?.(await api.clientWorkspace(client.id));
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  const saveSection = async () => {
    if (section === "personal") {
      if (identityChanged && canIdentity && (!identity.method || identity.reason.trim().length < 3)) {
        setErr("Legal name and date of birth changes need a verification method and reason.");
        return;
      }
      const patch = {
        preferredName: form.preferredName,
        language: form.language,
        emergencyContact: form.emergencyContact,
      };
      if (canIdentity) {
        patch.firstName = form.firstName;
        patch.lastName = form.lastName;
        patch.dob = form.dob;
      }
      return save(patch);
    }
    if (section === "contact") {
      return save({
        phone: form.phone,
        altPhone: form.altPhone,
        email: form.email,
        contactMethod: form.contactMethod,
      });
    }
    if (section === "addresses") return save({ addresses: form.addresses });
    if (section === "insurance") {
      return save({ insurance: form.insurance, noInsurance: form.noInsurance });
    }
    if (section === "prefs") {
      return save({ marketingConsent: form.marketingConsent, smsConsent: form.smsConsent, contactMethod: form.contactMethod, language: form.language });
    }
    return undefined;
  };

  const addAddress = () => {
    if (!addrPick?.line) return;
    const row = {
      ...addrPick,
      id: `ad-${Date.now()}`,
      label: addrMeta.label || "Home",
      purpose: addrMeta.purpose || "home",
      unit: addrMeta.unit || addrPick.unit || "",
      access: addrMeta.access || "",
      isDefault: form.addresses.length === 0,
      verificationState: addrPick.verificationState || (addrPick.clientConfirmed ? "verified" : "needs_confirmation"),
    };
    setForm((prev) => ({ ...prev, addresses: [...prev.addresses, row] }));
    setAddrPick(null);
    setAddrQuery("");
    setAddrMeta({ label: "Home", purpose: "home", unit: "", access: "" });
  };

  const tabs = SECTIONS.filter(([id]) => {
    if (id === "addresses") return canAddresses || canProfile;
    if (id === "insurance") return canInsurance;
    if (id === "history") return canHistory;
    if (id === "personal" || id === "contact" || id === "prefs") return canProfile || canIdentity;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-nb-ink/40 p-0 sm:items-center sm:p-4" data-testid="client-profile-editor">
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-sky-100 px-4 py-4 sm:px-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Edit profile</p>
            <h2 className="text-xl font-semibold text-nb-ink">{client.firstName} {client.lastName}</h2>
            <p className="text-xs text-nb-mute">Changes save by section. Login credentials are never reset from here.</p>
          </div>
          <button type="button" className="nb-btn-ghost h-9 w-9 px-0" onClick={onClose} data-testid="cpe-close" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-sky-50 px-3 py-2" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              data-testid={`cpe-tab-${id}`}
              onClick={() => { setSection(id); setErr(""); setOk(""); }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${section === id ? "bg-nb-navy text-white" : "text-nb-mute"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {section === "personal" && (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="cpe-personal">
              <Field label="Legal first name"><input className="nb-input" value={form.firstName} onChange={set("firstName")} disabled={!canIdentity} data-testid="cpe-firstName" /></Field>
              <Field label="Legal last name"><input className="nb-input" value={form.lastName} onChange={set("lastName")} disabled={!canIdentity} data-testid="cpe-lastName" /></Field>
              <Field label="Preferred name"><input className="nb-input" value={form.preferredName} onChange={set("preferredName")} disabled={!canProfile} data-testid="cpe-preferredName" /></Field>
              <Field label="Date of birth"><input type="date" className="nb-input" value={form.dob} onChange={set("dob")} disabled={!canIdentity} data-testid="cpe-dob" /></Field>
              <Field label="Preferred language">
                <select className="nb-input" value={form.language} onChange={set("language")} disabled={!canProfile} data-testid="cpe-language">
                  {["English", "Français", "Other"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Emergency contact" hint="Name · phone"><input className="nb-input" value={form.emergencyContact} onChange={set("emergencyContact")} disabled={!canProfile} data-testid="cpe-emergency" /></Field>
              {identityChanged && canIdentity && (
                <div className="sm:col-span-2 space-y-3 rounded-2xl bg-amber-50 p-4" data-testid="cpe-identity-gate">
                  <p className="text-sm font-semibold text-amber-950">Identity verification required</p>
                  <p className="text-xs text-amber-900">Record how you verified the correction. Do not upload or store copies of government ID.</p>
                  <Field label="Verification method">
                    <select className="nb-input" value={identity.method} onChange={(e) => setIdentity((x) => ({ ...x, method: e.target.value }))} data-testid="cpe-identity-method">
                      <option value="">Select…</option>
                      {IDENTITY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="Reason for correction">
                    <input className="nb-input" value={identity.reason} onChange={(e) => setIdentity((x) => ({ ...x, reason: e.target.value }))} data-testid="cpe-identity-reason" />
                  </Field>
                </div>
              )}
              {!canIdentity && <p className="sm:col-span-2 rounded-2xl bg-sky-50 px-3.5 py-3 text-sm text-nb-navy">Legal name and date of birth are read-only for your role.</p>}
            </div>
          )}

          {section === "contact" && (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="cpe-contact">
              <Field label="Phone"><input className="nb-input" value={form.phone} onChange={set("phone")} data-testid="cpe-phone" /></Field>
              <Field label="Alternative phone"><input className="nb-input" value={form.altPhone} onChange={set("altPhone")} data-testid="cpe-altPhone" /></Field>
              <Field label="Email (optional)" hint="Updates the contact record only — not login credentials.">
                <input type="email" className="nb-input" value={form.email} onChange={set("email")} data-testid="cpe-email" />
              </Field>
              <Field label="Preferred contact method">
                <select className="nb-input" value={form.contactMethod} onChange={set("contactMethod")} data-testid="cpe-contactMethod">
                  {["Text", "Email", "Phone"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
            </div>
          )}

          {section === "addresses" && (
            <div className="space-y-4" data-testid="cpe-addresses">
              {(form.addresses || []).map((a) => (
                <div key={a.id} className="rounded-2xl bg-sky-50/80 p-3 ring-1 ring-sky-100" data-testid={`cpe-address-${a.id}`}>
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-nb-blue" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{a.label || a.purpose}{a.isDefault ? " · Default" : ""}</p>
                      <p className="break-words text-sm text-nb-ink">{a.unit ? `Unit ${a.unit}, ` : ""}{a.line}</p>
                      <p className="mt-1 text-[11px] text-nb-mute">
                        {verificationLabel(a.verificationState)}
                        {a.poBox || a.purpose === "mailing" ? " · Mailing" : " · Service eligible check separate"}
                      </p>
                      {a.access && <p className="mt-1 text-xs text-nb-mute">Access: {a.access}</p>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!a.isDefault && (
                      <button type="button" className="nb-btn-ghost h-8 px-2 text-xs" data-testid={`cpe-default-${a.id}`}
                        onClick={() => setForm((prev) => ({ ...prev, addresses: prev.addresses.map((row) => ({ ...row, isDefault: row.id === a.id })) }))}>
                        Set default
                      </button>
                    )}
                    <button type="button" className="nb-btn-ghost h-8 px-2 text-xs text-rose-700" data-testid={`cpe-remove-${a.id}`}
                      onClick={() => setForm((prev) => ({ ...prev, addresses: prev.addresses.filter((row) => row.id !== a.id) }))}>
                      <Trash2 className="h-3.5 w-3.5" />Remove from book
                    </button>
                  </div>
                </div>
              ))}
              <div className="space-y-3 rounded-2xl border border-dashed border-sky-200 p-3">
                <p className="text-sm font-semibold">Add address</p>
                <div className="flex flex-wrap gap-2">
                  {["Home", "Mailing", "Office", "Hotel", "Temporary", "Other"].map((label) => (
                    <button key={label} type="button" className={addrMeta.label === label ? "nb-chip-on" : "nb-chip-off"} data-testid={`cpe-label-${label.toLowerCase()}`}
                      onClick={() => setAddrMeta((x) => ({ ...x, label, purpose: label === "Mailing" ? "mailing" : label === "Temporary" ? "temporary" : label.toLowerCase() }))}>
                      {label}
                    </button>
                  ))}
                </div>
                <AddressPicker purpose={addrMeta.purpose === "mailing" ? "visit" : "visit"} query={addrQuery} onQuery={setAddrQuery} value={addrPick} onChange={setAddrPick} testid="cpe-address-picker" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Unit / apt"><input className="nb-input" value={addrMeta.unit} onChange={(e) => setAddrMeta((x) => ({ ...x, unit: e.target.value }))} data-testid="cpe-unit" /></Field>
                  <Field label="Access instructions"><input className="nb-input" value={addrMeta.access} onChange={(e) => setAddrMeta((x) => ({ ...x, access: e.target.value }))} data-testid="cpe-access" /></Field>
                </div>
                <button type="button" disabled={!addrPick?.line} onClick={addAddress} className="nb-btn-ghost h-10 w-full text-sm" data-testid="cpe-add-address">
                  <Plus className="h-4 w-4" />Add to saved addresses
                </button>
                <p className="text-[11px] text-nb-mute">Removing an address from this book does not erase completed appointment history.</p>
              </div>
            </div>
          )}

          {section === "insurance" && (
            <div className="space-y-3" data-testid="cpe-insurance">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.noInsurance} onChange={set("noInsurance")} data-testid="cpe-no-insurance" />
                No insurance on file
              </label>
              {(form.insurance || []).map((pol, idx) => (
                <div key={pol.id} className="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-2" data-testid={`cpe-policy-${pol.id}`}>
                  <Field label="Insurer"><input className="nb-input" value={pol.insurer || ""} onChange={(e) => setForm((prev) => ({ ...prev, insurance: prev.insurance.map((row, i) => i === idx ? { ...row, insurer: e.target.value } : row) }))} data-testid={`cpe-insurer-${pol.id}`} /></Field>
                  <Field label="Policy / member #"><input className="nb-input" value={pol.memberId || pol.policy || ""} onChange={(e) => setForm((prev) => ({ ...prev, insurance: prev.insurance.map((row, i) => i === idx ? { ...row, memberId: e.target.value, policy: e.target.value } : row) }))} data-testid={`cpe-member-${pol.id}`} /></Field>
                  <Field label="Group / plan #"><input className="nb-input" value={pol.groupNumber || ""} onChange={(e) => setForm((prev) => ({ ...prev, insurance: prev.insurance.map((row, i) => i === idx ? { ...row, groupNumber: e.target.value } : row) }))} data-testid={`cpe-group-${pol.id}`} /></Field>
                  <Field label="Policyholder"><input className="nb-input" value={pol.holderName || ""} onChange={(e) => setForm((prev) => ({ ...prev, insurance: prev.insurance.map((row, i) => i === idx ? { ...row, holderName: e.target.value } : row) }))} data-testid={`cpe-holder-${pol.id}`} /></Field>
                  <Field label="Relationship">
                    <select className="nb-input" value={pol.relationship || "Self"} onChange={(e) => setForm((prev) => ({ ...prev, insurance: prev.insurance.map((row, i) => i === idx ? { ...row, relationship: e.target.value } : row) }))} data-testid={`cpe-rel-${pol.id}`}>
                      {["Self", "Spouse", "Child", "Other"].map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </Field>
                  <Field label="Coverage details"><input className="nb-input" value={pol.extra || pol.secondary || ""} onChange={(e) => setForm((prev) => ({ ...prev, insurance: prev.insurance.map((row, i) => i === idx ? { ...row, extra: e.target.value } : row) }))} data-testid={`cpe-extra-${pol.id}`} /></Field>
                  <div className="sm:col-span-2 flex flex-wrap gap-2">
                    <button type="button" className="nb-btn-ghost h-8 px-2 text-xs" onClick={() => setForm((prev) => ({ ...prev, insurance: prev.insurance.map((row, i) => ({ ...row, primary: i === idx })) }))} data-testid={`cpe-primary-${pol.id}`}>
                      {pol.primary ? <><Check className="h-3.5 w-3.5" />Primary</> : "Make primary"}
                    </button>
                    <button type="button" className="nb-btn-ghost h-8 px-2 text-xs text-rose-700" onClick={() => setForm((prev) => ({ ...prev, insurance: prev.insurance.filter((_, i) => i !== idx) }))} data-testid={`cpe-del-policy-${pol.id}`}>
                      Remove policy
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" className="nb-btn-ghost h-10 w-full text-sm" data-testid="cpe-add-policy" onClick={() => setForm((prev) => ({ ...prev, noInsurance: false, insurance: [...prev.insurance, { ...blankPolicy(), primary: prev.insurance.length === 0 }] }))}>
                <ShieldCheck className="h-4 w-4" />Add policy
              </button>
              <p className="text-[11px] text-nb-mute">Editing insurance here never resubmits claims or changes settled invoices.</p>
            </div>
          )}

          {section === "prefs" && (
            <div className="space-y-3" data-testid="cpe-prefs">
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={form.smsConsent} onChange={set("smsConsent")} data-testid="cpe-sms" /><span>Visit texts (reminders and day-of updates)</span></label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={form.marketingConsent} onChange={set("marketingConsent")} data-testid="cpe-marketing" /><span>Marketing / birthday offers</span></label>
            </div>
          )}

          {section === "history" && (
            <div className="space-y-2" data-testid="cpe-history">
              {history == null && <div className="h-24 rounded-2xl nb-skeleton" />}
              {history && !history.length && <p className="text-sm text-nb-mute">No administrative profile changes recorded yet.</p>}
              {(history || []).map((row) => (
                <div key={row.id} className="rounded-2xl bg-slate-50 p-3 text-sm" data-testid={`cpe-history-${row.id}`}>
                  <p className="font-semibold">{row.fields?.join(", ") || "Update"}</p>
                  <p className="text-xs text-nb-mute">{row.actor} · {row.at ? new Date(row.at).toLocaleString("en-CA") : ""}</p>
                  {row.identity && <p className="mt-1 text-xs text-amber-900">Verified via {row.identity.method}: {row.identity.reason}</p>}
                </div>
              ))}
            </div>
          )}

          {err && <p className="mt-4 rounded-2xl bg-rose-50 px-3.5 py-3 text-sm text-rose-700" data-testid="cpe-error">{err}</p>}
          {ok && <p className="mt-4 rounded-2xl bg-teal-50 px-3.5 py-3 text-sm text-teal-800" data-testid="cpe-ok">{ok}</p>}
        </div>
        {section !== "history" && (
          <div className="flex gap-2 border-t border-sky-100 px-4 py-3 sm:px-5">
            <button type="button" className="nb-btn-ghost h-11 flex-1" onClick={onClose} data-testid="cpe-cancel">Cancel</button>
            <button type="button" className="nb-btn-primary h-11 flex-1" disabled={saving} onClick={saveSection} data-testid="cpe-save">
              {saving ? "Saving…" : "Save section"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
