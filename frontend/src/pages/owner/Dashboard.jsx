import { RetentionNudges } from "@/components/RetentionNudges";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { Activity, BadgeAlert, Bell, CalendarCheck2, CalendarOff, CalendarPlus, CircleDollarSign, Clock3, Plus, Receipt, Sparkles, Tag, UserPlus, Wallet } from "lucide-react";
import { HubLink } from "@/components/tide";
import { TurnaroundBoard } from "@/components/session/TurnaroundBoard";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { NewBookingDialog } from "@/components/NewBookingDialog";
import { CreateInvoiceDialog } from "@/components/CreateInvoiceDialog";
import { ClientProfile } from "@/components/ops/Profiles";
import { EmptyState, KpiCard, PageHeader, Panel, Segmented } from "@/components/ds";
import { StatusPill } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { ACTIVE, DONE, addDays, bookedByWeek, fmtDate, fmtTime, money, todayISO } from "@/lib/domain";
import { formatCents } from "@/lib/billing";
import { sumInvoices, useInvoices } from "@/lib/useInvoices";

const CLOSED = ["cancelled", "no_show", ...DONE];
const CHART_H = 168;

function VisitRow({ item, idx, onOpen, onClient, showDate }) {
  const client = idx.clients[item.clientId];
  const pro = idx.practitioners[item.practitionerId];
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 hover:bg-sky-50/70" data-testid={`visit-row-${item.id}`}>
      <span className="w-[4.25rem] shrink-0 text-right">
        <span className="nb-num block text-sm font-semibold">{fmtTime(item.time)}</span>
        {showDate && <span className="block text-[10px] text-nb-mute">{fmtDate(item.date, { weekday: "short", month: "short", day: "numeric" })}</span>}
      </span>
      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: pro?.color || "#CBD5E1" }} aria-hidden="true" />
      <button type="button" onClick={() => onOpen(item.id)} className="min-w-0 flex-1 text-left" data-testid={`visit-open-${item.id}`}>
        <span className="block truncate text-sm font-semibold">{client ? `${client.firstName} ${client.lastName}` : "Client"}</span>
        <span className="block truncate text-xs text-nb-mute">{idx.services[item.serviceSlug]?.name || item.serviceSlug} · {pro?.name || "Unassigned"}</span>
      </button>
      <span className="hidden shrink-0 sm:block"><StatusPill status={item.status} /></span>
      <button type="button" className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-nb-blue hover:bg-sky-100" onClick={() => onClient(item.clientId)} data-testid={`visit-client-${item.id}`}>Client</button>
    </li>
  );
}

function VisitList({ rows, empty, ...rest }) {
  if (!rows.length) return <EmptyState compact title={empty} />;
  return <ul className="-mx-2 divide-y divide-sky-50">{rows.map((item) => <VisitRow key={item.id} item={item} {...rest} />)}</ul>;
}

function ChartBox({ children }) {
  return <div className="w-full min-w-0" style={{ height: CHART_H }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

function ActivityLog({ audit }) {
  if (!audit.length) return <EmptyState compact icon={Activity} title="No activity recorded yet" />;
  return (
    <ol className="space-y-0.5" data-testid="activity-list">
      {audit.slice(0, 8).map((item) => (
        <li key={item.id} className="grid grid-cols-[4.5rem_1fr] gap-2 rounded-lg px-1 py-1.5 text-xs">
          <span className="nb-num text-nb-mute">{item.at ? new Date(item.at).toLocaleString("en-CA", { timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(",", "") : "—"}</span>
          <span className="min-w-0 break-words text-nb-ink"><b className="font-semibold">{item.actor || "System"}</b> <span className="text-nb-mute">· {item.action}</span></span>
        </li>
      ))}
    </ol>
  );
}

function QuickActions({ training, go }) {
  const list = training ? [[go.booking, "New booking", CalendarPlus, "Book into the training sandbox."]] : [
    [go.booking, "Phone booking", CalendarPlus, "Search or create a patient, then book by phone, WhatsApp, SMS, or walk-in."],
    [go.invoice, "New invoice", Receipt, "Standalone draft invoice without an appointment."],
    [() => go.nav("/owner/manage?invite=1"), "Add practitioner", UserPlus, "Invitation only. You do not set their password."],
    [() => go.nav("/owner/manage?create=service"), "Create service", Sparkles, "Draft a treatment, then add its photo."],
    [() => go.nav("/owner/availability"), "Block availability", CalendarOff, "Close time without cancelling a visit."],
    [() => go.nav("/owner/promos?create=1"), "Create promotion", Tag, "Saved as a draft until you turn it on."],
  ];
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="dashboard-actions">{list.map(([fn, label, Icon, detail]) => <div key={label} className="nb-panel min-w-0 px-1"><HubLink icon={Icon} title={label} detail={detail} onClick={fn} /></div>)}</div>;
}

function useAlerts(state, today, invoices) {
  const credentials = state.practitioners.flatMap((person) => [["licence", person.licenseExpiry], ["insurance", person.insuranceExpiry]]
    .filter(([, date]) => date && date <= addDays(today, 60))
    .map(([kind, date]) => ({ id: `${person.id}-${kind}`, kind: "credential", text: `${person.name}: ${kind} ${date < today ? "expired" : "expires"} ${fmtDate(date, { month: "short", day: "numeric", year: "numeric" })}`, to: "/owner/credentials" })));
  const pending = state.practitioners.filter((p) => ["invited", "pending"].includes(p.onboardingStatus)).map((p) => ({ id: p.id, kind: "onboarding", text: `${p.name} is waiting for approval`, to: "/owner/credentials" }));
  const balances = (invoices || []).filter((r) => r.balance?.cents > 0 && !["draft", "voided"].includes(r.state)).slice(0, 4).map((r) => ({ id: r.id, kind: "balance", text: `${r.number} · ${r.clientName || "Client"} owes ${r.balance.display}`, to: "/owner/payments" }));
  const mail = (state.mailOps?.attention || []).slice(0, 3).map((row) => ({ id: row.id, kind: "mail", text: `${row.ref || "Message"} email ${row.status}`, to: "/owner/channels" }));
  return { credentials, all: [...credentials, ...pending, ...balances, ...mail] };
}

export default function Dashboard() {
  const { state, idx, user, training } = useDemo();
  const navigate = useNavigate();
  const [range, setRange] = useState("week");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [actions, setActions] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [booking, setBooking] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const { rows: invoices } = useInvoices({}, !training, true);
  const money$ = sumInvoices(invoices);
  const today = todayISO();
  const appts = state.appointments;
  const visitsToday = appts.filter((a) => a.date === today && !["cancelled", "no_show"].includes(a.status)).sort((a, b) => a.time.localeCompare(b.time));
  const booked = visitsToday.reduce((sum, a) => sum + (a.pricing?.total || 0), 0);
  const inProgress = appts.filter((a) => ACTIVE.includes(a.status));
  const isUpcoming = (a) => !CLOSED.includes(a.status) && !ACTIVE.includes(a.status) && a.date >= today;
  const upcoming = appts.filter(isUpcoming).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 8);
  const completed = appts.filter((a) => DONE.includes(a.status)).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).slice(0, 5);
  const ended = appts.filter((a) => a.timestamps?.session_ended);
  const soapPct = ended.length ? Math.round((ended.filter((a) => a.soapStatus === "signed").length / ended.length) * 100) : null;
  const weeks = bookedByWeek(appts);
  const services = useMemo(() => {
    const counts = {};
    appts.filter((a) => a.status !== "cancelled").forEach((a) => { counts[a.serviceSlug] = (counts[a.serviceSlug] || 0) + 1; });
    return Object.entries(counts).map(([slug, count]) => ({ name: idx.services[slug]?.name || slug, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [appts, idx.services]);
  const alerts = useAlerts(state, today, invoices);
  const chart = range === "week" ? weeks : visitsToday.map((a) => ({ week: fmtTime(a.time), revenue: a.pricing?.total || 0 }));
  const go = { booking: () => setBooking(true), invoice: () => setInvoice(true), nav: navigate };

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="owner-dashboard">
      <PageHeader
        eyebrow={fmtDate(today, { weekday: "long", month: "long", day: "numeric" })}
        title="Good day,"
        accent={user?.name?.split(" ")[0] || "there"}
        actions={<>
          <button type="button" className="nb-btn-ghost relative h-10 w-10 px-0" aria-label={`Alerts (${alerts.all.length})`} aria-expanded={alertsOpen} data-testid="dashboard-alerts" onClick={() => setAlertsOpen((v) => !v)}>
            <Bell className="h-4 w-4" />{alerts.all.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{alerts.all.length}</span>}
          </button>
          <button type="button" className="nb-btn-primary h-10 px-4 text-sm" aria-expanded={actions} data-testid="dashboard-quick" onClick={() => setActions((v) => !v)}><Plus className="h-4 w-4" />Quick action</button>
        </>}
      />
      {alertsOpen && (
        <Panel title="Alerts" testid="dashboard-alert-list">
          {alerts.all.length ? <ul className="-mx-2">{alerts.all.map((a) => <li key={a.id}><Link to={a.to} className="nb-row text-sm" data-testid={`alert-${a.id}`}><BadgeAlert className="h-4 w-4 shrink-0 text-amber-600" /><span className="min-w-0 flex-1 break-words">{a.text}</span></Link></li>)}</ul> : <EmptyState compact title="No operational alerts" />}
        </Panel>
      )}
      {actions && <QuickActions training={training} go={go} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-grid">
        <KpiCard to="/owner/schedule" icon={CalendarCheck2} label="Today's visits" value={visitsToday.length} sub={`${inProgress.length} in progress · ${money(booked)} booked`} testid="kpi-visits" />
        <KpiCard to="/owner/payments" icon={Wallet} label="Collected" value={training ? "—" : formatCents(money$.clientPaid + money$.insuranceReceived)} sub="Client and insurer payments on issued invoices" testid="kpi-collected" />
        <KpiCard to="/owner/payments" icon={CircleDollarSign} label="Outstanding" value={training ? "—" : formatCents(money$.balance)} sub={`${money$.open} invoice${money$.open === 1 ? "" : "s"} with a balance`} tone={money$.balance > 0 ? "warn" : "default"} testid="kpi-outstanding" />
        <KpiCard to="/owner/insights" icon={Clock3} label="SOAP signed" value={soapPct == null ? "—" : `${soapPct}%`} sub={soapPct == null ? "Waits for a finished session" : `${ended.length} finished session${ended.length === 1 ? "" : "s"}`} tone={soapPct != null && soapPct < 100 ? "warn" : "good"} testid="kpi-soap" />
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {inProgress.length > 0 && <Panel title={`In progress · ${inProgress.length}`} testid="owner-in-progress"><VisitList rows={inProgress} empty="" idx={idx} onOpen={setOpenId} onClient={setClientId} /></Panel>}
          <Panel title="Upcoming appointments" action={<Link to="/owner/schedule" className="text-sm font-semibold text-nb-blue" data-testid="owner-open-schedule">Calendar</Link>} testid="owner-upcoming">
            <VisitList rows={upcoming} empty="No upcoming appointments" showDate idx={idx} onOpen={setOpenId} onClient={setClientId} />
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          {!training && <TurnaroundBoard people={idx.practitioners} compact />}
          <Panel title="Credential reminders" action={<Link to="/owner/credentials" className="text-sm font-semibold text-nb-blue">Credentials</Link>} testid="owner-expiry-reminders">
            {alerts.credentials.length ? <ul className="space-y-1">{alerts.credentials.map((a) => <li key={a.id} className="flex items-start gap-2 text-sm"><BadgeAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span className="min-w-0 break-words">{a.text}</span></li>)}</ul> : <EmptyState compact title="Nothing expires in the next 60 days" />}
          </Panel>
        </div>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title={range === "week" ? "Booked value by week" : "Today's booked value"} action={<Segmented options={[["today", "Today"], ["week", "Weeks"]]} value={range} onChange={setRange} testid="chart-range" label="Chart range" />} testid="owner-revenue-chart">
          {chart.some((row) => row.revenue > 0) ? (
            <ChartBox>
              <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#EEF4F8" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(value) => money(value)} />
                <Area dataKey="revenue" stroke="#1565F0" strokeWidth={2.25} fill="#12C9EF26" />
              </AreaChart>
            </ChartBox>
          ) : <EmptyState compact title="No booked value in this range" body="Totals appear as visits are scheduled." />}
        </Panel>
        <Panel title="Visits by service" testid="owner-service-chart">
          {services.length ? (
            <ChartBox>
              <BarChart data={services} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={11} width={120} />
                <Tooltip />
                <Bar dataKey="count" fill="#14D8C4" radius={[0, 6, 6, 0]} barSize={14} />
              </BarChart>
            </ChartBox>
          ) : <EmptyState compact title="No visits yet" body="Service counts appear after the first booking." />}
        </Panel>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title="Recently completed" testid="owner-completed"><VisitList rows={completed} empty="No completed visits yet" showDate idx={idx} onOpen={setOpenId} onClient={setClientId} /></Panel>
        <Panel title="Recent activity" action={!training && <Link to="/owner/insights" className="text-sm font-semibold text-nb-blue" data-testid="owner-audit-link">Audit detail</Link>} testid="owner-activity"><ActivityLog audit={state.audit || []} /></Panel>
      </div>
      {!training && <RetentionNudges state={state} idx={idx} />}
      {openId && <AppointmentSheet apptId={openId} role="owner" onClose={() => setOpenId(null)} />}
      {clientId && <ClientProfile clientId={clientId} onClose={() => setClientId(null)} />}
      {booking && <NewBookingDialog open onClose={() => setBooking(false)} />}
      {invoice && <CreateInvoiceDialog open onClose={() => setInvoice(false)} />}
    </div>
  );
}
