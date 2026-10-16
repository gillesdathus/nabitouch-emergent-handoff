import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Navigation, MapPin, Pause, Play, Radio, Clock, AlertTriangle, Timer, MessageCircle } from "lucide-react";
import { Confirm, OpsTimeline, StatusPill, useNow, SuccessMark, Pill } from "@/components/ui-kit";
import { PaymentPanel } from "@/components/PaymentPanel";
import { LiveMap } from "@/components/LiveMap";
import { useDemo } from "@/store/DemoStore";
import { ReadinessBadge } from "@/components/PrepareCard";
import { ACTIONS, sessionElapsed, fmtClock, fmtTime, fmtDate } from "@/lib/domain";
import { useTrackingPublisher } from "@/lib/tracking/useTrackingPublisher";
import { isLiveTrial, useLiveSession, shouldShowPosition } from "@/lib/tracking/live";
import { etaCopy } from "@/lib/tracking/providers";
import { Notice, Stepper } from "@/components/tide";
import { SafetyCenter } from "@/components/SafetyCenter";
import { MemberBadge } from "@/components/MemberBadge";
import { openNavigation } from "@/lib/nativeShell";
import { SessionReadiness, useSessionReadiness } from "@/components/session/SessionReadiness";
import { CleanupPanel, NextBookingCard, SyncStrip, TreatmentTimer } from "@/components/session/SmartSession";
import { sendSessionOp, useTurnaround } from "@/lib/turnaround";
import { toast } from "sonner";

const READINESS_STATUSES = ["assigned", "confirmed", "preparing", "en_route", "arrived", "interrupted", "in_session", "safety_hold"];
const SAFETY_STATUSES = ["preparing", "en_route", "arrived", "in_session", "interrupted", "session_ended", "soap_pending", "soap_completed", "leaving", "safety_hold", "completed"];

function SessionTimer({ appt }) {
  const { api, run } = useDemo();
  const paused = !!appt.timer?.pausedAt;
  const now = useNow(1000, appt.status === "in_session" && !paused);
  const el = sessionElapsed(appt, now);
  const sched = appt.duration * 60000;
  const pct = Math.min(1, el / sched);
  const near = sched - el < 5 * 60000;
  const toggle = () => run(() => api.patch("appointments", appt.id, paused
    ? { timer: { pausedMs: (appt.timer.pausedMs || 0) + (Date.now() - new Date(appt.timer.pausedAt).getTime()), pausedAt: null } }
    : { timer: { ...appt.timer, pausedAt: new Date().toISOString() } }));
  return (
    <div className="nb-card p-6 text-center" data-testid="session-timer">
      <div className="relative mx-auto h-48 w-48">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90"><circle cx="50" cy="50" r="44" fill="none" stroke="#E0F2FE" strokeWidth="6" /><circle cx="50" cy="50" r="44" fill="none" stroke={near ? "#F59E0B" : "url(#tg)"} strokeWidth="6" strokeLinecap="round" strokeDasharray={276.5} strokeDashoffset={276.5 * (1 - pct)} style={{ transition: "stroke-dashoffset 1s linear" }} /><defs><linearGradient id="tg"><stop offset="0" stopColor="#1565F0" /><stop offset="1" stopColor="#14D8C4" /></linearGradient></defs></svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-4xl font-semibold tabular-nums" data-testid="session-elapsed">{fmtClock(el)}</span><span className="text-xs text-nb-mute">of {appt.duration}:00 scheduled</span></div>
      </div>
      {paused && <p className="mt-2 text-sm font-medium text-amber-700" data-testid="session-paused">Paused</p>}
      {near && !paused && <p className="mt-2 text-sm font-medium text-amber-700" data-testid="session-near-end">{el >= sched ? "Scheduled time reached — end when ready" : "Approaching scheduled end"}</p>}
      {appt.status === "in_session" && <button onClick={toggle} data-testid="session-pause-btn" className="nb-btn-ghost mt-4">{paused ? <><Play className="h-4 w-4" />Resume timer</> : <><Pause className="h-4 w-4" />Pause timer</>}</button>}
      <p className="mt-3 text-[11px] text-nb-mute">The session never ends automatically.</p>
    </div>
  );
}

function SharingIndicator({ appt, me }) {
  const sess = useLiveSession(appt, true);
  const show = shouldShowPosition(sess);
  const gps = sess?.source === "gps" && sess.phase === "live" && !sess.stale;
  return (
    <div className="space-y-3" data-testid="location-sharing-indicator">
      <div className="flex items-center gap-3 rounded-2xl bg-cyan-50 p-3 text-sm text-cyan-900"><span className="relative flex h-3 w-3"><span className="nb-ping absolute inset-0 rounded-full bg-cyan-500" /><span className="relative h-3 w-3 rounded-full bg-cyan-600" /></span><Radio className="h-4 w-4" /><span className="flex-1"><b>Sharing location</b> with this client for this trip only · stops on arrival</span></div>
      {show ? (
        <LiveMap height={280} testid="pro-live-map" tag={gps ? "Live GPS" : sess.stale ? "Last position" : "Tracking session"} routes={sess.route?.length ? [sess.route] : []} dests={appt.trip?.to ? [{ pos: appt.trip.to, label: "Client" }] : []} markers={[{ id: me.id, pos: sess.position, initials: me.initials, color: me.color }]} />
      ) : (
        <div className="grid h-48 place-items-center rounded-3xl bg-gradient-to-br from-sky-50 to-nb-mint px-6 text-center text-sm text-nb-mute" data-testid="pro-live-map">{sess?.phase === "paused" ? "Sharing is paused." : sess?.phase === "unavailable" ? "GPS is unavailable or permission was denied." : "No position yet. The map stays empty until a fix is accepted."}</div>
      )}
      <p className="text-center text-sm">ETA <b data-testid="pro-eta">{sess?.eta ? `${sess.eta.etaMin} min` : "waiting for GPS"}</b> <span className="text-xs text-nb-mute">{sess?.eta ? etaCopy(sess.eta.provider) : "An estimate appears only after the server calculates one."}</span></p>
    </div>
  );
}

const NAV_APPS = [
  ["google", "Google Maps", (lat, lng, line) => (lat ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(line)}`)],
  ["apple", "Apple Maps", (lat, lng, line) => (lat ? `https://maps.apple.com/?daddr=${lat},${lng}` : `https://maps.apple.com/?daddr=${encodeURIComponent(line)}`)],
  ["waze", "Waze", (lat, lng, line) => (lat ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(line)}&navigate=yes`)],
];

function NavHandoff({ appt, mapsUrl }) {
  const { idx, practitionerId, api: store } = useDemo();
  const me = idx.practitioners[practitionerId];
  const [app, setApp] = useState(me?.preferredNavApp || "google");
  const choose = (key) => { setApp(key); if (me?.id) store.patch("practitioners", me.id, { preferredNavApp: key }).catch(() => {}); };
  const lat = appt.address?.arrival?.lat;
  const lng = appt.address?.arrival?.lng;
  const line = appt.address?.line || "";
  const chosen = NAV_APPS.find((row) => row[0] === app) || NAV_APPS[0];
  const href = chosen[2](lat, lng, line) || mapsUrl;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {NAV_APPS.map(([key, label]) => <button key={key} type="button" data-testid={`nav-app-${key}`} onClick={() => choose(key)} className={app === key ? "nb-chip-on h-8 text-xs" : "nb-chip-off h-8 text-xs"}>{label}</button>)}
      </div>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (window.Capacitor?.isNativePlatform?.()) { e.preventDefault(); openNavigation(app, lat, lng, line, href); } }} data-testid="lifecycle-open-navigation-btn" className="nb-btn-ghost h-12"><Navigation className="h-4 w-4" />Open {chosen[1]}</a>
    </div>
  );
}

export default function Visit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { state, idx, api, run, practitionerId, training, refresh } = useDemo();
  const [pending, setPending] = useState(false);
  const [ask, setAsk] = useState(null);
  const [late, setLate] = useState(false);
  const [delayMin, setDelayMin] = useState(10);
  const [delayReason, setDelayReason] = useState("");
  const [flash, setFlash] = useState(false);
  const [brief, setBrief] = useState(null);
  useEffect(() => { let live = true; api.mobileBrief(id).then((row) => { if (live) setBrief(row); }).catch(() => {}); return () => { live = false; }; }, [api, id]);
  const appt = state.appointments.find((a) => a.id === id);
  const { data: readiness, reload: reloadReadiness } = useSessionReadiness(id, { enabled: !training && !!appt && READINESS_STATUSES.includes(appt.status) });
  const timed = !training && !!appt && (!!appt.session || !!appt.cleanup || appt.status === "in_session");
  const clock = useTurnaround(id, { active: timed, interval: appt?.status === "in_session" ? 15000 : 30000 });
  const { reload: reloadClock } = clock;
  const apptKey = `${appt?.status}|${appt?.cleanup?.completedAt || ""}|${appt?.timer?.pausedAt || ""}`;
  useEffect(() => { if (timed) reloadClock(); }, [apptKey, timed, reloadClock]);
  const trial = isLiveTrial(idx.settings, appt);
  const pub = useTrackingPublisher(appt, practitionerId, trial);
  if (!appt) return <p>Visit not found. <Link to="/pro" className="text-nb-blue">Back</Link></p>;
  const c = idx.clients[appt.clientId], s = idx.services[appt.serviceSlug], me = idx.practitioners[appt.practitionerId] || idx.practitioners[practitionerId];
  const actions = ACTIONS.filter((x) => x.from.includes(appt.status));
  const primary = actions.find((x) => !x.secondary) || actions[0];
  const actor = me?.name || "Practitioner";
  const lastNote = state.soap.filter((n) => n.clientId === appt.clientId && n.status === "signed" && n.appointmentId !== appt.id).slice(-1)[0];
  const mapsUrl = appt.address?.arrival?.lat
    ? `https://www.google.com/maps/dir/?api=1&destination=${appt.address.arrival.lat},${appt.address.arrival.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(appt.address.line)}`;

  const gated = !training && primary?.to === "in_session" && !readiness?.ready;
  const doIt = async (a) => {
    if (a.nav) return nav(`/pro/soap/${appt.id}`);
    if (pending) return;
    setPending(true);
    try {
      if (!training && ["in_session", "session_ended"].includes(a.to)) {
        const res = await sendSessionOp({ kind: "transition", apptId: appt.id, to: a.to, actor });
        if (!res.synced) toast.warning("Saved on this phone. Waiting to sync with Nabitouch, not confirmed yet.");
        await refresh();
        reloadClock();
        if (res.synced) { setFlash(true); setTimeout(() => setFlash(false), 1100); }
      } else {
        await run(() => api.transition(appt.id, a.to, actor)); setFlash(true); setTimeout(() => setFlash(false), 1100);
      }
    } catch (err) {
      if (a.to === "in_session") reloadReadiness();
      toast.error(err?.response?.data?.detail || "That step was not saved");
    } finally { setPending(false); }
  };
  const tap = (a) => (a.confirm ? setAsk(a) : doIt(a));

  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="pro-visit">
      <Link to="/pro" data-testid="visit-back-link" className="inline-flex items-center gap-1 text-sm text-nb-mute"><ArrowLeft className="h-4 w-4" />Today</Link>
      <div className="flex items-start justify-between gap-3">
        <div><p className="nb-eyebrow">{appt.ref} · {fmtDate(appt.date)} {fmtTime(appt.time)}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{c?.preferredName || c?.firstName} {c?.lastName}</h1><p className="text-sm text-nb-mute">{s.name} · {appt.duration} min{appt.preferences?.notes ? ` · ${appt.preferences.notes}` : ""}</p></div>
        <StatusPill status={appt.status} testid="visit-status-pill" />
      </div>
      <div className="nb-card space-y-2 p-4 text-sm">
        <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-nb-teal" /><span data-testid="visit-arrival">{appt.address.line}{appt.address.unit ? `, unit ${appt.address.unit}` : ""}{appt.address.notes && <span className="block text-xs text-nb-mute">{appt.address.notes}</span>}{appt.address.arrival && <span className="block text-xs text-nb-mute">Arrival pin is saved separately from the street address.</span>}</span></p>
        <div className="flex flex-wrap gap-1.5"><MemberBadge apptId={appt.id} /></div>
        <div className="flex flex-wrap gap-1.5">{[...(appt.preferences?.goals || []), ...(appt.preferences?.focus || [])].map((g) => <Pill key={g} tone="blue">{g}</Pill>)}</div>
        {appt.preferences?.notes && <p className="text-xs text-nb-mute">“{appt.preferences.notes}”</p>}
        {lastNote && <p className="rounded-xl bg-slate-50 p-2.5 text-xs text-nb-mute" data-testid="visit-history">Last visit: {lastNote.S.chips.join(", ")} · pain {lastNote.S.pain}/10 · plan: {lastNote.P.chips.join(", ")}</p>}
        {brief && <div className="rounded-xl bg-amber-50 p-2.5 text-xs" data-testid="visit-precautions"><b>Before you leave.</b> {brief.locationType === "clinic" ? "Clinic visit" : "Mobile visit"} · {brief.addressLine}{brief.accessNotes ? ` · ${brief.accessNotes}` : ""}{brief.precautions?.allergies ? ` · Allergies: ${brief.precautions.allergies}` : ""}{brief.precautions?.contraindications ? ` · Precautions: ${brief.precautions.contraindications}` : ""}{brief.equipment?.length ? ` · Bring: ${brief.equipment.join(", ")}` : ""} · Consent on file: {brief.consentOnFile ? "yes" : "not yet"}</div>}
      </div>

      {appt.status === "en_route" && <div className="nb-card space-y-3 p-4" data-testid="tracking-controls">
        <p className="text-sm"><b>Destination.</b> {appt.address?.line}</p>
        <p className="text-sm">Estimated travel {appt.trip?.driveMin ? `${appt.trip.driveMin} min` : "is calculated once sharing starts"}. <span className="text-xs text-nb-mute">This is not a confirmed arrival.</span></p>
        <div className="flex flex-wrap gap-2">
          {!appt.trip?.sharing
            ? <button type="button" onClick={() => run(() => api.trackingStart(appt.id))} data-testid="tracking-start-btn" className="nb-btn-primary h-11 px-4 text-sm">Start location sharing</button>
            : <button type="button" onClick={() => run(() => api.trackingStop(appt.id))} data-testid="tracking-stop-btn" className="nb-btn-ghost h-11 text-sm">Stop location sharing</button>}
        </div>
        <p className="text-[11px] text-nb-mute" data-testid="tracking-permission-note">Start sharing only for this visit. The browser asks before using GPS, and a locked phone may pause updates. Background tracking is not guaranteed.</p>
      </div>}
      {appt.status === "en_route" && <SharingIndicator appt={appt} me={me} trial={trial} />}
      {appt.status === "en_route" && <p className={`rounded-2xl p-2.5 text-xs ${pub.status === "sharing" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`} data-testid="tracking-publisher-status">Tracking service: <b>{pub.status}</b>{pub.lastAck ? ` · last fix accepted ${pub.lastAck.toLocaleTimeString()}` : ""}{pub.error ? ` · ${pub.error}` : ""} <span className="opacity-70" data-testid="tracking-source">{trial ? "(phone GPS while this page is open)" : "(the tracking service is not using phone GPS for this visit)"}</span></p>}
      {!training && READINESS_STATUSES.includes(appt.status) && <SessionReadiness readiness={readiness} canWithdraw={["arrived", "in_session"].includes(appt.status)} onWithdrawn={() => { reloadReadiness(); refresh(); reloadClock(); }} />}
      {training && ["in_session", "session_ended", "soap_pending", "interrupted"].includes(appt.status) && appt.timestamps?.in_session && <SessionTimer appt={appt} />}
      {timed && clock.snap?.treatment && <TreatmentTimer appt={appt} snap={clock.snap} serverNow={clock.serverNow} reload={() => { reloadClock(); refresh(); }} clientName={`${c?.preferredName || c?.firstName || ""} ${c?.lastName || ""}`.trim()} serviceName={s?.name} actor={actor} />}
      {timed && clock.snap?.cleanup && <CleanupPanel appt={appt} snap={clock.snap} serverNow={clock.serverNow} reload={() => { reloadClock(); refresh(); }} />}
      {timed && clock.snap && (appt.status === "in_session" || clock.snap.cleanup) && <NextBookingCard snap={clock.snap} idx={idx} />}
      {timed && <SyncStrip apptId={appt.id} error={clock.error} lastSync={clock.lastSync} onRetry={() => { reloadClock(); refresh(); }} />}

      <div className="safe-bottom sticky bottom-[72px] z-20 lg:static">
        <AnimatePresence>{flash && <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2"><SuccessMark size={64} /></motion.div>}</AnimatePresence>
        {primary && <motion.button key={primary.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} disabled={pending || gated} onClick={() => tap(primary)} data-testid={`lifecycle-${primary.label.toLowerCase().replace(/[^a-z]+/g, "-")}-btn`} className="nb-btn-primary h-16 w-full text-lg disabled:opacity-60">{pending ? "Saving…" : gated ? (readiness ? "Waiting for intake & consent" : "Checking consent…") : primary.label}</motion.button>}
      </div>
      <div className="space-y-3">
        {["assigned", "confirmed", "preparing", "en_route", "arrived"].includes(appt.status) && <div className="flex flex-wrap gap-2"><ReadinessBadge readiness={appt.readiness} /></div>}
        {["assigned", "confirmed", "preparing", "en_route"].includes(appt.status) && <NavHandoff appt={appt} mapsUrl={mapsUrl} />}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {actions.filter((x) => x !== primary).map((a) => <button key={a.label} disabled={pending} onClick={() => tap(a)} data-testid={`lifecycle-${a.label.toLowerCase().replace(/[^a-z]+/g, "-")}-btn`} className="nb-btn-ghost h-12 flex-1">{a.label}</button>)}
          {["en_route", "preparing", "assigned"].includes(appt.status) && <button type="button" onClick={() => setLate(true)} data-testid="lifecycle-running-late-btn" className="nb-btn-ghost h-12 flex-1"><Clock className="h-4 w-4" />Running late</button>}
          <Link to={`/pro/visit/${appt.id}/messages`} data-testid="visit-message-client" className="nb-btn-ghost h-12 flex-1"><MessageCircle className="h-4 w-4" />Message client</Link>
          {["en_route", "arrived", "in_session"].includes(appt.status) && <button onClick={() => setAsk({ to: "interrupted", label: "Interrupt visit", confirm: "Mark this visit as interrupted? The timer pauses and the office is notified." })} data-testid="lifecycle-interrupt-btn" className="nb-btn-ghost h-12 flex-1 text-amber-700"><AlertTriangle className="h-4 w-4" />Interrupt</button>}
        </div>
      </div>

      {appt.status === "safety_hold" && <Notice tone="warn" icon={AlertTriangle} className="!bg-rose-50 !text-rose-900" testid="visit-safety-hold">This visit is on safety hold. The owner or a safety manager decides how it continues. No penalty is applied automatically.</Notice>}
      {SAFETY_STATUSES.includes(appt.status) && <SafetyCenter appt={appt} />}
      <div className="nb-card rounded-[28px] p-5"><Stepper steps={["Prepare", "En route", "Arrived", "Session", "Done"]} current={appt.status === "safety_hold" ? ["preparing", "en_route", "arrived", "in_session"].indexOf(appt.events?.filter((e) => e.status !== "safety_hold").slice(-1)[0]?.status) : ["preparing", "en_route", "arrived", "in_session", "completed"].indexOf(appt.status)} testid="visit-stepper" /><p className="nb-label mt-4 flex items-center gap-2"><Timer className="h-4 w-4" />Visit timeline</p><OpsTimeline appt={appt} /></div>
      {late && (
        <div className="nb-card space-y-3 p-4" data-testid="visit-delay-sheet">
          <p className="font-semibold">Running late</p>
          <p className="text-sm text-nb-mute">Saving a delay updates the visit. Sending a message delivers it in the app only. No SMS or email is sent.</p>
          <div className="flex flex-wrap gap-2">{[5, 10, 15, 20, 30].map((value) => <button key={value} type="button" className={delayMin === value ? "nb-chip-on" : "nb-chip-off"} onClick={() => setDelayMin(value)} data-testid={`visit-delay-${value}`}>{value} min</button>)}</div>
          <input className="nb-input h-10" placeholder="Optional reason" value={delayReason} onChange={(event) => setDelayReason(event.target.value)} data-testid="visit-delay-reason" />
          <p className="rounded-2xl bg-sky-50 p-3 text-sm" data-testid="visit-delay-preview">I'm running {delayMin} minutes late.{delayReason ? ` ${delayReason}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="nb-btn-ghost h-11 text-sm" onClick={() => run(() => api.event(appt.id, "delayed", actor, delayReason || `Running ${delayMin} minutes late`, { delayMin }), "Delay saved in the app. No SMS was sent.").then(() => setLate(false)).catch(() => {})} data-testid="visit-delay-save">Save status</button>
            <button type="button" className="nb-btn-primary h-11 px-4 text-sm" onClick={() => run(() => api.postMessage(appt.id, { body: `I'm running ${delayMin} minutes late.${delayReason ? ` ${delayReason}` : ""}`, presetId: "late", minutes: delayMin, reason: delayReason, recordDelay: true }), "Sent in the app and saved on the visit. No SMS was sent.").then(() => setLate(false)).catch(() => {})} data-testid="visit-delay-send">Save and message</button>
          </div>
        </div>
      )}
      <Notice testid="visit-trip-alerts">Trip status is saved in the app. Running late is not an SMS or an email unless a later, approved channel sends it. None is sent from this screen.</Notice>
      <Link to={`/pro/visit/${appt.id}/native`} data-testid="native-nav-link" className="flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200"><span className="font-medium text-amber-900">In-app navigation design</span><span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Not operational</span></Link>
      <div className="nb-card p-5"><p className="nb-label">Payment</p><PaymentPanel appt={appt} role="pro" /></div>
      <Confirm open={!!ask} onOpenChange={() => setAsk(null)} title={ask?.label} body={ask?.confirm} confirmLabel={ask?.label} onConfirm={() => doIt(ask)} testid="lifecycle-confirm" />
    </div>
  );
}
