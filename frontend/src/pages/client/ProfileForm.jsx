import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Lock } from "lucide-react";
import { Avatar } from "@/components/ui-kit";
import { AddressPicker } from "@/components/AddressPicker";
import { zoneFor } from "@/lib/domain";
import { apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";

const resize = (file) => new Promise((res) => {
  const img = new Image();
  img.onload = () => { const c = document.createElement("canvas"); const s = 160 / Math.max(img.width, img.height); c.width = img.width * s; c.height = img.height * s; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.8)); URL.revokeObjectURL(img.src); };
  img.src = URL.createObjectURL(file);
});

export default function ProfileForm() {
  const { me, run, api, register, state } = useDemo();
  const nav = useNavigate();
  const file = useRef(null);
  const [f, setF] = useState(() => ({ firstName: "", lastName: "", preferredName: "", email: "", phone: "", dob: "", language: "English", contactMethod: "Text", emergencyContact: "", marketingConsent: false, smsConsent: false, photo: null, addresses: [], paymentPreference: "card", ...(me || {}) }));
  const [aq, setAq] = useState("");
  const [addr, setAddr] = useState(null);
  const [label, setLabel] = useState("Home");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [intake, setIntake] = useState({ allergies: "", medications: "", concerns: "", preferences: "", contraindications: "" });
  const [intakeOpen, setIntakeOpen] = useState(false);
  const valid = f.firstName && f.lastName && /\S+@\S+/.test(f.email) && f.phone && f.dob && (me || pw.length >= 8);
  const save = async () => {
    const { id, ...body } = f;
    if (me) await run(() => api.patch("clients", me.id, body), "Profile updated");
    else {
      const { firstName, lastName, email, phone, dob, marketingConsent, smsConsent, ...profile } = body;
      try { await register({ email, password: pw, firstName, lastName, phone, dob, marketingConsent, smsConsent, profile }); } catch (e) { setErr(apiError(e)); return; }
    }
    nav("/me");
  };
  const In = ({ k, l, type = "text", opt, ...p }) => <label><span className="nb-label">{l}{opt && <span className="font-normal text-nb-mute"> (optional)</span>}</span><input type={type} className="nb-input" value={f[k] || ""} onChange={set(k)} data-testid={`profile-${k}-input`} {...p} /></label>;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10" data-testid="profile-form">
      <p className="nb-eyebrow">{me ? "Edit profile" : "Welcome"}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{me ? "Your " : "Let’s get to "}<span className="font-display font-normal italic nb-gradient-text">{me ? "details" : "know you"}</span></h1>
      <p className="mt-1 text-sm text-nb-mute">It only takes a minute. These details are used for your visits and stay with your account.</p>
      <div className="mt-8 flex items-center gap-4">
        <Avatar person={f} photo={f.photo} size={72} />
        <button onClick={() => file.current?.click()} data-testid="profile-photo-btn" className="nb-btn-ghost h-10 text-sm"><Camera className="h-4 w-4" />{f.photo ? "Change photo" : "Add a photo (optional)"}</button>
        <input ref={file} type="file" accept="image/*" className="hidden" data-testid="profile-photo-input" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) { const d = await resize(fl); setF((x) => ({ ...x, photo: d })); } }} />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {In({ k: "firstName", l: "First name" })}{In({ k: "lastName", l: "Last name" })}
        {In({ k: "preferredName", l: "Preferred name", opt: true })}{In({ k: "email", l: "Email", type: "email" })}
        {In({ k: "phone", l: "Phone number", type: "tel" })}
        <label><span className="nb-label">Preferred language</span><select className="nb-input" value={f.language} onChange={set("language")} data-testid="profile-language-select">{["English", "Français", "Other"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <div className="sm:col-span-2 rounded-3xl bg-gradient-to-r from-sky-50 to-teal-50 p-5">
          <label className="block"><span className="nb-label">When is your birthday? We’d love to send you a little birthday wish!</span><input type="date" className="nb-input" value={f.dob} onChange={set("dob")} data-testid="profile-dob-input" /></label>
          <p className="mt-2 text-xs text-nb-mute">We also use your birthdate to identify you and, where applicable, for care or insurance records.</p>
        </div>
        <label><span className="nb-label">Preferred contact method</span><select className="nb-input" value={f.contactMethod} onChange={set("contactMethod")} data-testid="profile-contact-select">{["Text", "Email", "Phone"].map((x) => <option key={x}>{x}</option>)}</select></label>
        {In({ k: "emergencyContact", l: "Emergency contact", opt: true, placeholder: "Name · phone" })}
      </div>
      <div className="nb-card mt-8 space-y-4 p-5" data-testid="profile-addresses">
        <p className="font-semibold">Saved addresses</p>
        {f.addresses.map((a) => <p key={a.id} className="flex items-center justify-between text-sm"><span><b>{a.label}</b> · {a.line}</span><button onClick={() => setF((x) => ({ ...x, addresses: x.addresses.filter((y) => y.id !== a.id) }))} className="text-xs text-rose-600" data-testid={`profile-remove-address-${a.id}`}>Remove</button></p>)}
        <div className="flex gap-2">{["Home", "Office", "Hotel", "Other"].map((l) => <button key={l} type="button" onClick={() => setLabel(l)} data-testid={`profile-address-label-${l.toLowerCase()}`} className={label === l ? "nb-chip-on" : "nb-chip-off"}>{l}</button>)}</div>
        <AddressPicker testid="profile-address" query={aq} onQuery={setAq} value={addr} onChange={setAddr} />
        <button type="button" disabled={!addr} onClick={() => { const z = zoneFor(addr, state.zones); setF((x) => ({ ...x, addresses: [...x.addresses, { ...addr, id: `ad-${Date.now()}`, label, zoneId: z?.zone?.id || null }] })); setAddr(null); setAq(""); }} data-testid="profile-add-address-btn" className="nb-btn-ghost h-10 text-sm">Save this address</button>
      </div>
      <div className="nb-card mt-6 p-5" data-testid="profile-payment-pref">
        <p className="mb-3 font-semibold">Preferred payment</p>
        <div className="flex flex-wrap gap-2">{[["card", "Credit / debit card (Stripe)"], ["cash", "Cash"], ["insurance", "Use insurance"]].map(([k, l]) => <button key={k} type="button" onClick={() => setF((x) => ({ ...x, paymentPreference: k }))} data-testid={`profile-pay-${k}`} className={f.paymentPreference === k ? "nb-chip-on" : "nb-chip-off"}>{l}</button>)}</div>
        {f.paymentPreference === "insurance" && <p className="mt-3 text-xs text-nb-mute">Add your plan details and card photo from <b>My Nabitouch → Wallet → Insurance</b> after saving. Coverage depends on your plan and practitioner eligibility.</p>}
        <p className="mt-2 text-[11px] text-nb-mute">Card details are never stored by Nabitouch. Card payments are handled by the payment provider.</p>
      </div>
      <div className="hidden">
      </div>
      <div className="nb-card mt-8 space-y-4 p-5">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={!!f.smsConsent} onChange={set("smsConsent")} data-testid="profile-sms-consent-checkbox" /><span><b>Visit texts</b> — yes, Nabitouch may text me reminders, on-the-way and running-late updates, and booking changes. Message and data rates may apply. Reply STOP anytime.</span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={!!f.marketingConsent} onChange={set("marketingConsent")} data-testid="profile-marketing-consent-checkbox" /><span><b>Birthday wishes & offers</b> — yes, Nabitouch may email/text me promotions, birthday offers and wellness tips. Optional and never required to book. You can withdraw anytime.</span></label>
        <p className="text-xs text-nb-mute">Appointment confirmations and reminders are operational messages and are sent separately from marketing.</p>
        <div className="flex gap-3 rounded-2xl bg-slate-50 p-4 text-xs text-nb-mute"><Lock className="h-4 w-4 shrink-0" /><p>We collect only what’s needed to book and care for you. Your account, clinical notes, and insurance details stay in the workspace that is allowed to see them.</p></div>
      </div>
      {me && intakeOpen && (
        <form className="nb-card mt-6 space-y-3 p-5" data-testid="intake-form" onSubmit={async (event) => { event.preventDefault(); await run(() => api.submitIntake(intake), "Health history saved as a new version"); setIntake({ allergies: "", contraindications: "", medications: "", concerns: "", preferences: "" }); setIntakeOpen(false); }}>
          <p className="font-semibold">Health history</p>
          <p className="text-xs text-nb-mute">Share only what your therapist needs. Saving adds a new version and keeps the earlier one.</p>
          {[["allergies", "Allergies"], ["contraindications", "Contraindications or precautions"], ["medications", "Medications that affect treatment"], ["concerns", "Areas of concern"], ["preferences", "Treatment preferences"]].map(([key, label]) => (
            <label key={key} className="block text-sm"><span className="nb-label">{label}</span><input className="nb-input" value={intake[key]} onChange={(e) => setIntake({ ...intake, [key]: e.target.value })} data-testid={`intake-${key}`} /></label>
          ))}
          <div className="flex gap-2"><button type="button" className="nb-btn-ghost h-12 px-4" onClick={() => setIntakeOpen(false)}>Cancel</button><button className="nb-btn-primary h-12" data-testid="intake-save">Save health history</button></div>
        </form>
      )}
      {me && !intakeOpen && (
        <div className="nb-card mt-6 flex items-center justify-between gap-3 p-5" data-testid="intake-saved">
          <div><p className="font-semibold">Health history</p><p className="text-xs text-nb-mute">Saved versions stay on the account. Open the form only when you want to add another version.</p></div>
          <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="intake-edit" onClick={() => setIntakeOpen(true)}>Add a version</button>
        </div>
      )}
      {me && (
        <div className="nb-card mt-6 space-y-3 p-5" data-testid="consent-card">
          <p className="font-semibold">Consent</p>
          <p className="text-xs text-nb-mute">Booking an appointment does not record consent. Acknowledge the statement that applies.</p>
          <button type="button" className="nb-btn-ghost h-11" data-testid="consent-treatment" onClick={() => run(() => api.recordConsent({ kind: "treatment", version: "2026-1", acknowledged: true }), "Treatment consent recorded")}>I agree to treatment</button>
          <button type="button" className="nb-btn-ghost h-11" data-testid="consent-mobile" onClick={() => run(() => api.recordConsent({ kind: "mobile", version: "2026-1", acknowledged: true }), "Mobile visit consent recorded")}>I agree to a mobile visit at my address</button>
        </div>
      )}
      {!me && <label className="mt-6 block"><span className="nb-label">Create a password (min. 8 characters)</span><input type="password" autoComplete="new-password" className="nb-input" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="profile-password-input" /></label>}
      {err && <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="profile-error">{err}</p>}
      <button disabled={!valid} onClick={save} data-testid="profile-save-btn" className="nb-btn-primary mt-8 w-full">{me ? "Save changes" : "Create my profile"}</button>
    </div>
  );
}
