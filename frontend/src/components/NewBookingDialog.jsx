import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ClientSelector } from "@/components/clients/ClientSelector";
import { useDemo } from "@/store/DemoStore";
import { quote, todayISO, money, slotsFor, fmtTime, staffActor, designatedTherapist, CANONICAL_PRACTITIONER_ID, CANONICAL_PRACTITIONER_NAME } from "@/lib/domain";
import { preferredBookingAddress } from "@/lib/booking-selection";
import { BOOKING_SOURCES } from "@/lib/workspaces";
import { apiError } from "@/lib/api";

function bookingDefaults({ clientId, firstService, therapistId, defaultSource }) {
  return {
    clientId: clientId || "",
    serviceSlug: firstService?.slug || "",
    duration: Number(Object.keys(firstService?.prices || { 60: 0 })[0]),
    date: todayISO(),
    time: "",
    practitionerId: therapistId,
    locationType: "clinic",
    source: defaultSource,
  };
}

export function NewBookingDialog({ open, onClose, clientId, defaultSource = "phone" }) {
  const { state, idx, api, run, user } = useDemo();
  const firstService = state.services.find((item) => item.slug === "swedish") || state.services[0];
  const therapist = designatedTherapist(state.practitioners);
  const therapistId = therapist?.id || CANONICAL_PRACTITIONER_ID;
  const therapistName = therapist?.name || CANONICAL_PRACTITIONER_NAME;
  const [f, setF] = useState(() => bookingDefaults({ clientId, firstService, therapistId, defaultSource }));
  const [selectedClient, setSelectedClient] = useState(null);
  const [err, setErr] = useState("");
  const [hydrating, setHydrating] = useState(false);

  const hydrateClient = async (row) => {
    if (!row?.id) {
      setSelectedClient(null);
      return null;
    }
    // Search hits historically omitted addresses. Load the workspace book when missing.
    if (Array.isArray(row.addresses)) {
      setSelectedClient(row);
      return row;
    }
    setHydrating(true);
    try {
      const workspace = await api.clientWorkspace(row.id);
      const merged = {
        ...row,
        ...(workspace?.client || {}),
        addresses: workspace?.client?.addresses || [],
      };
      setSelectedClient(merged);
      return merged;
    } catch (error) {
      setSelectedClient(row);
      setErr(apiError(error) || "Could not load the client's saved addresses.");
      return row;
    } finally {
      setHydrating(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const next = bookingDefaults({ clientId, firstService, therapistId, defaultSource });
    setF(next);
    setErr("");
    if (clientId) {
      const known = idx.clients?.[clientId] || (state.clients || []).find((row) => row.id === clientId) || { id: clientId };
      hydrateClient(known);
    } else {
      setSelectedClient(null);
    }
    // Reset booking shell when the dialog opens or a preselected client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k !== "time" ? { time: "" } : {}) }));
  const s = idx.services[f.serviceSlug];
  const c = selectedClient || idx.clients[f.clientId] || (state.clients || []).find((row) => row.id === f.clientId);
  const addr = preferredBookingAddress(c);
  const addressReady = f.locationType === "clinic" || (addr?.clientConfirmed === true && String(addr?.line || "").trim());
  const zone = (state.zones || []).find((z) => z.id === addr?.zoneId);
  const q = quote({ service: s, duration: f.duration, zone, client: c, promotions: [], settings: idx.settings, locationType: f.locationType });
  const slots = slotsFor(f.date, therapistId, state.appointments, f.duration).filter((x) => x.available);

  const onClientChange = async (row) => {
    // Changing clients must not wipe service / date / practitioner / other booking fields.
    setErr("");
    setF((x) => ({ ...x, clientId: row?.id || "" }));
    if (!row) {
      setSelectedClient(null);
      return;
    }
    await hydrateClient(row);
  };

  const save = async () => {
    setErr("");
    if (f.locationType === "home" && !addressReady) {
      setErr("This saved address cannot be used for a mobile visit until it is confirmed.");
      return;
    }
    const appointment = {
      serviceSlug: f.serviceSlug, duration: Number(f.duration), date: f.date, time: f.time, locationType: f.locationType,
      address: f.locationType === "clinic"
        ? { line: idx.settings?.clinic?.address || "Clinic" }
        : {
            id: addr.id,
            line: addr.line,
            unit: addr.unit || "",
            access: addr.access || "",
            notes: "",
            postal: addr.postal || "",
            lat: addr.lat,
            lng: addr.lng,
            zoneId: addr.zoneId,
            mapboxId: addr.mapboxId || "",
            clientConfirmed: true,
            confidence: addr.confidence || "address",
            label: addr.label,
            purpose: addr.purpose,
          },
      addressId: f.locationType === "clinic" ? undefined : addr?.id,
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

  const missingAddress = f.locationType === "home" && !addressReady;
  const addressHint = missingAddress
    ? (Array.isArray(c?.addresses) && c.addresses.length === 0
      ? "This client has no saved address for a mobile visit."
      : "This saved address has not been confirmed for a mobile visit.")
    : null;

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
          <div className="sm:col-span-2" data-testid="nb-client-section">
            <span className="nb-label mb-1 block">Client</span>
            <ClientSelector
              value={f.clientId}
              client={c}
              onChange={onClientChange}
              testidPrefix="nb-client"
            />
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
        <p className="text-xs text-nb-mute" data-testid="nb-address-line">
          Address: {f.locationType === "clinic" ? (idx.settings?.clinic?.address || "Clinic") : (hydrating ? "Loading…" : (addr?.line || "—"))}
          {" · "}Total {money(q.total)} (incl. travel & GST).
        </p>
        {addressHint && <p data-testid="nb-address-unconfirmed" className="text-sm text-amber-800">{addressHint}</p>}
        {err && <p className="text-sm text-rose-700" data-testid="nb-error">{err}</p>}
        <button disabled={!f.time || !f.clientId || !addressReady || hydrating} onClick={save} data-testid="nb-save-btn" className="nb-btn-primary w-full">Create booking</button>
      </DialogContent>
    </Dialog>
  );
}
