import { useState } from "react";
import { Plus, LogIn, LogOut } from "lucide-react";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { NewBookingDialog } from "@/components/NewBookingDialog";
import { Avatar, StatusPill, PayPill, SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { todayISO, addDays, fmtDate, fmtTime, staffActor } from "@/lib/domain";

export default function Desk() {
  const { state, idx, perm, run, api, user } = useDemo();
  const [day, setDay] = useState(todayISO());
  const [sel, setSel] = useState(null);
  const [nb, setNb] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(todayISO(), i - 1));
  const list = state.appointments.filter((a) => a.date === day).sort((a, b) => a.time.localeCompare(b.time));
  const unassigned = state.appointments.filter((a) => a.status === "requested");
  return (
    <div className="space-y-6" data-testid="desk-schedule">
      <SectionHead eyebrow="Front desk" title="Schedule" action={perm("createBooking") && <button onClick={() => setNb(true)} data-testid="desk-new-booking-btn" className="nb-btn-primary h-10 text-sm"><Plus className="h-4 w-4" />New booking</button>} />
      {unassigned.length > 0 && <div className="space-y-2" data-testid="desk-unassigned">{unassigned.map((a) => <button key={a.id} onClick={() => setSel(a.id)} data-testid={`desk-unassigned-${a.id}`} className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-4 text-left text-sm text-amber-900"><span className="flex-1"><b>Needs a practitioner:</b> {a.ref} · {idx.clients[a.clientId]?.firstName} · {idx.services[a.serviceSlug].name} · {fmtDate(a.date)} {fmtTime(a.time)}</span><span className="font-semibold">Assign →</span></button>)}</div>}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">{days.map((d) => <button key={d} onClick={() => setDay(d)} data-testid={`desk-day-${d}`} className={`flex h-20 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border-2 text-sm ${day === d ? "border-transparent text-white nb-gradient" : "border-sky-100 bg-white"}`}><span className={`text-[10px] uppercase ${day === d ? "text-white/80" : "text-nb-mute"}`}>{fmtDate(d, { weekday: "short" })}</span><b>{fmtDate(d, { day: "numeric" })}</b></button>)}</div>
      <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0" data-testid="desk-lanes">
        {state.practitioners.map((p) => (
          <div key={p.id} data-testid={`desk-col-${p.id}`} className="w-[86%] shrink-0 snap-center sm:w-80 lg:w-auto">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Avatar person={p} size={26} />{p.name}{!p.available && <span className="text-xs font-normal text-nb-mute">(off)</span>}</p>
            <div className="space-y-2">
              {list.filter((a) => a.practitionerId === p.id).map((a) => (
                <div key={a.id} className="nb-card p-3" data-testid={`desk-appt-${a.id}`}>
                  <button onClick={() => setSel(a.id)} className="w-full text-left" data-testid={`desk-appt-open-${a.id}`}><div className="flex items-center justify-between"><b className="text-sm">{fmtTime(a.time)}</b><StatusPill status={a.status} /></div><p className="mt-1 text-sm">{idx.clients[a.clientId]?.firstName} {idx.clients[a.clientId]?.lastName}</p><p className="text-xs text-nb-mute">{idx.services[a.serviceSlug].name} · {a.duration}m</p></button>
                  <div className="mt-2 flex items-center justify-between">{perm("managePayments") || perm("viewInsuranceStatus") ? <PayPill status={a.paymentStatus} /> : <span />}
                    {!["cancelled", "no_show", "closed"].includes(a.status) && <button onClick={() => run(() => api.patch("appointments", a.id, { checkedIn: !a.checkedIn, _audit: `${a.ref} ${a.checkedIn ? "checked out" : "checked in"}`, _actor: staffActor(user) }))} data-testid={`desk-checkin-${a.id}`} className="flex items-center gap-1 text-xs font-semibold text-nb-blue">{a.checkedIn ? <><LogOut className="h-3 w-3" />Check out</> : <><LogIn className="h-3 w-3" />Check in</>}</button>}</div>
                </div>))}
              {!list.some((a) => a.practitionerId === p.id) && <p className="rounded-2xl border border-dashed border-sky-200 p-4 text-center text-xs text-nb-mute">Open day</p>}
            </div>
          </div>))}
      </div>
      {sel && <AppointmentSheet apptId={sel} role="desk" onClose={() => setSel(null)} />}
      {nb && <NewBookingDialog open onClose={() => setNb(false)} />}
    </div>
  );
}
