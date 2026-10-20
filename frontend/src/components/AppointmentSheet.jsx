import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MapPin, Phone, Lock, CalendarClock, UserCog, LogIn, LogOut } from "lucide-react";
import { OpsTimeline, StatusPill, Confirm, Pill } from "@/components/ui-kit";
import { PaymentPanel } from "@/components/PaymentPanel";
import { ClientProfile, PractitionerProfile } from "@/components/ops/Profiles";
import { LiveTrack } from "@/components/LiveTrack";
import { useDemo } from "@/store/DemoStore";
import { RescheduleSheet } from "@/components/RescheduleSheet";
import { fmtDate, fmtTime, fmtStamp, OPEN, staffActor } from "@/lib/domain";

export function AppointmentSheet({ apptId, role, onClose }) {
  const { state, idx, api, run, perm, user } = useDemo();
  const appt = state.appointments.find((a) => a.id === apptId);
  const [resched, setResched] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [profile, setProfile] = useState(null);
  if (!appt) return null;
  const can = (k) => role === "owner" || perm(k);
  const actor = staffActor(user);
  const c = idx.clients[appt.clientId], s = idx.services[appt.serviceSlug], p = idx.practitioners[appt.practitionerId];
  const open = OPEN.includes(appt.status);
  const ts = appt.timestamps || {};
  const assign = async (pid) => {
    if (appt.status === "requested") { await api.patch("appointments", appt.id, { practitionerId: pid }); await run(() => api.transition(appt.id, "assigned", actor), "Practitioner assigned"); }
    else await run(() => api.event(appt.id, "reassigned", actor, idx.practitioners[pid].name, { practitionerId: pid }), "Practitioner reassigned");
  };
  return (
    <>
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="appointment-sheet">
        <SheetTitle className="flex items-center gap-2">{appt.ref} <StatusPill status={appt.status} testid="sheet-status-pill" /></SheetTitle>
        <div className="mt-4 space-y-5 text-sm">
          <div className="nb-soft p-4">
            <p className="font-semibold">{s.name} · {appt.duration} min</p>
            <p className="text-nb-mute">{fmtDate(appt.date)} at {fmtTime(appt.time)} · {c ? `${c.firstName} ${c.lastName}` : "—"}</p>
            {role === "owner" && c && <button type="button" className="mt-2 text-xs font-semibold text-nb-blue" onClick={() => setProfile("client")} data-testid="sheet-client-profile">Open client profile</button>}
            {c && <p className="mt-1 flex items-center gap-1 text-xs text-nb-mute"><Phone className="h-3 w-3" />{c.phone}</p>}
            {can("viewAddresses") ? <p className="mt-1 flex items-center gap-1 text-xs text-nb-mute" data-testid="sheet-address"><MapPin className="h-3 w-3" />{appt.address?.line}{appt.address?.notes ? ` · ${appt.address.notes}` : ""}</p> : <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Lock className="h-3 w-3" />Address hidden by permissions</p>}
          </div>
          {appt.status === "en_route" && (can("viewLocations") || can("viewEta")) && <LiveTrack appt={appt} practitioner={p} showLate />}
          <div className="grid grid-cols-2 gap-2 text-xs" data-testid="sheet-op-times">
            {[["Arrival", ts.arrived], ["Session start", ts.in_session], ["Session end", ts.session_ended], ["Departure", ts.leaving]].map(([l, v]) => <div key={l} className="rounded-xl bg-slate-50 p-2.5"><p className="text-nb-mute">{l}</p><p className="font-semibold">{fmtStamp(v)}</p></div>)}
          </div>
          <div>
            <p className="nb-label flex items-center gap-1"><UserCog className="h-4 w-4" />Practitioner</p>
            {can("assign") && open ? <select className="nb-input" value={appt.practitionerId || ""} onChange={(e) => assign(e.target.value)} data-testid="sheet-assign-select"><option value="" disabled>Unassigned — choose…</option>{state.practitioners.map((x) => <option key={x.id} value={x.id}>{x.name}{x.available ? "" : " (unavailable)"}</option>)}</select> : <p>{p?.name || "Unassigned"}</p>}
            {role === "owner" && p && <button type="button" className="mt-2 text-xs font-semibold text-nb-blue" onClick={() => setProfile("practitioner")} data-testid="sheet-practitioner-profile">Open practitioner profile</button>}
          </div>
          {open && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => run(() => api.patch("appointments", appt.id, { checkedIn: !appt.checkedIn, _audit: `${appt.ref} ${appt.checkedIn ? "checked out" : "checked in"}`, _actor: actor }))} data-testid="sheet-checkin-btn" className="nb-btn-ghost h-10 text-sm">{appt.checkedIn ? <><LogOut className="h-4 w-4" />Check out</> : <><LogIn className="h-4 w-4" />Check in</>}</button>
              {can("createBooking") && <button onClick={() => setResched({ date: appt.date, time: appt.time })} data-testid="sheet-reschedule-btn" className="nb-btn-ghost h-10 text-sm"><CalendarClock className="h-4 w-4" />Reschedule</button>}
              <button onClick={() => setConfirm("cancelled")} data-testid="sheet-cancel-btn" className="nb-btn-ghost h-10 text-sm text-rose-700">Cancel</button>
              {["assigned", "confirmed", "preparing", "arrived"].includes(appt.status) && <button onClick={() => setConfirm("no_show")} data-testid="sheet-noshow-btn" className="nb-btn-ghost h-10 text-sm">No-show</button>}
            </div>
          )}
          {resched && <RescheduleSheet appt={appt} label={`${appt.ref} · ${c ? `${c.firstName} ${c.lastName}` : "Client"}`} cta="Save new time" onClose={() => setResched(null)} onPick={async (date, time) => { try { await run(() => api.event(appt.id, "rescheduled", actor, `${fmtDate(date)} ${fmtTime(time)}`, { date, time }), "Visit rescheduled"); setResched(null); } catch { /* toast shown; keep sheet open */ } }} />}
          <div className="flex items-center gap-2 text-xs"><span className="text-nb-mute">Clinical notes:</span>{role === "owner" || perm("clinical") ? <Pill tone={appt.soapStatus === "signed" ? "green" : appt.soapStatus === "draft" ? "amber" : "slate"} testid="sheet-soap-status">{appt.soapStatus === "signed" ? "SOAP signed" : appt.soapStatus === "draft" ? "SOAP draft" : "Not started"}</Pill> : <span className="flex items-center gap-1 text-slate-400" data-testid="sheet-soap-restricted"><Lock className="h-3 w-3" />Restricted</span>}</div>
          {appt.flashProtection?.enabled && (
            <div className="rounded-2xl bg-sky-50 p-3 text-xs" data-testid="sheet-flash-grace">
              <p className="font-semibold text-nb-ink">Flash Booking Protection</p>
              <p className="mt-1 text-nb-mute">
                {appt.flashProtection.graceMinutes != null ? `${appt.flashProtection.graceMinutes} min grace` : "Grace window"}
                {appt.flashProtection.graceEndsAt ? ` · ends ${fmtStamp(appt.flashProtection.graceEndsAt)}` : ""}
              </p>
            </div>
          )}
          {appt.cancellationAssessment && (
            <div className="rounded-2xl bg-amber-50 p-3 text-xs" data-testid="sheet-cancellation-assessment">
              <p className="font-semibold text-amber-950">
                {appt.cancellationAssessment.kind === "no_show" ? "No-show" : "Cancellation"} assessment (staff review)
              </p>
              <p className="mt-1 text-amber-900">
                Suggested fee ${Number(appt.cancellationAssessment.suggestedFee || 0).toFixed(2)}
                {appt.cancellationAssessment.withinFlashGrace ? " · within flash grace ($0)" : ""}
                {appt.cancellationAssessment.requiresManagerReview ? " · manager review required" : ""}
              </p>
              <p className="mt-1 text-amber-800">No automatic card charge. Record any waiver or collection separately.</p>
            </div>
          )}
          <div><p className="nb-label">Payment & insurance</p>{can("managePayments") || can("viewInsuranceStatus") ? <PaymentPanel appt={appt} role={role} /> : <p className="text-xs text-slate-400">Hidden by permissions</p>}</div>
          {can("viewHistory") && <div><p className="nb-label">Timeline</p><OpsTimeline appt={appt} /></div>}
        </div>
        <Confirm open={!!confirm} onOpenChange={() => setConfirm(null)} title={confirm === "no_show" ? "Mark as no-show?" : "Cancel this appointment?"} body="This is recorded on the timeline and audit log." confirmLabel="Yes, confirm" testid="sheet-exception-confirm"
          onConfirm={() => run(() => api.transition(appt.id, confirm, actor), "Updated")} />
      </SheetContent>
    </Sheet>
    {profile === "client" && <ClientProfile clientId={appt.clientId} onClose={() => setProfile(null)} />}
    {profile === "practitioner" && <PractitionerProfile personId={appt.practitionerId} onClose={() => setProfile(null)} />}
    </>
  );
}
