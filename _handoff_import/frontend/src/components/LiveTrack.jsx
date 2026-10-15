import { Navigation, Radio, Clock, Route } from "lucide-react";
import { LiveMap } from "@/components/LiveMap";
import { Avatar } from "@/components/ui-kit";
import { useLiveSession, shouldShowPosition, trackingPhaseCopy } from "@/lib/tracking/live";
import { etaCopy } from "@/lib/tracking/providers";

// Shows a position only when the tracking session has a live or stale fix.
export function LiveTrack({ appt, practitioner, showLate }) {
  const sess = useLiveSession(appt, true);
  const show = shouldShowPosition(sess);
  const etaMin = sess?.eta?.etaMin;
  const gps = sess?.source === "gps" && sess?.phase === "live" && !sess?.stale;
  if (!sess) {
    return <div className="rounded-3xl bg-white p-5 ring-1 ring-sky-100" data-testid="nabitouch-live"><p data-testid="live-phase">Waiting for a tracking update.</p></div>;
  }
  return (
    <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-sky-100" data-testid="nabitouch-live">
      {show && <LiveMap height={260} testid="client-live-map" tag={gps ? "Live GPS" : "Last position"} routes={sess.route?.length ? [sess.route] : []} dests={appt.trip?.to ? [{ pos: appt.trip.to, label: "You" }] : []} markers={[{ id: practitioner?.id || "p", pos: sess.position, initials: practitioner?.initials, color: practitioner?.color }]} />}
      <div className="p-5">
        <div className="flex items-center gap-3">
          <Avatar person={practitioner} photo={practitioner?.photo} size={44} />
          <div className="flex-1"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-nb-teal"><Radio className="h-3.5 w-3.5" />Nabitouch Live</p><p className="font-semibold">{practitioner?.name || "Your practitioner"} {show ? "is sharing a position" : "has not shared a position"}</p></div>
          <div className="text-right"><p className="text-3xl font-semibold tabular-nums text-nb-navy" data-testid="live-eta-min">{etaMin == null ? "—" : etaMin === 0 ? "Now" : etaMin}<span className="text-sm font-medium">{etaMin ? " min" : ""}</span></p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-2xl bg-sky-50 p-2.5"><Clock className="mx-auto h-4 w-4 text-nb-blue" /><p className="mt-1 font-semibold" data-testid="live-arrival-clock">{etaMin == null ? "—" : "Estimate"}</p><p className="text-nb-mute">Est. arrival</p></div>
          <div className="rounded-2xl bg-sky-50 p-2.5"><Route className="mx-auto h-4 w-4 text-nb-blue" /><p className="mt-1 font-semibold" data-testid="live-remaining-km">{sess.eta?.remainingKm == null ? "—" : `${Number(sess.eta.remainingKm).toFixed(1)} km`}</p><p className="text-nb-mute">Remaining</p></div>
          <div className="rounded-2xl bg-sky-50 p-2.5"><Navigation className="mx-auto h-4 w-4 text-nb-blue" /><p className="mt-1 font-semibold" data-testid="live-journey-status">{show ? (gps ? "Live GPS" : "Last position") : "Waiting"}</p><p className="text-nb-mute">Journey</p></div>
        </div>
        {showLate && appt.delayMin > 5 && <p className="mt-3 rounded-2xl bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="live-late-indicator">Recorded delay +{appt.delayMin} min. This is not an SMS.</p>}
        {!show && <p className="mt-3 rounded-2xl bg-sky-50 p-2.5 text-xs text-nb-navy" data-testid="live-waiting-gps">{trackingPhaseCopy(sess.phase) || "Waiting for a phone GPS fix. A sample route is not shown."}</p>}
        {sess.phase === "stale" && <p className="mt-3 rounded-2xl bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="live-stale-gps">Last-known location{sess.ageSec != null ? ` · ${Math.round(sess.ageSec)} s ago` : ""}</p>}
        {sess.phase && sess.phase !== "live" && <p className="mt-3 rounded-2xl bg-sky-50 p-2.5 text-xs text-nb-navy" data-testid="live-phase">{trackingPhaseCopy(sess.phase)}</p>}
        <p className="mt-3 text-[11px] text-nb-mute" data-testid="live-source-note">{gps ? `Live phone GPS. ${etaCopy(sess.eta?.provider)}` : show ? `This position is not a fresh phone GPS fix. ${etaCopy(sess.eta?.provider)}` : "No map marker until an authorized session has a live or last-known position."} Location sharing stops with the visit.</p>
      </div>
    </div>
  );
}
