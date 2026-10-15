import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, UserPlus, Plus, Truck, Zap, Gift, MapPinned, BadgeCheck, Clock, LifeBuoy, KeyRound, BarChart3, FlaskConical, Archive, Users, ImageOff, ChevronRight } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Segmented, IconTile, Avatar, Pill, BottomSheet, Field, Notice, Reveal, SectionHead, EmptyState } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { money0 } from "@/lib/domain";

const GROUPS = [
  ["Operations", [["Live Fleet", Truck, "/owner/dispatch", "tint-lagoon", "text-nb-blue"], ["Availability", Clock, "/owner/availability", "tint-ice", "text-nb-sky"], ["Recovery", LifeBuoy, "/owner/recovery", "tint-mint", "text-nb-teal"], ["Zones & settings", MapPinned, "/owner/zones", "tint-meadow", "text-[#4E9A2B]"]]],
  ["Growth", [["Flash campaigns", Zap, "/owner/campaigns", "tint-lagoon", "text-nb-blue"], ["Promotions & rewards", Gift, "/owner/promos", "tint-mint", "text-nb-teal"]]],
  ["Admin", [["Credentials", BadgeCheck, "/owner/credentials", "tint-ice", "text-nb-sky"], ["Reception access", KeyRound, "/owner/permissions", "tint-meadow", "text-[#4E9A2B]"], ["Insights", BarChart3, "/owner/insights", "tint-lagoon", "text-nb-blue"], ["Training Center", FlaskConical, "/owner/training", "bg-amber-50", "text-amber-600"], ["Legacy import", Archive, null, "bg-slate-100", "text-nb-mute"]]],
];

function InviteSheet({ open, onOpenChange }) {
  const { api } = usePreview();
  const [f, setF] = useState({ name: "", email: "" });
  const go = async () => { await api.create("staff", { id: `st${Date.now()}`, ...f, role: "practitioner", status: "invited" }, `Invite sent to ${f.email}`); setF({ name: "", email: "" }); onOpenChange(false); };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Invite practitioner" testid="invite-sheet" footer={<button data-testid="invite-submit" disabled={!f.name || !f.email.includes("@")} onClick={go} className="nb-btn-primary w-full">Send invite</button>}>
      <Field label="Full name"><input data-testid="invite-name" className="nb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Email"><input data-testid="invite-email" type="email" className="nb-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Notice tone="info" icon={KeyRound}>They set their own password from the invite link. They won't be bookable until credentials, services and schedule are approved.</Notice>
    </BottomSheet>
  );
}

function ServiceSheet({ open, onOpenChange }) {
  const { api } = usePreview();
  const [f, setF] = useState({ name: "", duration: 60, price: 100, category: "Relax", benefits: "", prep: "" });
  const ok = f.name && f.benefits.trim() && f.prep.trim();
  const go = async () => {
    await api.create("services", { id: `s${Date.now()}`, slug: f.name.toLowerCase().replace(/\W+/g, "-"), name: f.name, category: f.category, duration: +f.duration, price: +f.price, img: "", published: false, blurb: "", benefits: f.benefits.split(",").map((x) => x.trim()), prep: f.prep.split(",").map((x) => x.trim()) }, "Draft service created — unpublished");
    onOpenChange(false);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="New service" sub="Starts unpublished, without a photo" testid="service-sheet" full footer={<button data-testid="service-submit" disabled={!ok} onClick={go} className="nb-btn-primary w-full">Create draft</button>}>
      <Field label="Name"><input data-testid="service-name" className="nb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Minutes"><input data-testid="service-duration" type="number" className="nb-input" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field><Field label="Price ($)"><input data-testid="service-price" type="number" className="nb-input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field></div>
      <Field label="Benefits" hint="Comma separated · required"><input data-testid="service-benefits" className="nb-input" value={f.benefits} onChange={(e) => setF({ ...f, benefits: e.target.value })} /></Field>
      <Field label="Preparation" hint="Comma separated · required"><input data-testid="service-prep" className="nb-input" value={f.prep} onChange={(e) => setF({ ...f, prep: e.target.value })} /></Field>
      <Notice icon={ImageOff}>Upload a photo after the draft exists. New services never reuse catalogue stock photos.</Notice>
    </BottomSheet>
  );
}

export default function Manage() {
  const { db, svc, openProfile, api } = usePreview();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get("tab") || "hub");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(sp.get("invite") ? "invite" : null);
  useEffect(() => { if (sp.get("open")) openProfile("practitioner", sp.get("open")); }, [sp]); // eslint-disable-line
  const match = (s) => s.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="max-w-6xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Manage" sub="People, catalogue and every business tool" right={<TopIcons base="/owner" />} />
      <div className="relative mb-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-nb-mute" /><input data-testid="manage-search" className="nb-input pl-11 rounded-full" placeholder="Search clients, practitioners, services" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value && tab === "hub") setTab("clients"); }} /></div>
      <Segmented testid="manage-tabs" value={tab} onChange={setTab} options={[{ value: "hub", label: "Tools" }, { value: "practitioners", label: "Team" }, { value: "services", label: "Services" }, { value: "clients", label: "Clients" }]} className="mb-5 max-w-full overflow-x-auto no-scrollbar" />
      {tab === "hub" && GROUPS.map(([g, items]) => (
        <section key={g} className="mb-6">
          <SectionHead title={g} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {items.map(([l, I, to, t, ic], i) => <Reveal key={l} i={i}><IconTile testid={`tool-${l.toLowerCase().replace(/\W+/g, "-")}`} icon={I} label={l} sub={to ? undefined : "Off · legacy flag disabled"} tint={t} iconClass={ic} disabled={!to} onClick={() => to && nav(to)} /></Reveal>)}
          </div>
        </section>
      ))}
      {tab === "practitioners" && (
        <>
          <div className="flex justify-between items-center mb-3"><p className="text-sm text-nb-mute">{db.practitioners.length} practitioners · {db.staff.filter((s) => s.status === "invited").length} invited</p><button data-testid="invite-practitioner-btn" onClick={() => setSheet("invite")} className="nb-btn-primary h-11 text-sm"><UserPlus className="h-4 w-4" />Invite</button></div>
          <div className="grid sm:grid-cols-2 gap-3">
            {db.practitioners.filter((p) => match(p.name)).map((p) => (
              <button key={p.id} data-testid={`team-row-${p.id}`} onClick={() => openProfile("practitioner", p.id)} className="nb-card p-3.5 flex items-center gap-3 text-left hover:-translate-y-0.5 transition-transform">
                <Avatar src={p.photo} name={p.name} size={48} />
                <div className="flex-1 min-w-0"><p className="font-semibold truncate">{p.name}</p><p className="text-xs text-nb-mute truncate">{p.specialties.map((s) => svc(s).name).join(" · ")}</p></div>
                <Pill tone={p.bookable ? "bg-nb-turq/15 text-nb-teal ring-nb-turq/30" : "bg-sky-50 text-nb-blue ring-sky-200"}>{p.bookable ? "Bookable" : "Onboarding"}</Pill>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === "services" && (
        <>
          <div className="flex justify-between items-center mb-3"><p className="text-sm text-nb-mute">{db.services.filter((s) => s.published).length} published · {db.services.filter((s) => !s.published).length} draft</p><button data-testid="new-service-btn" onClick={() => setSheet("service")} className="nb-btn-primary h-11 text-sm"><Plus className="h-4 w-4" />New service</button></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {db.services.filter((s) => match(s.name)).map((s) => (
              <div key={s.id} data-testid={`svc-row-${s.id}`} className="nb-card p-3 flex items-center gap-3">
                {s.img ? <img src={s.img} alt="" className="h-14 w-14 rounded-2xl object-cover" /> : <span className="h-14 w-14 rounded-2xl bg-slate-100 grid place-items-center text-nb-mute"><ImageOff className="h-5 w-5" /></span>}
                <div className="flex-1 min-w-0"><p className="font-semibold text-sm truncate">{s.name}</p><p className="text-xs text-nb-mute">{s.duration} min · {money0(s.price)}</p></div>
                <button data-testid={`svc-toggle-${s.id}`} onClick={() => api.save("services", s.id, { published: !s.published }, s.published ? "Moved to draft" : "Published")} disabled={!s.img && !s.published} className={s.published ? "nb-chip-on h-8 text-xs" : "nb-chip-off h-8 text-xs disabled:opacity-50"}>{s.published ? "Published" : "Publish"}</button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "clients" && (
        db.clients.filter((c) => match(c.name)).length === 0 ? <EmptyState icon={Users} title="No matching clients" /> :
        <div className="grid sm:grid-cols-2 gap-2">
          {db.clients.filter((c) => match(c.name)).map((c) => {
            const bal = db.appointments.filter((a) => a.clientId === c.id).reduce((s, a) => s + (a.status === "completed" ? a.settle.balance : 0), 0);
            return (
              <button key={c.id} data-testid={`client-row-${c.id}`} onClick={() => openProfile("client", c.id)} className="nb-card p-3 flex items-center gap-3 text-left">
                <Avatar name={c.name} size={44} />
                <div className="flex-1 min-w-0"><p className="font-semibold text-sm truncate">{c.name}</p><p className="text-xs text-nb-mute truncate">{c.tags[0] || c.email}</p></div>
                {bal > 0 ? <Pill tone="bg-nb-coral/10 text-nb-coral ring-nb-coral/25">{money0(bal)} due</Pill> : <ChevronRight className="h-4 w-4 text-nb-mute" />}
              </button>
            );
          })}
        </div>
      )}
      <InviteSheet open={sheet === "invite"} onOpenChange={(o) => !o && setSheet(null)} />
      <ServiceSheet open={sheet === "service"} onOpenChange={(o) => !o && setSheet(null)} />
    </div>
  );
}
