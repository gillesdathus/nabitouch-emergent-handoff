import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Phone, MessageSquareWarning, FileText, Check, Navigation, Copy, ExternalLink, ShieldCheck, Smartphone, X, MapPin, Lock } from "lucide-react";
import { toast } from "sonner";
import { usePreview } from "@/store/PreviewStore";
import { MapView, CapBadge, FreshnessPill } from "@/components/MapView";
import { Avatar, Stepper, BottomSheet, Notice, cx } from "@/components/ui-kit";
import { Switch } from "@/components/ui/switch";
import { useGeolocation } from "@/lib/useGeolocation";
import { LateSheet, TripHistory } from "@/components/TripAlerts";
import { timeLabel, TRIP_FLOW, TRIP_ACTION, nextStatus, money, hhmm } from "@/lib/domain";
import { clientLngLat, demoFix, fetchRoute, straightEstimate, availableApps, getNavPref, setNavPref, NAV_APPS } from "@/lib/geo";

const loadTrip = () => JSON.parse(localStorage.getItem("nb-trip") || "null");

function StartTripSheet({ open, onOpenChange, a, c, origin, eta, onStart }) {
  const [app, setApp] = useState(getNavPref());
  const [share, setShare] = useState(true);
  const [step, setStep] = useState("review");
  const apps = availableApps();
  const dest = clientLngLat(c.id);
  const go = () => {
    if (share && !localStorage.getItem("nb-loc-consent") && step === "review") return setStep("consent");
    if (share) localStorage.setItem("nb-loc-consent", "1");
    setNavPref(app);
    onStart({ app, share });
    setStep("review");
  };
  const label = NAV_APPS.find((x) => x.key === app).label;
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} testid="start-trip-sheet" title={step === "consent" ? "Share your location for this trip?" : "Start trip"} sub={step === "consent" ? undefined : `${c.name} · ${timeLabel(a.time)}`} full
      footer={<button data-testid="start-trip-confirm" onClick={go} className="nb-btn-primary w-full h-14 text-base"><Navigation className="h-5 w-5" />{step === "consent" ? "Continue to permission" : `Start trip & open ${label}`}</button>}>
      {step === "consent" ? (
        <div data-testid="location-consent" className="space-y-3">
          <span className="grid place-items-center h-16 w-16 rounded-3xl tint-mint text-nb-teal"><ShieldCheck className="h-7 w-7" /></span>
          {[["Starts when you tap Start trip", "Never before, never off-shift."], ["Stops when you arrive or end the trip", "You can stop sharing anytime."], ["Seen by your client and authorized staff", "Only for this visit."], ["Your browser will ask next", "Choose Allow. Precise location gives the best ETA."]].map(([t, b]) => <div key={t} className="flex gap-3 rounded-2xl bg-sky-50/70 p-3"><Check className="h-4 w-4 mt-0.5 text-nb-teal" /><div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-nb-mute">{b}</p></div></div>)}
          <Notice>When {label} is open, your browser may pause GPS (especially on iPhone). Your client will see “last updated” instead of a live position.</Notice>
        </div>
      ) : (
        <>
          <div className="rounded-3xl nb-tide text-white p-4">
            <p className="text-xs text-white/60">Destination</p>
            <p className="font-semibold mt-0.5 flex items-center gap-1.5"><MapPin className="h-4 w-4 text-nb-turq" />{a.address}</p>
            <p className="text-xs text-white/70 mt-1">Access notes: {a.notes || "Buzzer at main door · street parking"}</p>
          </div>
          <MapView className="h-44 rounded-3xl mt-3" route={eta?.coords} markers={[origin && { id: "o", kind: "me", lngLat: origin }, { id: "d", kind: "pin", lngLat: dest }].filter(Boolean)} fit={origin ? [origin, dest] : [dest]} testid="trip-preview-map" />
          <div className="flex items-center justify-between mt-3"><p className="text-sm"><span className="text-2xl font-semibold nb-num">{eta?.min ?? "—"}</span> min · <span className="nb-num">{eta?.km ?? "—"} km</span></p>{eta && <CapBadge kind={eta.source} />}</div>
          <p className="nb-label mt-5">Navigate with</p>
          <div className="grid grid-cols-3 gap-2">{apps.map((x) => <button key={x.key} data-testid={`trip-app-${x.key}`} onClick={() => setApp(x.key)} className={cx("h-12 rounded-2xl text-sm font-semibold transition-colors", app === x.key ? "nb-lagoon text-white" : "bg-white ring-1 ring-sky-100")}>{x.label}</button>)}</div>
          <p className="text-xs text-nb-mute mt-2">Saved as your default. Change anytime in Settings.</p>
          <div className="flex items-center gap-3 rounded-2xl ring-1 ring-sky-100 p-3 mt-4"><div className="flex-1"><p className="text-sm font-semibold">Share my location during this trip</p><p className="text-xs text-nb-mute">Gives your client a live ETA when GPS is available</p></div><Switch data-testid="trip-share-switch" checked={share} onCheckedChange={setShare} /></div>
        </>
      )}
    </BottomSheet>
  );
}

export default function Visit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { db, cli, svc, pro, api } = usePreview();
  const a = db.appointments.find((x) => x.id === id);
  const [trip, setTrip] = useState(() => { const t = loadTrip(); return t?.id === id ? t : null; });
  const [sheet, setSheet] = useState(false);
  const [back, setBack] = useState(false);
  const [late, setLate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eta, setEta] = useState(null);
  const driving = a?.status === "en_route";
  const geo = useGeolocation(driving && !!trip?.share);
  const p = a && pro(a.practitionerId);
  const origin = geo.lngLat || (a && demoFix(a.practitionerId)?.lngLat);
  const dest = a && clientLngLat(a.clientId);
  const key = JSON.stringify([origin?.map((v) => v.toFixed(3)), dest]);
  useEffect(() => { if (origin && dest) fetchRoute([origin, dest]).then(setEta); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => document.visibilityState === "visible" && loadTrip()?.id === id && setBack(true);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [id]);
  if (!a) return null;
  const c = cli(a.clientId);
  const app = NAV_APPS.find((x) => x.key === (trip?.app || getNavPref()));
  const launch = (x = app) => { window.open(x.url(dest), "_blank", "noopener"); };
  const start = async ({ app: k, share }) => {
    const t = { id, app: k, share, startedAt: Date.now() };
    localStorage.setItem("nb-trip", JSON.stringify(t));
    setTrip(t);
    setSheet(false);
    await api.transition(a.id, "en_route");
    await api.tripEvent(a.id, "started", {}, "Trip started · client alerted (preview)");
    launch(NAV_APPS.find((x) => x.key === k));
  };
  const advance = async () => {
    if (a.status === "confirmed" || a.status === "requested") return setSheet(true);
    setBusy(true);
    const to = nextStatus(a.status);
    if (to === "arrived") { localStorage.removeItem("nb-trip"); setTrip(null); }
    await api.transition(a.id, to, { in_session: "Session started", completed: "Visit completed" }[to]);
    if (to === "arrived") await api.tripEvent(a.id, "arrived", {}, "Arrived · location sharing stopped · client alerted (preview)");
    setBusy(false);
  };
  const e = eta || (origin ? straightEstimate(origin, dest) : null);
  const now = new Date();
  const arrival = e ? timeLabel(hhmm(Math.min(1439, now.getHours() * 60 + now.getMinutes() + e.min))) : "—";
  const geoState = trip?.share ? geo.state : "idle";
  return (
    <div className="relative h-[100dvh] -mb-28 lg:-mb-10 nb-tide overflow-hidden">
      <MapView dark className="absolute inset-0" route={e?.coords} markers={[origin && { id: "me", lngLat: origin, photo: p.photo, state: geo.lngLat ? "live" : "en_route", dim: !geo.lngLat }, { id: "dest", kind: "pin", lngLat: dest, label: c.name.split(" ")[0] }].filter(Boolean)} fit={origin ? [origin, dest] : [dest]} testid="trip-map" />
      <div className="absolute top-10 inset-x-3 lg:left-auto lg:right-4 lg:w-[420px] space-y-2">
        <div className="flex gap-2">
          <button data-testid="trip-back" onClick={() => nav(-1)} className="h-12 w-12 shrink-0 grid place-items-center rounded-2xl nb-glass-dark text-white"><ArrowLeft className="h-5 w-5" /></button>
          <div className="flex-1 rounded-2xl nb-glass-dark text-white px-4 flex items-center justify-between text-sm font-medium"><span className="truncate">{svc(a.serviceId).name} · {timeLabel(a.time)}</span>{driving && <FreshnessPill state={geoState} at={geo.at} />}</div>
        </div>
        {back && driving && (
          <div data-testid="return-banner" className="rounded-2xl bg-white text-nb-ink p-3 flex gap-3 shadow-xl">
            <Smartphone className="h-5 w-5 text-nb-blue shrink-0 mt-0.5" />
            <p className="text-xs flex-1"><span className="font-semibold block text-sm">Welcome back — trip still active</span>GPS may have paused while {app.label} was open. {geo.at ? `Last update ${Math.round((Date.now() - geo.at) / 1000)}s ago.` : "No update received yet."}</p>
            <button data-testid="return-banner-close" onClick={() => setBack(false)}><X className="h-4 w-4 text-nb-mute" /></button>
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 lg:left-auto lg:right-4 lg:bottom-4 lg:w-[420px] rounded-t-[30px] lg:rounded-[30px] bg-white pb-28 lg:pb-5 pt-3 px-5 shadow-2xl max-h-[70dvh] overflow-y-auto" data-testid="trip-panel">
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200 lg:hidden" />
        <div className="grid grid-cols-3 text-center mt-3 pb-3 border-b border-sky-100">
          {[[arrival.replace(/ (AM|PM)/, ""), "Arrival"], [e?.min ?? "—", "min"], [e?.km ?? "—", "km"]].map(([v, l]) => <div key={l}><p className="text-2xl font-semibold nb-num" data-testid={`trip-${l}`}>{v}</p><p className="text-xs text-nb-mute">{l}</p></div>)}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">{e && <CapBadge kind={e.source} />}{!geo.lngLat && <CapBadge kind="demo" />}{geo.lngLat && <CapBadge kind="device" />}</div>
        <div className="flex items-center gap-3 mt-3">
          <Avatar name={c.name} size={44} />
          <div className="flex-1 min-w-0"><p className="font-semibold">{c.name}</p><p className="text-xs text-nb-mute truncate">{a.address} · {money(a.pricing.total)} {a.pay === "paid" ? "paid" : "due at visit"}</p></div>
          <a href={`tel:${c.phone}`} data-testid="trip-call" className="h-11 w-11 grid place-items-center rounded-full bg-sky-50 text-nb-blue"><Phone className="h-4 w-4" /></a>
        </div>
        <div className="mt-4"><Stepper steps={["Confirmed", "En route", "Arrived", "Session", "Done"]} current={a.status === "completed" ? 5 : Math.max(0, TRIP_FLOW.indexOf(a.status))} testid="trip-stepper" /></div>
        {driving && (
          <div className="mt-4 space-y-2">
            <button data-testid="trip-reopen-nav" onClick={() => launch()} className="nb-btn-dark w-full h-12"><ExternalLink className="h-4 w-4" />Open {app.label}</button>
            <div className="flex gap-2 overflow-x-auto no-scrollbar"><span className="text-xs text-nb-mute self-center shrink-0">Didn't open?</span>{availableApps().filter((x) => x.key !== app.key).map((x) => <button key={x.key} data-testid={`trip-fallback-${x.key}`} onClick={() => launch(x)} className="nb-chip-off h-8 text-xs shrink-0">{x.label}</button>)}<button data-testid="trip-copy-address" onClick={() => { navigator.clipboard?.writeText(a.address); toast.success("Address copied"); }} className="nb-chip-off h-8 text-xs shrink-0"><Copy className="h-3 w-3" />Copy address</button></div>
            {trip?.share && <button data-testid="trip-stop-sharing" onClick={() => { const t = { ...trip, share: false }; localStorage.setItem("nb-trip", JSON.stringify(t)); setTrip(t); toast("Location sharing stopped"); }} className="text-xs text-nb-coral font-semibold flex items-center gap-1"><Lock className="h-3 w-3" />Stop sharing my location</button>}
            {geoState === "denied" && <Notice testid="geo-denied-notice">Location permission was denied. Your client sees status updates only. Enable location for this site in browser settings to share ETA.</Notice>}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          {a.status === "completed" ? (
            <button data-testid="trip-soap-btn" onClick={() => nav(`/pro/soap/${a.id}`)} className="nb-btn-primary flex-1 h-14"><FileText className="h-5 w-5" />{a.soap === "signed" ? "View SOAP note" : "Write SOAP note"}</button>
          ) : (
            <button data-testid="trip-primary-btn" disabled={busy} onClick={advance} className={cx("nb-btn flex-1 h-14 text-white text-base", a.status === "in_session" ? "bg-nb-green" : "nb-lagoon")}>{busy ? "Updating…" : TRIP_ACTION[a.status === "requested" ? "confirmed" : a.status]}{a.status === "in_session" && <Check className="h-5 w-5" />}</button>
          )}
          {driving && <button data-testid="trip-late-btn" aria-label="Running late" onClick={() => setLate(true)} className="nb-btn-ghost h-14 px-4"><MessageSquareWarning className="h-5 w-5" /></button>}
        </div>
        <div className="mt-5 pt-4 border-t border-sky-100"><TripHistory apptId={a.id} name={p.name.split(" ")[0]} testid="visit-trip-history" /></div>
        <Link to={`/pro/visit/${a.id}/native`} data-testid="native-nav-link" className="mt-4 flex items-center justify-between rounded-2xl bg-amber-50 ring-1 ring-amber-200 px-4 h-12 text-sm"><span className="font-medium text-amber-900">Preview in-app navigation</span><CapBadge kind="native" /></Link>
      </div>
      <LateSheet open={late} onOpenChange={setLate} name={c.name.split(" ")[0]} onSend={async (x) => { setLate(false); await api.tripEvent(a.id, "late", x, `Late alert recorded · ${x.delay} min (preview, not sent)`); }} />
      <StartTripSheet open={sheet} onOpenChange={setSheet} a={a} c={c} origin={origin} eta={e} onStart={start} />
    </div>
  );
}
