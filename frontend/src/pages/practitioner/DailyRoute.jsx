import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { LiveMap } from "@/components/LiveMap";
import { useDemo } from "@/store/DemoStore";
import { fmtDate, fmtTime, todayISO, OPEN } from "@/lib/domain";

const CANCELLED = new Set(["cancelled", "no_show", "refunded"]);

function isMobileVisit(row) {
  const location = row?.stop?.locationType || row?.locationType;
  return location && location !== "clinic";
}

export default function DailyRoute({ mode = "pro" }) {
  const { state, api, practitionerId, idx } = useDemo();
  const people = state.practitioners || [];
  const [personId, setPersonId] = useState(mode === "pro" ? practitionerId : people[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [route, setRoute] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [futureIndex, setFutureIndex] = useState(0);
  const today = todayISO();

  const load = () => {
    if (!personId) return;
    api.dailyRoute(personId, date).then(setRoute).catch((err) => setError(err?.response?.data?.detail || "The route could not be loaded."));
    if (mode === "owner") api.scheduleOverview(date).then(setOverview).catch(() => setOverview(null));
  };
  useEffect(() => { load(); }, [personId, date]); // eslint-disable-line

  const mobileStops = useMemo(() => (route?.stops || []).filter((row) => isMobileVisit(row) && row.stop?.position), [route]);
  const dests = mobileStops.map((row, index) => ({ pos: row.stop.position, label: String(index + 1) }));
  const viewingToday = date === today;

  const futureMobile = useMemo(() => {
    return (state.appointments || [])
      .filter((row) => row.practitionerId === personId)
      .filter((row) => !CANCELLED.has(row.status) && OPEN.includes(row.status))
      .filter((row) => row.locationType && row.locationType !== "clinic")
      .filter((row) => row.date > today)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [state.appointments, personId, today]);

  useEffect(() => { setFutureIndex(0); }, [personId, futureMobile.length]);

  const nextDest = futureMobile[futureIndex] || null;
  const showFuturePreview = viewingToday && mobileStops.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="daily-route-page">
      <div>
        <p className="nb-eyebrow">Route</p>
        <h1 className="text-3xl font-semibold tracking-tight">Daily <span className="font-display font-normal italic nb-gradient-text">route</span></h1>
        <p className="text-sm text-nb-mute">Mobile destinations only. In-clinic visits are never shown as driving stops. Navigation is never started automatically for future visits.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {mode === "owner" && <select className="nb-input w-auto" value={personId} onChange={(event) => setPersonId(event.target.value)} data-testid="route-practitioner">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
        <input className="nb-input w-auto" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="route-date" />
        <button type="button" className="nb-btn-ghost h-12" onClick={load}>Refresh estimates</button>
        {mode === "pro" && (
          <Link to="/pro/team/help" className="nb-btn-ghost inline-flex h-12 items-center gap-2 px-4" data-testid="route-quick-help">
            <LifeBuoy className="h-4 w-4" />Quick Help
          </Link>
        )}
      </div>
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="route-error">{error}</p>}

      {dests.length > 0 ? (
        <LiveMap dests={dests} height={360} testid="route-map" tag="Day destinations" />
      ) : (
        <div className="grid h-48 place-items-center rounded-[28px] bg-gradient-to-br from-sky-50 to-nb-mint text-sm text-nb-mute" data-testid="route-map">
          {viewingToday ? "No destinations today" : "No mobile destination pins for this day."}
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
        {(route?.stops || []).filter((row) => isMobileVisit(row)).map((row, index) => (
          <li key={row.stop.id} className="nb-card p-4" data-testid={`route-stop-${row.stop.id}`}>
            <p className="font-semibold">{index + 1}. {fmtTime(row.stop.time)} · {row.stop.duration} min · {row.stop.ref}</p>
            {row.leg && <p className="mt-1 text-sm text-nb-mute">Drive about {row.leg.minutes} min · leave {row.leg.depart} · arrive {row.leg.arrive} · {row.leg.provider}</p>}
            <p className="mt-1 text-xs text-nb-mute">Setup {route.rules.setupMin} min · cleanup {route.rules.cleanupMin} min · travel buffer {route.rules.travelBufferMin} min</p>
            {row.stop.maps && date === today && <a className="mt-2 inline-flex text-sm font-semibold text-nb-blue" href={row.stop.maps} target="_blank" rel="noreferrer">Open navigation</a>}
          </li>
        ))}
        {route && (route.stops || []).some((row) => !isMobileVisit(row)) && (
          <li className="text-xs text-nb-mute" data-testid="route-clinic-omitted">In-clinic visits on this day are listed on Today and are not mobile destinations.</li>
        )}
        {route && mobileStops.length === 0 && !showFuturePreview && <li className="text-sm text-nb-mute">No mobile visits on this day.</li>}
      </ol>
      {(route?.warnings || []).map((warning) => <p key={warning.appointmentId} className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="route-warning">{warning.ref}: {warning.message}</p>)}
      <div>
        <h2 className="text-sm font-semibold">Open gaps</h2>
        <ul className="mt-2 space-y-2">{(route?.gaps || []).map((gap) => <li key={`${gap.start}-${gap.duration}`} className="text-sm text-nb-mute" data-testid="route-gap">{gap.text}</li>)}
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
