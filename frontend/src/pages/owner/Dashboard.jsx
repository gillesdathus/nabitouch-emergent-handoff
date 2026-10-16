import { RetentionNudges } from "@/components/RetentionNudges";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { Bell, CalendarOff, CalendarPlus, Plus, Receipt, Sparkles, Tag, UserPlus } from "lucide-react";
import { HubLink } from "@/components/tide";
import { TurnaroundBoard } from "@/components/session/TurnaroundBoard";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { NewBookingDialog } from "@/components/NewBookingDialog";
import { ClientProfile } from "@/components/ops/Profiles";
import { Counter, PayPill, StatusPill } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { ACTIVE, addDays, bookedByWeek, fmtDate, fmtTime, money, todayISO } from "@/lib/domain";

function Card({ label, children, sub, testid, to }) {
  const { training } = useDemo();
  const body = <><p className="text-xs font-medium text-nb-mute">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-nb-ink">{children}</p>{sub && <p className="mt-1 text-xs text-nb-mute">{sub}</p>}</>;
  if (training) return <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-amber-100" data-testid={testid}>{body}</div>;
  return <Link to={to} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-sky-100 transition hover:-translate-y-0.5" data-testid={testid}>{body}</Link>;
}

export default function Dashboard() {
  const { state, idx, user, training } = useDemo();
  const navigate = useNavigate();
  const [range, setRange] = useState("week");
  const [alerts, setAlerts] = useState(false);
  const [actions, setActions] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [booking, setBooking] = useState(false);
  const today = todayISO();
  const visitsToday = state.appointments.filter((item) => item.date === today && !["cancelled", "no_show"].includes(item.status));
  const booked = visitsToday.reduce((sum, item) => sum + (item.pricing?.total || 0), 0);
  const collected = state.appointments.reduce((sum, item) => sum + (item.settle?.clientPaid || 0) + (item.settle?.insuranceConfirmed || 0), 0);
  const outstanding = state.appointments.filter((item) => (item.settle?.balance || 0) > 0 && ["completed", "processing", "closed"].includes(item.status));
  const due = outstanding.reduce((sum, item) => sum + item.settle.balance, 0);
  const ended = state.appointments.filter((item) => item.timestamps?.session_ended);
  const soapPct = ended.length ? Math.round((ended.filter((item) => item.soapStatus === "signed").length / ended.length) * 100) : null;
  const upcoming = state.appointments.filter((item) => item.date >= today && !["cancelled", "no_show"].includes(item.status)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 6);
  const weeks = bookedByWeek(state.appointments);
  const services = useMemo(() => {
    const counts = {};
    state.appointments.filter((item) => item.status !== "cancelled").forEach((item) => { counts[item.serviceSlug] = (counts[item.serviceSlug] || 0) + 1; });
    return Object.entries(counts).map(([slug, count]) => ({ name: idx.services[slug]?.name || slug, count })).slice(0, 6);
  }, [state.appointments, idx.services]);
  const notifications = [
    ...state.practitioners.flatMap((person) => [["licence", person.licenseExpiry], ["insurance", person.insuranceExpiry]].filter(([, date]) => date && date <= addDays(today, 60)).map(([kind, date]) => ({ id: `${person.id}-${kind}`, text: `${person.name} ${kind} expires ${date}`, to: "/owner/credentials" }))),
    ...outstanding.slice(0, 5).map((item) => ({ id: item.id, text: `${item.ref} has ${money(item.settle.balance)} outstanding`, to: "/owner/payments" })),
    ...state.practitioners.filter((person) => person.onboardingStatus === "invited" || person.onboardingStatus === "pending").map((person) => ({ id: person.id, text: `${person.name} is waiting for approval`, to: "/owner/manage" })),
    ...((state.mailOps?.attention || []).slice(0, 3).map((row) => ({ id: row.id, text: `${row.ref || "Message"} email ${row.status}`, appointmentId: row.appointmentId, to: "/owner/schedule" }))),
    ...state.appointments.filter((item) => item.paymentStatus === "failed" || (item.payments || []).some((payment) => payment.status === "failed")).slice(0, 5).map((item) => ({ id: `pay-${item.id}`, text: `${item.ref} has a failed payment`, appointmentId: item.id, to: "/owner/payments" })),
  ];
  const chart = range === "week" ? weeks : visitsToday.map((item) => ({ week: fmtTime(item.time), revenue: item.pricing?.total || 0 }));

  return (
    <div className="space-y-6" data-testid="owner-dashboard">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-nb-mute">{fmtDate(today, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Good day, <span className="font-display font-normal italic nb-gradient-text">{user?.name?.split(" ")[0] || "there"}</span></h1>
        </div>
        <div className="flex gap-2">
          <button type="button" className="relative nb-btn-ghost h-11 w-11 px-0" aria-label="Notifications" data-testid="dashboard-alerts" onClick={() => setAlerts((value) => !value)}>
            <Bell className="h-4 w-4" />
            {notifications.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />}
          </button>
          <button type="button" className="nb-btn-primary h-11 px-4" data-testid="dashboard-quick" onClick={() => setActions((value) => !value)}><Plus className="h-4 w-4" />Quick action</button>
        </div>
      </header>
      {!training && <TurnaroundBoard people={idx.practitioners} compact />}
      {alerts && (
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-sky-100" data-testid="dashboard-alert-list">
          {notifications.length ? notifications.map((item) => item.appointmentId ? <button key={item.id} type="button" className="block w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-sky-50" onClick={() => { setOpenId(item.appointmentId); setAlerts(false); }}>{item.text}</button> : <Link key={item.id} to={item.to} className="block rounded-2xl px-3 py-2 text-sm hover:bg-sky-50">{item.text}</Link>) : <p className="text-sm text-nb-mute">No operational alerts.</p>}
        </div>
      )}
      {actions && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="dashboard-actions">
          {(training ? [[() => { if (state.clients.length) setBooking(true); }, "New booking", CalendarPlus, "Book into the training sandbox."]] : [[() => { if (state.clients.length) setBooking(true); }, "New booking", CalendarPlus, "Open the existing booking form."], [() => navigate("/owner/manage?invite=1"), "Add practitioner", UserPlus, "Invitation only. You do not set their password."], [() => navigate("/owner/manage?create=service"), "Create service", Sparkles, "Draft a treatment, then add its photo."], [() => navigate("/owner/payments"), "Open invoices", Receipt, "Balances and period reports."], [() => navigate("/owner/availability"), "Block availability", CalendarOff, "Close time without cancelling a visit."], [() => navigate("/owner/promos?create=1"), "Create promotion", Tag, "Saved as a draft until you turn it on."]]).map(([go, label, Icon, detail]) => <div key={label} className="nb-card px-1"><HubLink icon={Icon} title={label} detail={detail} onClick={go} /></div>)}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card to="/owner/payments" label="Booked value" testid="kpi-revenue" sub={`${visitsToday.length} visits today, including travel and GST`}><span className="nb-num"><Counter value={booked} prefix="$" decimals={0} /></span></Card>
        <div className="relative overflow-hidden rounded-[30px] p-5 text-white nb-lagoon lg:col-span-2">
          <div className="absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-nb-turq/40 blur-3xl" />
          <p className="relative text-sm text-white/75">Collected on record</p>
          <p className="relative nb-num text-4xl font-semibold"><Counter value={collected} prefix="$" /></p>
          <p className="relative mt-1 text-sm text-white/75">{outstanding.length} completed visits still have a balance · SOAP {soapPct == null ? "waits for a finished session" : `${soapPct}% signed`}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card to="/owner/schedule" label="Today's appointments" testid="kpi-visits" sub={`${visitsToday.filter((item) => ACTIVE.includes(item.status)).length} in progress`}><Counter value={visitsToday.length} /></Card>
        <Card to="/owner/payments" label="Collected payments" testid="kpi-collected" sub="Recorded card, cash, and verified insurer payments"><Counter value={collected} prefix="$" /></Card>
        <Card to="/owner/payments" label="Outstanding" testid="kpi-outstanding" sub={soapPct == null ? "SOAP: no completed sessions" : `SOAP ${soapPct}% signed`}><Counter value={due} prefix="$" /></Card>
      </div>
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-sky-100" data-testid="owner-upcoming">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Upcoming appointments</h2>{!training && <Link to="/owner/dispatch" data-testid="owner-open-dispatch" className="text-sm font-semibold text-nb-blue">Dispatch</Link>}</div>
        <div className="space-y-2">
          {upcoming.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-3xl bg-white p-3.5 text-sm ring-1 ring-sky-100" data-testid={`upcoming-${item.id}`}>
              <button type="button" onClick={() => setOpenId(item.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="w-24 font-semibold">{fmtTime(item.time)}</span>
                <span className="min-w-[140px] flex-1"><b>{idx.clients[item.clientId]?.firstName} {idx.clients[item.clientId]?.lastName}</b><span className="block text-xs text-nb-mute">{idx.services[item.serviceSlug]?.name} · {idx.practitioners[item.practitionerId]?.name || "Unassigned"} · {item.address?.line || "Address on the visit"}</span></span>
              </button>
              <StatusPill status={item.status} />
              <PayPill status={item.paymentStatus} />
              <button type="button" className="text-xs font-semibold text-nb-blue" onClick={() => setClientId(item.clientId)}>Client</button>
            </div>
          ))}
          {!upcoming.length && <p className="text-sm text-nb-mute">No upcoming appointments.</p>}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-sky-100">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{range === "week" ? "Booked value by week" : "Today's booked value"}</h2>
            <div className="flex rounded-full bg-slate-50 p-1">{["today", "week"].map((item) => <button key={item} type="button" className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${range === item ? "bg-white shadow-sm" : "text-nb-mute"}`} onClick={() => setRange(item)} data-testid={`chart-range-${item}`}>{item}</button>)}</div>
          </div>
          {chart.length ? <div className="h-52"><ResponsiveContainer><AreaChart data={chart}><XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={12} /><Tooltip formatter={(value) => `$${value}`} /><Area dataKey="revenue" stroke="#1565F0" strokeWidth={2.5} fill="#12C9EF33" /></AreaChart></ResponsiveContainer></div> : <p className="text-sm text-nb-mute">Booked totals appear here as visits are scheduled.</p>}
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-sky-100">
          <h2 className="mb-3 font-semibold">Visits by service</h2>
          {services.length ? <div className="h-52"><ResponsiveContainer><BarChart data={services}><XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Bar dataKey="count" fill="#14D8C4" radius={8} onClick={(row) => row?.name && !training && navigate("/owner/schedule")} /></BarChart></ResponsiveContainer></div> : <p className="text-sm text-nb-mute">Service counts appear after the first booking.</p>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-sky-100" data-testid="owner-expiry-reminders">
          <h2 className="mb-2 font-semibold">Credential reminders</h2>
          {notifications.filter((item) => item.to === "/owner/credentials").map((item) => <p key={item.id} className="text-sm text-nb-mute">{item.text}</p>)}
          {!notifications.some((item) => item.to === "/owner/credentials") && <p className="text-sm text-nb-mute">No credential dates are inside the reminder window.</p>}
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-sky-100" data-testid="owner-activity">
          <h2 className="mb-2 font-semibold">Recent activity</h2>
          {state.audit.slice(0, 5).map((item) => <p key={item.id} className="text-xs text-nb-mute">{item.action}</p>)}
          {!training && <Link to="/owner/insights" className="mt-2 inline-block text-xs font-semibold text-nb-blue" data-testid="kpi-soap">Clinical and audit detail</Link>}
        </div>
      </div>
      {openId && <AppointmentSheet apptId={openId} role="owner" onClose={() => setOpenId(null)} />}
      {clientId && <ClientProfile clientId={clientId} onClose={() => setClientId(null)} />}
      {booking && <NewBookingDialog open onClose={() => setBooking(false)} />}
      {!training && <RetentionNudges state={state} idx={idx} />}
    </div>
  );
}
