import { useEffect, useState } from "react";
import { Crosshair, Loader2, MapPin, CheckCircle2, AlertCircle } from "lucide-react";
import { money } from "@/lib/domain";
import { api, apiError } from "@/lib/api";

// Address suggestions come from the API. The server decides the zone and the travel fee.
export function AddressPicker({ value, onChange, query, onQuery, testid = "address", purpose = "visit" }) {
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState(value?.unit || "");
  const [postal, setPostal] = useState(value?.postal || "");
  const q = query ?? "";
  const clinic = purpose === "clinic";

  useEffect(() => {
    if (!open || q.trim().length < 3) {
      setMatches([]);
      return undefined;
    }
    let stopped = false;
    const handle = setTimeout(() => {
      api.geoSuggest(q.trim()).then((body) => { if (!stopped) { setMatches(body.suggestions || []); setError(""); } }).catch((err) => { if (!stopped) { setMatches([]); setError(apiError(err)); } });
    }, 250);
    return () => { stopped = true; clearTimeout(handle); };
  }, [q, open]);

  const apply = async (body) => {
    setChecking(true);
    setError("");
    try {
      if (clinic) {
        if (!body.mapboxId) {
          setError("Choose an address suggestion before confirming the clinic.");
          onChange(null);
          return;
        }
        const checked = await api.geoClinicConfirm({ line: body.line, mapboxId: body.mapboxId, postal, clientConfirmed: false });
        onChange({ line: checked.line, mapboxId: checked.mapboxId, postal, clientConfirmed: false, confidence: checked.confidence });
        onQuery(checked.line);
        setVerdict(null);
        return;
      }
      const checked = await api.geoCheck(body);
      setVerdict(checked);
      if (!checked.eligible) {
        onChange(null);
        return;
      }
      onChange({
        line: checked.line, unit, lat: checked.lat, lng: checked.lng, area: checked.area,
        mapboxId: checked.mapboxId, zoneId: checked.zone?.id, travelFee: checked.travel, quoted: true,
        clientConfirmed: false, postal,
      });
      onQuery(checked.line);
    } catch (err) {
      setVerdict(null);
      onChange(null);
      setError(apiError(err));
    } finally {
      setChecking(false);
      setOpen(false);
    }
  };

  const confirmServiceAddress = async () => {
    if (!value?.line) return;
    setChecking(true);
    setError("");
    try {
      if (clinic) {
        const checked = await api.geoClinicConfirm({ line: value.line, mapboxId: value.mapboxId, postal, clientConfirmed: true });
        if (!checked.accepted) {
          onChange({ ...value, postal, clientConfirmed: false });
          setError("This address needs review before the clinic location can be saved.");
          return;
        }
        onChange({ ...value, line: checked.line, lat: checked.lat, lng: checked.lng, mapboxId: checked.mapboxId, postal, clientConfirmed: true, confidence: checked.confidence });
        onQuery(checked.line);
        return;
      }
      const checked = await api.geoConfirm({ line: value.line, mapboxId: value.mapboxId, postal, unit, clientConfirmed: true });
      const approximate = checked.confidence && checked.confidence !== "address";
      if (!checked.accepted || approximate) {
        onChange({ ...value, unit, postal, clientConfirmed: false, confidence: checked.confidence });
        setError(approximate
          ? "This result is approximate, so it is not a verified civic address. Correct it or ask Nabitouch to review it before a mobile visit."
          : "Confirm a complete civic address before a mobile visit can be booked.");
        return;
      }
      onChange({
        ...value, line: checked.line, unit, lat: checked.lat, lng: checked.lng,
        mapboxId: checked.mapboxId || value.mapboxId, postal: checked.postalNormalized || postal,
        clientConfirmed: true, confidence: checked.confidence, travelFee: checked.travel, quoted: true,
      });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setChecking(false);
    }
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setError("Location permission is not available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocating(false); apply({ lat: position.coords.latitude, lng: position.coords.longitude }); },
      () => { setLocating(false); setError("We couldn't read your location. Enter the street address instead."); },
      { timeout: 8000 });
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-nb-sky" />
        <input data-testid={`${testid}-input`} className="nb-input pl-11" placeholder="Street address in Edmonton or nearby" value={q} role="combobox" aria-expanded={open} aria-controls={`${testid}-list`} autoComplete="off"
          onChange={(e) => { onQuery(e.target.value); onChange(null); setVerdict(null); setError(""); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 250)} />
        {open && q.trim().length >= 3 && (
          <ul id={`${testid}-list`} role="listbox" className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-2xl border border-sky-100 bg-white shadow-xl">
            {matches.length === 0 && !error && <li className="px-4 py-3 text-sm text-nb-mute">No matching address yet. Include the street and city.</li>}
            {matches.map((item, i) => (
              <li key={item.id || item.label}><button type="button" role="option" aria-selected={false} data-testid={`${testid}-option-${i}`} onMouseDown={(e) => e.preventDefault()} onClick={() => apply({ line: item.label, mapboxId: item.id })} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sky-50">
                <MapPin className="mt-0.5 h-4 w-4 text-nb-teal" /><span><span className="block text-sm font-medium text-nb-ink">{item.label}</span><span className="text-xs text-nb-mute">{item.area || "Edmonton area"}</span></span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      <label className="block"><span className="nb-label">Apartment, unit or buzzer <span className="font-normal text-nb-mute">(optional, not used to find the building)</span></span>
        <input className="nb-input" value={unit} data-testid={`${testid}-unit-input`} placeholder="Unit 4, buzzer 12" onChange={(e) => { setUnit(e.target.value); if (value) onChange({ ...value, unit: e.target.value }); }} /></label>
      <label className="block"><span className="nb-label">Postal code</span>
        <input className="nb-input" value={postal} data-testid={`${testid}-postal-input`} placeholder="T5J 2R4" autoComplete="postal-code" onChange={(e) => setPostal(e.target.value)} /></label>
      {value?.line && !value.clientConfirmed && <button type="button" onClick={confirmServiceAddress} data-testid={`${testid}-confirm`} className="nb-btn-primary h-10 px-4 text-sm">Confirm this service address</button>}
      {value?.clientConfirmed && <p data-testid={`${testid}-confirmed`} className="text-sm text-teal-800">You confirmed this civic address. The arrival point can still be adjusted without changing the street.</p>}
      {!clinic && <button type="button" onClick={locate} data-testid={`${testid}-geolocate-btn`} className="mt-2 flex items-center gap-2 text-sm font-medium text-nb-blue">
        {locating || checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} Use my current location <span className="text-xs font-normal text-nb-mute">(optional — asks permission)</span>
      </button>}
      {error && <p data-testid={`${testid}-error`} className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {!clinic && verdict && <ZoneResult res={verdict} testid={testid} />}
      {clinic && value?.clientConfirmed && <p data-testid={`${testid}-navigation-ready`} className="text-sm text-teal-800">This clinic address is confirmed for navigation.</p>}
    </div>
  );
}

export function ZoneResult({ res, testid }) {
  if (!res.eligible) return (
    <div data-testid={`${testid}-zone-outside`} className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800"><AlertCircle className="h-5 w-5 shrink-0" />
      <p>{res.message}</p></div>
  );
  return (
    <div data-testid={`${testid}-zone-ok`} className="flex gap-3 rounded-2xl bg-teal-50 p-4 text-sm text-teal-900"><CheckCircle2 className="h-5 w-5 shrink-0 text-nb-teal" />
      <p>We come to you in <b>{res.zone.name}</b>. Travel fee <b>{res.travel ? money(res.travel) : "included"}</b>. <span className="text-xs text-teal-700">This fee comes from Nabitouch. Arrival time is estimated on the day — it is not a confirmed arrival.</span></p></div>
  );
}
