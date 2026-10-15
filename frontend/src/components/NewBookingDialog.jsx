import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/store/DemoStore";
import { quote, todayISO, money, slotsFor, fmtTime, staffActor } from "@/lib/domain";

export function NewBookingDialog({ open, onClose, clientId }) {
  const { state, idx, api, run, user } = useDemo();
  const firstService = state.services.find((item) => item.slug === "swedish") || state.services[0];
  const firstPractitioner = state.practitioners.find((item) => item.id === "p-maya" && item.bookable !== false) || state.practitioners.find((item) => item.available && item.bookable !== false && item.onboardingStatus !== "pending");
  const [f, setF] = useState({ clientId: clientId || state.clients[0]?.id || "", serviceSlug: firstService?.slug || "", duration: Number(Object.keys(firstService?.prices || { 60: 0 })[0]), date: todayISO(), time: "", practitionerId: firstPractitioner?.id || "" });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k !== "time" ? { time: "" } : {}) }));
  const s = idx.services[f.serviceSlug];
  const c = idx.clients[f.clientId];
  const addr = c?.addresses?.find((item) => item.clientConfirmed === true) || c?.addresses?.[0];
  const addressReady = addr?.clientConfirmed === true;
  const zone = (state.zones || []).find((z) => z.id === addr?.zoneId);
  const q = quote({ service: s, duration: f.duration, zone, client: c, promotions: [], settings: idx.settings, locationType: "home" });
  const slots = slotsFor(f.date, f.practitionerId, state.appointments, f.duration).filter((x) => x.available);
  const save = async () => {
    await run(() => api.book({ client: { id: f.clientId }, practitionerId: f.practitionerId, source: "reception", actor: staffActor(user),
      appointment: { serviceSlug: f.serviceSlug, duration: Number(f.duration), date: f.date, time: f.time, locationType: "home", address: { ...addr, notes: "" }, pricing: q, paymentMethod: "self", insuranceId: null, preferences: { goals: [], focus: [], notes: "Booked by reception. Notes do not change the purchased service." }, checkedIn: false, feedback: null } }), "Booking created");
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl sm:max-w-lg" data-testid="new-booking-dialog">
        <DialogTitle>New booking</DialogTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="nb-label">Client</span><select className="nb-input" value={f.clientId} onChange={set("clientId")} data-testid="nb-client-select">{state.clients.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>)}</select></label>
          <label><span className="nb-label">Service</span><select className="nb-input" value={f.serviceSlug} onChange={(e) => setF((x) => ({ ...x, serviceSlug: e.target.value, duration: Number(Object.keys(idx.services[e.target.value].prices)[0]), time: "" }))} data-testid="nb-service-select">{state.services.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select></label>
          <label><span className="nb-label">Duration</span><select className="nb-input" value={f.duration} onChange={set("duration")} data-testid="nb-duration-select">{Object.keys(s?.prices || {}).map((d) => <option key={d} value={d}>{d} min</option>)}</select></label>
          <label><span className="nb-label">Practitioner</span><select className="nb-input" value={f.practitionerId} onChange={set("practitionerId")} data-testid="nb-pract-select">{state.practitioners.filter((x) => x.available && x.onboardingStatus !== "draft" && x.onboardingStatus !== "pending" && x.bookable !== false).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label><span className="nb-label">Date</span><input type="date" className="nb-input" value={f.date} onChange={set("date")} data-testid="nb-date-input" /></label>
          <label className="sm:col-span-2"><span className="nb-label">Time</span><select className="nb-input" value={f.time} onChange={set("time")} data-testid="nb-time-select"><option value="">Select an open time…</option>{slots.map((x) => <option key={x.time} value={x.time}>{fmtTime(x.time)}</option>)}</select></label>
        </div>
        <p className="text-xs text-nb-mute">Address: {addr?.line || "—"} · Total {money(q.total)} (incl. travel & GST). Online welcome offer doesn’t apply to staff bookings.</p>
        {!addressReady && <p data-testid="nb-address-unconfirmed" className="text-sm text-amber-800">This saved address has not been confirmed for a mobile visit.</p>}
        <button disabled={!f.time || !addressReady} onClick={save} data-testid="nb-save-btn" className="nb-btn-primary w-full">Create booking</button>
      </DialogContent>
    </Dialog>
  );
}
