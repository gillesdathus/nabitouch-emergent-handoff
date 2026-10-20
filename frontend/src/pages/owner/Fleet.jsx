import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, Car, History, Plus, Search, UserRound } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { restrictedFlag } from "@/lib/feature-flags";
import { EmptyState, Notice, Reveal, SaveFeedback, StatusBadge } from "@/components/tide";
import { ShieldChrome } from "@/components/shield/ShieldChrome";

const BLANK = {
  vin: "", make: "", model: "", year: "", trim: "", color: "", licensePlate: "",
  registrationJurisdiction: "AB", description: "", status: "active", unavailableReason: "",
};

function statusTone(status) {
  if (status === "active") return "success";
  if (status === "unavailable") return "warn";
  return "neutral";
}

export function VehicleForm({ initial, onSaved, onCancel, navigateOnCreate }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...BLANK, ...initial });
  const [busy, setBusy] = useState(false);
  const [decodeNote, setDecodeNote] = useState("");
  const [feedback, setFeedback] = useState({ state: "idle", message: "" });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const decode = async () => {
    setBusy(true);
    setDecodeNote("");
    try {
      const result = await api.fleetVinDecode(form.vin);
      if (result.ok) {
        setForm((f) => ({
          ...f,
          vin: result.vin || f.vin,
          make: f.make || result.make || "",
          model: f.model || result.model || "",
          year: f.year || result.year || "",
          trim: f.trim || result.trim || "",
        }));
        setDecodeNote(result.note || "Specs filled from VIN. Colour and plate are entered manually.");
      } else {
        setDecodeNote(result.error || "VIN lookup failed. Enter details manually.");
      }
    } catch (err) {
      setDecodeNote(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    if (!form.make?.trim() || !form.model?.trim() || !form.licensePlate?.trim()) {
      setFeedback({ state: "error", message: "Make, model, and license plate are required." });
      return;
    }
    setBusy(true);
    setFeedback({ state: "saving", message: "Saving vehicle…" });
    try {
      const body = {
        ...form,
        year: form.year === "" ? null : Number(form.year),
        applyVinDecode: false,
        manualOverride: true,
      };
      const saved = initial?.id
        ? await api.fleetUpdateVehicle(initial.id, body)
        : await api.fleetCreateVehicle({ ...body, applyVinDecode: Boolean(form.vin) });
      const vehicle = saved?.vehicle || saved;
      setFeedback({ state: "success", message: initial?.id ? "Vehicle saved." : "Vehicle added." });
      toast.success(initial?.id ? "Vehicle saved" : "Vehicle added");
      if (!initial?.id && navigateOnCreate && vehicle?.id) {
        navigate(`/owner/fleet/${vehicle.id}`, { replace: true });
        return;
      }
      onSaved?.(vehicle);
    } catch (err) {
      setFeedback({ state: "error", message: apiError(err) });
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nb-card space-y-3 p-5" data-testid="fleet-vehicle-form">
      <p className="font-semibold">{initial?.id ? "Edit vehicle" : "Add vehicle"}</p>
      <p className="text-xs text-nb-mute">VIN decode fills make, model, year, and trim when available. Colour, plate, insurance, and registration are never provided by VIN lookup.</p>
      <SaveFeedback state={feedback.state} message={feedback.message} testid="fleet-save-feedback" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs sm:col-span-2"><span className="mb-1 block text-nb-mute">VIN</span>
          <div className="flex gap-2">
            <input className="nb-input h-10 flex-1 font-mono uppercase" value={form.vin} onChange={set("vin")} maxLength={17} data-testid="fleet-vin" />
            <button type="button" disabled={busy || !form.vin} onClick={decode} className="nb-btn-ghost h-10 shrink-0 px-3 text-sm" data-testid="fleet-vin-decode">Decode</button>
          </div>
        </label>
        {decodeNote && <p className="text-xs text-nb-mute sm:col-span-2" data-testid="fleet-vin-note">{decodeNote}</p>}
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Make</span><input className="nb-input h-10" value={form.make} onChange={set("make")} data-testid="fleet-make" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Model</span><input className="nb-input h-10" value={form.model} onChange={set("model")} data-testid="fleet-model" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Year</span><input className="nb-input h-10" inputMode="numeric" value={form.year} onChange={set("year")} data-testid="fleet-year" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Trim</span><input className="nb-input h-10" value={form.trim} onChange={set("trim")} data-testid="fleet-trim" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Colour</span><input className="nb-input h-10" value={form.color} onChange={set("color")} data-testid="fleet-color" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">License plate</span><input className="nb-input h-10 uppercase" value={form.licensePlate} onChange={set("licensePlate")} data-testid="fleet-plate" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Registration jurisdiction</span><input className="nb-input h-10" value={form.registrationJurisdiction} onChange={set("registrationJurisdiction")} data-testid="fleet-jurisdiction" /></label>
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Status</span>
          <select className="nb-input h-10" value={form.status} onChange={set("status")} data-testid="fleet-status">
            <option value="active">Active</option>
            <option value="unavailable">Unavailable</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        {form.status === "unavailable" && (
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-nb-mute">Unavailable reason</span>
            <input className="nb-input h-10" value={form.unavailableReason} onChange={set("unavailableReason")} data-testid="fleet-unavailable-reason" />
          </label>
        )}
        <label className="text-xs sm:col-span-2"><span className="mb-1 block text-nb-mute">Vehicle description</span>
          <textarea className="nb-input min-h-[72px] py-2" value={form.description} onChange={set("description")} data-testid="fleet-description" />
        </label>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" disabled={busy} onClick={save} className="nb-btn-primary h-11 flex-1" data-testid="fleet-save">{busy ? "Saving…" : "Save vehicle"}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="nb-btn-ghost h-11 px-4" data-testid="fleet-cancel">Cancel</button>
      </div>
    </div>
  );
}

function AssignPanel({ vehicle, practitioners, onDone }) {
  const [practitionerId, setPractitionerId] = useState(vehicle.assignment?.practitionerId || "");
  const [kind, setKind] = useState("primary");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy || !practitionerId) return;
    setBusy(true);
    try {
      await api.fleetAssignVehicle(vehicle.id, { practitionerId, kind, note });
      toast.success(kind === "temporary" ? "Temporary assignment saved" : "Primary vehicle assigned");
      onDone();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3" data-testid={`fleet-assign-${vehicle.id}`}>
      <p className="text-xs font-semibold">Assign practitioner</p>
      <select className="nb-input h-10 w-full text-sm" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)} data-testid="fleet-assign-practitioner">
        <option value="">Choose practitioner</option>
        {(practitioners || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="flex flex-wrap gap-2">
        {[["primary", "Primary"], ["temporary", "Temporary"]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={kind === k ? "nb-chip-on h-8 text-xs" : "nb-chip-off h-8 text-xs"} data-testid={`fleet-assign-kind-${k}`}>{label}</button>
        ))}
      </div>
      <input className="nb-input h-10 w-full text-sm" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="fleet-assign-note" />
      <button type="button" disabled={busy || !practitionerId} onClick={save} className="nb-btn-primary h-10 w-full text-sm" data-testid="fleet-assign-save">{busy ? "Saving…" : "Save assignment"}</button>
    </div>
  );
}

function HistoryPanel({ vehicleId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.fleetAssignmentHistory(vehicleId).then((r) => setRows(r.assignments || [])).catch(() => setRows([]));
  }, [vehicleId]);
  if (!rows) return <p className="mt-2 text-xs text-nb-mute">Loading history…</p>;
  if (!rows.length) return <p className="mt-2 text-xs text-nb-mute">No assignments yet.</p>;
  return (
    <ul className="mt-2 space-y-2" data-testid={`fleet-history-${vehicleId}`}>
      {rows.map((row) => (
        <li key={row.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
          <p className="font-semibold">{row.kind} · {row.practitionerId}</p>
          <p className="text-nb-mute">From {row.effectiveFrom}{row.endedAt ? ` · ended ${new Date(row.endedAt).toLocaleString("en-CA", { timeZone: "America/Edmonton" })}` : " · active"}{row.endReason ? ` · ${row.endReason}` : ""}</p>
        </li>
      ))}
    </ul>
  );
}

function VehicleDocs({ vehicleId }) {
  const { idx } = useDemo();
  const docsOn = restrictedFlag(idx?.settings, "securityShieldDocsEnabled");
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ docType: "vehicle_insurance", provider: "", policyReference: "", expiresOn: "", jurisdiction: "AB", licensePlate: "" });
  useEffect(() => {
    if (!docsOn) return;
    api.shieldVehicleDocuments(vehicleId).then((r) => setRows(r.documents || [])).catch(() => setRows([]));
  }, [vehicleId, docsOn]);
  if (!docsOn) {
    return <p className="mt-3 text-[11px] text-nb-mute">Vehicle insurance and registration stay off until Security Shield documents are enabled.</p>;
  }
  const save = async () => {
    try {
      await api.shieldUpsertVehicleDocument(vehicleId, form);
      toast.success("Document saved for review");
      const r = await api.shieldVehicleDocuments(vehicleId);
      setRows(r.documents || []);
    } catch (err) {
      toast.error(apiError(err));
    }
  };
  const decide = async (id, approve) => {
    const reason = approve ? undefined : window.prompt("Rejection reason") || "";
    if (!approve && !reason) return;
    try {
      await api.shieldVerifyVehicleDocument(id, { approve, reason });
      toast.success(approve ? "Verified" : "Rejected");
      const r = await api.shieldVehicleDocuments(vehicleId);
      setRows(r.documents || []);
    } catch (err) {
      toast.error(apiError(err));
    }
  };
  return (
    <div className="mt-3 space-y-2 border-t border-sky-100 pt-3" data-testid={`fleet-docs-${vehicleId}`}>
      <p className="text-xs font-semibold">Insurance & registration (auto — not professional liability)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="nb-input h-9 text-sm" value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
          <option value="vehicle_insurance">Auto insurance</option>
          <option value="vehicle_registration">Registration</option>
        </select>
        <input className="nb-input h-9 text-sm" placeholder="Provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
        <input className="nb-input h-9 text-sm" placeholder="Policy / ref" value={form.policyReference} onChange={(e) => setForm({ ...form, policyReference: e.target.value })} />
        <input className="nb-input h-9 text-sm" type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
      </div>
      <button type="button" onClick={save} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`fleet-docs-save-${vehicleId}`}>Save document</button>
      {(rows || []).map((row) => (
        <div key={row.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
          <p className="font-semibold">{row.docType.replace(/_/g, " ")} · {row.dashboardStatus.replace(/_/g, " ")}</p>
          <p className="text-nb-mute">{row.provider || "—"} · expires {row.expiresOn || "missing"}</p>
          {row.status === "pending_review" && (
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => decide(row.id, true)} className="nb-chip-on h-7 text-[10px]">Approve</button>
              <button type="button" onClick={() => decide(row.id, false)} className="nb-chip-off h-7 text-[10px]">Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function VehicleCard({ vehicle, practitioners }) {
  const person = practitioners.find((p) => p.id === vehicle.assignment?.practitionerId);
  return (
    <Link to={`/owner/fleet/${vehicle.id}`} className="nb-card block p-5 transition-colors hover:bg-sky-50/60" data-testid={`fleet-vehicle-${vehicle.id}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl tint-lagoon text-nb-blue"><Car className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold" data-testid={`fleet-vehicle-label-${vehicle.id}`}>{vehicle.label}</p>
            <StatusBadge tone={statusTone(vehicle.status)}>{vehicle.status}</StatusBadge>
          </div>
          <p className="mt-1 text-xs text-nb-mute">
            {vehicle.licensePlate ? `Plate ${vehicle.licensePlate}` : "No plate on file"}
            {vehicle.vin ? ` · VIN …${String(vehicle.vin).slice(-4)}` : ""}
            {vehicle.registrationJurisdiction ? ` · ${vehicle.registrationJurisdiction}` : ""}
          </p>
          {person && <p className="mt-1 flex items-center gap-1 text-xs text-nb-ink"><UserRound className="h-3.5 w-3.5" />{person.name} · {vehicle.assignment?.kind || "assigned"}</p>}
          {!person && <p className="mt-1 text-xs text-nb-mute">Not assigned</p>}
        </div>
      </div>
    </Link>
  );
}

function FleetOff() {
  return (
    <ShieldChrome title="Fleet" sub="Vehicle registry for mobile visit identification." testid="fleet-page-off">
      <Notice testid="fleet-flag-off">Security Shield fleet is turned off in this environment (SECURITY_SHIELD_FLEET_ENABLED). Clinical document uploads stay separate and remain off.</Notice>
    </ShieldChrome>
  );
}

export function FleetNew() {
  const { idx } = useDemo();
  const navigate = useNavigate();
  const enabled = restrictedFlag(idx?.settings, "securityShieldFleetEnabled");
  if (!enabled) return <FleetOff />;
  return (
    <ShieldChrome title="Add vehicle" sub="Identify the car or van used for mobile visits. Clients later see make, colour, and plate — never VIN or documents." testid="fleet-new-page">
      <VehicleForm navigateOnCreate onCancel={() => navigate("/owner/fleet")} onSaved={() => navigate("/owner/fleet")} />
    </ShieldChrome>
  );
}

export function FleetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, idx } = useDemo();
  const enabled = restrictedFlag(idx?.settings, "securityShieldFleetEnabled");
  const practitioners = state.practitioners || [];
  const [vehicle, setVehicle] = useState(undefined);
  const [edit, setEdit] = useState(false);
  const [assign, setAssign] = useState(false);
  const [history, setHistory] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    if (!enabled || !id) return Promise.resolve();
    return api.fleetVehicle(id)
      .then((r) => setVehicle(r.vehicle || r))
      .catch((err) => {
        setVehicle(null);
        toast.error(apiError(err));
      });
  }, [enabled, id]);

  useEffect(() => { load(); }, [load]);

  if (!enabled) return <FleetOff />;
  if (vehicle === undefined) {
    return <ShieldChrome title="Vehicle" testid="fleet-detail-loading"><p className="text-sm text-nb-mute">Loading vehicle…</p></ShieldChrome>;
  }
  if (!vehicle) {
    return (
      <ShieldChrome title="Vehicle" testid="fleet-detail-missing">
        <EmptyState title="Vehicle not found" body="It may have been archived or the link is out of date." action={<Link to="/owner/fleet" className="nb-btn-primary h-11 px-5">Back to fleet</Link>} />
      </ShieldChrome>
    );
  }

  const person = practitioners.find((p) => p.id === vehicle.assignment?.practitionerId);

  const archive = async () => {
    if (!window.confirm("Archive this vehicle? Active assignments will end.")) return;
    try {
      await api.fleetArchiveVehicle(vehicle.id);
      toast.success("Vehicle archived");
      navigate("/owner/fleet");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await api.fleetAddPhoto(vehicle.id, file);
      toast.success("Vehicle photo added");
      await load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setUploading(false);
    }
  };

  if (edit) {
    return (
      <ShieldChrome title="Edit vehicle" testid="fleet-detail-edit">
        <VehicleForm
          initial={vehicle}
          onCancel={() => setEdit(false)}
          onSaved={() => { setEdit(false); load(); }}
        />
      </ShieldChrome>
    );
  }

  return (
    <ShieldChrome
      title={vehicle.label || "Vehicle"}
      sub="Registry detail for Track Visit identity. Dispatch stays under Manage → Dispatch."
      right={<Link to="/owner/fleet" className="nb-btn-ghost h-10 px-3 text-sm" data-testid="fleet-back">Back</Link>}
      testid="fleet-detail-page"
    >
      <div className="nb-card p-5" data-testid={`fleet-vehicle-${vehicle.id}`}>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl tint-lagoon text-nb-blue"><Car className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold" data-testid={`fleet-vehicle-label-${vehicle.id}`}>{vehicle.label}</p>
              <StatusBadge tone={statusTone(vehicle.status)}>{vehicle.status}</StatusBadge>
            </div>
            <p className="mt-1 text-xs text-nb-mute">
              {vehicle.licensePlate ? `Plate ${vehicle.licensePlate}` : "No plate on file"}
              {vehicle.vin ? ` · VIN …${String(vehicle.vin).slice(-4)}` : ""}
              {vehicle.registrationJurisdiction ? ` · ${vehicle.registrationJurisdiction}` : ""}
            </p>
            {person && <p className="mt-1 flex items-center gap-1 text-xs text-nb-ink"><UserRound className="h-3.5 w-3.5" />{person.name} · {vehicle.assignment?.kind || "assigned"}</p>}
            {!person && <p className="mt-1 text-xs text-nb-mute">Not assigned</p>}
            {vehicle.description && <p className="mt-2 text-sm">{vehicle.description}</p>}
            {(vehicle.photos || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {vehicle.photos.map((photo) => (
                  <img key={photo.id} src={api.fleetPhotoUrl(photo.id)} alt={photo.caption || "Vehicle"} className="h-16 w-24 rounded-xl object-cover" data-testid={`fleet-photo-${photo.id}`} />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-sky-100 pt-3">
          <button type="button" onClick={() => setEdit(true)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`fleet-edit-${vehicle.id}`}>Edit</button>
          <button type="button" onClick={() => setAssign((v) => !v)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`fleet-open-assign-${vehicle.id}`}>Assign</button>
          <button type="button" onClick={() => setHistory((v) => !v)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`fleet-open-history-${vehicle.id}`}><History className="mr-1 inline h-3.5 w-3.5" />History</button>
          <label className="nb-btn-ghost h-9 cursor-pointer px-3 text-xs">
            {uploading ? "Uploading…" : "Add photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={onPhoto} data-testid={`fleet-photo-input-${vehicle.id}`} />
          </label>
          {vehicle.status !== "archived" && (
            <button type="button" onClick={archive} className="nb-btn-ghost h-9 px-3 text-xs text-rose-700" data-testid={`fleet-archive-${vehicle.id}`}><Archive className="mr-1 inline h-3.5 w-3.5" />Archive</button>
          )}
        </div>
        {assign && <AssignPanel vehicle={vehicle} practitioners={practitioners} onDone={() => { setAssign(false); load(); }} />}
        {history && <HistoryPanel vehicleId={vehicle.id} />}
        <VehicleDocs vehicleId={vehicle.id} />
      </div>
    </ShieldChrome>
  );
}

export default function Fleet() {
  const { state, idx } = useDemo();
  const enabled = restrictedFlag(idx?.settings, "securityShieldFleetEnabled");
  const [vehicles, setVehicles] = useState(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState("");
  const practitioners = state.practitioners || [];

  const load = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return api.fleetVehicles(showArchived)
      .then((r) => setVehicles(r.vehicles || []))
      .catch((err) => {
        setVehicles([]);
        toast.error(apiError(err));
      });
  }, [enabled, showArchived]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const list = vehicles || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((v) => [v.label, v.licensePlate, v.vin, v.color, v.make, v.model].join(" ").toLowerCase().includes(needle));
  }, [vehicles, q]);

  if (!enabled) return <FleetOff />;

  const empty = vehicles && vehicles.length === 0;
  const noMatch = vehicles && vehicles.length > 0 && filtered.length === 0;

  return (
    <ShieldChrome
      title="Fleet"
      sub="Add vehicles, assign them to practitioners, and keep identity details accurate for Track Visit."
      right={!empty ? (
        <Link to="/owner/fleet/new" className="nb-btn-primary inline-flex h-10 items-center px-4 text-sm" data-testid="fleet-add">
          <Plus className="mr-1 inline h-4 w-4" />Add vehicle
        </Link>
      ) : undefined}
      testid="fleet-page"
    >
      <Notice testid="fleet-vs-live">
        Dispatch under Manage shows trips on the road. This page is the vehicle registry only.
      </Notice>

      {vehicles === undefined && <p className="text-sm text-nb-mute">Loading fleet…</p>}

      {empty && (
        <EmptyState
          icon={Car}
          title="No vehicles yet"
          body="Add the cars and vans practitioners use for mobile visits. Clients will later see make, colour, and plate on Track Visit — never VIN or documents."
          action={(
            <Link to="/owner/fleet/new" className="nb-btn-primary inline-flex h-11 items-center px-5" data-testid="fleet-add">
              <Plus className="mr-1 h-4 w-4" />Add vehicle
            </Link>
          )}
          testid="fleet-empty"
        />
      )}

      {!empty && vehicles && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nb-mute" />
              <input className="nb-input h-10 w-full pl-9 text-sm" placeholder="Search plate, make, colour…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="fleet-search" />
            </label>
            <button type="button" onClick={() => setShowArchived((v) => !v)} className={showArchived ? "nb-chip-on h-10 text-xs" : "nb-chip-off h-10 text-xs"} data-testid="fleet-toggle-archived">
              {showArchived ? "Hiding archived" : "Show archived"}
            </button>
          </div>
          {noMatch && (
            <EmptyState
              title="No vehicles match"
              body="Clear the search or show archived vehicles."
              testid="fleet-search-empty"
            />
          )}
          <div className="space-y-3">
            {filtered.map((vehicle) => (
              <Reveal key={vehicle.id}>
                <VehicleCard vehicle={vehicle} practitioners={practitioners} />
              </Reveal>
            ))}
          </div>
        </>
      )}
    </ShieldChrome>
  );
}
