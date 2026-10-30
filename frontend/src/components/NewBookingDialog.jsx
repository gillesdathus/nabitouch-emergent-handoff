import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/store/DemoStore";
import { quote, todayISO, money, slotsFor, fmtTime, staffActor, designatedTherapist, CANONICAL_PRACTITIONER_ID, CANONICAL_PRACTITIONER_NAME } from "@/lib/domain";
import { BOOKING_SOURCES } from "@/lib/workspaces";
import { apiError } from "@/lib/api";

export function NewBookingDialog({ open, onClose, clientId, defaultSource = "phone" }) {
  const { state, idx, api, run, user } = useDemo();
  const firstService = state.services.find((item) => item.slug === "swedish") || state.services[0];
  const therapist = designatedTherapist(state.practitioners);
  const therapistId = therapist?.id || CANONICAL_PRACTITIONER_ID;
  const therapistName = therapist?.name || CANONICAL_PRACTITIONER_NAME;
  const [f, setF] = useState({
    clientId: clientId || "",
    serviceSlug: firstService?.slug || "",
    duration: Number(Object.keys(firstService?.prices || { 60: 0 })[0]),
    date: todayISO(),
    time: "",
    practitionerId: therapistId,
    locationType: "clinic",
    source: defaultSource,
    query: "",
  });
  const [hits, setHits] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k !== "time" ? { time: "" } : {}) }));
  const s = idx.services[f.serviceSlug];
  const c = idx.clients[f.clientId] || hits.find((row) => row.id === f.clientId);
  const addr = c?.addresses?.find((item) => item.clientConfirmed === true) || c?.addresses?.[0];
  const addressReady = f.locationType === "clinic" || addr?.clientConfirmed === true;
  const zone = (state.zones || []).find((z) => z.id === addr?.zoneId);
  const q = quote({ service: s, duration: f.duration, zone, client: c, promotions: [], settings: idx.settings, locationType: f.locationType });
  const slots = slotsFor(f.date, therapistId, state.appointments, f.duration).filter((x) => x.available);

  useEffect(() => {
    if (!open || f.query.trim().length < 2) { setHits([]); return undefined; }
    let live = true;
    const handle = setTimeout(() => {
      api.searchClients(f.query).then((body) => { if (live) setHits(body.clients || []); }).catch(() => { if (live) setHits([]); });
    }, 250);
    return () => { live = false; clearTimeout(handle); };
  }, [api, f.query, open]);

  const createPatient = async () => {
    setErr(""); setCreating(true);
    try {
      const created = await api.createClient(newClient);
      setF((x) => ({ ...x, clientId: created.id, query: `${created.firstName} ${created.lastName}` }));
      setHits([created]);
      setCreating(false);
    } catch (error) {
      setErr(apiError(error));
      setCreating(false);
    }
  };

  const save = async () => {
    setErr("");
    const appointment = {
      serviceSlug: f.serviceSlug, duration: Number(f.duration), date: f.date, time: f.time, locationType: f.locationType,
      address: f.locationType === "clinic" ? { line: idx.settings?.clinic?.address || "Clinic" } : { ...addr, notes: "" },
      pricing: q, paymentMethod: "self", insuranceId: null,
      preferences: { goals: [], focus: [], notes: `Booked by staff (${f.source}). Notes do not change the purchased service.` },
      checkedIn: f.source === "walk_in", feedback: null,
    };
    try {
      await run(() => api.book({
        client: { id: f.clientId }, practitionerId: therapistId, source: f.source, actor: staffActor(user),
        appointment, idempotencyKey: `book-${f.clientId}-${f.date}-${f.time}-${f.serviceSlug}`,
      }), "Booking created");
      onClose();
    } catch (error) {
      setErr(apiError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-lg" data-testid="new-booking-dialog">
        <DialogTitle>Phone / front-desk booking</DialogTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="nb-label">Source</span>
            <select className="nb-input" value={f.source} onChange={set("source")} data-testid="nb-source-select">
              {BOOKING_SOURCES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="sm:col-span-2"><span className="nb-label">Find patient</span>
            <input className="nb-input" value={f.query} onChange={(e) => setF((x) => ({ ...x, query: e.target.value }))} placeholder="Name, email, or phone" data-testid="nb-client-search" />
          </label>
          <label className="sm:col-span-2"><span className="nb-label">Patient</span>
            <select className="nb-input" value={f.clientId} onChange={set("clientId")} data-testid="nb-client-select">
              <option value="">Select…</option>
              {(hits.length ? hits : state.clients).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName}{x.email ? ` · ${x.email}` : ""}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2 rounded-2xl bg-sky-50/70 p-3" data-testid="nb-create-patient">
            <p className="mb-2 text-xs font-semibold text-nb-mute">Or create a patient</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="nb-input" placeholder="First name" value={newClient.firstName} onChange={(e) => setNewClient({ ...newClient, firstName: e.target.value })} data-testid="nb-new-first" />
              <input className="nb-input" placeholder="Last name" value={newClient.lastName} onChange={(e) => setNewClient({ ...newClient, lastName: e.target.value })} data-testid="nb-new-last" />
              <input className="nb-input" placeholder="Email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} data-testid="nb-new-email" />
              <input className="nb-input" placeholder="Phone" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} data-testid="nb-new-phone" />
            </div>
            <button type="button" disabled={creating || !newClient.firstName || !newClient.lastName} onClick={createPatient} className="nb-btn-ghost mt-2 h-9 w-full text-sm" data-testid="nb-create-patient-btn">Create patient</button>
          </div>
          <label><span className="nb-label">Service</span><select className="nb-input" value={f.serviceSlug} onChange={(e) => setF((x) => ({ ...x, serviceSlug: e.target.value, duration: Number(Object.keys(idx.services[e.target.value].prices)[0]), time: "" }))} data-testid="nb-service-select">{state.services.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select></label>
          <label><span className="nb-label">Duration</span><select className="nb-input" value={f.duration} onChange={set("duration")} data-testid="nb-duration-select">{Object.keys(s?.prices || {}).map((d) => <option key={d} value={d}>{d} min</option>)}</select></label>
          <div data-testid="nb-pract-sole">
            <span className="nb-label">Therapist</span>
            <p className="nb-input flex items-center bg-sky-50/80 text-sm font-semibold text-nb-navy">{therapistName}<span className="ml-2 font-normal text-nb-mute">· assigned automatically</span></p>
            <input type="hidden" value={therapistId} readOnly />
          </div>
          <label><span className="nb-label">Location</span><select className="nb-input" value={f.locationType} onChange={set("locationType")} data-testid="nb-location-select"><option value="clinic">Clinic</option><option value="home">Mobile</option></select></label>
          <label><span className="nb-label">Date</span><input type="date" className="nb-input" value={f.date} onChange={set("date")} data-testid="nb-date-input" /></label>
          <label className="sm:col-span-2"><span className="nb-label">Time</span><select className="nb-input" value={f.time} onChange={set("time")} data-testid="nb-time-select"><option value="">Select an open time…</option>{slots.map((x) => <option key={x.time} value={x.time}>{fmtTime(x.time)}</option>)}</select></label>
        </div>
        <p className="text-xs text-nb-mute">Address: {f.locationType === "clinic" ? (idx.settings?.clinic?.address || "Clinic") : (addr?.line || "—")} · Total {money(q.total)} (incl. travel & GST).</p>
        {f.locationType === "home" && !addressReady && <p data-testid="nb-address-unconfirmed" className="text-sm text-amber-800">This saved address has not been confirmed for a mobile visit.</p>}
        {err && <p className="text-sm text-rose-700" data-testid="nb-error">{err}</p>}
        <button disabled={!f.time || !f.clientId || !addressReady} onClick={save} data-testid="nb-save-btn" className="nb-btn-primary w-full">Create booking</button>
      </DialogContent>
    </Dialog>
  );
}
