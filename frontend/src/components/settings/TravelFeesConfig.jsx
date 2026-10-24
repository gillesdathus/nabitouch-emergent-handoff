import { useEffect, useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { api, apiError } from "@/lib/api";

const DEFAULT_FEES = {
  baseFee: 0,
  perKm: 0,
  freeKm: 0,
  maxFee: "",
  rounding: "cent",
  departure: { mode: "clinic", line: "", lat: null, lng: null, mapboxId: "" },
  fallbackPolicy: "manual_review",
  fallbackFixedFee: 0,
  municipalityOverrides: {},
};

function moneyInput(value) {
  if (value === "" || value == null) return "";
  return String(value);
}

export function TravelFeesConfig({
  coverage,
  onSave,
  disabled = false,
}) {
  const fees = coverage.travelFees || DEFAULT_FEES;
  const [enabled, setEnabled] = useState(!!coverage.travelFeesEnabled);
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FEES,
    ...fees,
    maxFee: fees.maxFee == null ? "" : fees.maxFee,
    departure: { ...DEFAULT_FEES.departure, ...(fees.departure || {}) },
    municipalityOverrides: { ...(fees.municipalityOverrides || {}) },
  }));
  const [estimates, setEstimates] = useState([]);
  const [estError, setEstError] = useState("");
  const [estBusy, setEstBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setEnabled(!!coverage.travelFeesEnabled);
    const next = coverage.travelFees || DEFAULT_FEES;
    setForm({
      ...DEFAULT_FEES,
      ...next,
      maxFee: next.maxFee == null ? "" : next.maxFee,
      departure: { ...DEFAULT_FEES.departure, ...(next.departure || {}) },
      municipalityOverrides: { ...(next.municipalityOverrides || {}) },
    });
    setDirty(false);
  }, [coverage.travelFeesEnabled, coverage.travelFees]);

  const selectedIds = useMemo(
    () => [...(coverage.municipalityIds || []), ...(coverage.customMunicipalities || []).map((c) => c.id)],
    [coverage.municipalityIds, coverage.customMunicipalities],
  );

  const loadEstimates = () => {
    if (!enabled) {
      setEstimates([]);
      return;
    }
    setEstBusy(true);
    setEstError("");
    api.geoTravelFeeEstimates()
      .then((body) => {
        setEstimates(body.estimates || []);
        setEstError("");
      })
      .catch((err) => setEstError(apiError(err)))
      .finally(() => setEstBusy(false));
  };

  useEffect(() => {
    loadEstimates();
    // Refresh when coverage selection or enabled flag changes from props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedIds.join("|")]);

  const patchForm = (partial) => {
    setForm((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  };

  const setOverride = (id, partial) => {
    setForm((prev) => {
      const current = { ...(prev.municipalityOverrides || {}) };
      const row = { policy: "distance", ...(current[id] || {}), ...partial };
      if (row.policy === "distance" && !partial.policy) {
        // keep
      }
      current[id] = row;
      return { ...prev, municipalityOverrides: current };
    });
    setDirty(true);
  };

  const clearOverride = (id) => {
    setForm((prev) => {
      const current = { ...(prev.municipalityOverrides || {}) };
      delete current[id];
      return { ...prev, municipalityOverrides: current };
    });
    setDirty(true);
  };

  const persist = async () => {
    setMsg("");
    const maxFee = form.maxFee === "" || form.maxFee == null ? null : Number(form.maxFee);
    const payload = {
      travelFeesEnabled: enabled,
      travelFees: {
        baseFee: Number(form.baseFee) || 0,
        perKm: Number(form.perKm) || 0,
        freeKm: Number(form.freeKm) || 0,
        maxFee: maxFee == null || Number.isNaN(maxFee) ? null : maxFee,
        rounding: form.rounding || "cent",
        departure: {
          mode: form.departure?.mode || "clinic",
          line: form.departure?.line || "",
          lat: form.departure?.lat ?? null,
          lng: form.departure?.lng ?? null,
          mapboxId: form.departure?.mapboxId || "",
        },
        fallbackPolicy: form.fallbackPolicy || "manual_review",
        fallbackFixedFee: Number(form.fallbackFixedFee) || 0,
        municipalityOverrides: form.municipalityOverrides || {},
      },
    };
    try {
      await onSave(payload);
      setDirty(false);
      setMsg("Travel fee settings saved.");
      if (enabled) loadEstimates();
    } catch (err) {
      setMsg(apiError(err));
    }
  };

  return (
    <div className="space-y-4 border-t border-sky-100 pt-4" data-testid="settings-travel-fees">
      <div>
        <p className="font-semibold">Travel fees</p>
        <p className="text-xs text-nb-mute">
          Off by default. When off, bookings charge $0 travel, hide travel rows for clients, and do not call paid routing APIs for fees.
        </p>
      </div>
      <label className="flex items-center justify-between gap-3">
        <span><b>Enable travel fees</b></span>
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(v) => { setEnabled(v); setDirty(true); }}
          data-testid="settings-travel-fees-switch"
        />
      </label>

      {enabled && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="settings-travel-fees-form">
          <label>
            <span className="nb-label">Base travel fee ($)</span>
            <input type="number" min={0} step="0.01" className="nb-input" value={moneyInput(form.baseFee)} disabled={disabled}
              data-testid="settings-travel-base" onChange={(e) => patchForm({ baseFee: e.target.value })} />
          </label>
          <label>
            <span className="nb-label">Fee per kilometre ($)</span>
            <input type="number" min={0} step="0.01" className="nb-input" value={moneyInput(form.perKm)} disabled={disabled}
              data-testid="settings-travel-per-km" onChange={(e) => patchForm({ perKm: e.target.value })} />
          </label>
          <label>
            <span className="nb-label">Free travel distance (km)</span>
            <input type="number" min={0} step="0.1" className="nb-input" value={moneyInput(form.freeKm)} disabled={disabled}
              data-testid="settings-travel-free-km" onChange={(e) => patchForm({ freeKm: e.target.value })} />
          </label>
          <label>
            <span className="nb-label">Maximum travel fee ($)</span>
            <input type="number" min={0} step="0.01" className="nb-input" placeholder="No maximum" value={moneyInput(form.maxFee)} disabled={disabled}
              data-testid="settings-travel-max" onChange={(e) => patchForm({ maxFee: e.target.value })} />
          </label>
          <label>
            <span className="nb-label">Rounding</span>
            <select className="nb-input" value={form.rounding || "cent"} disabled={disabled}
              data-testid="settings-travel-rounding" onChange={(e) => patchForm({ rounding: e.target.value })}>
              <option value="cent">Nearest cent</option>
              <option value="dollar">Nearest dollar</option>
              <option value="none">No extra rounding</option>
            </select>
          </label>
          <label>
            <span className="nb-label">Departure location</span>
            <select className="nb-input" value={form.departure?.mode || "clinic"} disabled={disabled}
              data-testid="settings-travel-departure-mode"
              onChange={(e) => patchForm({ departure: { ...form.departure, mode: e.target.value } })}>
              <option value="clinic">Clinic address (when verified)</option>
              <option value="center">Service area center</option>
              <option value="custom">Custom coordinates</option>
            </select>
          </label>
          {(form.departure?.mode || "clinic") === "custom" && (
            <>
              <label>
                <span className="nb-label">Departure latitude</span>
                <input type="number" step="0.000001" className="nb-input" value={form.departure?.lat ?? ""} disabled={disabled}
                  data-testid="settings-travel-departure-lat"
                  onChange={(e) => patchForm({ departure: { ...form.departure, lat: e.target.value === "" ? null : Number(e.target.value) } })} />
              </label>
              <label>
                <span className="nb-label">Departure longitude</span>
                <input type="number" step="0.000001" className="nb-input" value={form.departure?.lng ?? ""} disabled={disabled}
                  data-testid="settings-travel-departure-lng"
                  onChange={(e) => patchForm({ departure: { ...form.departure, lng: e.target.value === "" ? null : Number(e.target.value) } })} />
              </label>
            </>
          )}
          <label className="sm:col-span-2">
            <span className="nb-label">If driving route is unavailable</span>
            <select className="nb-input" value={form.fallbackPolicy || "manual_review"} disabled={disabled}
              data-testid="settings-travel-fallback" onChange={(e) => patchForm({ fallbackPolicy: e.target.value })}>
              <option value="manual_review">Require review (do not invent a fee)</option>
              <option value="zero">Charge $0</option>
              <option value="fixed">Use fallback fixed fee</option>
            </select>
          </label>
          {form.fallbackPolicy === "fixed" && (
            <label>
              <span className="nb-label">Fallback fixed fee ($)</span>
              <input type="number" min={0} step="0.01" className="nb-input" value={moneyInput(form.fallbackFixedFee)} disabled={disabled}
                data-testid="settings-travel-fallback-fee" onChange={(e) => patchForm({ fallbackFixedFee: e.target.value })} />
            </label>
          )}
        </div>
      )}

      {enabled && (
        <div className="space-y-2" data-testid="settings-travel-estimates">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Municipality estimates</p>
              <p className="text-[11px] text-nb-mute">Driving-route estimates to a representative location — not guaranteed charges.</p>
            </div>
            <button type="button" className="nb-btn-ghost h-9 px-4 text-xs" data-testid="settings-travel-estimates-refresh" onClick={loadEstimates} disabled={disabled || estBusy}>
              {estBusy ? "Routing…" : "Refresh estimates"}
            </button>
          </div>
          {estError && <p className="text-xs text-rose-700" data-testid="settings-travel-estimates-error">{estError}</p>}
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(estimates.length ? estimates : selectedIds.map((id) => ({ municipalityId: id, name: id, status: "pending" }))).map((row) => {
              const id = row.municipalityId;
              const ov = (form.municipalityOverrides || {})[id] || { policy: "distance" };
              return (
                <div key={id} className="rounded-2xl border border-sky-100 p-3 text-sm" data-testid={`settings-travel-estimate-${id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <b>{row.name || id}</b>
                      <p className="text-[11px] text-nb-mute">
                        {row.covered === false ? "Not covered" : "Covered"} ·{" "}
                        {row.status === "ok" ? `Est. ${row.drivingKm} km · $${Number(row.estimate).toFixed(2)}` : row.status === "unavailable" ? "Estimate unavailable" : row.status === "disabled" ? "Fees off" : "—"}
                      </p>
                      <p className="text-[11px] text-nb-mute">{row.disclaimer || "Estimate only"}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label>
                      <span className="nb-label">Override</span>
                      <select
                        className="nb-input"
                        value={ov.policy || "distance"}
                        disabled={disabled}
                        data-testid={`settings-travel-override-policy-${id}`}
                        onChange={(e) => {
                          const policy = e.target.value;
                          if (policy === "distance") clearOverride(id);
                          else setOverride(id, { policy });
                        }}
                      >
                        <option value="distance">Use global distance rules</option>
                        <option value="fixed">Fixed municipality fee</option>
                        <option value="custom_rate">Custom distance rate</option>
                        <option value="free">Free travel</option>
                      </select>
                    </label>
                    {ov.policy === "fixed" && (
                      <label>
                        <span className="nb-label">Fixed fee ($)</span>
                        <input type="number" min={0} step="0.01" className="nb-input" value={ov.fixedFee ?? 0} disabled={disabled}
                          data-testid={`settings-travel-override-fixed-${id}`}
                          onChange={(e) => setOverride(id, { policy: "fixed", fixedFee: Number(e.target.value) || 0 })} />
                      </label>
                    )}
                    {ov.policy === "custom_rate" && (
                      <>
                        <label>
                          <span className="nb-label">Base ($)</span>
                          <input type="number" min={0} step="0.01" className="nb-input" value={ov.baseFee ?? form.baseFee} disabled={disabled}
                            data-testid={`settings-travel-override-base-${id}`}
                            onChange={(e) => setOverride(id, { policy: "custom_rate", baseFee: Number(e.target.value) || 0 })} />
                        </label>
                        <label>
                          <span className="nb-label">Per km ($)</span>
                          <input type="number" min={0} step="0.01" className="nb-input" value={ov.perKm ?? form.perKm} disabled={disabled}
                            data-testid={`settings-travel-override-perkm-${id}`}
                            onChange={(e) => setOverride(id, { policy: "custom_rate", perKm: Number(e.target.value) || 0 })} />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {!selectedIds.length && (
              <p className="text-xs text-nb-mute" data-testid="settings-travel-estimates-empty">
                Select municipalities under Locations to see per-municipality estimates and overrides.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="nb-btn-primary h-11 px-5 text-sm"
          data-testid="settings-travel-fees-save"
          disabled={disabled || !dirty}
          onClick={persist}
        >
          Save travel fees
        </button>
        {msg ? <p className="text-xs text-nb-mute" data-testid="settings-travel-fees-msg">{msg}</p> : null}
      </div>
    </div>
  );
}
