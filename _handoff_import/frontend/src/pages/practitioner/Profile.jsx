import { useState } from "react";
import { SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

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
    };
    if (owner) {
      body.specialties = form.specialties;
      body.profileVisibility = form.profileVisibility;
      body.displayOrder = Number(form.displayOrder);
      if (form.slug) body.slug = form.slug;
    }
    setError("");
    return run(() => api.savePractitionerProfile(person.id, body), "Profile saved").then((result) => { onSaved?.(); return result; }).catch((err) => setError(apiError(err)));
  };
  return (
    <form className="space-y-3" data-testid={`profile-editor-${person.id}`} onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label className="block text-xs"><span className="mb-1 block text-nb-mute">Display name</span><input className="nb-input h-10" value={form.name} onChange={set("name")} data-testid={`profile-name-${person.id}`} /></label>
      <label className="block text-xs"><span className="mb-1 block text-nb-mute">Designation</span><input className="nb-input h-10" value={form.designation} onChange={set("designation")} data-testid={`profile-designation-${person.id}`} /></label>
      <label className="block text-xs"><span className="mb-1 block text-nb-mute">Biography</span><textarea rows={3} className="nb-input h-auto py-3" value={form.bio} onChange={set("bio")} data-testid={`profile-bio-${person.id}`} /></label>
      <label className="block text-xs"><span className="mb-1 block text-nb-mute">Experience</span><textarea rows={2} className="nb-input h-auto py-3" value={form.experience} onChange={set("experience")} data-testid={`profile-experience-${person.id}`} /></label>
      <label className="block text-xs"><span className="mb-1 block text-nb-mute">Qualifications, one per line</span><textarea rows={3} className="nb-input h-auto py-3" value={form.qualifications} onChange={set("qualifications")} data-testid={`profile-qualifications-${person.id}`} /></label>
      {owner && (
        <>
          <fieldset className="text-xs">
            <legend className="mb-1 text-nb-mute">Services offered</legend>
            <div className="flex flex-wrap gap-2">{state.services.filter((service) => service.archived !== true).map((service) => (
              <label key={service.slug} className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1">
                <input type="checkbox" checked={form.specialties.includes(service.slug)} onChange={() => setForm((current) => ({ ...current, specialties: current.specialties.includes(service.slug) ? current.specialties.filter((item) => item !== service.slug) : [...current.specialties, service.slug] }))} />
                {service.name}
              </label>
            ))}</div>
          </fieldset>
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
      <div className="flex gap-2">{onCancel && <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" onClick={onCancel}>Cancel</button>}<button type="submit" className="nb-btn-primary h-10 px-4 text-sm" data-testid={`profile-save-${person.id}`}>Save profile</button></div>
    </form>
  );
}

export default function ProProfile() {
  const { state, practitionerId } = useDemo();
  const [editing, setEditing] = useState(false);
  const person = state.practitioners.find((row) => row.id === practitionerId);
  if (!person) return <p className="text-sm text-nb-mute">Your practitioner profile is not available in this workspace.</p>;
  return (
    <div data-testid="pro-profile">
      <SectionHead eyebrow="Public profile" title="What clients see" />
      <div className="nb-card max-w-2xl p-5">
        <p className="mb-4 text-sm text-nb-mute">You can update your public biography and photograph. Registration, insurance, activation, and another practitioner's profile stay with the owner.</p>
        {editing ? <ProfileFields person={person} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /> : (
          <div className="flex items-start justify-between gap-3 text-sm" data-testid={`profile-summary-${person.id}`}>
            <div><p className="font-semibold">{person.name}</p><p className="text-nb-mute">{person.designation || "No designation"}</p><p className="mt-2 text-nb-mute">{person.bio || "No biography yet"}</p></div>
            <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid={`profile-edit-${person.id}`} onClick={() => setEditing(true)}>Edit</button>
          </div>
        )}
      </div>
    </div>
  );
}
