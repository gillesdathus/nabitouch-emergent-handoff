import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientDirectory } from "@/components/clients/ClientDirectory";
import { Avatar, CatalogueImage, Pill } from "@/components/ui-kit";
import { HubLink, HubSection, PageHeader } from "@/components/tide";
import { BadgeCheck, BarChart3, CalendarClock, Gift, GraduationCap, LifeBuoy, MailPlus, MapPinned, Radio, Receipt, Route, Settings, Shield, Sparkles, Tag, Users, UserRound, Zap, Archive } from "lucide-react";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";
import { ClientProfile, PractitionerProfile } from "@/components/ops/Profiles";
import { money, addDays, todayISO, profileVisibility, servicePublication, clinicBookable } from "@/lib/domain";
import { ProfileFields } from "@/pages/practitioner/Profile";

const CATEGORIES = [
  ["relaxation", "Relaxation"],
  ["therapeutic", "Therapeutic"],
  ["gentle", "Gentle care"],
  ["specialty", "Specialty"],
];

const slugify = (value) => String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const lines = (value) => String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);

function emptyForm() {
  return {
    name: "", slug: "", short: "", description: "", benefits: "", goals: "", category: "relaxation",
    rows: [{ duration: "60", price: "120" }], taxable: true, mobile: true, clinic: false,
    prepMinutes: "10", prep: "Hydrate well before and after your session.", enabled: false, slugEdited: false,
  };
}

function formFrom(service) {
  return {
    name: service.name || "",
    slug: service.slug || "",
    short: service.short || "",
    description: service.description || "",
    benefits: (service.benefits || []).join("\n"),
    goals: (service.goals || []).join("\n"),
    category: service.category || "",
    rows: Object.entries(service.prices || {}).map(([duration, price]) => ({ duration, price: String(price) })),
    taxable: service.taxable !== false,
    mobile: service.mobile !== false,
    clinic: service.clinic !== false,
    prepMinutes: service.prepMinutes == null ? "" : String(service.prepMinutes),
    prep: (service.prep || []).join("\n"),
    enabled: service.enabled !== false && service.archived !== true,
    slugEdited: true,
  };
}

function ServiceEditor({ service, onClose }) {
  const { run, api, idx } = useDemo();
  const clinicOpen = clinicBookable(idx?.settings?.clinic);
  const [form, setForm] = useState(service ? formFrom(service) : emptyForm());
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(service || null);
  const [photoReady, setPhotoReady] = useState(String(service?.img || "").startsWith("/api/media/"));
  const set = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && !current.slugEdited && !service) next.slug = slugify(value);
      if (key === "slug") next.slugEdited = true;
      return next;
    });
  };
  const setRow = (index, key, value) => setForm((current) => ({ ...current, rows: current.rows.map((row, i) => i === index ? { ...row, [key]: value } : row) }));

  const save = () => {
    const durations = form.rows.map((row) => Number(row.duration));
    if (durations.some((duration) => !Number.isInteger(duration) || duration < 15)) {
      setError("Durations must be whole minutes of at least 15.");
      return;
    }
    if (new Set(durations).size !== durations.length) {
      setError("Each duration can only be listed once.");
      return;
    }
    if (form.rows.some((row) => row.price === "" || Number(row.price) < 0)) {
      setError("Prices must be zero or more.");
      return;
    }
    const prices = Object.fromEntries(form.rows.map((row) => [String(Number(row.duration)), Number(row.price)]));
    const body = {
      name: form.name.trim(),
      short: form.short.trim(),
      description: form.description.trim(),
      benefits: lines(form.benefits),
      goals: lines(form.goals),
      prices,
      durations,
      taxable: form.taxable,
      mobile: form.mobile,
      clinic: form.clinic,
      prep: lines(form.prep),
      enabled: form.enabled,
    };
    if (form.category) body.category = form.category;
    if (form.prepMinutes !== "") body.prepMinutes = Number(form.prepMinutes);
    if (!saved) body.slug = form.slug.trim();
    if (saved && Number.isInteger(saved.version)) body.version = saved.version;
    if (!clinicOpen) body.clinic = false;
    if (!saved) body.enabled = false;
    setError("");
    run(() => saved ? api.patch("services", saved.id, body) : api.create("services", body), saved ? "Service saved" : "Draft saved")
      .then((created) => { if (!saved && created) setSaved(created); setStep(2); })
      .catch((err) => setError(apiError(err)));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl" data-testid="service-editor">
    <DialogTitle>{saved ? saved.name || form.name || "Service" : "Create service"}</DialogTitle>
    <p className="text-xs text-nb-mute">Step {step + 1} of 4 · {["Basics", "Pricing", "Photo", "Review"][step]}</p>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (step < 1) setStep(step + 1); else if (step === 1) save(); }}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-nb-ink">{service ? `Edit ${service.name}` : "New service"}</p>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-nb-blue" data-testid="service-editor-close">Close</button>
      </div>
      {step === 0 && <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Name</span><input className="nb-input h-10" value={form.name} onChange={set("name")} data-testid="service-name" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Slug</span><input className="nb-input h-10" value={form.slug} onChange={set("slug")} disabled={!!service} data-testid="service-slug" /></label>
        <label className="text-xs sm:col-span-2"><span className="mb-1 block text-nb-mute">Short description</span><input className="nb-input h-10" value={form.short} onChange={set("short")} data-testid="service-short" /></label>
        <label className="text-xs sm:col-span-2"><span className="mb-1 block text-nb-mute">Full description</span><textarea rows={4} className="nb-input h-auto py-3" value={form.description} onChange={set("description")} data-testid="service-description" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Benefits, one per line</span><textarea rows={4} className="nb-input h-auto py-3" value={form.benefits} onChange={set("benefits")} data-testid="service-benefits" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Goals, one per line</span><textarea rows={4} className="nb-input h-auto py-3" value={form.goals} onChange={set("goals")} data-testid="service-goals" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Category</span>
          <select className="nb-input h-10" value={form.category} onChange={set("category")} data-testid="service-category">
            <option value="">{service ? "Keep unset" : "Choose a category"}</option>
            {CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Preparation time (minutes)</span><input type="number" min="0" className="nb-input h-10" value={form.prepMinutes} onChange={set("prepMinutes")} data-testid="service-prep-minutes" /></label>
      </div>}
      {step === 1 && <div className="space-y-2">
        <p className="text-xs text-nb-mute">Durations and prices</p>
        {form.rows.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <input type="number" min="15" className="nb-input h-10 w-24" value={row.duration} onChange={(event) => setRow(index, "duration", event.target.value)} aria-label="Duration minutes" data-testid={service ? `price-duration-${service.slug}-${index}` : `service-duration-${index}`} />
            <input type="number" min="0" step="0.01" className="nb-input h-10 w-28" value={row.price} onChange={(event) => setRow(index, "price", event.target.value)} aria-label="Price" data-testid={service ? `price-${service.slug}-${row.duration}` : `service-price-${index}`} />
            <button type="button" className="text-xs font-semibold text-nb-blue" onClick={() => setForm((current) => ({ ...current, rows: current.rows.filter((_, i) => i !== index) }))} data-testid={`service-remove-duration-${index}`}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-sm font-semibold text-nb-blue" onClick={() => setForm((current) => ({ ...current, rows: [...current.rows, { duration: "", price: "" }] }))} data-testid="service-add-duration">Add duration</button>
      <label className="text-xs"><span className="mb-1 block text-nb-mute">Preparation steps, one per line</span><textarea rows={3} className="nb-input h-auto py-3" value={form.prep} onChange={set("prep")} data-testid="service-prep" /></label>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.mobile} onChange={set("mobile")} data-testid="service-mobile" />Mobile visits</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={clinicOpen && form.clinic} disabled={!clinicOpen} onChange={set("clinic")} data-testid="service-clinic" />In clinic{!clinicOpen && " (clinic booking is off)"}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.taxable} onChange={set("taxable")} data-testid="service-taxable" />Taxable</label>
      </div>
      </div>}
      {step === 2 && <div className="space-y-3" data-testid="service-photo-step">
        <p className="text-sm">Upload a cover photo for this service. A new service does not reuse another treatment’s picture.</p>
        <label className="nb-btn-ghost inline-flex h-10 cursor-pointer items-center px-4 text-sm">Choose photo
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" data-testid="service-create-photo" onChange={(event) => {
            const file = event.target.files && event.target.files[0];
            event.target.value = "";
            if (!file || !saved?.id) return;
            setError("");
            run(() => api.replaceServicePhoto(saved.id, file), "Cover photo saved").then(() => setPhotoReady(true)).catch((err) => setError(apiError(err)));
          }} />
        </label>
        {photoReady && <p className="text-sm text-teal-800" data-testid="service-photo-ready">Cover photo saved.</p>}
      </div>}
      {step === 3 && <div className="space-y-2 text-sm" data-testid="service-review">
        <p><b>{form.name}</b> · {form.slug}</p>
        <p className="text-nb-mute">{form.short}</p>
        <p>{form.rows.map((row) => `${row.duration} min · $${row.price}`).join(" · ")}</p>
        <p className="text-nb-mute">This stays a draft until you publish it. Drafts are not shown in public booking.</p>
        <button type="button" className="nb-btn-primary h-10 px-4 text-sm" disabled={!photoReady} data-testid="service-editor-publish" onClick={() => run(() => api.publishService(saved.id), "Service published").then(() => onClose()).catch((err) => setError(apiError(err)))}>Publish</button>
      </div>}
      {error && <p className="text-sm text-red-700" data-testid="service-form-error">{error}</p>}
      <div className="flex gap-2">
        {step > 0 && <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 1 && <button type="submit" className="nb-btn-primary h-10 px-4 text-sm" data-testid="service-next">Continue</button>}
        {step === 1 && <button type="submit" className="nb-btn-primary h-10 px-4 text-sm" data-testid="service-save">{saved ? "Save and add photo" : "Save draft and add photo"}</button>}
        {step === 2 && <button type="button" className="nb-btn-primary h-10 px-4 text-sm" disabled={!photoReady} data-testid="service-photo-next" onClick={() => setStep(3)}>Review</button>}
      </div>
    </form>
    </DialogContent>
    </Dialog>
  );
}

function ServiceRow({ service, onEdit }) {
  const { run, api } = useDemo();
  const [confirming, setConfirming] = useState("");
  const [error, setError] = useState("");
  const version = Number.isInteger(service.version) ? { version: service.version } : {};
  const act = (fn, ok) => { setError(""); return run(fn, ok).catch((err) => setError(apiError(err))); };
  return (
    <div className="nb-card space-y-3 p-4" data-testid={`manage-service-${service.slug}`}>
      <div className="flex flex-wrap items-center gap-4">
        <CatalogueImage src={service.img} alt="" size="thumb" className="h-12 w-12 rounded-xl object-cover" />
        <div className="min-w-[160px] flex-1">
          <p className="font-semibold">{service.name}</p>
          <p className="text-xs text-nb-mute">{service.category || "No category"} · {Object.entries(service.prices || {}).map(([minutes, price]) => `${minutes}m ${money(price)}`).join(" · ")}</p>
        </div>
        <Pill tone={servicePublication(service) === "published" ? "turq" : servicePublication(service) === "archived" ? "amber" : "slate"}>{servicePublication(service)}</Pill>
        <Switch checked={servicePublication(service) === "published"} disabled={service.archived === true || service.publication === "preview" || service.publication === "draft"} onCheckedChange={(value) => act(() => api.patch("services", service.id, { enabled: value, ...version }), value ? "Service activated" : "Service deactivated")} data-testid={`manage-service-enabled-${service.slug}`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={onEdit} data-testid={`service-edit-${service.slug}`}>Edit</button>
        {service.archived
          ? <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => act(() => api.restoreService(service.id), "Service restored")} data-testid={`service-restore-${service.slug}`}>Restore</button>
          : <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => setConfirming("archive")} data-testid={`service-archive-${service.slug}`}>Archive</button>}
        <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => setConfirming("delete")} data-testid={`service-delete-${service.slug}`}>Delete</button>
        <label className="nb-btn-ghost inline-flex h-9 cursor-pointer items-center px-3 text-xs">
          Replace photo
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" data-testid={`service-photo-${service.slug}`} onChange={(event) => { const file = event.target.files && event.target.files[0]; event.target.value = ""; if (file) act(() => api.replaceServicePhoto(service.id, file), "Service photo updated"); }} />
        </label>
        {String(service.img || "").startsWith("/api/media/") && <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => act(() => api.removeServicePhoto(service.id), "Service photo removed")} data-testid={`service-photo-remove-${service.slug}`}>Remove photo</button>}
        {servicePublication(service) !== "preview" && servicePublication(service) !== "archived" && <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => act(() => api.previewService(service.id), "Preview prepared")} data-testid={`service-preview-${service.slug}`}>Preview</button>}
        {servicePublication(service) !== "published" && <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => act(() => api.publishService(service.id), "Service published")} data-testid={`service-publish-${service.slug}`}>Publish</button>}
        {servicePublication(service) === "published" && <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => act(() => api.draftService(service.id), "Moved to draft")} data-testid={`service-draft-${service.slug}`}>Move to draft</button>}
      </div>
      {confirming && (
        <div className="rounded-2xl bg-sky-50 p-3 text-sm">
          <p>{confirming === "delete" ? "Delete this service only when no visit, invoice, promotion, or practitioner uses it." : "Archived services stay on past visits and disappear from booking."}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="nb-btn-primary h-9 px-3 text-xs" data-testid={`service-confirm-${service.slug}`} onClick={() => act(() => confirming === "delete" ? api.deleteService(service.id) : api.archiveService(service.id), confirming === "delete" ? "Service deleted" : "Service archived").then(() => setConfirming(""))}>Confirm</button>
            <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => setConfirming("")}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-700" data-testid={`service-error-${service.slug}`}>{error}</p>}
    </div>
  );
}

function PractitionerCard({ person, soon }) {
  const { run, api } = useDemo();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const act = (fn, ok) => { setError(""); return run(fn, ok).catch((err) => setError(apiError(err))); };
  const onFile = (event, upload, ok) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (file) act(() => upload(file), ok);
  };
  const gallery = Array.isArray(person.gallery) ? person.gallery : [];
  return (
    <div className="nb-card min-w-0 p-4 sm:p-5" data-testid={`manage-pract-${person.id}`}>
      <div className="flex min-w-0 items-center gap-3"><Avatar person={person} /><div className="min-w-0 flex-1"><p className="break-words font-semibold">{person.name} {person.isOwner && <Pill tone="blue">Owner</Pill>}</p><p className="truncate text-xs text-nb-mute">{(person.specialties || []).join(" · ")}</p></div><Switch checked={person.available} onCheckedChange={(value) => run(() => api.patch("practitioners", person.id, { available: value, _audit: `${person.name} availability → ${value ? "on" : "off"}` }))} data-testid={`manage-avail-${person.id}`} /></div>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="nb-btn-ghost inline-flex h-9 cursor-pointer items-center px-3 text-xs">
          Replace photo
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" data-testid={`pract-photo-${person.id}`} onChange={(event) => onFile(event, (file) => api.replacePractitionerPhoto(person.id, file), "Profile photo updated")} />
        </label>
        {String(person.photo || "").startsWith("/api/media/") && <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={() => act(() => api.removePractitionerPhoto(person.id), "Profile photo removed")} data-testid={`pract-photo-remove-${person.id}`}>Remove photo</button>}
        {gallery.length < 6 && (
          <label className="nb-btn-ghost inline-flex h-9 cursor-pointer items-center px-3 text-xs">
            Add gallery photo
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" data-testid={`pract-gallery-${person.id}`} onChange={(event) => onFile(event, (file) => api.addPractitionerGallery(person.id, file), "Gallery photo added")} />
          </label>
        )}
      </div>
      {gallery.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {gallery.slice(0, 6).map((item) => (
            <div key={item.id} className="space-y-1">
              <CatalogueImage src={item.src} alt="" size="thumb" className="h-14 w-14 rounded-xl object-cover" />
              <button type="button" className="text-[11px] font-semibold text-nb-blue" onClick={() => act(() => api.removePractitionerGallery(person.id, item.id), "Gallery photo removed")} data-testid={`pract-gallery-remove-${person.id}-${item.id}`}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs"><Pill tone={profileVisibility(person) === "published" ? "turq" : "slate"}>{profileVisibility(person)}</Pill><Pill tone={person.available && person.bookable !== false ? "turq" : "slate"}>{person.available && person.bookable !== false ? "Bookable" : "Not bookable"}</Pill><Pill tone={soon(person.licenseExpiry) ? "amber" : "slate"}>Licence {person.licenseExpiry}</Pill><Pill tone={soon(person.insuranceExpiry) ? "amber" : "slate"}>Insurance {person.insuranceExpiry}</Pill></div>
      <button type="button" className="nb-btn-ghost mt-3 h-9 px-3 text-xs" onClick={() => setEditing((value) => !value)} data-testid={`profile-edit-${person.id}`}>{editing ? "Close profile" : "Edit profile"}</button>
      {editing && <div className="mt-3"><ProfileFields person={person} owner onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /></div>}
      {error && <p className="mt-2 text-sm text-red-700" data-testid={`pract-photo-error-${person.id}`}>{error}</p>}
    </div>
  );
}

const SYNTHETIC = new Set(["p-maya", "p-liam", "p-priya"]);

export default function Manage() {
  const { state, api, run } = useDemo();
  const records = useRef(null);
  const [q, setQ] = useState("");
  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState(params.get("create") === "service" ? "services" : params.get("tab") || "practitioners");
  const [editing, setEditing] = useState(params.get("create") === "service" ? "new" : null);
  const [showInvite, setShowInvite] = useState(params.get("invite") === "1");
  const [invite, setInvite] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [personId, setPersonId] = useState(null);
  const [person, setPerson] = useState({ name: "", email: "", phone: "", role: "practitioner", roles: ["practitioner"] });
  const toggleInviteRole = (role) => {
    setPerson((current) => {
      const have = new Set(current.roles || [current.role]);
      if (have.has(role)) have.delete(role); else have.add(role);
      if (!have.size) have.add("practitioner");
      const roles = ["owner", "manager", "practitioner", "desk"].filter((item) => have.has(item));
      return { ...current, roles, role: roles[0] };
    });
  };
  const soon = (d) => d <= addDays(todayISO(), 60);
  const today = todayISO();
  const openTab = (name, extra) => {
    setTab(name);
    if (extra) extra();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    records.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  const visitsToday = (state.appointments || []).filter((item) => item.date === today && !["cancelled", "no_show"].includes(item.status));
  const onDuty = visitsToday.filter((item) => ["assigned", "en_route", "arrived", "in_session"].includes(item.status)).length;
  const published = (state.services || []).filter((service) => service.archived !== true && servicePublication(service) === "published").length;
  const zonesOn = (state.zones || []).filter((zone) => zone.enabled).length;
  const balances = (state.appointments || []).filter((item) => (item.settle?.balance || 0) > 0).length;
  const expiring = (state.practitioners || []).filter((item) => (item.licenseExpiry && item.licenseExpiry <= addDays(today, 60)) || (item.insuranceExpiry && item.insuranceExpiry <= addDays(today, 60))).length;
  return (
    <div data-testid="owner-manage" className="space-y-6">
      <PageHeader eyebrow="Management" title="People and services" sub="Operations, people, catalogue, and the business settings that already exist in this workspace." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HubSection title="Operations" testid="manage-section-operations">
          <HubLink to="/owner/dispatch" icon={Radio} tint="tint-lagoon" title="Live Fleet" detail="Dispatch, arrivals, and visits on the road." meta={onDuty ? String(onDuty) : undefined} testid="manage-link-live" />
          <HubLink to="/owner/availability" icon={CalendarClock} tint="tint-ice" title="Availability" detail="Weekly hours, campaign slots, breaks, and travel buffers." meta={state.practitioners?.length ? String(state.practitioners.length) : undefined} testid="manage-link-availability" />
          <HubLink to="/owner/routes" icon={Route} tint="tint-mint" title="Routes" detail="The day’s stops in Edmonton order." meta={visitsToday.length ? String(visitsToday.length) : undefined} testid="manage-link-routes" />
          <HubLink to="/owner/zones" icon={MapPinned} tint="tint-meadow" title="Travel zones" detail="Radius, travel fee, and which rings are on." meta={zonesOn ? String(zonesOn) : undefined} testid="manage-link-travel" />
          <HubLink to="/owner/campaigns" icon={Zap} tint="tint-ice" title="Flash bookings" detail="Limited windows. Nothing is sent until you publish one." testid="manage-link-flash" />
        </HubSection>
        <HubSection title="People" testid="manage-section-people">
          <HubLink icon={Users} tint="tint-ice" title="Clients" detail="Profiles, visits, and balances on file." meta={state.clients?.length ? String(state.clients.length) : undefined} testid="manage-open-clients" onClick={() => openTab("clients")} />
          <HubLink icon={UserRound} tint="tint-mint" title="Practitioners" detail="Photos, bookable status, and public profiles." meta={state.practitioners?.length ? String(state.practitioners.length) : undefined} testid="manage-open-practitioners" onClick={() => openTab("practitioners")} />
          <HubLink icon={MailPlus} tint="tint-lagoon" title="Invitations" detail="Create a practitioner invite. Email delivery stays off." testid="manage-open-invites" onClick={() => openTab("practitioners", () => setShowInvite(true))} />
          <HubLink to="/owner/credentials" icon={BadgeCheck} tint="tint-meadow" title="Credentials" detail="Association, liability, municipal, CPR — 14-day grace after approval." meta={expiring ? `${expiring} due` : undefined} testid="manage-link-credentials" />
        </HubSection>
        <HubSection title="Services and growth" testid="manage-section-growth">
          <HubLink icon={Sparkles} tint="tint-lagoon" title="Service catalogue" detail="Durations, prices, photos, and publication." meta={published ? String(published) : undefined} testid="manage-open-services" onClick={() => openTab("services")} />
          <HubLink to="/owner/marketing" icon={Tag} tint="tint-mint" title="Marketing" detail="Welcome offer, flash campaigns, follow-up coupons, and light reporting." testid="manage-link-marketing" />
          <HubLink to="/owner/promos" icon={Tag} tint="tint-mint" title="Promotions" detail="Codes and the welcome offer. Gift cards stay inactive." meta={state.promotions?.length ? String(state.promotions.length) : undefined} testid="manage-link-promotions" />
          <HubLink to="/owner/campaigns" icon={Zap} tint="tint-ice" title="Campaigns" detail="The same flash-booking desk, filtered by status." testid="manage-link-campaigns" />
          <HubLink to="/owner/rewards" icon={Gift} tint="tint-meadow" title="Rewards" detail="Draft point rules. Earning and redemption stay off." testid="manage-link-rewards" />
        </HubSection>
        <HubSection title="Business administration" testid="manage-section-admin">
          <HubLink to="/owner/payments" icon={Receipt} tint="tint-ice" title="Invoices" detail="Collections, insurance receivables, and period reports." meta={balances ? String(balances) : undefined} testid="manage-link-invoices" />
          <HubLink to="/owner/insights" icon={BarChart3} tint="tint-lagoon" title="Insights" detail="Service mix, booked hours, and the audit trail." testid="manage-link-insights" />
          <HubLink to="/owner/permissions" icon={Shield} tint="tint-mint" title="Staff access" detail="Reception permissions and authenticator rules." testid="manage-link-staff" />
          <HubLink to="/owner/zones" icon={Settings} tint="tint-meadow" title="Settings" detail="Clinic booking, payment policy, and GST." testid="manage-link-settings" />
          <HubLink to="/owner/legacy" icon={Archive} tint="tint-ice" title="Legacy clients" detail="Imported records stay separate until they are linked." testid="manage-link-legacy" />
          <HubLink to="/owner/recovery" icon={LifeBuoy} tint="tint-mint" title="Recovery" detail="Restore a visit that was closed by mistake." testid="manage-link-recovery" />
          <HubLink to="/owner/training" icon={GraduationCap} tint="tint-lagoon" title="Training" detail="Isolated scenarios. They do not write to live clients." testid="manage-link-training" />
        </HubSection>
      </div>
      <div ref={records} className="min-w-0 scroll-mt-24">
      <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="nb-eyebrow">Workspace</p>
          <h2 className="text-xl font-semibold tracking-tight text-nb-ink">Records</h2>
        </div>
        <p className="text-xs text-nb-mute">{state.practitioners.length} practitioners · {state.services.length} services · {state.clients.length} clients</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="inline-flex h-11 w-max min-w-full rounded-full bg-white p-1 shadow-sm ring-1 ring-sky-100 sm:w-auto">{["practitioners", "services", "clients"].map((t) => <TabsTrigger key={t} value={t} data-testid={`manage-tab-${t}`} className="rounded-full px-4 capitalize data-[state=active]:bg-nb-ink data-[state=active]:text-white">{t}</TabsTrigger>)}</TabsList>
        </div>
        <TabsContent value="practitioners" className="mt-5 space-y-3">
          <div className="nb-card min-w-0 space-y-3 p-4" data-testid="practitioner-invite">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">Staff invitations</p><button type="button" className="nb-btn-primary h-10 px-4 text-sm" onClick={() => setShowInvite((value) => !value)} data-testid="invite-open">{showInvite ? "Close" : "Invite staff"}</button></div>
            {showInvite && <>
            <p className="text-xs text-nb-mute">Invite owner, manager, reception, or practitioner roles. You do not set their password. A single-use link is shown once when email delivery is off.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="nb-input h-10" placeholder="Name" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} data-testid="invite-name" />
              <input className="nb-input h-10" placeholder="Email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} data-testid="invite-email" />
              <input className="nb-input h-10" placeholder="Mobile phone" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} data-testid="invite-phone" />
              <div className="sm:col-span-2 flex flex-wrap gap-3 text-sm" data-testid="invite-roles">
                {[["owner", "Owner"], ["manager", "Manager"], ["desk", "Reception"], ["practitioner", "Practitioner"]].map(([id, label]) => (
                  <label key={id} className="inline-flex items-center gap-2"><input type="checkbox" checked={(person.roles || []).includes(id)} onChange={() => toggleInviteRole(id)} data-testid={`invite-role-${id}`} />{label}</label>
                ))}
              </div>
            </div>
            <button type="button" className="nb-btn-primary h-10 px-4 text-sm" data-testid="invite-send" onClick={() => run(() => api.inviteStaff({ ...person, roles: person.roles, role: person.role }), "Invitation created").then((result) => { setInvite(result); setPerson({ name: "", email: "", phone: "", role: "practitioner", roles: ["practitioner"] }); setShowInvite(false); }).catch(() => {})}>Create invitation</button>
            </>}
            {invite?.previewInviteToken && <p className="break-all rounded-2xl bg-sky-50 p-3 text-xs" data-testid="invite-link">Copy this link once: {window.location.origin}/join?token={invite.previewInviteToken}</p>}
            {invite && !invite.previewInviteToken && <p className="text-sm">{invite.message}</p>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
          {state.practitioners.map((item) => <div key={item.id} className="space-y-2">{SYNTHETIC.has(item.id) && <p className="text-xs font-semibold text-amber-800">Synthetic preview record. It stays until you confirm a cleanup. This screen does not delete it.</p>}<PractitionerCard person={item} soon={soon} /><button type="button" className="text-sm font-semibold text-nb-blue" onClick={() => setPersonId(item.id)} data-testid={`pract-profile-${item.id}`}>View profile</button></div>)}
          </div>
          <p className="text-xs text-nb-mute md:col-span-2">Licence and insurance dates stay in the owner workspace and drive the expiry reminders.</p>
        </TabsContent>
        <TabsContent value="services" className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-nb-ink">Treatment catalogue</p>
            <button type="button" className="nb-btn-primary h-10 px-4 text-sm" onClick={() => setEditing("new")} data-testid="service-create-open">Create service</button>
          </div>
          {editing === "new" && <ServiceEditor service={null} onClose={() => setEditing(null)} />}
          {state.services.map((service) => (
            <div key={service.id || service.slug} className="space-y-3">
              {editing === service.id && <ServiceEditor service={service} onClose={() => setEditing(null)} />}
              <ServiceRow service={service} onEdit={() => setEditing(service.id)} />
            </div>
          ))}
        </TabsContent>
        <TabsContent value="clients" className="mt-5"><ClientDirectory role="owner" /></TabsContent>
      </Tabs>
      {clientId && <ClientProfile clientId={clientId} onClose={() => setClientId(null)} />}
      {personId && <PractitionerProfile personId={personId} onClose={() => setPersonId(null)} />}
      </div>
    </div>
  );
}
