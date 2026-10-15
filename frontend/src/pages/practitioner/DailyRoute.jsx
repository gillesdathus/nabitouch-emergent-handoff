import { useEffect, useState } from "react";
import { LiveMap } from "@/components/LiveMap";
import { useDemo } from "@/store/DemoStore";
import { fmtTime, todayISO } from "@/lib/domain";

export default function DailyRoute({ mode = "pro" }) {
  const { state, api, practitionerId } = useDemo();
  const people = state.practitioners || [];
  const [personId, setPersonId] = useState(mode === "pro" ? practitionerId : people[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [route, setRoute] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const load = () => {
    if (!personId) return;
    api.dailyRoute(personId, date).then(setRoute).catch((err) => setError(err?.response?.data?.detail || "The route could not be loaded."));
    if (mode === "owner") api.scheduleOverview(date).then(setOverview).catch(() => setOverview(null));
  };
  useEffect(() => { load(); }, [personId, date]); // eslint-disable-line
  const dests = (route?.stops || []).filter((row) => row.stop.position).map((row, index) => ({ pos: row.stop.position, label: String(index + 1) }));
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="daily-route-page">
      <div>
        <p className="nb-eyebrow">Route</p>
        <h1 className="text-3xl font-semibold tracking-tight">Daily <span className="font-display font-normal italic nb-gradient-text">route</span></h1>
        <p className="text-sm text-nb-mute">Driving times are estimates, not confirmed arrivals. A shorter order is only a proposal. Confirmed visit times stay as booked.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {mode === "owner" && <select className="nb-input w-auto" value={personId} onChange={(event) => setPersonId(event.target.value)} data-testid="route-practitioner">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
        <input className="nb-input w-auto" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="route-date" />
        <button type="button" className="nb-btn-ghost h-12" onClick={load}>Refresh estimates</button>
      </div>
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {dests.length > 0 ? <LiveMap dests={dests} height={360} testid="route-map" tag="Day destinations" /> : <div className="grid h-48 place-items-center rounded-[28px] bg-gradient-to-br from-sky-50 to-nb-mint text-sm text-nb-mute" data-testid="route-map">No destination pins for this day.</div>}
      <ol className="space-y-3">
        {(route?.stops || []).map((row, index) => (
          <li key={row.stop.id} className="nb-card p-4" data-testid={`route-stop-${row.stop.id}`}>
            <p className="font-semibold">{index + 1}. {fmtTime(row.stop.time)} · {row.stop.duration} min · {row.stop.ref}</p>
            {row.leg && <p className="mt-1 text-sm text-nb-mute">Drive about {row.leg.minutes} min · leave {row.leg.depart} · arrive {row.leg.arrive} · {row.leg.provider}</p>}
            <p className="mt-1 text-xs text-nb-mute">Setup {route.rules.setupMin} min · cleanup {route.rules.cleanupMin} min · travel buffer {route.rules.travelBufferMin} min</p>
            {row.stop.maps && <a className="mt-2 inline-flex text-sm font-semibold text-nb-blue" href={row.stop.maps} target="_blank" rel="noreferrer">Open navigation</a>}
          </li>
        ))}
        {route && route.stops.length === 0 && <li className="text-sm text-nb-mute">No visits on this day.</li>}
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
