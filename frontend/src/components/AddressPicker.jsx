import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crosshair, Loader2, MapPin, CheckCircle2, AlertCircle, Pencil } from "lucide-react";
import { money } from "@/lib/domain";
import { api, apiError } from "@/lib/api";

function formatCardLines(value) {
  const line = String(value?.line || "");
  const street = line.split(",")[0]?.trim() || line;
  const rest = line.includes(",") ? line.split(",").slice(1).join(",").trim() : (value?.area || "");
  const postal = String(value?.postal || "").trim();
  const lineHasPostal = postal
    && line.toUpperCase().replace(/\s+/g, "").includes(postal.toUpperCase().replace(/\s+/g, ""));
  const locality = lineHasPostal
    ? rest
    : [rest, postal].filter(Boolean).join(rest && postal ? " · " : "");
  return { street, locality, postal };
}

/**
 * Address suggestions come from the API. The server decides the zone and the travel fee.
 *
 * Visit purpose phases (replace, do not stack):
 *   find → confirm (read-only card) → details ask → (optional form) → settled
 *
 * Parent contract:
 * - onQuery(text) updates the search string on every keystroke.
 * - onChange(null) clears a resolved address only — parents must leave addressQuery alone.
 * - onChange(address) applies a resolved / confirmed address and may set addressQuery to address.line.
 * - onNotes / notes: optional access notes stored separately from the civic address.
 * - onAdvance: called when the client finishes the details gate (No, or Yes + Continue).
 */
export function AddressPicker({
  value,
  onChange,
  query,
  onQuery,
  notes = "",
  onNotes,
  onAdvance,
  testid = "address",
  purpose = "visit",
}) {
  const listId = useId();
  const fieldRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState(value?.unit || "");
  const [postal, setPostal] = useState(value?.postal || "");
  const [access, setAccess] = useState(value?.access || "");
  const [localNotes, setLocalNotes] = useState(notes || "");
  const [editing, setEditing] = useState(!value?.line);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Latch: once confirm opens without a postal, keep the postal field until Confirm succeeds. */
  const [askPostal, setAskPostal] = useState(false);
  const [menuBox, setMenuBox] = useState(null);
  const q = query ?? "";
  const clinic = purpose === "clinic";
  const resolved = Boolean(value?.line);
  const confirmed = resolved && value?.clientConfirmed === true;
  const settled = confirmed && value?.detailsSettled === true;
  const showCard = resolved && !editing && !clinic;
  const postalMissing = !String(postal || value?.postal || "").trim();
  const needsPostal = !confirmed && askPostal && postalMissing;

  useEffect(() => {
    if (value?.line && !editing) {
      setUnit(value.unit || "");
      setPostal(value.postal || "");
      setAccess(value.access || "");
    }
  }, [value?.line, value?.mapboxId, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLocalNotes(notes || "");
  }, [notes]);

  useEffect(() => {
    if (!confirmed || settled) setDetailsOpen(false);
  }, [confirmed, settled, value?.line, value?.mapboxId]);

  useEffect(() => {
    if (showCard && !confirmed && !String(value?.postal || "").trim()) setAskPostal(true);
    if (!showCard || confirmed) setAskPostal(false);
  }, [showCard, confirmed, value?.line, value?.mapboxId, value?.postal]);

  useEffect(() => {
    if (!open || q.trim().length < 3 || showCard) {
      setMatches([]);
      return undefined;
    }
    let stopped = false;
    const handle = setTimeout(() => {
      api.geoSuggest(q.trim()).then((body) => { if (!stopped) { setMatches(body.suggestions || []); setError(""); } }).catch((err) => { if (!stopped) { setMatches([]); setError(apiError(err)); } });
    }, 250);
    return () => { stopped = true; clearTimeout(handle); };
  }, [q, open, showCard]);

  useLayoutEffect(() => {
    if (!open || showCard || !fieldRef.current) {
      setMenuBox(null);
      return undefined;
    }
    const update = () => {
      const rect = fieldRef.current.getBoundingClientRect();
      setMenuBox({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
    };
  }, [open, showCard, q]);

  const clearResolvedKeepQuery = () => {
    if (value) onChange(null);
    setVerdict(null);
    setDetailsOpen(false);
  };

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
        setEditing(false);
        return;
      }
      const checked = await api.geoCheck(body);
      setVerdict(checked);
      if (!checked.eligible) {
        onChange(null);
        setEditing(true);
        return;
      }
      const nextPostal = checked.postalNormalized || checked.civic?.postal || postal || "";
      onChange({
        line: checked.line, unit: "", access: "", lat: checked.lat, lng: checked.lng, area: checked.area,
        mapboxId: checked.mapboxId, zoneId: checked.zone?.id, travelFee: checked.travel, travelCalc: checked.travelCalc || null, quoted: true,
        clientConfirmed: false, detailsSettled: false, postal: nextPostal,
      });
      onQuery(checked.line);
      if (nextPostal) setPostal(nextPostal);
      setUnit("");
      setAccess("");
      setDetailsOpen(false);
      setEditing(false);
    } catch (err) {
      setVerdict(null);
      onChange(null);
      setError(apiError(err));
      setEditing(true);
    } finally {
      setChecking(false);
      setOpen(false);
    }
  };

  const confirmServiceAddress = async () => {
    if (!value?.line) return;
    if (!clinic && needsPostal) {
      setError("Add the postal code so we can confirm this civic address.");
      return;
    }
    setChecking(true);
    setError("");
    try {
      if (clinic) {
        const checked = await api.geoClinicConfirm({ line: value.line, mapboxId: value.mapboxId, postal, clientConfirmed: true });
        if (!checked.accepted) {
          onChange({ ...value, postal, clientConfirmed: false, detailsSettled: false });
          setError("This address needs review before the clinic location can be saved.");
          return;
        }
        onChange({ ...value, line: checked.line, lat: checked.lat, lng: checked.lng, mapboxId: checked.mapboxId, postal, clientConfirmed: true, confidence: checked.confidence, detailsSettled: true });
        onQuery(checked.line);
        setEditing(false);
        return;
      }
      const checked = await api.geoConfirm({ line: value.line, mapboxId: value.mapboxId, postal, unit: "", clientConfirmed: true });
      const approximate = checked.confidence && checked.confidence !== "address";
      if (!checked.accepted || approximate) {
        onChange({ ...value, unit: "", access: "", postal, clientConfirmed: false, detailsSettled: false, confidence: checked.confidence });
        setError(approximate
          ? "This result is approximate, so it is not a verified civic address. Correct it or ask Nabitouch to review it before a mobile visit."
          : "Confirm a complete civic address before a mobile visit can be booked.");
        setEditing(false);
        return;
      }
      onChange({
        ...value, line: checked.line, unit: "", access: "", lat: checked.lat, lng: checked.lng,
        mapboxId: checked.mapboxId || value.mapboxId, postal: checked.postalNormalized || postal,
        zoneId: checked.zone?.id || value.zoneId,
        clientConfirmed: true, detailsSettled: false, confidence: checked.confidence, travelFee: checked.travel, travelCalc: checked.travelCalc || null, quoted: true,
      });
      setUnit("");
      setAccess("");
      setDetailsOpen(false);
      setEditing(false);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setChecking(false);
    }
  };

  const settleDetails = ({ withDetails }) => {
    if (!value) return;
    const nextUnit = withDetails ? unit : "";
    const nextAccess = withDetails ? access : "";
    const nextNotes = withDetails ? localNotes : "";
    if (!withDetails) {
      setUnit("");
      setAccess("");
      setLocalNotes("");
    }
    onChange({
      ...value,
      unit: nextUnit,
      access: nextAccess,
      detailsSettled: true,
      clientConfirmed: true,
    });
    onNotes?.(nextNotes);
    setDetailsOpen(false);
    onAdvance?.();
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

  const startEdit = () => {
    setEditing(true);
    setOpen(false);
    setDetailsOpen(false);
    const keep = value?.line || q || "";
    clearResolvedKeepQuery();
    onQuery(keep);
  };

  const onStreetInput = (e) => {
    const next = e.target.value;
    onQuery(next);
    clearResolvedKeepQuery();
    setError("");
    setOpen(true);
  };

  const suggestionList = open && !showCard && q.trim().length >= 3 && menuBox && typeof document !== "undefined"
    ? createPortal(
      <ul
        id={listId}
        role="listbox"
        data-testid={`${testid}-list`}
        className="fixed z-[80] max-h-64 overflow-auto rounded-2xl border border-sky-100 bg-white shadow-xl"
        style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
      >
        {matches.length === 0 && !error && <li className="px-4 py-3 text-sm text-nb-mute">No matching address yet. Include the street and city.</li>}
        {matches.map((item, i) => (
          <li key={item.id || item.label}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              data-testid={`${testid}-option-${i}`}
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply({ line: item.label, mapboxId: item.id })}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sky-50"
            >
              <MapPin className="mt-0.5 h-4 w-4 text-nb-teal" />
              <span>
                <span className="block text-sm font-medium text-nb-ink">{item.label}</span>
                <span className="text-xs text-nb-mute">{item.area || "Suggested address"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>,
      document.body,
    )
    : null;

  if (showCard) {
    const { street, locality } = formatCardLines({ ...value, postal: value.postal || postal });

    // Phase: additional details form
    if (confirmed && !settled && detailsOpen) {
      return (
        <div className="space-y-3" data-testid={`${testid}-details-form`}>
          <p className="text-base font-semibold text-nb-ink">Add suite, buzzer, or notes</p>
          <p className="text-sm text-nb-mute">Optional — these stay separate from the street address.</p>
          <label className="block">
            <span className="nb-label">Suite / apartment / unit</span>
            <input
              className="nb-input"
              value={unit}
              data-testid={`${testid}-unit-input`}
              placeholder="Unit 4"
              onChange={(e) => setUnit(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="nb-label">Buzzer / access code</span>
            <input
              className="nb-input"
              value={access}
              data-testid={`${testid}-access-input`}
              placeholder="Buzzer 12"
              onChange={(e) => setAccess(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="nb-label">Special instructions / notes</span>
            <input
              className="nb-input"
              value={localNotes}
              data-testid={`${testid}-notes-input`}
              placeholder="Parking, pets, stairs…"
              onChange={(e) => setLocalNotes(e.target.value)}
            />
          </label>
          <div className="flex w-full flex-col gap-2 pt-1" data-testid={`${testid}-details-actions`}>
            <button
              type="button"
              onClick={() => settleDetails({ withDetails: true })}
              data-testid={`${testid}-details-continue`}
              className="nb-btn-primary h-12 w-full"
            >
              Continue
            </button>
          </div>
        </div>
      );
    }

    // Phase: ask about optional details
    if (confirmed && !settled) {
      return (
        <div className="space-y-3" data-testid={`${testid}-details-ask`}>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-nb-mute">Service address</p>
            <p className="mt-1 text-base font-semibold text-nb-ink" data-testid={`${testid}-card-line`}>{street}</p>
            {locality && <p className="text-sm text-nb-mute" data-testid={`${testid}-card-locality`}>{locality}</p>}
            <p data-testid={`${testid}-confirmed`} className="mt-2 text-sm text-teal-800">Address confirmed.</p>
          </div>
          <p className="text-lg font-semibold text-nb-ink" data-testid={`${testid}-details-prompt`}>
            Any suite, buzzer, or special instructions?
          </p>
          <button type="button" onClick={startEdit} data-testid={`${testid}-change`} className="text-sm font-semibold text-nb-blue">
            Change address
          </button>
          <div className="flex w-full flex-col gap-2 pt-1" data-testid={`${testid}-details-actions`}>
            <button
              type="button"
              onClick={() => settleDetails({ withDetails: false })}
              data-testid={`${testid}-details-no`}
              className="nb-btn-primary h-12 w-full"
            >
              No — Continue
            </button>
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              data-testid={`${testid}-details-yes`}
              className="nb-btn-ghost h-12 w-full"
            >
              Yes — Add Details
            </button>
          </div>
        </div>
      );
    }

    // Phase: settled summary (compact)
    if (settled) {
      return (
        <div className="space-y-3" data-testid={`${testid}-confirm-card`}>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-nb-mute">Service address</p>
            <p className="mt-1 text-base font-semibold text-nb-ink" data-testid={`${testid}-card-line`}>{street}</p>
            {locality && <p className="text-sm text-nb-mute" data-testid={`${testid}-card-locality`}>{locality}</p>}
            {(value.unit || value.access) && (
              <p className="mt-1 text-sm text-nb-mute" data-testid={`${testid}-card-extras`}>
                {[value.unit && `Unit ${value.unit}`, value.access].filter(Boolean).join(" · ")}
              </p>
            )}
            <p data-testid={`${testid}-confirmed`} className="mt-2 text-sm text-teal-800">Address confirmed.</p>
          </div>
          <button type="button" onClick={startEdit} data-testid={`${testid}-change`} className="nb-btn-ghost h-10 px-4 text-sm">
            <Pencil className="h-3.5 w-3.5" /> Change address
          </button>
        </div>
      );
    }

    // Phase: confirm civic address (read-only; postal only if missing)
    return (
      <div className="space-y-3" data-testid={`${testid}-confirm-card`}>
        <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-nb-mute">Your massage location</p>
          <p className="mt-1 text-base font-semibold text-nb-ink" data-testid={`${testid}-card-line`}>{street}</p>
          {locality && <p className="text-sm text-nb-mute" data-testid={`${testid}-card-locality`}>{locality}</p>}
          {verdict?.eligible && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-teal-800" data-testid={`${testid}-card-detected`}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Location detected
            </p>
          )}
        </div>
        <p className="text-base font-semibold text-nb-ink" data-testid={`${testid}-confirm-prompt`}>
          Is this the correct service address?
        </p>
        {askPostal && !confirmed && (
          <label className="block" data-testid={`${testid}-incomplete-postal`}>
            <span className="nb-label">Postal code <span className="font-normal text-nb-mute">(required to confirm)</span></span>
            <input
              className="nb-input"
              value={postal}
              data-testid={`${testid}-postal-input`}
              placeholder="T5J 2R4"
              autoComplete="postal-code"
              onChange={(e) => setPostal(e.target.value)}
            />
          </label>
        )}
        {error && <p data-testid={`${testid}-error`} className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {verdict && <ZoneResult res={verdict} testid={testid} />}
        <div className="flex w-full flex-col gap-2 pt-1 sm:flex-row" data-testid={`${testid}-confirm-actions`}>
          <button type="button" onClick={confirmServiceAddress} disabled={checking || needsPostal} data-testid={`${testid}-confirm`} className="nb-btn-primary h-12 flex-1">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm Address
          </button>
          <button type="button" onClick={startEdit} data-testid={`${testid}-change`} className="nb-btn-ghost h-12 flex-1">
            <Pencil className="h-3.5 w-3.5" /> Change Address
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid={`${testid}-find`}>
      <div className="relative" ref={fieldRef}>
        <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-nb-sky" />
        <input
          data-testid={`${testid}-input`}
          className="nb-input pl-11"
          placeholder="Street address, city, and province"
          value={q}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          onChange={onStreetInput}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 250)}
        />
        {suggestionList}
      </div>
      {clinic && (
        <>
          <label className="block"><span className="nb-label">Postal code</span>
            <input className="nb-input" value={postal} data-testid={`${testid}-postal-input`} placeholder="T5J 2R4" autoComplete="postal-code" onChange={(e) => setPostal(e.target.value)} /></label>
          {value?.line && !value.clientConfirmed && <button type="button" onClick={confirmServiceAddress} data-testid={`${testid}-confirm`} className="nb-btn-primary h-10 px-4 text-sm">Confirm this clinic address</button>}
          {value?.clientConfirmed && <p data-testid={`${testid}-confirmed`} className="text-sm text-teal-800">You confirmed this civic address.</p>}
        </>
      )}
      {!clinic && (
        <button type="button" onClick={locate} data-testid={`${testid}-geolocate-btn`} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-sky-100 bg-white text-sm font-semibold text-nb-blue">
          {locating || checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} Use my current location
        </button>
      )}
      {error && <p data-testid={`${testid}-error`} className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {!clinic && verdict && editing && <ZoneResult res={verdict} testid={testid} />}
      {clinic && value?.clientConfirmed && <p data-testid={`${testid}-navigation-ready`} className="text-sm text-teal-800">This clinic address is confirmed for navigation.</p>}
    </div>
  );
}

export function ZoneResult({ res, testid }) {
  if (!res.eligible) return (
    <div data-testid={`${testid}-zone-outside`} className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800"><AlertCircle className="h-5 w-5 shrink-0" />
      <p>{res.message}</p></div>
  );
  const body = res.message || (
    <>We come to you in <b>{res.zone?.name || "the service area"}</b>.{Number(res.travel) > 0 ? <> Travel fee <b>{money(res.travel)}</b>.</> : null}{" "}
      <span className="text-xs text-teal-700">Arrival time is estimated on the day — it is not a confirmed arrival.</span></>
  );
  return (
    <div data-testid={`${testid}-zone-ok`} className="flex gap-3 rounded-2xl bg-teal-50 p-4 text-sm text-teal-900"><CheckCircle2 className="h-5 w-5 shrink-0 text-nb-teal" />
      <p>{body}</p></div>
  );
}
