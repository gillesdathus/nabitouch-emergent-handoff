import { useEffect, useMemo, useState } from "react";
import { Clock3, Gauge, MapPin, Navigation, Radio, Route } from "lucide-react";
import { LiveMap } from "@/components/LiveMap";
import { Avatar, useNow } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { shouldShowPosition, trackingPhaseCopy, useLiveSession } from "@/lib/tracking/live";
import { etaCopy } from "@/lib/tracking/providers";

const STEPS = [["confirmed", "Confirmed"], ["en_route", "On the way"], ["arrived", "Arrived"], ["in_session", "In session"], ["completed", "Complete"]];

function freshness(ageSec) {
  if (ageSec == null) return ["No signal yet", "bg-slate-300"];
  if (ageSec < 45) return [`Updated ${Math.max(1, Math.round(ageSec))} s ago`, "bg-nb-turq"];
  if (ageSec < 180) return [`Updated ${Math.round(ageSec / 60) || 1} min ago`, "bg-amber-400"];
  return [`Last update ${Math.round(ageSec / 60)} min ago`, "bg-rose-400"];
}

function Timeline({ appt, notices }) {
  const reached = STEPS.findIndex(([s]) => s === appt.status);
  const items = useMemo(() => [...(appt.events || []).map((e) => ({ at: e.at, label: STEPS.find(([s]) => s === e.status)?.[1] || e.status, kind: "status" })), ...notices.map((n) => ({ at: n.at, label: n.body, kind: "notice" }))].filter((x) => x.at).sort((a, b) => a.at.localeCompare(b.at)).slice(-6), [appt.events, notices]);
  return (
    <div className="mt-5" data-testid="trip-timeline">
      <div className="flex items-center gap-1.5">{STEPS.map(([s, label], i) => <div key={s} className="flex-1"><div className={`h-1.5 rounded-full ${i <= reached ? "bg-gradient-to-r from-nb-blue to-nb-turq" : "bg-white/20"}`} /><p className={`mt-1.5 text-[10px] ${i <= reached ? "text-white" : "text-white/50"}`}>{label}</p></div>)}</div>
      {items.length > 0 && <ol className="mt-4 space-y-2 border-l border-white/20 pl-3">{items.map((x, i) => <li key={i} className="text-xs text-white/85" data-testid={`trip-timeline-item-${i}`}><span className="nb-num mr-2 text-white/60">{new Date(x.at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}</span>{x.label}</li>)}</ol>}
    </div>
  );
}

export function LiveTripCard({ appt, practitioner }) {
  const sess = useLiveSession(appt, true);
  const [notices, setNotices] = useState([]);
  useNow(5000, true);
  useEffect(() => { api.appointmentMessages(appt.id).then((t) => setNotices(t.notices || [])).catch(() => setNotices([])); }, [appt.id, appt.status]);
  const show = shouldShowPosition(sess);
  const etaMin = sess?.eta?.etaMin;
  const gps = sess?.source === "gps" && sess?.phase === "live" && !sess?.stale;
  const ageSec = sess?.ageSec != null ? sess.ageSec : null;
  const [freshLabel, dot] = freshness(ageSec);
  const arrival = etaMin != null ? new Date(Date.now() + etaMin * 60000).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }) : null;
  const arrived = appt.status === "arrived";
  return (
    <section className="overflow-hidden rounded-[32px] text-white nb-lagoon shadow-[0_24px_60px_-24px_rgba(11,46,138,0.6)]" data-testid="live-trip-card">
      {show && !arrived && <LiveMap height={220} testid="live-trip-map" tag={gps ? "Live GPS" : "Last position"} routes={sess.route?.length ? [sess.route] : []} dests={appt.trip?.to ? [{ pos: appt.trip.to, label: "You" }] : []} markers={[{ id: practitioner?.id || "p", pos: sess.position, initials: practitioner?.initials, color: practitioner?.color }]} />}
      <div className="relative p-5">
        <span className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-nb-turq/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Avatar person={practitioner} photo={practitioner?.photo} size={48} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100"><Radio className="h-3.5 w-3.5" />{arrived ? "Arrived" : "Live trip"}</p>
            <p className="truncate font-semibold">{practitioner?.name || "Your practitioner"} {arrived ? "is at your door" : "is on the way"}</p>
          </div>
          <div className="text-right" data-testid="live-trip-arrival">
            <p className="nb-num text-3xl font-semibold leading-none">{arrived ? "Now" : arrival || "—"}</p>
            <p className="mt-1 text-[11px] text-white/70">{arrived ? "Arrived" : etaMin != null ? `≈ ${etaMin} min · estimate` : "No estimate yet"}</p>
          </div>
        </div>
        {!arrived && (
          <div className="relative mt-4 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-2xl bg-white/10 p-2.5 backdrop-blur" data-testid="live-trip-freshness"><span className={`mx-auto mb-1 block h-2 w-2 rounded-full ${dot} ${gps ? "animate-pulse" : ""}`} /><p className="font-semibold">{freshLabel}</p></div>
            <div className="rounded-2xl bg-white/10 p-2.5 backdrop-blur" data-testid="live-trip-distance"><Route className="mx-auto mb-1 h-3.5 w-3.5" /><p className="font-semibold">{sess?.eta?.remainingKm == null ? "—" : `${Number(sess.eta.remainingKm).toFixed(1)} km`}</p></div>
            <div className="rounded-2xl bg-white/10 p-2.5 backdrop-blur" data-testid="live-trip-source">{gps ? <Gauge className="mx-auto mb-1 h-3.5 w-3.5" /> : <Clock3 className="mx-auto mb-1 h-3.5 w-3.5" />}<p className="font-semibold">{show ? (gps ? "Phone GPS" : "Last position") : "Not sharing"}</p></div>
          </div>
        )}
        {appt.delayMin > 5 && <p className="relative mt-3 rounded-2xl bg-amber-400/20 p-2.5 text-xs" data-testid="live-trip-delay">Running about {appt.delayMin} min late.</p>}
        {sess?.phase && sess.phase !== "live" && !arrived && <p className="relative mt-3 text-xs text-white/80" data-testid="live-trip-phase">{trackingPhaseCopy(sess.phase)}</p>}
        <Timeline appt={appt} notices={notices} />
        <div className="relative mt-4 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
          {appt.address?.line && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{appt.address.line}</span>}
          <span className="flex items-center gap-1" data-testid="live-trip-note"><Navigation className="h-3 w-3" />{etaCopy(sess?.eta?.provider)} In-app only, no SMS.</span>
        </div>
      </div>
    </section>
  );
}
