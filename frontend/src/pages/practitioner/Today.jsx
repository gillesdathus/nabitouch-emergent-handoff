import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Bell, ChevronRight, ClipboardEdit, MapPin, Navigation, Package } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Avatar, StatusPill, SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { todayISO, fmtTime, endTime, OPEN, ACTIVE, addDays } from "@/lib/domain";

export default function Today() {
  const { state, idx, practitionerId, run, api } = useDemo();
  const me = idx.practitioners[practitionerId];
  const today = todayISO();
  const mine = state.appointments.filter((a) => a.practitionerId === practitionerId);
  const list = mine.filter((a) => a.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const next = list.find((a) => ACTIVE.includes(a.status)) || list.find((a) => OPEN.includes(a.status));
  const soapDue = mine.filter((a) => a.status === "soap_pending" || (a.soapStatus === "draft"));
  const soon = (d) => d <= addDays(today, 60);
  const reminders = [me.licenseExpiry && soon(me.licenseExpiry) && `Licence renewal due ${me.licenseExpiry}`, me.insuranceExpiry && soon(me.insuranceExpiry) && `Liability insurance expires ${me.insuranceExpiry}`].filter(Boolean);
  const notes = [...state.audit.filter((x) => mine.some((a) => a.id === x.appointmentId)).slice(0, 3).map((x) => x.action)];

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="pro-today">
      <div className="rounded-[30px] p-5 text-white nb-tide">
        <div className="flex items-center gap-3">
          <Avatar person={me} size={46} />
          <div className="flex-1"><p className="text-xs text-white/60">{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}</p><p className="font-semibold">Hi {me.name.split(" ")[0]}</p></div>
        </div>
        <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight">You have <span className="nb-gradient-text">{list.filter((a) => OPEN.includes(a.status)).length}</span> visits ahead</h1>
      </div>
      <label className="nb-card flex items-center justify-between p-4"><span className="text-sm"><b>{me.available ? "Available for bookings" : "Unavailable"}</b><span className="block text-xs text-nb-mute">Off-duty status hides you from new bookings and location views.</span></span><Switch checked={me.available} onCheckedChange={(v) => run(() => api.patch("practitioners", me.id, { available: v }))} data-testid="pro-availability-switch" /></label>

      {next ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[30px] text-white nb-lagoon" data-testid="pro-next-card">
          <div className="p-6">
            <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">Next visit</p><StatusPill status={next.status} /></div>
            <p className="mt-3 text-3xl font-semibold">{fmtTime(next.time)} <span className="text-base font-normal text-white/60">– {fmtTime(endTime(next.time, next.duration))}</span></p>
            <p className="mt-1 text-lg">{idx.clients[next.clientId]?.firstName} {idx.clients[next.clientId]?.lastName[0]}. · {idx.services[next.serviceSlug].name} {next.duration}m</p>
            <p className="mt-2 flex items-center gap-1 text-sm text-white/70"><MapPin className="h-4 w-4" />{next.address.line}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1"><Navigation className="h-3 w-3" />Straight-line estimate only — road time needs Mapbox</span>{next.address.notes && <span className="rounded-full bg-white/10 px-3 py-1">{next.address.notes}</span>}</div>
          </div>
          <Link to={`/pro/visit/${next.id}`} data-testid="pro-open-next-visit" className="flex items-center justify-between bg-white/10 px-6 py-4 text-sm font-semibold hover:bg-white/15">Open visit <ChevronRight className="h-5 w-5" /></Link>
        </motion.div>
      ) : <div className="nb-soft p-6 text-sm">No more visits today. Breathe.</div>}

      <div className="nb-card flex gap-3 p-4 text-sm"><Package className="h-5 w-5 shrink-0 text-nb-teal" /><div><p className="font-semibold">Travel prep</p><p className="text-xs text-nb-mute">Table & face cradle · fresh linens · oils & hypoallergenic lotion · bolsters · sanitiser</p></div></div>

      {(soapDue.length > 0 || reminders.length > 0) && (
        <div className="space-y-2" data-testid="pro-attention">
          {soapDue.map((a) => <Link key={a.id} to={`/pro/soap/${a.id}`} data-testid={`pro-soap-due-${a.id}`} className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"><ClipboardEdit className="h-5 w-5" /><span className="flex-1">SOAP notes {a.soapStatus === "draft" ? "draft" : "pending"} · {idx.clients[a.clientId]?.firstName} ({a.ref})</span><ChevronRight className="h-4 w-4" /></Link>)}
          {reminders.map((r) => <div key={r} className="flex items-center gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="h-5 w-5" />{r}</div>)}
        </div>
      )}

      <div>
        <SectionHead eyebrow="Schedule" title="Today’s visits" />
        <ol className="relative space-y-3 pl-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-sky-200">
          {list.map((a, i) => (
            <motion.li key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative">
              <span className={`absolute -left-[22px] top-5 h-3 w-3 rounded-full ring-4 ring-[#F3F8FA] ${ACTIVE.includes(a.status) ? "nb-gradient" : "bg-sky-300"}`} />
              <Link to={`/pro/visit/${a.id}`} data-testid={`pro-visit-row-${a.id}`} className="nb-card flex items-center gap-4 p-4 hover:border-nb-sky">
                <div className="w-16 text-sm font-semibold">{fmtTime(a.time)}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{idx.clients[a.clientId]?.firstName} · {idx.services[a.serviceSlug].name}</p><p className="truncate text-xs text-nb-mute">{a.address.line}</p></div>
                <StatusPill status={a.status} />
              </Link>
            </motion.li>))}
          {list.length === 0 && <p className="text-sm text-nb-mute">Nothing scheduled today.</p>}
        </ol>
      </div>
      {notes.length > 0 && <div className="nb-card p-4" data-testid="pro-notifications"><p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4" />Recent updates</p>{notes.map((n, i) => <p key={i} className="text-xs text-nb-mute">{n}</p>)}</div>}
      <p className="text-center text-[11px] text-nb-mute">Clinical data is not cached for offline use.</p>
    </div>
  );
}
