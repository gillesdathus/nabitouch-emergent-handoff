import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Ban, UserPlus, Zap, CalendarDays, CalendarRange, Wallet, AlertCircle, FileCheck2, ArrowUpRight, MapPin, BadgeAlert, Megaphone } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Segmented, CountUp, RoundAction, Reveal, SectionHead, Avatar, StatusPill, PayPill, Pill } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { Emblem } from "@/components/brand";
import { TrendChart, Sparkline, PractitionerBars } from "@/components/Charts";
import { addDays, todayISO, fmtDate, timeLabel, money0, greeting } from "@/lib/domain";

const RANGE = { today: [0, 0], week: [-6, 0], month: [-29, 0] };

function Kpi({ icon: Icon, label, value, format, hint, onClick, testid, i, tint }) {
  return (
    <Reveal i={i}>
      <button data-testid={testid} onClick={onClick} className="w-full text-left nb-card p-4 group hover:-translate-y-0.5 transition-transform">
        <div className="flex items-center justify-between"><span className={`grid place-items-center h-9 w-9 rounded-xl ${tint}`}><Icon className="h-4 w-4" /></span><ArrowUpRight className="h-4 w-4 text-nb-mute group-hover:text-nb-blue transition-colors" /></div>
        <p className="text-[26px] font-semibold mt-3 leading-none">{value === null ? <span className="text-nb-mute">—</span> : <CountUp value={value} format={format} />}</p>
        <p className="text-xs text-nb-mute mt-1.5">{label}</p>
        {hint && <p className="text-[10.5px] text-nb-mute/80 mt-0.5">{hint}</p>}
      </button>
    </Reveal>
  );
}

export default function Dashboard() {
  const { db, svc, pro, cli, openAppt, openNewBooking } = usePreview();
  const nav = useNavigate();
  const [range, setRange] = useState("today");
  const T = todayISO();
  const [a0, a1] = RANGE[range];
  const inRange = db.appointments.filter((a) => a.date >= addDays(T, a0) && a.date <= addDays(T, a1) && a.status !== "cancelled");
  const booked = inRange.reduce((s, a) => s + a.pricing.total, 0);
  const collected = inRange.reduce((s, a) => s + a.settle.clientPaid, 0);
  const outstanding = db.appointments.filter((a) => a.status === "completed").reduce((s, a) => s + a.settle.balance, 0);
  const completed = inRange.filter((a) => a.status === "completed");
  const soap = completed.length ? Math.round((completed.filter((a) => a.soap === "signed").length / completed.length) * 100) : null;
  const upcoming = db.appointments.filter((a) => a.date >= T && a.date <= addDays(T, 7) && !["completed", "cancelled"].includes(a.status)).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  const trend = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(T, i - 6);
    const list = db.appointments.filter((a) => a.date === d && a.status !== "cancelled");
    return { label: fmtDate(d, { weekday: "short" }), iso: d, booked: list.reduce((s, a) => s + a.pricing.total, 0), collected: list.reduce((s, a) => s + a.settle.clientPaid, 0) };
  }), [db.appointments, T]);
  const bars = db.practitioners.filter((p) => p.bookable).map((p) => ({ label: p.name.split(" ")[0], id: p.id, color: p.color, value: inRange.filter((a) => a.practitionerId === p.id).reduce((s, a) => s + a.pricing.total, 0) }));
  const alerts = [
    ...db.credentials.filter((c) => c.status === "expiring").map((c) => ({ id: c.id, icon: BadgeAlert, text: `${pro(c.practitionerId).name}: ${c.type.toLowerCase()} expires ${fmtDate(c.expires)}`, to: "/owner/credentials" })),
    ...(!db.settings.promotionalSending ? [{ id: "ps", icon: Megaphone, text: "Promotional sending is off — live campaigns stay bookable in-app", to: "/owner/campaigns" }] : []),
  ];
  return (
    <div className="max-w-6xl mx-auto px-5 pt-12 lg:pt-14">
      <div className="flex items-center gap-3 mb-5">
        <Emblem className="h-9 lg:hidden" />
        <div className="flex-1"><p className="text-xs text-nb-mute">{fmtDate(T, { weekday: "long", month: "long", day: "numeric" })}</p><h1 className="text-xl sm:text-3xl font-semibold truncate">{greeting()}, <span className="font-display italic font-normal nb-gradient-text">Alex</span></h1></div>
        <TopIcons base="/owner" />
      </div>
      <Segmented testid="dashboard-range" value={range} onChange={setRange} options={[{ value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }]} className="mb-5" />
      <div className="grid lg:grid-cols-3 gap-4">
        <Reveal className="lg:col-span-2 relative overflow-hidden rounded-[30px] nb-lagoon text-white p-5 sm:p-6">
          <div data-testid="hero-booked-card">
            <div className="absolute -right-16 -bottom-20 h-56 w-56 rounded-full bg-nb-turq/40 blur-3xl" />
            <div className="relative flex items-start justify-between"><p className="text-sm text-white/75">Booked value</p><Pill tone="bg-white/15 text-white ring-white/30"><span className="h-1.5 w-1.5 rounded-full bg-nb-lime" />{db.settings.businessOpen ? "Open · accepting bookings" : "Paused"}</Pill></div>
            <p className="relative text-5xl font-semibold mt-1 nb-num"><CountUp value={booked} /></p>
            <p className="relative text-sm text-white/75 mt-1"><span className="font-semibold text-white"><CountUp value={collected} /></span> collected · {inRange.length} visits</p>
            <div className="relative -mx-2 mt-2"><Sparkline data={trend} /></div>
          </div>
        </Reveal>
        <Reveal i={1} className="nb-card p-5 flex flex-col justify-center">
          <p className="text-sm font-semibold mb-4">Quick actions</p>
          <div className="grid grid-cols-4 lg:grid-cols-2 gap-y-5">
            <RoundAction testid="qa-new-booking" icon={CalendarPlus} label="Booking" onClick={() => openNewBooking({})} />
            <RoundAction testid="qa-block-time" icon={Ban} label="Block time" onClick={() => nav("/owner/schedule?block=1")} />
            <RoundAction testid="qa-invite" icon={UserPlus} label="Invite" onClick={() => nav("/owner/manage?tab=practitioners&invite=1")} />
            <RoundAction testid="qa-campaign" icon={Zap} label="Campaign" onClick={() => nav("/owner/campaigns?new=1")} />
          </div>
        </Reveal>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
        <Kpi i={0} testid="kpi-visits" icon={CalendarDays} tint="tint-lagoon text-nb-blue" label="Visits in range" value={inRange.length} format={(v) => Math.round(v)} onClick={() => nav("/owner/schedule")} />
        <Kpi i={1} testid="kpi-upcoming" icon={CalendarRange} tint="tint-mint text-nb-teal" label="Upcoming · 7 days" value={upcoming.length} format={(v) => Math.round(v)} onClick={() => nav("/owner/schedule?view=week")} />
        <Kpi i={2} testid="kpi-collected" icon={Wallet} tint="tint-meadow text-[#4E9A2B]" label="Collected" value={collected} onClick={() => nav("/owner/payments?filter=paid")} />
        <Kpi i={3} testid="kpi-outstanding" icon={AlertCircle} tint="bg-nb-coral/10 text-nb-coral" label="Outstanding" value={outstanding} onClick={() => nav("/owner/payments?filter=unpaid")} />
        <Kpi i={4} testid="kpi-soap" icon={FileCheck2} tint="tint-ice text-nb-sky" label="SOAP completion" value={soap} format={(v) => `${Math.round(v)}%`} hint={soap === null ? "Shown once a session has ended" : undefined} onClick={() => nav("/owner/insights")} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 nb-card p-5">
          <div className="flex items-center justify-between mb-1"><p className="font-semibold">Booked vs collected</p><div className="flex gap-3 text-[11px] text-nb-mute"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-nb-teal" />Booked</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-nb-blue" />Collected</span></div></div>
          <p className="text-xs text-nb-mute mb-2">Last 7 days · tap a day to open its schedule</p>
          <TrendChart data={trend} onPick={(d) => d && nav(`/owner/schedule?date=${d.iso}`)} />
        </div>
        <div className="nb-card p-5">
          <p className="font-semibold">By practitioner</p><p className="text-xs text-nb-mute mb-2">Booked value in range · tap to open profile</p>
          <PractitionerBars data={bars} onPick={(d) => d && nav(`/owner/manage?tab=practitioners&open=${d.id}`)} />
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4 mt-6">
        <section className="lg:col-span-2">
          <SectionHead title="Up next" action="Schedule" onAction={() => nav("/owner/schedule")} testid="upnext-see-schedule" />
          <div className="space-y-2">
            {upcoming.slice(0, 6).map((a, i) => (
              <Reveal key={a.id} i={i}>
                <button data-testid={`upnext-${a.id}`} onClick={() => openAppt(a.id)} className="w-full nb-card p-3.5 flex items-center gap-3 text-left hover:-translate-y-0.5 transition-transform">
                  <div className="w-14 text-center shrink-0"><p className="text-sm font-semibold nb-num">{timeLabel(a.time).replace(/ (AM|PM)/, "")}</p><p className="text-[10px] text-nb-mute">{a.date === T ? "Today" : fmtDate(a.date, { weekday: "short" })}</p></div>
                  <span className="h-10 w-1 rounded-full" style={{ background: pro(a.practitionerId).color }} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{cli(a.clientId).name} <span className="font-normal text-nb-mute">· {svc(a.serviceId).name}</span></p><p className="text-xs text-nb-mute truncate flex items-center gap-1"><MapPin className="h-3 w-3" />{a.address} · {pro(a.practitionerId).name.split(" ")[0]}</p></div>
                  <div className="hidden sm:flex gap-1.5"><StatusPill status={a.status} /><PayPill pay={a.pay} /></div>
                  <Avatar src={pro(a.practitionerId).photo} name="" size={32} className="sm:hidden" />
                </button>
              </Reveal>
            ))}
          </div>
        </section>
        <section>
          <SectionHead title="Needs attention" />
          <div className="space-y-2">
            {alerts.map((al) => <button key={al.id} data-testid={`alert-${al.id}`} onClick={() => nav(al.to)} className="w-full flex items-start gap-3 rounded-3xl tint-ice p-4 text-left text-sm"><al.icon className="h-4 w-4 mt-0.5 text-nb-blue shrink-0" />{al.text}</button>)}
            <p className="text-[11px] text-nb-mute px-1">Outstanding = completed visits with a balance: {money0(outstanding)}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
