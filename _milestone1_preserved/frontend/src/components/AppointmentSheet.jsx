import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Clock, Phone, ChevronRight, Banknote, CreditCard, UserRoundCog, CalendarClock, LogIn } from "lucide-react";
import { TripHistory } from "@/components/TripAlerts";
import { BottomSheet, StatusPill, PayPill, Avatar, Row, Notice, Stepper, Pill } from "@/components/ui-kit";
import { usePreview } from "@/store/PreviewStore";
import { money, timeLabel, endTime, fmtDate, TRIP_FLOW } from "@/lib/domain";

function CashForm({ a, onDone }) {
  const { api } = usePreview();
  const [amt, setAmt] = useState(a.settle.balance.toFixed(2));
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); await api.recordCash(a.id, +amt); setBusy(false); onDone(); };
  return (
    <div className="flex gap-2 mt-2">
      <input data-testid="cash-amount-input" className="nb-input h-11" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
      <button data-testid="cash-confirm-btn" disabled={busy || !(+amt > 0)} onClick={go} className="nb-btn-dark shrink-0">{busy ? "Saving…" : "Record"}</button>
    </div>
  );
}

export function AppointmentHost() {
  const { apptId, openAppt, db, svc, pro, cli, role, openProfile, api, openNewBooking } = usePreview();
  const nav = useNavigate();
  const [cash, setCash] = useState(false);
  const a = db.appointments.find((x) => x.id === apptId);
  const perms = db.settings.receptionPerms;
  const isDesk = role === "desk";
  const canPay = role === "owner" || (isDesk && perms.managePayments);
  const showAddr = !isDesk || perms.viewAddresses;
  const close = () => { setCash(false); openAppt(null); };
  if (!a) return <BottomSheet open={false} onOpenChange={close} title="" testid="appointment-sheet" />;
  const s = svc(a.serviceId), p = pro(a.practitionerId), c = cli(a.clientId);
  const step = Math.max(0, TRIP_FLOW.indexOf(a.status));
  return (
    <BottomSheet open={!!a} onOpenChange={(o) => !o && close()} testid="appointment-sheet" title={s.name} sub={`${fmtDate(a.date)} · ${timeLabel(a.time)}–${timeLabel(endTime(a.time, a.duration))} · Edmonton time`}
      footer={
        <div className="flex gap-2">
          {role === "pro" && <button data-testid="appt-open-visit-btn" onClick={() => { close(); nav(`/pro/visit/${a.id}`); }} className="nb-btn-primary flex-1">Open visit</button>}
          {isDesk && a.status === "confirmed" && <button data-testid="appt-checkin-btn" onClick={() => api.transition(a.id, "arrived", "Client checked in")} className="nb-btn-primary flex-1"><LogIn className="h-4 w-4" />Check in</button>}
          {(role === "owner" || (isDesk && perms.createBooking)) && <button data-testid="appt-reschedule-btn" onClick={() => { close(); openNewBooking({ clientId: a.clientId, serviceId: a.serviceId, practitionerId: a.practitionerId, date: a.date }); }} className="nb-btn-ghost flex-1"><CalendarClock className="h-4 w-4" />Reschedule</button>}
          {role === "owner" && a.status !== "cancelled" && a.status !== "completed" && <button data-testid="appt-cancel-btn" onClick={() => api.transition(a.id, "cancelled", "Visit cancelled")} className="nb-btn-ghost text-nb-coral">Cancel</button>}
        </div>
      }>
      <div className="flex flex-wrap gap-2 mb-4"><StatusPill status={a.status} data-testid="appt-status-pill" /><PayPill pay={a.pay} data-testid="appt-pay-pill" /><Pill>{a.method === "card" ? "Card" : "Cash"}</Pill></div>
      {a.status !== "cancelled" && <div className="mb-5"><Stepper steps={["Confirmed", "En route", "Arrived", "Session", "Done"]} current={a.status === "requested" ? 0 : a.status === "completed" ? 5 : step} /></div>}
      <div className="space-y-2">
        <button data-testid="appt-client-row" onClick={() => openProfile("client", c.id)} className="w-full flex items-center gap-3 rounded-2xl bg-sky-50/70 p-3 text-left hover:bg-sky-50 transition-colors">
          <Avatar name={c.name} size={42} /><div className="flex-1 min-w-0"><p className="text-xs text-nb-mute">Client</p><p className="font-semibold truncate">{c.name}</p></div><ChevronRight className="h-4 w-4 text-nb-mute" />
        </button>
        <button data-testid="appt-practitioner-row" onClick={() => openProfile("practitioner", p.id)} className="w-full flex items-center gap-3 rounded-2xl bg-sky-50/70 p-3 text-left hover:bg-sky-50 transition-colors">
          <Avatar src={p.photo} name={p.name} size={42} /><div className="flex-1 min-w-0"><p className="text-xs text-nb-mute">Practitioner{isDesk && perms.assign ? " · can reassign" : ""}</p><p className="font-semibold truncate">{p.name}</p></div>
          {isDesk && perms.assign ? <UserRoundCog className="h-4 w-4 text-nb-blue" /> : <ChevronRight className="h-4 w-4 text-nb-mute" />}
        </button>
        <div className="flex items-start gap-3 p-3 text-sm"><MapPin className="h-4 w-4 mt-0.5 text-nb-teal" /><span data-testid="appt-address">{showAddr ? `${a.address} · mobile visit` : "Address hidden — reception permission off"}</span></div>
        <div className="flex items-start gap-3 px-3 text-sm"><Clock className="h-4 w-4 mt-0.5 text-nb-teal" />{a.duration} min treatment</div>
        {a.notes && <div className="flex items-start gap-3 px-3 pt-2 text-sm text-nb-mute"><Phone className="h-4 w-4 mt-0.5 opacity-0" /><span>Treatment note: “{a.notes}” <span className="block text-xs mt-0.5">Notes never change the purchased service or price.</span></span></div>}
      </div>
      {a.status !== "cancelled" && a.status !== "requested" && <div className="mt-5 rounded-3xl ring-1 ring-sky-100 p-4"><TripHistory apptId={a.id} name={p.name.split(" ")[0]} testid="appt-trip-history" /></div>}
      <div className="mt-5 rounded-3xl ring-1 ring-sky-100 p-4">
        <p className="nb-eyebrow mb-1">Server quote</p>
        <Row label="Treatment" value={money(a.pricing.price)} />
        <Row label="Travel (zone fee)" value={money(a.pricing.travel)} />
        <Row label="GST 5%" value={money(a.pricing.tax)} />
        <Row label="Total" value={money(a.pricing.total)} strong className="border-t border-dashed border-sky-100 mt-1 pt-3" />
        <Row label="Paid" value={money(a.settle.clientPaid)} />
        <Row label="Balance" value={<span data-testid="appt-balance" className={a.settle.balance > 0 ? "text-nb-coral font-semibold" : "text-[#3E7A1E] font-semibold"}>{money(a.settle.balance)}</span>} />
        {a.settle.balance > 0 && canPay && (
          <div className="mt-3">
            {!cash ? <button data-testid="record-cash-btn" onClick={() => setCash(true)} className="nb-btn-ghost w-full"><Banknote className="h-4 w-4" />Record cash received</button> : <CashForm a={a} onDone={() => setCash(false)} />}
            <Notice className="mt-2" icon={CreditCard} testid="card-disabled-notice">Card checkout is not configured (Stripe off). Cash stays unpaid until recorded.</Notice>
          </div>
        )}
        {a.settle.balance > 0 && isDesk && !perms.managePayments && <Notice className="mt-3">Payments are not enabled for reception.</Notice>}
      </div>
    </BottomSheet>
  );
}
