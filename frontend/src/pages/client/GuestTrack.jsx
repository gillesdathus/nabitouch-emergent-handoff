import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, MapPinOff, ShieldCheck } from "lucide-react";
import { LiveMap } from "@/components/LiveMap";
import { Notice } from "@/components/tide";
import { api, apiError } from "@/lib/api";
import { shouldShowPosition, trackingPhaseCopy, trackingTransportAfterError, trackingTransportForPhase } from "@/lib/tracking/live";
import { etaCopy } from "@/lib/tracking/providers";

function tokenFromLocation() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash) {
    try { return decodeURIComponent(hash); } catch { return ""; }
  }
  return "";
}

const DONE = ["arrived", "completed", "ended", "stopped", "expired"];

export default function GuestTrack() {
  const params = useParams();
  const [sess, setSess] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (params.token) window.history.replaceState(null, "", `/track#${encodeURIComponent(params.token)}`);
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [params.token]);
  useEffect(() => {
    const token = tokenFromLocation();
    if (!token) { setErr("Tracking link expired"); setLoading(false); return undefined; }
    let alive = true;
    let source;
    let poll;
    const apply = (next) => { if (alive && next) { setSess(next); setErr(""); setLoading(false); } };
    const startPoll = () => {
      if (poll) return;
      const load = () => api.trackingGuestSession().then(apply).catch((error) => { if (alive) { setErr(apiError(error)); setLoading(false); } });
      load();
      poll = setInterval(load, 8000);
    };
    api.trackingGuestOpen(token).then((opened) => {
      if (!alive) return;
      apply(opened);
      const base = process.env.REACT_APP_BACKEND_URL;
      if (base && typeof EventSource !== "undefined" && trackingTransportForPhase(opened.phase) !== "stop") {
        source = new EventSource(`${base}/api/tracking/guest/stream`, { withCredentials: true });
        source.onmessage = (event) => {
          try {
            const next = JSON.parse(event.data);
            apply(next);
            if (trackingTransportForPhase(next.phase) === "stop") source.close();
          } catch { /* ignore a malformed event */ }
        };
        source.onerror = () => { source.close(); if (trackingTransportAfterError() === "poll") startPoll(); };
      } else startPoll();
    }).catch((error) => { if (alive) { setErr(apiError(error)); setLoading(false); } });
    return () => { alive = false; if (poll) clearInterval(poll); if (source) source.close(); };
  }, [params.token]);

  const phase = sess?.phase;
  const showMap = shouldShowPosition(sess) && sess.destination;
  const finished = DONE.includes(phase);
  const phaseText = phase === "live" ? "Your practitioner is on the way." : trackingPhaseCopy(phase);
  const steps = ["Requested", "On the way", "Live location", "Arrived"];
  const reached = phase === "arrived" || phase === "completed" ? 4 : phase === "live" || phase === "stale" ? 3 : phase === "unavailable" || phase === "paused" ? 2 : 1;

  return (
    <div className="mx-auto max-w-5xl px-5 pb-10 pt-5" data-testid="guest-track">
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="relative h-[48vh] overflow-hidden rounded-[30px] lg:h-[600px]">
          {showMap ? (
            <LiveMap localOnly height="100%" testid="guest-live-map" tag={phase === "stale" ? "Last position" : "Live position"} routes={[[sess.position, sess.destination]]} dests={[{ pos: sess.destination, label: "You" }]} markers={[{ id: "practitioner", pos: sess.position }]} />
          ) : (
            <div data-testid="track-no-map" className="absolute inset-0 grid place-items-center bg-gradient-to-br from-sky-50 to-nb-mint p-6 text-center">
              <div>
                {finished && phase !== "stopped" && phase !== "expired" ? <Check className="mx-auto h-10 w-10 text-nb-teal nb-pop" /> : <MapPinOff className="mx-auto h-10 w-10 text-nb-mute" />}
                <p className="mt-2 font-semibold">{loading ? "Opening this visit…" : err ? "This link cannot be opened" : phase === "arrived" ? "Your practitioner has arrived" : phase === "completed" || phase === "ended" ? "This trip is complete" : phase === "stale" ? "The last signal is out of date" : "Location is not being shared"}</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-nb-mute">{err || (phase === "unavailable" ? "The visit is on the way, and GPS has not started or was denied." : "A position appears only while the practitioner is sharing it for this appointment.")}</p>
              </div>
            </div>
          )}
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium nb-glass"><ShieldCheck className="h-3.5 w-3.5 text-nb-teal" />Shared only for this visit</span>
            {showMap && <span className="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium nb-glass">{phase === "stale" ? "Stale GPS" : "Live GPS"}</span>}
          </div>
        </div>
        <div className="space-y-3">
          <div className="nb-card p-4" data-testid="eta-card">
            <p className="nb-eyebrow">Nabitouch Live</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Follow this visit</h1>
            <div className="mt-4 rounded-3xl p-4 text-white nb-lagoon">
              <p className="text-xs text-white/70">{finished ? "Status" : sess?.eta ? "Estimated arrival" : "Status"}</p>
              <p className="nb-num text-3xl font-semibold">{sess?.eta && !finished ? `${sess.eta.etaMin} min` : finished ? "Complete" : "Waiting"}</p>
              {sess?.eta && !finished && <p className="mt-1 text-xs text-white/75" data-testid="guest-track-eta">Estimated arrival about {sess.eta.etaMin} min. {etaCopy(sess.eta.provider)} This is not a confirmed arrival.</p>}
            </div>
            {err && <p className="mt-3 text-sm text-red-700" data-testid="guest-track-error">{err}</p>}
            {sess && <p className="mt-3 text-sm" data-testid="guest-track-phase">{phaseText || "Waiting for a tracking update."}</p>}
            {sess?.ageSec != null && (phase === "live" || phase === "stale") && <p className="text-xs text-nb-mute" data-testid="guest-track-fresh">Last update {Math.round(sess.ageSec)} s ago.</p>}
            {phase === "stale" && <Notice className="mt-3">The last location is older than a fresh GPS fix. The ETA may be out of date until the phone sends another update.</Notice>}
            {phase === "unavailable" && <Notice className="mt-3">GPS is unavailable, permission was denied, or sharing has not started. Status can still change without a map.</Notice>}
          </div>
          <div className="nb-card p-4" data-testid="track-trip-alerts">
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Trip alerts</p><span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">In-app only</span></div>
            <p className="text-sm text-nb-mute">SMS and push are not connected. This guest page does not send a text. Signed-in clients see in-app status and can message their practitioner from My Nabitouch.</p>
          </div>
          <div className="nb-card p-4" data-testid="track-timeline">
            <p className="mb-3 font-semibold">Visit progress</p>
            {steps.map((label, index) => (
              <div key={label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`grid h-6 w-6 place-items-center rounded-full ${index < reached ? "bg-nb-turq text-white" : index === reached ? "bg-nb-blue text-white ring-4 ring-nb-blue/20" : "bg-white ring-1 ring-sky-200"}`}>{index < reached && <Check className="h-3.5 w-3.5" />}</span>
                  {index < steps.length - 1 && <span className={`min-h-[22px] w-0.5 flex-1 ${index < reached ? "bg-nb-turq" : "bg-sky-100"}`} />}
                </div>
                <p className={`pb-3 text-sm font-medium ${index > reached ? "text-nb-mute" : ""}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
