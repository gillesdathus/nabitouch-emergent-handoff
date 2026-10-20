import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LifeBuoy, MapPinned, Navigation, RefreshCw } from "lucide-react";
import { LiveMap } from "@/components/LiveMap";
import { useDemo } from "@/store/DemoStore";
import { fmtDate, fmtTime, todayISO, OPEN, navigationHref } from "@/lib/domain";
import { openNavigation } from "@/lib/nativeShell";
import { etaCopy } from "@/lib/tracking/providers";
import {
  NAV_APPS,
  formatKm,
  freshnessLabel,
  isMobileRouteStop,
  providerLabel,
  stopDestinationPoint,
} from "@/lib/my-route";
import { quickHelpHref } from "@/lib/team-connect";

const CANCELLED = new Set(["cancelled", "no_show", "refunded"]);

function RouteNavHandoff({ row, preferredApp, onChoose }) {
  const [app, setApp] = useState(preferredApp || "google");
  const point = stopDestinationPoint(row);
  if (!point) {
    return <p className="mt-2 text-xs text-amber-800" data-testid="route-nav-unavailable">Navigation unavailable until this destination has coordinates.</p>;
  }
  const href = navigationHref(app, point);
  const label = (NAV_APPS.find(([key]) => key === app) || NAV_APPS[0])[1];
  return (
    <div className="mt-3 space-y-2" data-testid={`route-nav-${row.stop.id}`}>
      <div className="flex flex-wrap gap-1">
        {NAV_APPS.map(([key, name]) => (
          <button
            key={key}
            type="button"
            data-testid={`route-nav-app-${key}-${row.stop.id}`}
            className={app === key ? "nb-chip-on h-8 text-xs" : "nb-chip-off h-8 text-xs"}
            onClick={() => {
              setApp(key);
              onChoose?.(key);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`route-open-nav-${row.stop.id}`}
        className="nb-btn-ghost inline-flex h-11 items-center gap-2 px-4 text-sm"
        onClick={(event) => {
          if (window.Capacitor?.isNativePlatform?.()) {
            event.preventDefault();
            openNavigation(app, point.lat, point.lng, href);
          }
        }}
      >
        <Navigation className="h-4 w-4" />Open {label}
      </a>
      <p className="text-[11px] text-nb-mute">Opening Maps does not start On My Way or record a trip.</p>
    </div>
  );
}

export default function DailyRoute({ mode = "pro" }) {
  const { state, api, practitionerId, idx } = useDemo();
  const people = state.practitioners || [];
  const me = idx?.practitioners?.[practitionerId];
  const [personId, setPersonId] = useState(mode === "pro" ? practitionerId : people[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [route, setRoute] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [futureIndex, setFutureIndex] = useState(0);
  const [navApp, setNavApp] = useState(me?.preferredNavApp || "google");
  const [previewTargetId, setPreviewTargetId] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const previewOriginRef = useRef(null);
  const today = todayISO();

  const clearPreview = () => {
    previewOriginRef.current = null;
    setPreview(null);
    setPreviewError("");
  };

  const load = () => {
    if (!personId) return;
    setError("");
    api.dailyRoute(personId, date)
      .then(setRoute)
      .catch((err) => setError(err?.response?.data?.detail || "The route could not be loaded."));
    if (mode === "owner") api.scheduleOverview(date).then(setOverview).catch(() => setOverview(null));
  };
  useEffect(() => { load(); }, [personId, date]); // eslint-disable-line
  useEffect(() => () => { previewOriginRef.current = null; }, []);
  useEffect(() => { clearPreview(); }, [personId, date, previewTargetId]);

  const mobileStops = useMemo(
    () => (route?.stops || []).filter((row) => isMobileRouteStop(row) && row.stop?.position),
    [route],
  );
  const listedStops = useMemo(
    () => (route?.stops || []).filter((row) => isMobileRouteStop(row)),
    [route],
  );
  const dests = mobileStops.map((row, index) => ({ pos: row.stop.position, label: String(index + 1) }));
  const viewingToday = date === today;
  const futureDay = date > today;

  const futureMobile = useMemo(() => {
    return (state.appointments || [])
      .filter((row) => row.practitionerId === personId)
      .filter((row) => !CANCELLED.has(row.status) && OPEN.includes(row.status))
      .filter((row) => isMobileRouteStop(row))
      .filter((row) => row.date > today)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [state.appointments, personId, today]);

  useEffect(() => { setFutureIndex(0); }, [personId, futureMobile.length]);

  const nextDest = futureMobile[futureIndex] || null;
  const showFuturePreview = viewingToday && listedStops.length === 0;
  const previewCandidates = listedStops.filter((row) => OPEN.includes(row.stop?.status || "assigned") && stopDestinationPoint(row));
  useEffect(() => {
    if (!previewTargetId && previewCandidates[0]) setPreviewTargetId(previewCandidates[0].stop.id);
  }, [previewCandidates, previewTargetId]);

  const chooseNav = (key) => {
    setNavApp(key);
    if (mode === "pro" && me?.id) api.patch?.("practitioners", me.id, { preferredNavApp: key }).catch(() => {});
  };

  const runLocationPreview = () => {
    if (!personId || !previewTargetId) return;
    if (permissionDenied) {
      setPreviewError("Location permission was denied. Address-to-address legs and external navigation still work.");
      return;
    }
    if (!navigator.geolocation) {
      setPreviewError("This device cannot provide a current location. Use the itinerary legs or open Maps instead.");
      return;
    }
    setPreviewBusy(true);
    setPreviewError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const origin = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        previewOriginRef.current = origin;
        api.routePreview(personId, { origin, appointmentId: previewTargetId })
          .then((body) => {
            setPreview(body);
            previewOriginRef.current = null;
          })
          .catch((err) => {
            setPreview(null);
            setPreviewError(err?.response?.data?.detail || "Route preview is unavailable right now.");
            previewOriginRef.current = null;
          })
          .finally(() => setPreviewBusy(false));
      },
      (err) => {
        setPreviewBusy(false);
        previewOriginRef.current = null;
        if (err?.code === 1) {
          setPermissionDenied(true);
          setPreviewError("Location permission denied. Your itinerary and external navigation stay available.");
        } else {
          setPreviewError("Current location is unavailable. Try again or open Maps for this stop.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  };

  const visitPath = (id) => (mode === "pro" ? `/pro/visit/${id}` : `/owner/appointments`);
  const helpRole = mode === "pro" ? "pro" : "owner";
  const helpFocusId = previewTargetId || listedStops.find((row) => OPEN.includes(row.stop?.status || "assigned"))?.stop?.id || "";
  const helpPath = quickHelpHref(helpRole, {
    category: helpFocusId ? "running_late" : undefined,
    appointmentId: helpFocusId || undefined,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8" data-testid="daily-route-page">
      <div>
        <p className="nb-eyebrow">My Route</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          My <span className="font-display font-normal italic nb-gradient-text">Route</span>
        </h1>
        <p className="text-sm text-nb-mute">
          Today&apos;s driving itinerary in booked order. Previewing a route never starts On My Way or background tracking.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {mode === "owner" && (
          <select className="nb-input w-auto min-w-0 flex-1 sm:flex-none" value={personId} onChange={(event) => setPersonId(event.target.value)} data-testid="route-practitioner">
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        )}
        <input className="nb-input w-auto min-w-0" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="route-date" />
        <button type="button" className="nb-btn-ghost h-12 inline-flex items-center gap-2" onClick={load} data-testid="route-refresh">
          <RefreshCw className="h-4 w-4" />Refresh estimates
        </button>
        {mode === "pro" && (
          <Link to={helpPath} className="nb-btn-ghost inline-flex h-12 items-center gap-2 px-4" data-testid="route-quick-help">
            <LifeBuoy className="h-4 w-4" />Quick Help
          </Link>
        )}
      </div>

      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="route-error">{error}</p>}
      {futureDay && (
        <p className="rounded-2xl bg-sky-50 p-3 text-xs text-nb-ink" data-testid="route-future-day-note">
          Future-day preview uses address-to-address travel. Current traffic (when shown) is not a forecast for that departure time. Location permission is not required.
        </p>
      )}

      {dests.length > 0 ? (
        <LiveMap dests={dests} height={320} testid="route-map" tag="Day destinations" />
      ) : (
        <div className="grid h-48 place-items-center rounded-[28px] bg-gradient-to-br from-sky-50 to-nb-mint px-4 text-center text-sm text-nb-mute" data-testid="route-map">
          {viewingToday ? "No mobile destinations today" : "No mobile destination pins for this day."}
        </div>
      )}

      {mode === "pro" && viewingToday && previewCandidates.length > 0 && (
        <div className="nb-card space-y-3 p-5" data-testid="route-location-preview">
          <div className="flex items-start gap-3">
            <MapPinned className="mt-0.5 h-5 w-5 shrink-0 text-nb-teal" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Preview from my location</p>
              <p className="text-xs text-nb-mute">Optional one-time location check to estimate the drive to your next stop. Coordinates are not stored.</p>
            </div>
          </div>
          <label className="block text-xs font-semibold text-nb-mute">
            Destination
            <select
              className="nb-input mt-1 w-full"
              value={previewTargetId}
              onChange={(event) => setPreviewTargetId(event.target.value)}
              data-testid="route-preview-target"
            >
              {previewCandidates.map((row) => (
                <option key={row.stop.id} value={row.stop.id}>
                  {fmtTime(row.stop.time)} · {row.stop.ref || row.stop.id}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="nb-btn-primary h-11 px-4 text-sm" disabled={previewBusy} onClick={runLocationPreview} data-testid="route-preview-from-location">
              {previewBusy ? "Calculating…" : "Preview from my location"}
            </button>
            {preview && (
              <button type="button" className="nb-btn-ghost h-11 px-4 text-sm" onClick={clearPreview} data-testid="route-preview-clear">
                Clear preview
              </button>
            )}
          </div>
          {previewError && <p className="text-sm text-amber-900" data-testid="route-preview-error">{previewError}</p>}
          {preview && (
            <div className="rounded-2xl bg-sky-50 p-3 text-sm" data-testid="route-preview-result">
              <p className="font-semibold">About {preview.minutes} min · {formatKm(preview.km) || "distance unavailable"}</p>
              <p className="mt-1 text-nb-mute">Leave by {preview.depart} · arrive about {preview.arrive}</p>
              <p className="mt-1 text-xs text-nb-mute">{providerLabel(preview.provider)} · {preview.trafficNote}</p>
              {freshnessLabel(preview.computedAt) && <p className="mt-1 text-xs text-nb-mute">Calculated {freshnessLabel(preview.computedAt)} · not a confirmed arrival</p>}
            </div>
          )}
        </div>
      )}

      {showFuturePreview && (
        <div className="nb-card space-y-3 p-5" data-testid="route-next-destination">
          <p className="text-sm font-semibold" data-testid="route-no-destinations-today">No destinations today</p>
          {nextDest ? (
            <>
              <p className="text-xs uppercase tracking-wide text-nb-mute">Your next destination</p>
              <p className="text-lg font-semibold">{fmtDate(nextDest.date)} · {fmtTime(nextDest.time)}</p>
              <p className="text-sm">{idx.services[nextDest.serviceSlug]?.name || "Visit"} · {nextDest.duration} min · Mobile</p>
              <p className="text-sm text-nb-mute">{nextDest.address?.line || "Client address available in the visit after confirmation."}</p>
              <p className="text-xs text-nb-mute">Preview only — open Maps from the visit when you are en route. Tracking does not start from this screen.</p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/pro/visit/${nextDest.id}`} className="nb-btn-primary h-10 px-4 text-sm" data-testid="route-open-next-visit">Open visit</Link>
                {futureMobile.length > 1 && (
                  <button
                    type="button"
                    className="nb-btn-ghost h-10 px-4 text-sm"
                    data-testid="route-next-destination-cycle"
                    onClick={() => setFutureIndex((value) => (value + 1) % futureMobile.length)}
                  >
                    Next destination ({futureIndex + 1}/{futureMobile.length})
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-nb-mute" data-testid="route-no-upcoming-mobile">No upcoming mobile destinations.</p>
          )}
        </div>
      )}

      <ol className="space-y-3" data-testid="route-stop-list">
        {listedStops.map((row, index) => (
          <li key={row.stop.id} className="nb-card p-4" data-testid={`route-stop-${row.stop.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold">
                {index + 1}. {fmtTime(row.stop.time)} · {row.stop.duration} min · {row.stop.ref}
              </p>
              {mode === "pro" && (
                <Link to={visitPath(row.stop.id)} className="text-sm font-semibold text-nb-blue" data-testid={`route-open-visit-${row.stop.id}`}>
                  Open visit
                </Link>
              )}
            </div>
            {row.stop.addressLine && <p className="mt-1 text-sm text-nb-mute">{row.stop.addressLine}</p>}
            {!row.stop.addressLine && row.stop.area && <p className="mt-1 text-sm text-nb-mute">{row.stop.area}</p>}
            {row.leg && (
              <p className="mt-2 text-sm text-nb-mute" data-testid={`route-leg-${row.stop.id}`}>
                Drive about {row.leg.minutes} min
                {formatKm(row.leg.km) ? ` · ${formatKm(row.leg.km)}` : ""}
                {" · leave "}{row.leg.depart}
                {" · arrive "}{row.leg.arrive}
                {" · "}{providerLabel(row.leg.provider)}
              </p>
            )}
            {row.leg && <p className="mt-1 text-xs text-nb-mute">{etaCopy(row.leg.provider)}{freshnessLabel(row.leg.computedAt || route?.computedAt) ? ` · as of ${freshnessLabel(row.leg.computedAt || route?.computedAt)}` : ""}</p>}
            <p className="mt-1 text-xs text-nb-mute">
              Setup {route.rules.setupMin} min · cleanup {route.rules.cleanupMin} min · travel buffer {route.rules.travelBufferMin} min
            </p>
            <RouteNavHandoff row={row} preferredApp={navApp} onChoose={chooseNav} />
          </li>
        ))}
        {route && (route.stops || []).some((row) => !isMobileRouteStop(row)) && (
          <li className="text-xs text-nb-mute" data-testid="route-clinic-omitted">In-clinic visits on this day are listed on Today and are not mobile destinations.</li>
        )}
        {route && listedStops.length === 0 && !showFuturePreview && <li className="text-sm text-nb-mute">No mobile visits on this day.</li>}
      </ol>

      {(route?.warnings || []).map((warning) => (
        <p key={warning.appointmentId} className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="route-warning">
          {warning.ref}: {warning.message}
        </p>
      ))}

      <div>
        <h2 className="text-sm font-semibold">Open gaps</h2>
        <ul className="mt-2 space-y-2">
          {(route?.gaps || []).map((gap) => <li key={`${gap.start}-${gap.duration}`} className="text-sm text-nb-mute" data-testid="route-gap">{gap.text}</li>)}
          {route && route.gaps.length === 0 && <li className="text-sm text-nb-mute">No extra visit fits between the booked stops.</li>}
        </ul>
      </div>

      {route?.proposal && (
        <div className="rounded-3xl border border-sky-100 bg-white p-4" data-testid="route-proposal">
          <p className="font-semibold">A different order could save about {route.proposal.savedMinutes} minutes.</p>
          <p className="mt-1 text-sm text-nb-mute">This proposal is not applied. Each visit keeps its booked time until an authorized reschedule is confirmed with the client.</p>
          <ul className="mt-2 text-sm">{route.proposal.moves.map((move) => <li key={move.appointmentId}>{move.appointmentId} is booked at {move.currentTime}. Suggested time {move.suggestedTime}.</li>)}</ul>
        </div>
      )}

      {overview && (
        <div className="nb-card p-4" data-testid="route-overview">
          <h2 className="font-semibold">All practitioners</h2>
          <ul className="mt-2 space-y-2 text-sm">{overview.practitioners.map((row) => <li key={row.practitionerId}>{row.name} · {row.onboardingStatus} · booked {row.bookedMin} min · drive {row.travelMin} min · gaps {row.gaps} · warnings {row.warnings}</li>)}</ul>
          {overview.notices && <p className="mt-3 text-xs text-nb-mute">{overview.notices.reason}</p>}
        </div>
      )}
    </div>
  );
}

export { isMobileRouteStop };
