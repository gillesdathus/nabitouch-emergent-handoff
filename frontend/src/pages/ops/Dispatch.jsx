import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { List, Map as MapIcon, Lock, AlertTriangle, Wifi, WifiOff, Satellite } from "lucide-react";
import { LiveMap } from "@/components/LiveMap";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { Avatar, StatusPill, PayPill, SectionHead, Pill } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { todayISO, fmtTime, fmtStamp } from "@/lib/domain";
import { shouldShowPosition, trackingPhaseCopy } from "@/lib/tracking/live";
import { etaCopy } from "@/lib/tracking/providers";
import { Notice } from "@/components/tide";
import { TurnaroundBoard } from "@/components/session/TurnaroundBoard";

function GpsTrialPicker() {
  const { state, idx, api, run } = useDemo();
  const cur = idx.settings?.liveGpsPractitionerId || "";
  const set = (v) => run(() => api.patch("settings", "app", { liveGpsPractitionerId: v || null, _actor: "Owner", _audit: v ? `Live GPS trial enabled for ${idx.practitioners[v]?.name}` : "Live GPS trial turned off" }), v ? "Live GPS trial on" : "Live GPS trial off");
  return (
    <div className="nb-card flex flex-wrap items-center gap-3 p-4" data-testid="gps-trial-card">
      <Satellite className="h-5 w-5 text-nb-teal" />
      <div className="min-w-[200px] flex-1"><p className="text-sm font-semibold">Phone GPS</p><p className="text-xs text-nb-mute">This practitioner’s open visit page can publish phone GPS. Other visits stay off the map until a tracking session has a position.</p></div>
      <select className="nb-input h-10 w-auto" value={cur} onChange={(e) => set(e.target.value)} data-testid="gps-trial-select"><option value="">No phone GPS selected</option>{state.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </div>
  );
}

const COLS = [["Upcoming", ["requested", "confirmed", "assigned", "preparing"]], ["On the way", ["en_route"]], ["On site", ["arrived", "in_session", "interrupted"]], ["Wrap-up", ["session_ended", "soap_pending", "soap_completed", "leaving"]], ["Done & exceptions", ["completed", "processing", "closed", "cancelled", "no_show"]]];

export default function Dispatch({ role }) {
  const { state, idx, perm, api } = useDemo();
  const [sessions, setSessions] = useState({});
  useEffect(() => {
    const load = () => api.trackingActive(role === "owner" ? "owner:demo" : "desk:demo").then((l) => setSessions(Object.fromEntries(l.map((s) => [s.appointmentId, s])))).catch(() => setSessions({}));
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, [role, api]);
  const [view, setView] = useState("map");
  const [pf, setPf] = useState("all");
  const [sel, setSel] = useState(null);
  const can = (k) => role === "owner" || perm(k);
  const today = state.appointments.filter((a) => a.date === todayISO() && (pf === "all" || a.practitionerId === pf));
  const fleet = today.map((a) => ({ a, sess: sessions[a.id], p: idx.practitioners[a.practitionerId] })).filter((x) => x.p && (x.a.status === "en_route" || x.sess) && (role === "owner" || x.sess));
  const located = fleet.filter((x) => shouldShowPosition(x.sess));
  const anyLive = located.some((x) => x.sess.source === "gps" && x.sess.phase === "live" && !x.sess.stale);
  const showLoc = can("viewLocations");

  return (
    <div className="space-y-6" data-testid={`${role}-dispatch`}>
      <SectionHead eyebrow={role === "owner" ? "Operations" : "Coordination"} title="Live Fleet" action={
        <div className="flex rounded-full bg-white p-1 ring-1 ring-sky-100">{[["map", MapIcon], ["list", List]].map(([v, I]) => <button key={v} onClick={() => setView(v)} data-testid={`dispatch-view-${v}`} aria-pressed={view === v} className={`flex h-9 items-center gap-1 rounded-full px-4 text-sm font-medium ${view === v ? "bg-nb-ink text-white" : "text-nb-mute"}`}><I className="h-4 w-4" />{v === "map" ? "Map" : "Board"}</button>)}</div>} />
      <TurnaroundBoard people={idx.practitioners} compact={role !== "owner"} />
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <button onClick={() => setPf("all")} data-testid="dispatch-filter-all" className={pf === "all" ? "nb-chip-on" : "nb-chip-off"}>All practitioners</button>
        {state.practitioners.map((p) => <button key={p.id} onClick={() => setPf(p.id)} data-testid={`dispatch-filter-${p.id}`} className={pf === p.id ? "nb-chip-on" : "nb-chip-off"}><Avatar person={p} size={20} />{p.name.split(" ")[0]}{!p.available && " (off)"}</button>)}
      </div>

      {role === "owner" && <GpsTrialPicker />}
      {view === "map" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          {showLoc ? (
            located.length ? <LiveMap height={520} testid="dispatch-map" tag={anyLive ? "Live GPS" : located.some((x) => x.sess.stale) ? "Last position" : "Tracking session"} routes={located.filter((x) => x.sess.route?.length).map((x) => x.sess.route)} dests={located.filter((x) => can("viewAddresses") && x.a.address).map((x) => ({ pos: x.a.address, label: fmtTime(x.a.time) }))}
              markers={located.map(({ a, sess, p }) => ({ id: a.id, pos: sess.position, initials: p.initials, color: p.color, label: can("viewEta") && sess.eta ? `${sess.eta.etaMin} min` : null, onClick: () => setSel(a.id) }))} />
              : <div className="grid h-[520px] place-items-center rounded-[28px] bg-gradient-to-br from-sky-50 to-nb-mint text-center" data-testid="dispatch-map"><p className="max-w-xs text-sm text-nb-mute">No live positions. The map stays empty until an authorized tracking session has a fresh or stale fix.</p></div>
          ) : <div className="nb-soft flex h-[520px] flex-col items-center justify-center gap-2 rounded-[28px] text-sm text-nb-mute" data-testid="dispatch-map-restricted"><Lock className="h-6 w-6" />Live locations are not enabled for your role. Ask the owner to grant access.</div>}
          <div className="space-y-3">
            <p className="nb-label">On a trip ({fleet.length})</p>
            {fleet.map(({ a, sess, p }) => {
              const gps = sess?.source === "gps" && sess.phase === "live" && !sess.stale;
              return (
              <button key={a.id} onClick={() => setSel(a.id)} data-testid={`dispatch-trip-${a.id}`} className="nb-card w-full rounded-3xl p-4 text-left">
                <div className="flex items-center gap-3"><Avatar person={p} size={36} /><div className="flex-1"><p className="text-sm font-semibold">{p.name} → {idx.clients[a.clientId]?.firstName}{gps && <span className="ml-2 rounded-full bg-teal-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white" data-testid={`trip-live-badge-${a.id}`}>Live GPS</span>}</p><p className="text-xs text-nb-mute">{can("viewAddresses") ? a.address?.line : "Address hidden"}</p></div>
                  {can("viewEta") && sess?.eta && <div className="text-right"><p className="nb-num text-lg font-semibold text-nb-navy">{sess.eta.etaMin}m</p><p className="text-[10px] text-nb-mute">{etaCopy(sess.eta.provider)}</p></div>}</div>
                {a.delayMin > 0 && <p className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700" data-testid={`late-indicator-${a.id}`}><AlertTriangle className="h-3.5 w-3.5" />Recorded delay +{a.delayMin} min. In-app status only, not an SMS.</p>}
                {sess?.stale && <p className="mt-2 flex items-center gap-1 text-xs text-rose-700" data-testid={`signal-stale-${a.id}`}><WifiOff className="h-3.5 w-3.5" />{sess.ageSec == null ? "No GPS fix received yet" : `Signal stale · last fix ${Math.round(sess.ageSec)} s ago`}</p>}
                {sess && !sess.stale && shouldShowPosition(sess) && <p className="mt-2 flex items-center gap-1 text-xs text-teal-700" data-testid={`signal-live-${a.id}`}><Wifi className="h-3.5 w-3.5" />{gps ? "Live signal" : "Tracking position"}{sess.ageSec != null ? ` · ${Math.round(sess.ageSec)} s ago` : ""}{sess.source !== "gps" ? " · not phone GPS" : ""}</p>}
                {sess && !shouldShowPosition(sess) && <p className="mt-2 text-xs text-nb-mute">{trackingPhaseCopy(sess.phase) || "Sharing has not produced a position."}</p>}
                {!sess && <p className="mt-2 text-xs text-nb-mute">En route. Location sharing has not started, so no marker is drawn.</p>}
              </button>
              );
            })}
            {fleet.length === 0 && <p className="text-sm text-nb-mute">The fleet is empty. A visit appears here after On My Way, and a marker appears only when sharing has a position.</p>}
            <Notice testid="fleet-trip-alerts">Trip status on this board is operational. SMS and push are not sent. <Link to={role === "owner" ? "/owner/messages" : "/desk/messages"} className="font-semibold text-nb-blue">Open visit messages</Link></Notice>
          </div>
        </div>
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:grid lg:grid-cols-5 lg:px-0">
          {COLS.map(([title, sts]) => { const items = today.filter((a) => sts.includes(a.status)).sort((a, b) => a.time.localeCompare(b.time)); return (
            <div key={title} className="w-72 shrink-0 lg:w-auto" data-testid={`dispatch-col-${title.toLowerCase().replace(/\W+/g, "-")}`}>
              <p className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-nb-mute">{title}<span className="rounded-full bg-white px-2 py-0.5">{items.length}</span></p>
              <div className="space-y-3">{items.map((a) => { const sess = sessions[a.id]; return (
                <button key={a.id} onClick={() => setSel(a.id)} data-testid={`dispatch-card-${a.id}`} className="nb-card w-full space-y-2 rounded-3xl p-4 text-left transition-transform hover:-translate-y-0.5">
                  <div className="flex items-center justify-between"><span className="text-sm font-semibold">{fmtTime(a.time)}</span><StatusPill status={a.status} /></div>
                  <p className="text-sm">{idx.clients[a.clientId]?.firstName} · {idx.services[a.serviceSlug].name}</p>
                  <p className="text-xs text-nb-mute">{idx.practitioners[a.practitionerId]?.name || <span className="text-amber-700">Unassigned</span>}</p>
                  {can("viewAddresses") && <p className="truncate text-[11px] text-nb-mute">{a.address.line}</p>}
                  {sess?.eta && can("viewEta") && <Pill tone="cyan">ETA {sess.eta.etaMin} min · estimate</Pill>}
                  <p className="text-[10px] text-nb-mute">Arr {fmtStamp(a.timestamps?.arrived)} · Start {fmtStamp(a.timestamps?.in_session)} · End {fmtStamp(a.timestamps?.session_ended)} · Left {fmtStamp(a.timestamps?.leaving)}</p>
                  {(can("managePayments") || can("viewInsuranceStatus")) && <PayPill status={a.paymentStatus} />}
                  {a.delayMin > 0 && <Pill tone="amber">Delayed +{a.delayMin}m</Pill>}
                </button>); })}</div>
            </div>); })}
        </div>
      )}
      {sel && <AppointmentSheet apptId={sel} role={role} onClose={() => setSel(null)} />}
    </div>
  );
}
