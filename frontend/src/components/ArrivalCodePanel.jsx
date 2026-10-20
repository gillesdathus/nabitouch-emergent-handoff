import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { restrictedFlag } from "@/lib/feature-flags";
import { useDemo } from "@/store/DemoStore";

/** Client display of the appointment arrival verification code. */
export function ClientArrivalCode({ apptId }) {
  const { idx } = useDemo();
  const enabled = restrictedFlag(idx?.settings, "securityShieldArrivalCodeEnabled");
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled || !apptId) return;
    api.shieldArrivalCode(apptId).then(setData).catch(() => setData(null));
  }, [enabled, apptId]);
  if (!enabled || !data?.issued) return null;
  return (
    <section className="nb-card space-y-2 p-5" data-testid="client-arrival-code">
      <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-nb-teal" />Arrival verification code</p>
      {data.code && <p className="nb-num text-3xl font-semibold tracking-[0.35em]" data-testid="client-arrival-code-value">{data.code}</p>}
      {data.verified && <p className="text-sm text-teal-700">Already verified for this visit.</p>}
      <p className="text-xs text-nb-mute" data-testid="client-arrival-code-guidance">{data.guidance}</p>
      <p className="text-[11px] text-nb-mute">{data.disclaimer}</p>
    </section>
  );
}

/** Practitioner entry of the client-provided code after arrival. */
export function PractitionerArrivalVerify({ appt, onVerified }) {
  const { idx } = useDemo();
  const enabled = restrictedFlag(idx?.settings, "securityShieldArrivalCodeEnabled");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.shieldArrivalStatus(appt.id).then(setStatus).catch(() => setStatus(null));
  useEffect(() => { if (enabled) load(); }, [enabled, appt.id, appt.status]); // eslint-disable-line
  if (!enabled) return null;
  if (status?.verified) {
    return <p className="rounded-2xl bg-teal-50 p-3 text-sm text-teal-800" data-testid="arrival-verified">Client verification succeeded. You may start treatment.</p>;
  }
  if (!["arrived", "en_route"].includes(appt.status)) return null;
  const verify = async () => {
    setBusy(true);
    try {
      await api.shieldVerifyArrivalCode(appt.id, code);
      toast.success("Client verified");
      setCode("");
      load();
      onVerified?.();
    } catch (e) {
      toast.error(apiError(e));
      load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="nb-card space-y-3 p-4" data-testid="arrival-verify-panel">
      <p className="font-semibold">Visit verification</p>
      <p className="text-xs text-nb-mute">Ask the client for their arrival code in person after you check identity and vehicle. The code is not shown here.</p>
      {status?.locked && <p className="text-xs text-rose-700">Too many attempts. Ask the office for an authorized fallback.</p>}
      <div className="flex gap-2">
        <input className="nb-input h-12 flex-1 text-center text-lg tracking-[0.3em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} data-testid="arrival-code-input" placeholder="••••••" />
        <button type="button" disabled={busy || code.length < 4 || status?.locked} onClick={verify} className="nb-btn-primary h-12 px-5" data-testid="arrival-code-verify">{busy ? "…" : "Verify"}</button>
      </div>
    </section>
  );
}

/** Client-facing assigned vehicle identity on Track Visit. */
export function TrackVisitVehicle({ appt, practitioner }) {
  const vehicle = appt?.vehiclePublic;
  if (!vehicle?.id) {
    return (
      <section className="nb-card p-5" data-testid="track-vehicle-unavailable">
        <p className="font-semibold">Assigned vehicle</p>
        <p className="mt-1 text-sm text-nb-mute">Vehicle details are not available for this visit yet.</p>
      </section>
    );
  }
  return (
    <section className="nb-card space-y-2 p-5" data-testid="track-vehicle-card">
      <p className="font-semibold">Assigned vehicle</p>
      <p className="text-sm" data-testid="track-vehicle-label">{vehicle.label}</p>
      <p className="text-xs text-nb-mute">
        {vehicle.color ? `${vehicle.color} · ` : ""}
        {vehicle.licensePlate ? `Plate ${vehicle.licensePlate}` : "Plate not listed"}
        {practitioner?.name ? ` · with ${practitioner.name}` : ""}
      </p>
      {(vehicle.photoIds || []).length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {vehicle.photoIds.map((id) => (
            <img key={id} src={api.fleetPhotoUrl(id, appt.id)} alt="Assigned vehicle" className="h-20 w-28 rounded-xl object-cover" data-testid={`track-vehicle-photo-${id}`} />
          ))}
        </div>
      )}
    </section>
  );
}
