import { useEffect, useState } from "react";
import { Car } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { restrictedFlag } from "@/lib/feature-flags";
import { useDemo } from "@/store/DemoStore";
import { Notice, PageHeader } from "@/components/tide";

export default function MyVehicle() {
  const { idx } = useDemo();
  const enabled = restrictedFlag(idx?.settings, "securityShieldFleetEnabled");
  const [data, setData] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    api.fleetMine()
      .then(setData)
      .catch((err) => {
        setError(apiError(err));
        setData(null);
      });
  }, [enabled]);

  if (!enabled) {
    return (
      <div className="mx-auto max-w-lg space-y-6" data-testid="my-vehicle-off">
        <PageHeader eyebrow="Security Shield" title="My vehicle" />
        <Notice>Security Shield fleet is not enabled in this environment.</Notice>
      </div>
    );
  }

  const vehicle = data?.vehicle;
  const unavailable = data?.unavailable;

  return (
    <div className="mx-auto max-w-lg space-y-6" data-testid="my-vehicle-page">
      <PageHeader
        eyebrow="Security Shield"
        title="My vehicle"
        sub="The vehicle clients should look for on Track Visit. Ask the owner to update assignment or photos."
      />
      {error && <Notice testid="my-vehicle-error">{error}</Notice>}
      {data === undefined && !error && <p className="text-sm text-nb-mute">Loading…</p>}
      {data && unavailable && !vehicle && (
        <Notice testid="my-vehicle-none">No vehicle is assigned to you yet. The owner assigns vehicles from Security Shield → Fleet.</Notice>
      )}
      {vehicle && (
        <div className="nb-card p-5" data-testid="my-vehicle-card">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl tint-lagoon text-nb-blue"><Car className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold" data-testid="my-vehicle-label">{vehicle.label}</p>
              <p className="mt-1 text-xs text-nb-mute">
                {vehicle.licensePlate ? `Plate ${vehicle.licensePlate}` : "Plate not on file"}
                {vehicle.color ? ` · ${vehicle.color}` : ""}
                {data.assignment?.kind ? ` · ${data.assignment.kind}` : ""}
              </p>
              {unavailable && <p className="mt-2 text-xs text-amber-800" data-testid="my-vehicle-unavailable">This vehicle is marked {data.reason || "unavailable"} for operational use.</p>}
              {vehicle.description && <p className="mt-3 text-sm">{vehicle.description}</p>}
            </div>
          </div>
          {(vehicle.photos || []).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {vehicle.photos.map((photo) => (
                <img key={photo.id} src={api.fleetPhotoUrl(photo.id)} alt={photo.caption || "Assigned vehicle"} className="h-24 w-36 rounded-xl object-cover" />
              ))}
            </div>
          )}
          <p className="mt-4 text-[11px] text-nb-mute">Driver’s licence and auto insurance documents will appear here in a later Security Shield stage. Professional liability insurance stays under your profile credentials.</p>
        </div>
      )}
    </div>
  );
}
