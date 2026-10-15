import { useEffect, useMemo, useState } from "react";
import { Search, Map as MapIcon, List, EyeOff, Phone, MessageSquare, UserRoundCog, CalendarDays, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { usePreview } from "@/store/PreviewStore";
import { MapView, CapBadge, FreshnessPill } from "@/components/MapView";
import { Avatar, StatusPill, Stepper, Notice, Segmented, BottomSheet, Pill, ProgressRail, cx } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { isFree } from "@/lib/schedule";
import { todayISO, timeLabel, TRIP_FLOW, fmtDate } from "@/lib/domain";
import { demoFix, clientLngLat, zoneCoords, fetchRoute, straightEstimate, freshness, hasMapbox } from "@/lib/geo";

const STATES = [["all", "All"], ["available", "Available"], ["assigned", "Assigned"], ["en_route", "En route"], ["arrived", "Arrived"], ["in_session", "In session"], ["offline", "Offline"]];
const LABEL = Object.fromEntries(STATES);

function useFleet() {
  const { db } = usePreview();
  const T = todayISO();
  return db.practitioners.map((p) => {
    const today = db.appointments.filter((a) => a.practitionerId === p.id && a.date === T && a.status !== "cancelled").sort((x, y) => x.time.localeCompare(y.time));
    const live = today.find((a) => ["en_route", "arrived", "in_session"].includes(a.status));
    const next = today.find((a) => a.status === "confirmed");
    const fix = demoFix(p.id);
    const fresh = fix ? freshness(fix.at) : "offline";
    const state = !fix || p.status !== "active" ? "offline" : live ? live.status : next ? "assigned" : "available";
    return { p, today, cur: live || next, fix, fresh, state };
  });
}

function EtaLine({ from, to, hide }) {
  const [r, setR] = useState(null);
  const key = JSON.stringify([from, to]);
  useEffect(() => { if (from && to) fetchRoute([from, to]).then(setR); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (hide) return <p className="text-xs text-nb-mute">ETA hidden by permission</p>;
  if (!from) return <p className="text-xs text-nb-mute">No position — ETA unavailable</p>;
  const e = r || straightEstimate(from, to);
  return <div className="flex items-center gap-2 flex-wrap"><span className="text-lg font-semibold nb-num">{e.min} min</span><span className="text-xs text-nb-mute nb-num">{e.km} km</span><CapBadge kind={e.source} /></div>;
}

function AssignSheet({ appt, onClose }) {
  const { db, svc, cli, api } = usePreview();
  const fleet = useFleet();
  if (!appt) return <BottomSheet open={false} onOpenChange={onClose} title="" testid="assign-sheet" />;
  const dest = clientLngLat(appt.clientId);
  const ranked = fleet.filter((f) => f.p.bookable && f.p.specialties.includes(appt.serviceId)).map((f) => {
    const free = f.p.id === appt.practitionerId || isFree(db, f.p.id, appt.date, appt.time, appt.duration);
    const eta = f.fix ? straightEstimate(f.fix.lngLat, dest) : null;
    const score = Math.round((free ? 60 : 0) + (eta ? Math.max(0, 40 - eta.min) : 0));
    return { ...f, free, eta, score };
  }).sort((a, b) => b.score - a.score);
  const assign = async (pid) => { await api.save("appointments", appt.id, { practitionerId: pid, status: "confirmed" }, null); toast.success("Trip assigned", { description: `${db.practitioners.find((p) => p.id === pid).name} · ${cli(appt.clientId).name}` }); onClose(); };
  const best = ranked[0];
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title="Assign practitioner" sub={`${cli(appt.clientId).name} · ${svc(appt.serviceId).name} · ${timeLabel(appt.time)}`} testid="assign-sheet">
      {best && (
        <div data-testid="assign-best-match" className="rounded-[26px] nb-lagoon text-white p-4 mb-4">
          <p className="text-xs text-white/70 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />Best match found</p>
          <div className="flex items-center gap-3 mt-2"><Avatar src={best.p.photo} name={best.p.name} size={48} /><div className="flex-1"><p className="font-semibold">{best.p.name}</p><p className="text-xs text-white/75">{best.free ? "Free at this time" : "Busy"} · {best.eta ? `${best.eta.km} km · ~${best.eta.min} min` : "no position"}</p></div><span className="text-2xl font-semibold nb-num">{best.score}%</span></div>
          <button data-testid="assign-best-btn" disabled={!best.free} onClick={() => assign(best.p.id)} className="nb-btn w-full h-12 mt-3 bg-white text-nb-ink">Confirm dispatch</button>
        </div>
      )}
      <p className="nb-eyebrow mb-2">Other options</p>
      {ranked.slice(1).map((f) => (
        <div key={f.p.id} className="flex items-center gap-3 py-3 border-b border-sky-100">
          <Avatar src={f.p.photo} name={f.p.name} size={40} /><div className="flex-1 min-w-0"><p className="text-sm font-semibold">{f.p.name}</p><p className="text-xs text-nb-mute">{f.free ? "Free" : "Conflict at this time"} · {f.eta ? `${f.eta.km} km` : "no position"}</p></div>
          <span className="text-sm font-semibold nb-num w-10 text-right">{f.score}%</span>
          <button data-testid={`assign-${f.p.id}`} disabled={!f.free} onClick={() => assign(f.p.id)} className="nb-btn-ghost h-9 px-3 text-xs">Assign</button>
        </div>
      ))}
      <Notice className="mt-3">Distances use demo positions and straight-line estimates{hasMapbox ? "" : " (Mapbox not configured)"}. The server re-checks availability on assignment.</Notice>
    </BottomSheet>
  );
}

function PractitionerSheet({ f, onClose, onAssign }) {
  const { cli, svc, role, db, openAppt } = usePreview();
  const perms = db.settings.receptionPerms;
  const desk = role === "desk";
  if (!f) return <BottomSheet open={false} onOpenChange={onClose} title="" testid="fleet-pro-sheet" />;
  const { p, cur, today, fix, fresh, state } = f;
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={p.name} sub={p.title} testid="fleet-pro-sheet">
      <div className="flex items-center gap-3 mb-4"><Avatar src={p.photo} name={p.name} size={56} /><div className="flex flex-wrap gap-1.5"><Pill tone="bg-nb-ink text-white ring-nb-ink">{LABEL[state]}</Pill>{!(desk && !perms.viewLocations) && <FreshnessPill state={fresh} at={fix?.at} />}{fix && <CapBadge kind="demo" />}</div></div>
      {cur ? (
        <div className="rounded-3xl ring-1 ring-sky-100 p-4">
          <div className="flex items-center justify-between"><p className="text-xs text-nb-mute">Current visit</p><StatusPill status={cur.status} /></div>
          <p className="font-semibold mt-1">{cli(cur.clientId).name} · {svc(cur.serviceId).name}</p>
          <p className="text-xs text-nb-mute">{timeLabel(cur.time)} · {desk && !perms.viewAddresses ? "Address hidden" : cur.address}</p>
          <div className="mt-3"><EtaLine from={desk && !perms.viewLocations ? null : fix?.lngLat} to={clientLngLat(cur.clientId)} hide={desk && !perms.viewEta} /></div>
          <div className="mt-4"><Stepper steps={["Assigned", "En route", "Arrived", "Session"]} current={Math.max(0, TRIP_FLOW.indexOf(cur.status))} testid="fleet-sheet-stepper" /></div>
        </div>
      ) : <Notice tone="info" icon={CheckCircle2}>No active or upcoming visit today.</Notice>}
      <p className="nb-eyebrow mt-5 mb-2">Today · {today.filter((a) => a.status === "completed").length}/{today.length} done</p>
      <ProgressRail value={today.length ? today.filter((a) => a.status === "completed").length / today.length : 0} />
      <div className="mt-3 space-y-1">{today.map((a) => <button key={a.id} onClick={() => openAppt(a.id)} className="w-full flex items-center justify-between py-2 text-sm"><span className="nb-num">{timeLabel(a.time)} · {cli(a.clientId).name}</span><StatusPill status={a.status} /></button>)}</div>
      <div className="grid grid-cols-3 gap-2 mt-5">
        <a href="tel:7805550100" data-testid="fleet-call" className="nb-btn-ghost h-11 text-xs"><Phone className="h-4 w-4" />Call</a>
        <button data-testid="fleet-message" onClick={() => toast("Messaging is not connected in this preview")} className="nb-btn-ghost h-11 text-xs"><MessageSquare className="h-4 w-4" />Message</button>
        {cur && (role === "owner" || perms.assign) ? <button data-testid="fleet-reassign" onClick={() => onAssign(cur)} className="nb-btn-dark h-11 text-xs"><UserRoundCog className="h-4 w-4" />Reassign</button> : <button disabled className="nb-btn-ghost h-11 text-xs">Reassign</button>}
      </div>
    </BottomSheet>
  );
}

function DispatchBoard({ onAssign }) {
  const { db, cli, svc, pro, role } = usePreview();
  const canAssign = role === "owner" || db.settings.receptionPerms.assign;
  const T = todayISO();
  const upcoming = db.appointments.filter((a) => a.date >= T && a.status !== "cancelled" && a.status !== "completed");
  const cols = [["Needs assignment", upcoming.filter((a) => a.status === "requested")], ["Assigned", upcoming.filter((a) => a.status === "confirmed")], ["On trip", upcoming.filter((a) => ["en_route", "arrived"].includes(a.status))], ["In session", upcoming.filter((a) => a.status === "in_session")]];
  return (
    <div data-testid="dispatch-board" className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
      {cols.map(([t, list]) => (
        <section key={t} className="rounded-[26px] bg-white/60 ring-1 ring-sky-100 p-3">
          <p className="text-sm font-semibold px-1 mb-2 flex items-center justify-between">{t}<span className="h-6 min-w-6 px-2 rounded-full bg-nb-ink text-white text-xs grid place-items-center">{list.length}</span></p>
          <div className="space-y-2">
            {list.length === 0 && <p className="text-xs text-nb-mute px-1 py-4 text-center">Nothing here</p>}
            {list.map((a) => (
              <div key={a.id} data-testid={`dispatch-card-${a.id}`} className="rounded-2xl bg-white ring-1 ring-sky-100 p-3">
                <div className="flex items-center justify-between"><p className="text-sm font-semibold truncate">{cli(a.clientId).name}</p><StatusPill status={a.status} /></div>
                <p className="text-xs text-nb-mute truncate">{svc(a.serviceId).name} · {a.date === T ? "Today" : fmtDate(a.date)} {timeLabel(a.time)}</p>
                <div className="flex items-center justify-between mt-2"><span className="flex items-center gap-1.5 text-xs"><Avatar src={pro(a.practitionerId).photo} name="" size={22} />{pro(a.practitionerId).name.split(" ")[0]}</span>{canAssign && <button data-testid={`dispatch-assign-${a.id}`} onClick={() => onAssign(a)} className="nb-btn-dark h-8 px-3 text-[11px]">{a.status === "requested" ? "Assign" : "Reassign"}</button>}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Fleet() {
  const { db, role, cli } = usePreview();
  const fleet = useFleet();
  const [tab, setTab] = useState("fleet");
  const [view, setView] = useState("map");
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [assign, setAssign] = useState(null);
  const perms = db.settings.receptionPerms;
  const hideLoc = role === "desk" && !perms.viewLocations;
  const list = fleet.filter((x) => (f === "all" || x.state === f) && x.p.name.toLowerCase().includes(q.toLowerCase()));
  const selected = fleet.find((x) => x.p.id === sel);
  const route = useMemo(() => (selected?.fix && selected.cur ? [selected.fix.lngLat, clientLngLat(selected.cur.clientId)] : null), [selected]);
  const markers = hideLoc ? [] : [
    ...list.filter((x) => x.fix).map((x) => ({ id: x.p.id, lngLat: x.fix.lngLat, photo: x.p.photo, state: x.state, dim: x.fresh !== "live", pulse: x.state === "en_route" && x.fresh === "live", label: x.p.name.split(" ")[0], onClick: () => setSel(x.p.id) })),
    ...(selected?.cur ? [{ id: "dest", kind: "pin", lngLat: clientLngLat(selected.cur.clientId), label: cli(selected.cur.clientId).name.split(" ")[0] }] : []),
  ];
  const Row = ({ x }) => (
    <button data-testid={`fleet-row-${x.p.id}`} onClick={() => setSel(x.p.id)} className={cx("w-full text-left rounded-3xl bg-white ring-1 p-3.5 transition-shadow hover:shadow-md", sel === x.p.id ? "ring-nb-blue/50" : "ring-sky-100")}>
      <div className="flex items-center gap-3">
        <Avatar src={x.p.photo} name={x.p.name} size={42} className={x.state === "offline" ? "grayscale opacity-60" : ""} />
        <div className="flex-1 min-w-0"><p className="font-semibold text-sm">{x.p.name}</p><p className="text-xs text-nb-mute truncate">{x.cur ? `${cli(x.cur.clientId).name} · ${timeLabel(x.cur.time)}` : "No visit assigned"}</p></div>
        <Pill tone="bg-nb-ink text-white ring-nb-ink">{LABEL[x.state]}</Pill>
      </div>
      {!hideLoc && <div className="mt-2"><FreshnessPill state={x.fresh} at={x.fix?.at} testid={`fleet-fresh-${x.p.id}`} /></div>}
    </button>
  );
  return (
    <div className="max-w-7xl mx-auto px-5 pt-12 lg:pt-14">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div><p className="nb-eyebrow mb-1">Operations</p><h1 className="text-[28px] sm:text-4xl font-semibold tracking-tight">Live Fleet</h1></div>
        <TopIcons base={`/${role}`} />
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Segmented testid="fleet-tabs" value={tab} onChange={setTab} options={[{ value: "fleet", label: "Fleet" }, { value: "dispatch", label: "Dispatch board" }]} />
        {tab === "fleet" && <Segmented testid="fleet-view" value={view} onChange={setView} className="lg:hidden" options={[{ value: "map", label: <MapIcon className="h-4 w-4" /> }, { value: "list", label: <List className="h-4 w-4" /> }]} />}
        <CapBadge kind="demo" />
      </div>
      {tab === "dispatch" ? <DispatchBoard onAssign={setAssign} /> : (
        <>
          <div className="relative mb-3"><Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-nb-mute" /><input data-testid="fleet-search" className="nb-input pl-11 rounded-full" placeholder="Search practitioners" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 mb-4">{STATES.map(([k, l]) => <button key={k} data-testid={`fleet-filter-${k}`} onClick={() => setF(k)} className={f === k ? "nb-chip-on" : "nb-chip-off"}>{l}<span className="text-[10px] opacity-70">{k === "all" ? fleet.length : fleet.filter((x) => x.state === k).length}</span></button>)}</div>
          <div className="grid lg:grid-cols-[1fr_380px] gap-4">
            <div className={cx("relative", view === "list" && "hidden lg:block")}>
              <MapView className="h-[56vh] lg:h-[640px] rounded-[28px]" zones={db.zones.map((z) => ({ ...z, coords: zoneCoords(z) }))} markers={markers} route={route} fit={route || undefined} testid="fleet-map">
                {hideLoc && <div className="absolute inset-0 grid place-items-center bg-white/40"><div data-testid="fleet-locations-hidden" className="nb-glass rounded-3xl p-5 text-center max-w-xs"><EyeOff className="h-6 w-6 mx-auto text-nb-mute" /><p className="font-semibold mt-2">Locations hidden</p><p className="text-xs text-nb-mute">Reception live-location permission is off.</p></div></div>}
              </MapView>
            </div>
            <div className={cx("space-y-2", view === "map" && "hidden lg:block")}>
              {list.map((x) => <Row key={x.p.id} x={x} />)}
              {list.length === 0 && <p className="text-sm text-nb-mute text-center py-6">No practitioners match.</p>}
            </div>
            {view === "map" && <div className="lg:hidden flex gap-2 overflow-x-auto no-scrollbar snap-x -mx-5 px-5">{list.map((x) => <div key={x.p.id} className="snap-start shrink-0 w-[80%]"><Row x={x} /></div>)}</div>}
          </div>
          <Notice className="mt-4" icon={CalendarDays}>Positions shown are demo data with fixed timestamps — nothing moves unless a real trip session reports GPS. Stale and offline states appear when updates stop.</Notice>
        </>
      )}
      <PractitionerSheet f={selected} onClose={() => setSel(null)} onAssign={(a) => { setSel(null); setAssign(a); }} />
      {assign && <AssignSheet appt={assign} onClose={() => setAssign(null)} />}
    </div>
  );
}
