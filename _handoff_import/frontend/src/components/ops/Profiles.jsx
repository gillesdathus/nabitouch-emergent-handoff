import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Avatar, PayPill, StatusPill } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { DONE, OPEN, fmtDate, fmtTime, money, todayISO } from "@/lib/domain";

const TABS = ["Overview", "Appointments", "Invoices", "Payments"];

function Tabs({ tab, setTab, items = TABS }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-full bg-slate-50 p-1" role="tablist">
      {items.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`rounded-full px-3 py-2 text-xs font-semibold ${tab === item ? "bg-white text-nb-ink shadow-sm" : "text-nb-mute"}`} onClick={() => setTab(item)}>{item}</button>)}
    </div>
  );
}

export function ClientProfile({ clientId, onClose, onOpenAppointment }) {
  const { state, idx } = useDemo();
  const client = idx?.clients?.[clientId];
  const [tab, setTab] = useState("Overview");
  if (!client) return null;
  const visits = state.appointments.filter((item) => item.clientId === clientId).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const upcoming = visits.filter((item) => item.date >= todayISO() && OPEN.includes(item.status));
  const due = visits.reduce((sum, item) => sum + (item.settle?.balance || 0), 0);
  const paid = visits.reduce((sum, item) => sum + (item.settle?.clientPaid || 0), 0);
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="client-profile">
        <SheetTitle className="sr-only">{client.firstName} {client.lastName}</SheetTitle>
        <div className="flex items-center gap-3">
          <Avatar person={client} photo={client.photo} size={64} />
          <div>
            <h2 className="text-2xl font-semibold">{client.firstName} {client.lastName}</h2>
            <p className="text-sm text-nb-mute">{client.email}</p>
            <p className="text-sm text-nb-mute">{client.phone || "No phone on file"}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-sky-50 p-3"><p className="text-xs text-nb-mute">Next visit</p><p className="font-semibold">{upcoming[0] ? `${fmtDate(upcoming[0].date)} ${fmtTime(upcoming[0].time)}` : "None scheduled"}</p></div>
          <div className="rounded-2xl bg-amber-50 p-3"><p className="text-xs text-nb-mute">Outstanding</p><p className="font-semibold">{money(due)}</p></div>
        </div>
        <div className="mt-4"><Tabs tab={tab} setTab={setTab} /></div>
        <div className="mt-4 space-y-2" role="tabpanel">
          {tab === "Overview" && <>
            <p className="text-sm text-nb-mute">{visits.length} stored visits · collected {money(paid)}</p>
            {(client.addresses || []).slice(0, 3).map((address) => <p key={address.id || address.line} className="rounded-2xl bg-slate-50 p-3 text-sm">{address.label || "Address"} · {address.line}</p>)}
            {!client.addresses?.length && <p className="text-sm text-nb-mute">No saved service address.</p>}
          </>}
          {tab === "Appointments" && visits.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenAppointment?.(item.id)} className="nb-card flex w-full items-center gap-3 p-3 text-left text-sm" data-testid={`client-visit-${item.id}`}>
              <span className="flex-1"><b>{idx.services[item.serviceSlug]?.name || item.serviceSlug}</b><span className="block text-xs text-nb-mute">{fmtDate(item.date)} {fmtTime(item.time)} · {idx.practitioners[item.practitionerId]?.name || "Unassigned"}</span></span>
              <StatusPill status={item.status} />
            </button>
          ))}
          {tab === "Invoices" && visits.filter((item) => item.pricing).map((item) => (
            <div key={item.id} className="rounded-2xl bg-slate-50 p-3 text-sm"><b>{item.ref}</b><span className="block text-xs text-nb-mute">Invoiced {money(item.pricing.total)} · balance {money(item.settle?.balance || 0)}</span>{item.invoiceBanner && <span className="mt-1 block text-xs font-semibold text-amber-800">{item.invoiceBanner}</span>}</div>
          ))}
          {tab === "Payments" && visits.flatMap((item) => (item.payments || []).map((payment) => ({ ...payment, ref: item.ref }))).map((payment) => (
            <div key={payment.id} className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3 text-sm"><span className="flex-1">{payment.ref} · {payment.provider}</span><PayPill status={payment.status} /><b>{money(payment.amount)}</b></div>
          ))}
          {tab === "Payments" && !visits.some((item) => item.payments?.length) && <p className="text-sm text-nb-mute">No recorded payments for this client.</p>}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/owner/payments" className="nb-btn-ghost h-10 px-3 text-sm">Invoices</Link>
          <Link to="/owner/schedule" className="nb-btn-primary h-10 px-3 text-sm">Schedule a visit</Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PractitionerProfile({ personId, onClose }) {
  const { state, idx, api } = useDemo();
  const person = idx?.practitioners?.[personId];
  const [tab, setTab] = useState("Overview");
  const [credentials, setCredentials] = useState([]);
  useEffect(() => {
    api.credentials().then((rows) => setCredentials((rows || []).filter((row) => row.practitionerId === personId))).catch(() => setCredentials([]));
  }, [api, personId]);
  if (!person) return null;
  const visits = state.appointments.filter((item) => item.practitionerId === personId);
  const next = visits.filter((item) => item.date >= todayISO() && !DONE.includes(item.status) && item.status !== "cancelled").sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="practitioner-profile">
        <SheetTitle className="sr-only">{person.name}</SheetTitle>
        <div className="flex items-center gap-3">
          <Avatar person={person} size={64} />
          <div>
            <h2 className="text-2xl font-semibold">{person.name}</h2>
            <p className="text-sm text-nb-mute">{person.onboardingStatus || (person.bookable === false ? "Not bookable" : "Active")}</p>
            <p className="text-sm text-nb-mute">{person.available ? "Shown for new bookings" : "Paused for new bookings"}</p>
          </div>
        </div>
        <div className="mt-4"><Tabs tab={tab} setTab={setTab} items={["Overview", "Schedule", "Credentials", "Reports"]} /></div>
        <div className="mt-4 space-y-2 text-sm" role="tabpanel">
          {tab === "Overview" && <>
            <p>{person.bio || "No biography yet."}</p>
            <p className="text-nb-mute">Services: {(person.specialties || []).map((slug) => idx.services[slug]?.name || slug).join(", ") || "None assigned"}</p>
            <p className="text-nb-mute">Next visit: {next ? `${fmtDate(next.date)} ${fmtTime(next.time)}` : "None"}</p>
          </>}
          {tab === "Schedule" && visits.slice(0, 12).map((item) => <p key={item.id} className="rounded-2xl bg-slate-50 p-3">{fmtDate(item.date)} {fmtTime(item.time)} · {idx.services[item.serviceSlug]?.name} · {idx.clients[item.clientId]?.firstName}</p>)}
          {tab === "Reports" && <p className="text-nb-mute">Approved reports are generated from Invoices & reports. A published PDF is available there for this practitioner.</p>}
          {tab === "Credentials" && <>
            <p className="rounded-2xl bg-slate-50 p-3">Licence expiry: {person.licenseExpiry || "Not recorded"}</p>
            <p className="rounded-2xl bg-slate-50 p-3">Insurance expiry: {person.insuranceExpiry || "Not recorded"}</p>
            {credentials.map((row) => <p key={row.id} className="rounded-2xl bg-slate-50 p-3">{row.kind} · {row.status || "recorded"} · {row.expiresOn || "no expiry"}</p>)}
            {!credentials.length && <p className="text-nb-mute">No credential documents are stored for this profile.</p>}
            <Link to="/owner/credentials" className="inline-block font-semibold text-nb-blue">Open credential review</Link>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
