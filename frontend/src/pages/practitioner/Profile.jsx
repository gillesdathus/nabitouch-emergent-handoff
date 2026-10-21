import { useEffect, useRef, useState } from "react";
import { Camera, FileBadge, Trash2 } from "lucide-react";
import { FlowStepShell } from "@/components/FlowStepShell";
import { SectionHead, Avatar } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

const CRED_KINDS = [
  ["registration", "Registration / license"],
  ["liability", "Liability insurance"],
  ["association", "Association"],
  ["membership", "Membership"],
  ["municipal", "Municipal licence"],
  ["other", "Other / education"],
];

export function ProfileFields({ person, owner = false, onSaved, onCancel }) {
  const { run, api, state } = useDemo();
  const [form, setForm] = useState({
    name: person.name || "",
    designation: person.designation || "",
    bio: person.bio || "",
    experience: person.experience || "",
    qualifications: (person.qualifications || []).join("\n"),
    specialties: person.specialties || [],
    profileVisibility: person.profileVisibility || "published",
    displayOrder: person.displayOrder ?? 100,
    slug: person.slug || "",
  });
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = () => {
    const body = {
      name: form.name,
      designation: form.designation,
      bio: form.bio,
      experience: form.experience,
      qualifications: form.qualifications.split("\n").map((line) => line.trim()).filter(Boolean),
      specialties: form.specialties,
    };
    if (owner) {
      body.profileVisibility = form.profileVisibility;
      body.displayOrder = Number(form.displayOrder);
      if (form.slug) body.slug = form.slug;
    }
    setError("");
    return run(() => api.savePractitionerProfile(person.id, body), "Profile saved").then((result) => { onSaved?.(); return result; }).catch((err) => setError(apiError(err)));
  };
  return (
    <form className="space-y-3" data-testid={`profile-editor-${person.id}`} onSubmit={(event) => { event.preventDefault(); save(); }}>
      <FlowStepShell
        testid={`profile-flow-shell-${person.id}`}
        actionsTestid={`profile-sticky-actions-${person.id}`}
        stacked={Boolean(onCancel)}
        actions={(
          <div className="flex w-full gap-2">
            {onCancel && <button type="button" className="nb-btn-ghost h-12 flex-1 px-4 text-sm" onClick={onCancel}>Cancel</button>}
            <button type="button" className="nb-btn-primary h-12 flex-1 px-4 text-sm" data-testid={`profile-save-${person.id}`} onClick={save}>Save profile</button>
          </div>
        )}
      >
        <label className="block text-xs"><span className="mb-1 block text-nb-mute">Display name</span><input className="nb-input h-10" value={form.name} onChange={set("name")} data-testid={`profile-name-${person.id}`} /></label>
        <label className="block text-xs"><span className="mb-1 block text-nb-mute">Designation</span><input className="nb-input h-10" value={form.designation} onChange={set("designation")} data-testid={`profile-designation-${person.id}`} placeholder="e.g. RMT" /></label>
        <label className="block text-xs"><span className="mb-1 block text-nb-mute">Biography</span><textarea rows={3} className="nb-input h-auto py-3" value={form.bio} onChange={set("bio")} data-testid={`profile-bio-${person.id}`} /></label>
        <label className="block text-xs"><span className="mb-1 block text-nb-mute">Experience</span><textarea rows={2} className="nb-input h-auto py-3" value={form.experience} onChange={set("experience")} data-testid={`profile-experience-${person.id}`} /></label>
        <label className="block text-xs"><span className="mb-1 block text-nb-mute">Qualifications, one per line</span><textarea rows={3} className="nb-input h-auto py-3" value={form.qualifications} onChange={set("qualifications")} data-testid={`profile-qualifications-${person.id}`} /></label>
        <fieldset className="text-xs">
          <legend className="mb-1 text-nb-mute">Services offered</legend>
          <div className="flex flex-wrap gap-2" data-testid={`profile-specialties-${person.id}`}>
            {state.services.filter((service) => service.archived !== true).map((service) => (
              <label key={service.slug} className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1">
                <input type="checkbox" checked={form.specialties.includes(service.slug)} onChange={() => setForm((current) => ({ ...current, specialties: current.specialties.includes(service.slug) ? current.specialties.filter((item) => item !== service.slug) : [...current.specialties, service.slug] }))} />
                {service.name}
              </label>
            ))}
          </div>
        </fieldset>
        {owner && (
          <>
            <label className="block text-xs"><span className="mb-1 block text-nb-mute">Public visibility</span>
              <select className="nb-input h-10" value={form.profileVisibility} onChange={set("profileVisibility")} data-testid={`profile-visibility-${person.id}`}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
            <p className="text-xs text-nb-mute">Publishing a profile does not approve credentials, hours, or booking.</p>
            <label className="block text-xs"><span className="mb-1 block text-nb-mute">Display order</span><input type="number" min="0" className="nb-input h-10" value={form.displayOrder} onChange={set("displayOrder")} data-testid={`profile-order-${person.id}`} /></label>
            <label className="block text-xs"><span className="mb-1 block text-nb-mute">Public address</span><input className="nb-input h-10" value={form.slug} onChange={set("slug")} data-testid={`profile-slug-${person.id}`} /></label>
          </>
        )}
        {error && <p className="text-sm text-red-700" data-testid={`profile-error-${person.id}`}>{error}</p>}
      </FlowStepShell>
    </form>
  );
}

export function PhotoEditor({ person, onChanged }) {
  const { api, run } = useDemo();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await run(() => api.replacePractitionerPhoto(person.id, file), "Photograph updated");
      onChanged?.();
    } catch (err) {
      /* toast via run */
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await run(() => api.removePractitionerPhoto(person.id), "Photograph removed");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid={`profile-photo-${person.id}`}>
      <Avatar person={person} photo={person.photo} size={88} />
      <div className="space-y-2">
        <p className="text-sm text-nb-mute">Professional photograph shown on your public profile. Use a clear head-and-shoulders image.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="nb-btn-primary h-10 px-4 text-sm" disabled={busy} onClick={() => input.current?.click()} data-testid={`profile-photo-upload-${person.id}`}><Camera className="h-4 w-4" />{person.photo ? "Replace photo" : "Upload photo"}</button>
          {person.photo && <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" disabled={busy} onClick={remove} data-testid={`profile-photo-remove-${person.id}`}><Trash2 className="h-4 w-4" />Remove</button>}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={upload} data-testid={`profile-photo-input-${person.id}`} />
      </div>
    </div>
  );
}

function CredentialsSelf({ personId }) {
  const { api, run } = useDemo();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ kind: "registration", identifier: "", issuingAuthority: "", province: "AB", provider: "", effectiveOn: "", expiresOn: "", documentNote: "" });
  const load = () => api.credentials().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const mine = rows.filter((row) => row.practitionerId === personId);
  const save = async (event) => {
    event.preventDefault();
    await run(() => api.addCredential({ ...form, practitionerId: personId }), "Credential submitted for review");
    setForm({ kind: "registration", identifier: "", issuingAuthority: "", province: "AB", provider: "", effectiveOn: "", expiresOn: "", documentNote: "" });
    load();
  };
  return (
    <section className="nb-card mt-5 space-y-4 p-5" data-testid="pro-credentials">
      <div className="flex items-center gap-2"><FileBadge className="h-5 w-5 text-nb-teal" /><h2 className="font-semibold">License & insurance</h2></div>
      <p className="text-sm text-nb-mute">Submit registration and insurance details for owner verification. Missing optional fields do not block profile activation. Verified credentials are required before you can accept bookings.</p>
      <ul className="space-y-2 text-sm">
        {mine.map((row) => (
          <li key={row.id} className="rounded-2xl bg-sky-50 px-3 py-2" data-testid={`pro-credential-${row.id}`}>
            {row.kind} · {row.identifier} · expires {row.expiresOn} · {row.status === "verified" ? "Verified" : "Awaiting verification"}
            {row.province ? ` · ${row.province}` : ""}
          </li>
        ))}
        {!mine.length && <li className="text-nb-mute">No credentials on file yet.</li>}
      </ul>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={save} data-testid="pro-credential-form">
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Type</span><select className="nb-input h-10" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{CRED_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Number / policy</span><input className="nb-input h-10" required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} data-testid="pro-credential-identifier" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Issuing authority</span><input className="nb-input h-10" value={form.issuingAuthority} onChange={(e) => setForm({ ...form, issuingAuthority: e.target.value })} /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Province</span><input className="nb-input h-10" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Provider (insurance)</span><input className="nb-input h-10" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Effective</span><input type="date" className="nb-input h-10" value={form.effectiveOn} onChange={(e) => setForm({ ...form, effectiveOn: e.target.value })} /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Expires</span><input type="date" required className="nb-input h-10" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} data-testid="pro-credential-expires" /></label>
        <label className="text-xs sm:col-span-2"><span className="mb-1 block text-nb-mute">Document note</span><input className="nb-input h-10" value={form.documentNote} onChange={(e) => setForm({ ...form, documentNote: e.target.value })} placeholder="Certificate on file with owner" /></label>
        <button type="submit" className="nb-btn-primary h-10 text-sm sm:col-span-2" data-testid="pro-credential-save">Submit for verification</button>
      </form>
    </section>
  );
}

export default function ProProfile() {
  const { state, practitionerId, refresh } = useDemo();
  const [editing, setEditing] = useState(false);
  const person = state.practitioners.find((row) => row.id === practitionerId);
  if (!person) return <p className="text-sm text-nb-mute">Your practitioner profile is not available in this workspace.</p>;
  return (
    <div data-testid="pro-profile" className="mx-auto max-w-2xl space-y-5">
      <SectionHead eyebrow="Public profile" title="What clients see" />
      <div className="nb-card space-y-5 p-5">
        <PhotoEditor person={person} onChanged={() => refresh?.()} />
        <p className="text-sm text-nb-mute">Update your public biography, specialties, and photograph. Owner verification is still required before booking opens.</p>
        {editing ? <ProfileFields person={person} onSaved={() => { setEditing(false); refresh?.(); }} onCancel={() => setEditing(false)} /> : (
          <div className="flex items-start justify-between gap-3 text-sm" data-testid={`profile-summary-${person.id}`}>
            <div>
              <p className="font-semibold">{person.name}</p>
              <p className="text-nb-mute">{person.designation || "No designation"}</p>
              <p className="mt-2 text-nb-mute">{person.bio || "No biography yet"}</p>
              <p className="mt-2 text-xs text-nb-mute">Services: {(person.specialties || []).join(", ") || "None selected"}</p>
            </div>
            <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid={`profile-edit-${person.id}`} onClick={() => setEditing(true)}>Edit</button>
          </div>
        )}
      </div>
      <CredentialsSelf personId={person.id} />
    </div>
  );
}
