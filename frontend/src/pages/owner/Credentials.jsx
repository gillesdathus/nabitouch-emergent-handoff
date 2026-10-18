import { useEffect, useState } from "react";
import { useDemo } from "@/store/DemoStore";

const KINDS = [
  ["association", "Association license #"],
  ["liability", "Insurance liability policy #"],
  ["municipal", "Municipality license #"],
  ["cpr", "CPR / First Aid"],
  ["registration", "Registration (optional)"],
  ["membership", "Membership (optional)"],
  ["other", "Other"],
];

export default function Credentials() {
  const { api, run, state } = useDemo();
  const [rows, setRows] = useState([]);
  const [board, setBoard] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [chosen, setChosen] = useState({});
  const [form, setForm] = useState({ practitionerId: "", kind: "association", identifier: "", expiresOn: "" });
  const [adding, setAdding] = useState(false);
  const [editingServices, setEditingServices] = useState("");
  const people = state.practitioners || [];
  const services = state.services || [];
  const load = () => Promise.all([
    api.credentials().catch(() => []),
    api.onboarding().catch(() => null),
    api.credentialReminders().catch(() => ({ due: [] })),
  ]).then(([credentials, onboarding, due]) => {
    setRows(credentials);
    setBoard(onboarding);
    setReminders(due?.due || []);
  });
  useEffect(() => { load(); }, []); // eslint-disable-line
  const save = async (event) => {
    event.preventDefault();
    await run(() => api.addCredential(form), "Credential recorded for review");
    setForm({ ...form, identifier: "", expiresOn: "" });
    setAdding(false);
    load();
  };
  const tracked = (board?.practitioners || []).filter((person) => person.onboardingStatus === "draft" || person.onboardingStatus === "pending" || (person.gaps || []).length);
  const launch = board?.launch;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="credential-dashboard">
      <div>
        <p className="nb-eyebrow">People</p>
        <h1 className="text-3xl font-semibold tracking-tight">Creden<span className="font-display font-normal italic nb-gradient-text">tials</span></h1>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
      <section className="nb-card p-5 text-sm">
        <h2 className="font-semibold">Activation and the 14-day grace</h2>
        <p className="mt-2 text-nb-mute">Owner approval activates the profile as soon as a staff login is linked. Association license #, insurance liability policy #, municipality license #, and CPR / First Aid can be added within 14 days. After that grace, new bookings pause until all four verified numbers are on file. Placeholder numbers are refused. Expiry reminder windows are 60, 30, 14, and 7 days unless you change them in settings.</p>
      </section>
      {launch && (
        <section className="nb-card space-y-2 p-5 text-sm" data-testid="launch-readiness">
          <h2 className="font-semibold">Launch configuration</h2>
          <p data-testid="launch-published">{launch.published ? "Published on this database." : "Prepared for an authorized release. Not published."}</p>
          <p>Phone {launch.prepared.phoneDisplay} · <span className="font-mono">tel:{launch.prepared.phoneTel}</span></p>
          <p>{launch.prepared.email} · {launch.prepared.hours}</p>
          <p>Mobile booking prepared on. In-clinic booking and the street address stay off.</p>
          <p>GST 5%. Document uploads, card checkout, rewards, referrals, NabiDerm, promotional sending, cancellation fees, and no-show fees stay off.</p>
          <p data-testid="launch-welcome">First-booking welcome offer: {launch.prepared.welcomePercent}% off the treatment price. Owner-approved in the prepared configuration. Not published to production from this screen.</p>
          <p data-testid="launch-policy">{launch.prepared.policyText}</p>
        </section>
      )}
      </div>
      {tracked.map((person) => (
        <section key={person.practitionerId} className="nb-card space-y-3 p-5" data-testid={`onboarding-${person.practitionerId}`}>
          <h2 className="font-semibold">{person.name} · {person.onboardingStatus} · {person.available ? "active" : "inactive"}</h2>
          <ul className="space-y-1 text-sm">
            {(person.gaps || []).map((gap) => <li key={gap.id} data-testid={`onboarding-gap-${person.practitionerId}-${gap.id}`}>{gap.label}: {gap.status}</li>)}
            {(person.gaps || []).length === 0 && <li>No missing onboarding items.</li>}
          </ul>
          <fieldset className="space-y-2 text-sm">
            <legend className="nb-label">Services offered</legend>
            {editingServices === person.practitionerId ? (
              <>
                {services.map((service) => {
                  const selected = Object.prototype.hasOwnProperty.call(chosen, person.practitionerId) ? chosen[person.practitionerId] : (person.specialties || []);
                  return (
                    <label key={service.slug} className="mr-4 inline-flex items-center gap-2">
                      <input type="checkbox" checked={selected.includes(service.slug)} onChange={(event) => {
                        const current = Object.prototype.hasOwnProperty.call(chosen, person.practitionerId) ? chosen[person.practitionerId] : (person.specialties || []);
                        const next = event.target.checked ? [...current, service.slug] : current.filter((slug) => slug !== service.slug);
                        setChosen({ ...chosen, [person.practitionerId]: next });
                      }} />
                      {service.name}
                    </label>
                  );
                })}
                <div className="flex gap-2">
                  <button type="button" className="nb-btn-ghost h-10" onClick={() => setEditingServices("")}>Cancel</button>
                  <button type="button" className="nb-btn-ghost h-10" data-testid={`onboarding-services-${person.practitionerId}`} onClick={async () => { const selected = Object.prototype.hasOwnProperty.call(chosen, person.practitionerId) ? chosen[person.practitionerId] : (person.specialties || []); await run(() => api.savePractitionerServices(person.practitionerId, selected), "Services saved"); setEditingServices(""); load(); }}>Save services</button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p>{(person.specialties || []).join(", ") || "No services selected"}</p>
                <button type="button" className="nb-btn-ghost h-10" data-testid={`onboarding-services-edit-${person.practitionerId}`} onClick={() => setEditingServices(person.practitionerId)}>Edit</button>
              </div>
            )}
          </fieldset>
          <button type="button" className="nb-btn-primary h-10" disabled={!person.activationReady} data-testid={`onboarding-approve-${person.practitionerId}`} onClick={async () => { await run(() => api.approveOnboarding(person.practitionerId, { confirm: true }), "Practitioner approved"); load(); }}>Approve activation</button>
          {!person.activationReady && <p className="text-xs text-nb-mute">Approval stays disabled until a staff login is linked to this profile. Credentials have a 14-day grace after activation.</p>}
        </section>
      ))}
      <button type="button" className="nb-btn-primary h-10 px-4 text-sm" onClick={() => setAdding((value) => !value)} data-testid="credential-add">{adding ? "Close" : "Add credential"}</button>
      {adding && <form onSubmit={save} className="nb-card grid gap-3 p-5 sm:grid-cols-2">
        <label className="text-sm"><span className="nb-label">Practitioner</span>
          <select className="nb-input" required value={form.practitionerId} onChange={(e) => setForm({ ...form, practitionerId: e.target.value })} data-testid="credential-practitioner">
            <option value="">Choose a practitioner</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="nb-label">Kind</span><select className="nb-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} data-testid="credential-kind">{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="text-sm"><span className="nb-label">Number</span><input className="nb-input" required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} data-testid="credential-identifier" /></label>
        <label className="text-sm"><span className="nb-label">Expires</span><input type="date" required className="nb-input" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} data-testid="credential-expires" /></label>
        <button className="nb-btn-primary h-12 sm:col-span-2" data-testid="credential-save">Add credential</button>
      </form>}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="nb-card flex flex-wrap items-center justify-between gap-2 p-4 text-sm" data-testid={`credential-${row.id}`}>
            <span>{row.practitionerId} · {row.kind} · {row.identifier || "no number"} · expires {row.expiresOn}</span>
            {row.status === "verified" ? <span className="text-teal-700">Verified</span> : <button type="button" className="nb-btn-ghost h-10" data-testid={`credential-verify-${row.id}`} onClick={async () => { await run(() => api.verifyCredential(row.id), "Credential verified"); load(); }}>Mark verified</button>}
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-nb-mute">No credentials recorded yet.</li>}
      </ul>
      <section data-testid="credential-reminders">
        <h2 className="text-sm font-semibold">Expiry reminders</h2>
        <ul className="mt-2 space-y-1 text-sm text-nb-mute">
          {reminders.map((row) => <li key={row.id}>{row.practitionerId} · {row.kind} · expires {row.expiresOn}{row.verified ? "" : " · not verified"}</li>)}
          {reminders.length === 0 && <li>No credential is inside the reminder window.</li>}
        </ul>
      </section>
    </div>
  );
}
