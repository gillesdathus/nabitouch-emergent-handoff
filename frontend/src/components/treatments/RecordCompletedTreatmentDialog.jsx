import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AddressPicker } from "@/components/AddressPicker";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";
import {
  CANONICAL_PRACTITIONER_ID,
  CANONICAL_PRACTITIONER_NAME,
  designatedTherapist,
  fmtDate,
  fmtTime,
  money,
  todayISO,
} from "@/lib/domain";
import { hasStaffRole } from "@/lib/staffRoles";

const STEPS = ["client", "search", "create", "details", "review"];
const emptyClient = {
  firstName: "",
  lastName: "",
  preferredName: "",
  dob: "",
  phone: "",
  altPhone: "",
  email: "",
  language: "English",
  contactMethod: "Text",
};

function defaultForm(clientId, therapistId) {
  return {
    clientId: clientId || "",
    practitionerId: therapistId || CANONICAL_PRACTITIONER_ID,
    serviceSlug: "",
    duration: 60,
    serviceDate: todayISO(),
    serviceTime: "14:00",
    locationType: "home",
    addressId: "",
    charge: "",
    paymentMethod: "self",
    selfMethod: "cash",
    recordedPaymentStatus: "paid",
    adminNotes: "",
    completed: true,
    source: "",
  };
}

export function RecordCompletedTreatmentDialog({ open, onClose, clientId = "", onSaved }) {
  const { state, idx, api, run, refresh, perm, user } = useDemo();
  const therapist = designatedTherapist(state.practitioners);
  const therapistId = therapist?.id || CANONICAL_PRACTITIONER_ID;
  const therapistName = therapist?.name || CANONICAL_PRACTITIONER_NAME;
  const canFinance = hasStaffRole(user, "owner") || perm("managePayments");
  const [step, setStep] = useState(clientId ? "details" : "client");
  const [mode, setMode] = useState(clientId ? "existing" : "");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [newClient, setNewClient] = useState(emptyClient);
  const [addrQuery, setAddrQuery] = useState("");
  const [addr, setAddr] = useState(null);
  const [form, setForm] = useState(() => defaultForm(clientId, therapistId));
  const [selectedClient, setSelectedClient] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const idemRef = useRef(`ht-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const firstService = state.services.find((s) => s.slug === "swedish") || state.services[0];
  const firstServiceSlug = firstService?.slug || "";
  useEffect(() => {
    if (!open) return;
    idemRef.current = `ht-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setErr("");
    setSaving(false);
    setNewClient(emptyClient);
    setAddr(null);
    setAddrQuery("");
    setQuery("");
    setHits([]);
    setDuplicates([]);
    const svc = state.services.find((s) => s.slug === firstServiceSlug) || state.services[0];
    const next = defaultForm(clientId, therapistId);
    next.serviceSlug = svc?.slug || "";
    next.duration = Number(Object.keys(svc?.prices || { 60: 0 })[0] || 60);
    next.serviceDate = todayISO() > "2026-11-03" ? "2026-11-03" : todayISO();
    if (clientId) {
      const known = idx.clients?.[clientId] || state.clients.find((c) => c.id === clientId);
      setMode("existing");
      setStep("details");
      setSelectedClient(known || { id: clientId });
      if (known) {
        const def = (known.addresses || []).find((a) => a.isDefault) || (known.addresses || [])[0];
        if (def?.id) {
          next.addressId = def.id;
          next.locationType = def.purpose === "office" ? "office" : "home";
        }
      }
      setForm(next);
    } else {
      setMode("");
      setStep("client");
      setSelectedClient(null);
      setForm(next);
    }
    // Reset only when the dialog opens or the preselected client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId, therapistId, firstServiceSlug]);

  useEffect(() => {
    if (!open || step !== "search" || query.trim().length < 2) {
      if (step === "search" && query.trim().length < 2) { setHits([]); setDuplicates([]); }
      return undefined;
    }
    let live = true;
    const handle = setTimeout(() => {
      api.searchClients(query).then((body) => {
        if (!live) return;
        setHits(body.clients || []);
        setDuplicates(body.duplicates || []);
      }).catch(() => { if (live) { setHits([]); setDuplicates([]); } });
    }, 250);
    return () => { live = false; clearTimeout(handle); };
  }, [api, open, query, step]);

  const service = idx.services[form.serviceSlug] || firstService;
  const durations = Object.keys(service?.prices || { 60: 0 }).map(Number);
  const client = selectedClient || hits.find((c) => c.id === form.clientId) || idx.clients?.[form.clientId];
  const addresses = client?.addresses || [];
  const selectedAddress = addresses.find((a) => a.id === form.addressId) || addresses[0];
  const maxDate = todayISO();

  const setField = (key) => (e) => {
    const value = e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const pickExisting = (row) => {
    setSelectedClient(row);
    setForm((prev) => {
      const def = (row.addresses || []).find((a) => a.isDefault) || (row.addresses || [])[0];
      return {
        ...prev,
        clientId: row.id,
        addressId: def?.id || "",
        locationType: def?.purpose === "office" ? "office" : prev.locationType === "clinic" ? "clinic" : "home",
      };
    });
    setStep("details");
  };

  const continueNewClient = async ({ force = false } = {}) => {
    setErr("");
    if (!newClient.firstName.trim() || !newClient.lastName.trim()) {
      setErr("First and last name are required.");
      return;
    }
    // Soft duplicate check before creating — user may continue after reviewing matches.
    if (!force) {
      try {
        const needle = [newClient.phone, newClient.email, `${newClient.firstName} ${newClient.lastName}`].filter(Boolean).join(" ");
        if (needle.trim().length >= 2) {
          const body = await api.searchClients(needle);
          const matches = body.clients || [];
          const phoneDigits = String(newClient.phone || "").replace(/\D/g, "").slice(-10);
          const email = String(newClient.email || "").trim().toLowerCase();
          const dupes = matches.filter((row) => {
            const rowPhone = String(row.phone || "").replace(/\D/g, "").slice(-10);
            const rowEmail = String(row.email || "").trim().toLowerCase();
            const name = `${row.firstName || ""} ${row.lastName || ""}`.trim().toLowerCase();
            const mine = `${newClient.firstName} ${newClient.lastName}`.trim().toLowerCase();
            return (email && rowEmail && email === rowEmail)
              || (phoneDigits.length >= 10 && rowPhone === phoneDigits)
              || (name && name === mine);
          });
          if (dupes.length) {
            setHits(dupes);
            setDuplicates(body.duplicates || []);
            setErr(`Possible duplicate client${dupes.length > 1 ? "s" : ""} found. Select an existing record, or continue anyway.`);
            return;
          }
        }
      } catch {
        // Search is advisory only.
      }
    }
    setMode("new");
    setStep("details");
  };

  const reviewReady = useMemo(() => {
    if (!form.serviceSlug || !form.serviceDate || !form.serviceTime || !form.practitionerId || !form.completed) return false;
    if (form.serviceDate > maxDate) return false;
    if (mode === "existing" && !form.clientId) return false;
    if (mode === "new" && (!newClient.firstName.trim() || !newClient.lastName.trim())) return false;
    if (form.locationType !== "clinic" && mode === "existing" && !selectedAddress?.line && !addr?.line) return false;
    if (form.locationType !== "clinic" && mode === "new" && !addr?.line && !selectedAddress?.line) return false;
    return true;
  }, [form, mode, newClient, selectedAddress, addr, maxDate]);

  const save = async () => {
    setErr("");
    if (!reviewReady) {
      setErr("Complete required fields before saving.");
      return;
    }
    if (form.serviceDate > maxDate) {
      setErr("Treatment date cannot be in the future.");
      return;
    }
    setSaving(true);
    const body = {
      practitionerId: form.practitionerId,
      serviceSlug: form.serviceSlug,
      duration: Number(form.duration),
      serviceDate: form.serviceDate,
      serviceTime: form.serviceTime,
      locationType: form.locationType,
      addressId: form.locationType === "clinic" ? undefined : form.addressId || undefined,
      address: form.locationType !== "clinic" && addr?.line ? {
        ...addr,
        label: addr.label || "Service",
        purpose: form.locationType,
        manualEntry: !addr.mapboxId,
      } : undefined,
      charge: canFinance ? (form.charge === "" ? 0 : Number(form.charge)) : 0,
      paymentMethod: "self",
      selfMethod: canFinance ? form.selfMethod : undefined,
      recordedPaymentStatus: canFinance ? form.recordedPaymentStatus : "unpaid",
      adminNotes: form.adminNotes,
      completed: true,
      source: form.serviceDate === maxDate ? "on_the_spot" : "historical_manual",
      idempotencyKey: idemRef.current,
    };
    if (mode === "existing") {
      body.clientId = form.clientId;
    } else {
      body.newClient = {
        ...newClient,
        addresses: addr?.line ? [{
          ...addr,
          id: `ad-${Date.now()}`,
          label: "Home",
          purpose: "home",
          isDefault: true,
          manualEntry: !addr.mapboxId,
        }] : [],
      };
    }
    try {
      const result = await run(() => api.recordCompletedTreatment(body), "Completed treatment recorded");
      await refresh?.();
      onSaved?.(result);
      onClose?.();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg" data-testid="record-completed-treatment-dialog">
        <DialogTitle>Record completed treatment</DialogTitle>
        <p className="text-sm text-nb-mute">For treatments already delivered with no prior booking. No reminders, claims, or payment charges are sent.</p>

        {step === "client" && (
          <div className="mt-4 space-y-3" data-testid="rct-step-client">
            <p className="text-sm font-semibold">Is this an existing client or a new client?</p>
            <button type="button" className="nb-btn-primary w-full" data-testid="rct-existing" onClick={() => { setMode("existing"); setStep("search"); }}>Existing client</button>
            <button type="button" className="nb-btn-ghost w-full" data-testid="rct-new" onClick={() => { setMode("new"); setStep("create"); }}>New client</button>
          </div>
        )}

        {step === "search" && (
          <div className="mt-4 space-y-3" data-testid="rct-step-search">
            <label><span className="nb-label">Search by name, phone or email</span>
              <input className="nb-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, phone, or email" data-testid="rct-client-search" />
            </label>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {hits.map((row) => (
                <li key={row.id}>
                  <button type="button" className="nb-btn-ghost h-auto w-full justify-start px-3 py-2 text-left text-sm" data-testid={`rct-hit-${row.id}`} onClick={() => pickExisting(row)}>
                    <span className="font-semibold">{row.firstName} {row.lastName}</span>
                    <span className="ml-2 text-nb-mute">{row.phone || row.email || row.id}</span>
                  </button>
                </li>
              ))}
            </ul>
            {duplicates.length > 0 && <p className="text-xs text-amber-800" data-testid="rct-dup-hint">Possible duplicates were flagged in search results.</p>}
            <div className="flex gap-2">
              <button type="button" className="nb-btn-ghost h-10 flex-1 text-sm" onClick={() => setStep("client")}>Back</button>
              <button type="button" className="nb-btn-ghost h-10 flex-1 text-sm" data-testid="rct-switch-new" onClick={() => { setMode("new"); setStep("create"); }}>Create new instead</button>
            </div>
          </div>
        )}

        {step === "create" && (
          <div className="mt-4 space-y-3" data-testid="rct-step-create">
            <p className="text-sm text-nb-mute">Email and online account are optional.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="nb-label">First name</span><input className="nb-input" value={newClient.firstName} onChange={(e) => setNewClient({ ...newClient, firstName: e.target.value })} data-testid="rct-new-first" /></label>
              <label><span className="nb-label">Last name</span><input className="nb-input" value={newClient.lastName} onChange={(e) => setNewClient({ ...newClient, lastName: e.target.value })} data-testid="rct-new-last" /></label>
              <label><span className="nb-label">Phone</span><input className="nb-input" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} data-testid="rct-new-phone" /></label>
              <label><span className="nb-label">Email (optional)</span><input className="nb-input" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} data-testid="rct-new-email" /></label>
              <label><span className="nb-label">Date of birth</span><input type="date" className="nb-input" value={newClient.dob} onChange={(e) => setNewClient({ ...newClient, dob: e.target.value })} data-testid="rct-new-dob" /></label>
              <label><span className="nb-label">Preferred name</span><input className="nb-input" value={newClient.preferredName} onChange={(e) => setNewClient({ ...newClient, preferredName: e.target.value })} data-testid="rct-new-preferred" /></label>
            </div>
            <div className="rounded-2xl bg-sky-50/70 p-3 space-y-2">
              <p className="text-sm font-semibold">Address (optional)</p>
              <AddressPicker query={addrQuery} onQuery={setAddrQuery} value={addr} onChange={setAddr} testid="rct-new-address" />
            </div>
            {hits.length > 0 && err && (
              <ul className="space-y-1" data-testid="rct-create-dupes">
                {hits.slice(0, 5).map((row) => (
                  <li key={row.id}>
                    <button type="button" className="text-sm font-semibold text-nb-blue underline" onClick={() => { setMode("existing"); pickExisting(row); }}>
                      Use {row.firstName} {row.lastName} instead
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <button type="button" className="nb-btn-ghost h-10 flex-1 text-sm" onClick={() => setStep("client")}>Back</button>
              {hits.length > 0 && err ? (
                <button type="button" className="nb-btn-primary h-10 flex-1 text-sm" data-testid="rct-create-continue" onClick={() => continueNewClient({ force: true })}>Continue anyway</button>
              ) : (
                <button type="button" className="nb-btn-primary h-10 flex-1 text-sm" data-testid="rct-create-continue" onClick={() => continueNewClient()}>Continue</button>
              )}
            </div>
          </div>
        )}

        {step === "details" && (
          <div className="mt-4 space-y-3" data-testid="rct-step-details">
            <p className="rounded-2xl bg-sky-50/70 px-3 py-2 text-sm" data-testid="rct-client-summary">
              {mode === "new"
                ? <>New client: <b>{newClient.firstName} {newClient.lastName}</b></>
                : <>Client: <b>{client ? `${client.firstName} ${client.lastName}` : form.clientId}</b></>}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="nb-label">Practitioner</span>
                <p className="nb-input flex items-center bg-sky-50/80 text-sm font-semibold text-nb-navy">{therapistName}</p>
                <input type="hidden" value={form.practitionerId} readOnly />
              </div>
              <label><span className="nb-label">Treatment date</span>
                <input type="date" className="nb-input" max={maxDate} value={form.serviceDate} onChange={setField("serviceDate")} data-testid="rct-date" />
              </label>
              <label><span className="nb-label">Treatment time</span>
                <input type="time" className="nb-input" value={form.serviceTime} onChange={setField("serviceTime")} data-testid="rct-time" />
              </label>
              <label><span className="nb-label">Treatment type</span>
                <select className="nb-input" value={form.serviceSlug} onChange={(e) => {
                  const slug = e.target.value;
                  const svc = idx.services[slug];
                  const dur = Number(Object.keys(svc?.prices || { 60: 0 })[0] || 60);
                  setForm((prev) => ({ ...prev, serviceSlug: slug, duration: dur }));
                }} data-testid="rct-service">
                  {state.services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                </select>
              </label>
              <label><span className="nb-label">Duration</span>
                <select className="nb-input" value={form.duration} onChange={setField("duration")} data-testid="rct-duration">
                  {(durations.length ? durations : [30, 45, 60, 75, 90]).map((d) => <option key={d} value={d}>{d} min</option>)}
                </select>
              </label>
              <label><span className="nb-label">Location</span>
                <select className="nb-input" value={form.locationType} onChange={setField("locationType")} data-testid="rct-location">
                  <option value="clinic">Clinic</option>
                  <option value="home">Home / mobile</option>
                  <option value="office">Office</option>
                  <option value="hotel">Hotel</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {form.locationType !== "clinic" && mode === "existing" && addresses.length > 0 && (
                <label className="sm:col-span-2"><span className="nb-label">Saved address</span>
                  <select className="nb-input" value={form.addressId} onChange={setField("addressId")} data-testid="rct-address-select">
                    {addresses.map((a) => <option key={a.id} value={a.id}>{a.label || a.purpose || "Address"} — {a.line}</option>)}
                  </select>
                </label>
              )}
              {form.locationType !== "clinic" && (mode === "new" || !addresses.length) && (
                <div className="sm:col-span-2 space-y-2" data-testid="rct-address-manual">
                  <span className="nb-label">Treatment address</span>
                  <AddressPicker query={addrQuery} onQuery={setAddrQuery} value={addr} onChange={setAddr} testid="rct-address-picker" />
                </div>
              )}
              {canFinance && (
                <>
                  <label><span className="nb-label">Actual charge (CAD)</span>
                    <input type="number" min="0" step="0.01" className="nb-input" value={form.charge} onChange={setField("charge")} data-testid="rct-charge" />
                  </label>
                  <label><span className="nb-label">Payment method</span>
                    <select className="nb-input" value={form.selfMethod} onChange={setField("selfMethod")} data-testid="rct-pay-method">
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="etransfer">E-transfer</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="sm:col-span-2"><span className="nb-label">Payment status</span>
                    <select className="nb-input" value={form.recordedPaymentStatus} onChange={setField("recordedPaymentStatus")} data-testid="rct-pay-status">
                      <option value="paid">Paid</option>
                      <option value="unpaid">Unpaid</option>
                      <option value="partial">Partial</option>
                      <option value="waived">Waived</option>
                    </select>
                  </label>
                </>
              )}
              <label className="sm:col-span-2"><span className="nb-label">Administrative notes (optional)</span>
                <textarea className="nb-input min-h-[72px]" value={form.adminNotes} onChange={setField("adminNotes")} data-testid="rct-notes" />
              </label>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.completed} onChange={setField("completed")} data-testid="rct-completed" />
                Mark treatment as completed
              </label>
            </div>
            <div className="flex gap-2">
              <button type="button" className="nb-btn-ghost h-10 flex-1 text-sm" onClick={() => setStep(mode === "new" ? "create" : clientId ? "client" : "search")}>Back</button>
              <button type="button" className="nb-btn-primary h-10 flex-1 text-sm" disabled={!reviewReady} data-testid="rct-to-review" onClick={() => setStep("review")}>Review</button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="mt-4 space-y-3" data-testid="rct-step-review">
            <dl className="space-y-1.5 rounded-2xl bg-sky-50/70 p-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-nb-mute">Client</dt><dd className="font-semibold text-right">{mode === "new" ? `${newClient.firstName} ${newClient.lastName}` : `${client?.firstName || ""} ${client?.lastName || ""}`}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-nb-mute">Practitioner</dt><dd className="font-semibold">{therapistName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-nb-mute">When</dt><dd className="font-semibold">{fmtDate(form.serviceDate)} · {fmtTime(form.serviceTime)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-nb-mute">Treatment</dt><dd className="font-semibold text-right">{service?.name || form.serviceSlug} · {form.duration} min</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-nb-mute">Location</dt><dd className="font-semibold text-right">{form.locationType === "clinic" ? (idx.settings?.clinic?.address || "Clinic") : (selectedAddress?.line || addr?.line || "—")}</dd></div>
              {canFinance && <div className="flex justify-between gap-3"><dt className="text-nb-mute">Charge</dt><dd className="font-semibold">{form.charge === "" ? "—" : money(Number(form.charge))} · {form.recordedPaymentStatus}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-nb-mute">Source</dt><dd className="font-semibold">{form.serviceDate === maxDate ? "On the spot" : "Historical (manual)"}</dd></div>
            </dl>
            <div className="flex gap-2">
              <button type="button" className="nb-btn-ghost h-10 flex-1 text-sm" onClick={() => setStep("details")}>Back</button>
              <button type="button" className="nb-btn-primary h-10 flex-1 text-sm" disabled={saving || !form.completed} data-testid="rct-save" onClick={save}>
                {saving ? "Saving…" : "Save completed treatment"}
              </button>
            </div>
          </div>
        )}

        {err && <p className="mt-3 text-sm text-rose-700" data-testid="rct-error">{err}</p>}
        {!STEPS.includes(step) && null}
      </DialogContent>
    </Dialog>
  );
}
