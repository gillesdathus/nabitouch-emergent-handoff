import { useState } from "react";
import { Phone, MessageCircle, ShieldCheck, MapPinOff, Check } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { MapView, CapBadge, FreshnessPill } from "@/components/MapView";
import { Avatar, Notice, cx } from "@/components/ui-kit";
import { timeLabel } from "@/lib/domain";
import { clientLngLat, demoFix, straightEstimate } from "@/lib/geo";
import { LatestAlert, TripHistory } from "@/components/TripAlerts";

const PREVIEW = [["before", "Before trip"], ["enroute", "On the way"], ["stale", "Location stale"], ["hidden", "Not shared"], ["arrived", "Arrived"]];
const STEPS = [["Booked", "Yesterday 6:12 PM"], ["Confirmed", "Yesterday 6:40 PM"], ["Trip started", "10:44 AM"], ["On the way", "10:46 AM"], ["Arrived", ""], ["In session", ""]];

export default function Track() {
  const { db, pro, svc } = usePreview();
  const [s, setS] = useState("enroute");
  const a = db.appointments.find((x) => x.id === "a02");
  const p = pro(a.practitionerId);
  const fix = demoFix(p.id);
  const dest = clientLngLat(a.clientId);
  const showMap = s === "enroute" || s === "stale";
  const at = s === "stale" ? Date.now() - 6 * 60e3 : fix.at;
  const e = straightEstimate(fix.lngLat, dest);
  const reached = { before: 2, enroute: 4, stale: 4, hidden: 4, arrived: 5 }[s];
  return (
    <div className="max-w-5xl mx-auto px-5 pt-5 pb-10">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mb-3"><span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 shrink-0">Preview state</span>{PREVIEW.map(([k, l]) => <button key={k} data-testid={`track-state-${k}`} onClick={() => setS(k)} className={cx(s === k ? "nb-chip-on" : "nb-chip-off", "h-8 text-xs shrink-0")}>{l}</button>)}</div>
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="relative rounded-[30px] overflow-hidden h-[48vh] lg:h-[600px]">
          {showMap ? (
            <MapView className="absolute inset-0" route={e.coords} markers={[{ id: "pro", lngLat: fix.lngLat, photo: p.photo, state: "en_route", dim: s === "stale", label: p.name.split(" ")[0] }, { id: "home", kind: "pin", lngLat: dest, label: "You" }]} fit={[fix.lngLat, dest]} testid="track-map" />
          ) : (
            <div data-testid="track-no-map" className="absolute inset-0 bg-gradient-to-br from-sky-50 to-nb-mint grid place-items-center p-6 text-center">
              <div>{s === "arrived" ? <Check className="h-10 w-10 mx-auto text-nb-teal nb-pop" /> : <MapPinOff className="h-10 w-10 mx-auto text-nb-mute" />}<p className="font-semibold mt-2">{s === "arrived" ? `${p.name.split(" ")[0]} has arrived` : s === "before" ? "Map appears when the trip starts" : "Location isn't being shared"}</p><p className="text-xs text-nb-mute mt-1 max-w-xs">{s === "hidden" ? "Your therapist is on the way, but live location is off or GPS is unavailable. You'll still get status updates." : "Your therapist's position is shown only during an active trip."}</p></div>
            </div>
          )}
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5"><span className="nb-glass rounded-full px-3 h-8 inline-flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="h-3.5 w-3.5 text-nb-teal" />Shared only for this visit</span>{showMap && <CapBadge kind="demo" />}</div>
        </div>
        <div className="space-y-3">
          <div data-testid="eta-card" className="nb-card p-4">
            <div className="flex items-center gap-3">
              <Avatar src={p.photo} name={p.name} size={52} />
              <div className="flex-1 min-w-0"><p className="font-semibold">{p.name}</p><p className="text-xs text-nb-mute">{svc(a.serviceId).name} · {timeLabel(a.time)}</p></div>
              <a href="tel:7805550100" data-testid="track-call-btn" className="h-11 w-11 grid place-items-center rounded-full bg-sky-50"><Phone className="h-4 w-4 text-nb-blue" /></a>
              <button data-testid="track-message-btn" className="h-11 w-11 grid place-items-center rounded-full bg-sky-50"><MessageCircle className="h-4 w-4 text-nb-blue" /></button>
            </div>
            <div className="rounded-3xl nb-lagoon text-white p-4 mt-4">
              <p className="text-xs text-white/70">{s === "arrived" ? "Status" : s === "before" ? "Scheduled" : "Estimated arrival"}</p>
              <p data-testid="track-eta" className="text-3xl font-semibold nb-num">{s === "arrived" ? "Arrived" : s === "before" ? timeLabel(a.time) : `${e.min} min`}</p>
              {(s === "enroute" || s === "stale") && <p className="text-xs text-white/75 mt-1">{e.km} km away · route estimate</p>}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {s === "enroute" && <FreshnessPill state="live" at={at} />}
              {s === "stale" && <FreshnessPill state="stale" at={at} />}
              {s === "hidden" && <FreshnessPill state="idle" />}
              {(s === "enroute" || s === "stale") && <CapBadge kind="estimate" />}
            </div>
            {s === "stale" && <Notice className="mt-3">We haven't received a location update for a few minutes — your therapist's phone may be in their navigation app. The ETA may be out of date.</Notice>}
          </div>
          {s !== "before" && <LatestAlert apptId={a.id} name={p.name.split(" ")[0]} testid="track-latest-alert" />}
          <div className="nb-card p-4"><TripHistory apptId={a.id} name={p.name.split(" ")[0]} testid="track-trip-history" /></div>
          <div className="nb-card p-4" data-testid="track-timeline">
            <p className="font-semibold mb-3">Visit progress</p>
            {STEPS.map(([t, time], i) => (
              <div key={t} className="flex gap-3">
                <div className="flex flex-col items-center"><span className={cx("h-6 w-6 rounded-full grid place-items-center", i < reached ? "bg-nb-turq text-white" : i === reached ? "bg-nb-blue text-white ring-4 ring-nb-blue/20" : "bg-white ring-1 ring-sky-200")}>{i < reached && <Check className="h-3.5 w-3.5" />}</span>{i < STEPS.length - 1 && <span className={cx("w-0.5 flex-1 min-h-[22px]", i < reached ? "bg-nb-turq" : "bg-sky-100")} />}</div>
                <div className="pb-3"><p className={cx("text-sm font-medium", i > reached && "text-nb-mute")}>{t}</p>{i < reached && time && <p className="text-xs text-nb-mute">{time}</p>}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
