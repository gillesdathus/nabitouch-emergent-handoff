import { useState } from "react";
import { Phone, Mail, CalendarDays, ClipboardList, FileText, Receipt, BellRing, ChevronRight, ShieldCheck, Clock, BadgeCheck, FolderLock, UserCog } from "lucide-react";
import { BottomSheet, Avatar, Segmented, StatusPill, PayPill, Pill, Notice, EmptyState, Row } from "@/components/ui-kit";
import { usePreview } from "@/store/PreviewStore";
import { money, fmtDate, timeLabel } from "@/lib/domain";

const ApptRow = ({ a, svc, pro, onOpen }) => (
  <button onClick={() => onOpen(a.id)} className="w-full flex items-center gap-3 rounded-2xl bg-white ring-1 ring-sky-100 p-3 mb-2 text-left active:scale-[0.99] transition-transform">
    <Avatar src={pro(a.practitionerId).photo} name={pro(a.practitionerId).name} size={38} />
    <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{svc(a.serviceId).name}</p><p className="text-xs text-nb-mute">{fmtDate(a.date)} · {timeLabel(a.time)}</p></div>
    <span className="rounded-full bg-nb-ink text-white text-xs font-semibold px-3 h-7 grid place-items-center nb-num">{money(a.pricing.total)}</span>
  </button>
);

function ClientProfile({ c }) {
  const { db, svc, pro, role, openAppt } = usePreview();
  const [tab, setTab] = useState("overview");
  const list = db.appointments.filter((a) => a.clientId === c.id).sort((x, y) => y.date.localeCompare(x.date));
  const clinical = role === "owner" || role === "pro";
  const deskClinical = role === "desk" && db.settings.receptionPerms.clinical;
  const tabs = [{ value: "overview", label: "Overview" }, { value: "visits", label: "Visits" }, { value: "invoices", label: "Invoices" }, ...(clinical || deskClinical ? [{ value: "clinical", label: "Clinical" }] : [])];
  const rows = [
    { k: "visits", icon: CalendarDays, label: "Appointments", val: `${list.length}` },
    { k: "intake", icon: ClipboardList, label: "Intake forms", val: c.intake === "complete" ? "Complete" : "Pending" },
    ...(clinical ? [{ k: "clinical", icon: FileText, label: "Treatment notes", val: `${list.filter((a) => a.soap === "signed").length} signed` }] : []),
    { k: "invoices", icon: Receipt, label: "Invoices", val: money(list.reduce((s, a) => s + a.settle.balance, 0)) + " due" },
    { k: "follow", icon: BellRing, label: "Follow-ups", val: db.plans.filter((p) => p.clientId === c.id).length ? "Care plan active" : "None" },
  ];
  return (
    <div data-testid="client-profile">
      <div className="rounded-[28px] nb-soft p-5 flex items-center gap-4">
        <Avatar name={c.name} size={68} />
        <div className="min-w-0">
          <p className="text-xl font-semibold leading-tight">{c.name}</p>
          <p className="text-xs text-nb-mute mt-0.5">Client since {fmtDate(c.since, { month: "short", year: "numeric" })}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">{c.tags.map((t) => <Pill key={t} tone="bg-white text-nb-teal ring-nb-turq/30">{t}</Pill>)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <a href={`tel:${c.phone}`} className="nb-btn-ghost"><Phone className="h-4 w-4" />Call</a>
        <a href={`mailto:${c.email}`} className="nb-btn-ghost"><Mail className="h-4 w-4" />Email</a>
      </div>
      <Segmented className="mt-4 w-full overflow-x-auto no-scrollbar" testid="client-profile-tabs" options={tabs} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === "overview" && rows.map((r) => (
          <button key={r.k} data-testid={`client-row-${r.k}`} onClick={() => ["visits", "invoices", "clinical"].includes(r.k) && setTab(r.k)} className="w-full flex items-center gap-3 py-3.5 border-b border-sky-100 text-left">
            <span className="grid place-items-center h-9 w-9 rounded-xl tint-ice text-nb-blue"><r.icon className="h-4 w-4" /></span>
            <span className="flex-1 text-sm font-medium">{r.label}</span><span className="text-xs text-nb-mute">{r.val}</span><ChevronRight className="h-4 w-4 text-nb-mute" />
          </button>
        ))}
        {tab === "overview" && <Row className="mt-3" label="Insurance" value={role === "desk" && !db.settings.receptionPerms.viewInsuranceStatus ? "Hidden" : c.insurance} />}
        {tab === "visits" && (list.length ? list.map((a) => <ApptRow key={a.id} a={a} svc={svc} pro={pro} onOpen={openAppt} />) : <EmptyState title="No visits yet" />)}
        {tab === "invoices" && list.filter((a) => a.status !== "cancelled").map((a) => (
          <div key={a.id} className="flex items-center justify-between py-3 border-b border-sky-100"><div><p className="text-sm font-medium">{svc(a.serviceId).name}</p><p className="text-xs text-nb-mute">{fmtDate(a.date)}</p></div><div className="flex items-center gap-2"><PayPill pay={a.pay} /><span className="text-sm font-semibold nb-num">{money(a.pricing.total)}</span></div></div>
        ))}
        {tab === "clinical" && (deskClinical && !clinical ? (
          <Notice icon={FolderLock}>Reception sees completion status only: {list.filter((a) => a.soap === "signed").length} signed notes. SOAP content is never shown to reception.</Notice>
        ) : (
          list.filter((a) => a.soap !== "none").map((a) => (
            <div key={a.id} className="flex items-center justify-between py-3 border-b border-sky-100"><div><p className="text-sm font-medium">SOAP · {svc(a.serviceId).name}</p><p className="text-xs text-nb-mute">{fmtDate(a.date)} · {pro(a.practitionerId).name}</p></div><Pill tone={a.soap === "signed" ? "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30" : "bg-sky-50 text-nb-blue ring-sky-200"}>{a.soap === "signed" ? "Signed" : "Draft"}</Pill></div>
          ))
        ))}
      </div>
    </div>
  );
}

function PractitionerProfile({ p }) {
  const { db, svc, role, api, openAppt } = usePreview();
  const [tab, setTab] = useState("overview");
  const creds = db.credentials.filter((c) => c.practitionerId === p.id);
  const visits = db.appointments.filter((a) => a.practitionerId === p.id && a.status !== "cancelled");
  const sch = db.schedules[p.id];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div data-testid="practitioner-profile">
      <div className="relative rounded-[28px] overflow-hidden tint-ice h-56">
        <div className="absolute inset-0 bg-gradient-to-br from-nb-cyan/20 via-transparent to-nb-turq/25" />
        <img src={p.photo} alt={p.name} className="absolute right-0 bottom-0 h-full w-1/2 object-cover object-top [mask-image:linear-gradient(to_left,black_70%,transparent)]" />
        <div className="relative p-5 h-full flex flex-col">
          <Pill tone="bg-white text-nb-teal ring-nb-turq/30" className="self-start">{svc(p.specialties[0]).name}</Pill>
          <p className="mt-3 text-2xl font-semibold leading-tight max-w-[55%]">{p.name}</p>
          <p className="text-xs text-nb-mute mt-1 max-w-[55%]">{p.title}</p>
          <div className="mt-auto"><Pill tone={p.bookable ? "bg-nb-turq/15 text-nb-teal ring-nb-turq/30" : "bg-slate-100 text-nb-mute ring-slate-200"}>{p.bookable ? "Publicly bookable" : "Not bookable yet"}</Pill></div>
        </div>
      </div>
      <div className="grid grid-cols-4 -mt-6 mx-3 relative rounded-3xl nb-glass shadow-lg py-3 text-center">
        {[[`${p.years}y`, "Experience"], [p.specialties.length, "Services"], [visits.length, "Visits"], [p.languages.length, "Languages"]].map(([v, l]) => <div key={l}><p className="text-lg font-semibold nb-num">{v}</p><p className="text-[10.5px] text-nb-mute">{l}</p></div>)}
      </div>
      <Segmented className="mt-5 w-full overflow-x-auto no-scrollbar" testid="practitioner-profile-tabs" value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "schedule", label: "Schedule" }, { value: "credentials", label: "Credentials" }, { value: "reports", label: "Reports" }]} />
      <div className="mt-4">
        {tab === "overview" && (
          <>
            <p className="text-sm text-nb-mute leading-relaxed">{p.bio}</p>
            <div className="flex flex-wrap gap-2 mt-3">{p.specialties.map((s) => <span key={s} className="nb-chip-off h-8 text-xs">{svc(s).name}</span>)}</div>
            <p className="nb-eyebrow mt-5 mb-2">Assigned visits</p>
            {visits.slice(0, 4).map((a) => <button key={a.id} onClick={() => openAppt(a.id)} className="w-full flex items-center justify-between py-2.5 border-b border-sky-100 text-sm text-left"><span>{fmtDate(a.date)} · {timeLabel(a.time)}</span><StatusPill status={a.status} /></button>)}
          </>
        )}
        {tab === "schedule" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2"><p className="text-sm font-medium">Weekly hours</p><Pill tone={sch.status === "approved" ? "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30" : "bg-sky-50 text-nb-blue ring-sky-200"}>{sch.status === "approved" ? "Approved" : "Pending approval"}</Pill></div>
            {DAYS.map((d, i) => <div key={d} className="flex items-center justify-between rounded-2xl bg-sky-50/60 px-4 h-11 text-sm"><span className="font-medium">{d}</span><span className="text-nb-mute nb-num">{sch.weekly[i] ? `${timeLabel(sch.weekly[i][0])} – ${timeLabel(sch.weekly[i][1])}` : "Closed"}</span></div>)}
          </div>
        )}
        {tab === "credentials" && creds.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-3 border-b border-sky-100">
            <span className="grid place-items-center h-9 w-9 rounded-xl tint-mint text-nb-teal">{c.status === "verified" ? <BadgeCheck className="h-4 w-4" /> : <Clock className="h-4 w-4" />}</span>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{c.type}</p><p className="text-xs text-nb-mute">Expires {fmtDate(c.expires, { month: "short", day: "numeric", year: "numeric" })}</p></div>
            {c.status !== "verified" && role === "owner" ? <button data-testid={`verify-cred-${c.id}`} onClick={() => api.save("credentials", c.id, { status: "verified" }, "Credential verified")} className="nb-btn-dark h-9 px-4 text-xs"><ShieldCheck className="h-3.5 w-3.5" />Verify</button> : <Pill tone={c.status === "verified" ? "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30" : c.status === "expiring" ? "bg-nb-coral/10 text-nb-coral ring-nb-coral/25" : "bg-sky-50 text-nb-blue ring-sky-200"}>{c.status === "verified" ? "Verified" : c.status === "expiring" ? "Expiring" : "Awaiting owner review"}</Pill>}
          </div>
        ))}
        {tab === "credentials" && role === "pro" && <Notice className="mt-3" icon={UserCog}>Only the owner can verify credentials. You can upload renewals when document uploads are enabled.</Notice>}
        {tab === "reports" && (db.reports.filter((r) => r.practitionerId === p.id && (role !== "pro" || r.status === "published")).map((r) => (
          <div key={r.id} className="flex items-center justify-between py-3 border-b border-sky-100"><div><p className="text-sm font-medium">{new Date(r.year, r.month - 1).toLocaleString("en-CA", { month: "long" })} · {r.half === 1 ? "1st–15th" : "16th–end"}</p><p className="text-xs text-nb-mute">{r.visits} visits · {money(r.gross)}</p></div><Pill>{r.status}</Pill></div>
        )))}
      </div>
    </div>
  );
}

export function ProfileHost() {
  const { profile, closeProfile, cli, pro } = usePreview();
  const c = profile?.type === "client" ? cli(profile.id) : null;
  const p = profile?.type === "practitioner" ? pro(profile.id) : null;
  return (
    <BottomSheet open={!!profile} onOpenChange={(o) => !o && closeProfile()} testid="profile-sheet" title={c ? "Client profile" : "Practitioner profile"} full>
      {c && <ClientProfile c={c} />}
      {p && <PractitionerProfile p={p} />}
    </BottomSheet>
  );
}
