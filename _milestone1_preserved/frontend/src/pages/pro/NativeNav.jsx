import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CornerUpRight, ArrowUp, CornerUpLeft, Volume2, VolumeX, LocateFixed, RefreshCw, WifiOff, MapPinCheck, ShieldAlert, Flag } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { MapView, CapBadge } from "@/components/MapView";
import { cx } from "@/components/ui-kit";
import { clientLngLat, demoFix, straightEstimate } from "@/lib/geo";

const STATES = [["nav", "Navigating"], ["reroute", "Rerouting"], ["offline", "Offline"], ["arrival", "Arrival detected"], ["permission", "Background permission"]];

export default function NativeNav() {
  const { id } = useParams();
  const nav = useNavigate();
  const { db, cli } = usePreview();
  const [s, setS] = useState("nav");
  const [voice, setVoice] = useState(true);
  const a = db.appointments.find((x) => x.id === id);
  if (!a) return null;
  const c = cli(a.clientId);
  const from = demoFix(a.practitionerId)?.lngLat;
  const to = clientLngLat(a.clientId);
  const e = from ? straightEstimate(from, to) : null;
  return (
    <div className="relative h-[100dvh] -mb-28 lg:-mb-10 nb-tide overflow-hidden" data-testid="native-nav">
      <MapView dark className="absolute inset-0" route={e?.coords} markers={[from && { id: "me", lngLat: from, photo: "/img/team/amira.jpg", state: "en_route" }, { id: "d", kind: "pin", lngLat: to }].filter(Boolean)} fit={from ? [from, to] : [to]} testid="native-map" />
      <div className="absolute top-10 inset-x-3 lg:max-w-md space-y-2">
        <div className="flex items-center gap-2"><button data-testid="native-back" onClick={() => nav(-1)} className="h-11 w-11 grid place-items-center rounded-2xl nb-glass-dark text-white"><ArrowLeft className="h-5 w-5" /></button><CapBadge kind="native" /></div>
        {s === "reroute" ? (
          <div data-testid="native-reroute" className="rounded-3xl bg-nb-blue text-white p-4 flex items-center gap-3"><RefreshCw className="h-6 w-6 animate-spin" /><div><p className="font-semibold">Rerouting…</p><p className="text-xs text-white/80">You left the planned route</p></div></div>
        ) : s === "offline" ? (
          <div data-testid="native-offline" className="rounded-3xl bg-slate-700 text-white p-4 flex items-center gap-3"><WifiOff className="h-6 w-6" /><div><p className="font-semibold">No connection</p><p className="text-xs text-white/80">Following last downloaded route · ETA paused</p></div></div>
        ) : (
          <div data-testid="native-maneuver" className="rounded-3xl bg-black/90 text-white p-4">
            <div className="flex items-center gap-3"><CornerUpRight className="h-10 w-10 text-nb-cyan" /><div><p className="text-3xl font-semibold nb-num">250 m</p><p className="text-sm text-white/80">Turn right onto 104 Ave NW</p></div></div>
            <div className="flex gap-2 mt-3">{[CornerUpLeft, ArrowUp, ArrowUp, CornerUpRight].map((I, i) => <span key={i} className={cx("h-9 flex-1 rounded-xl grid place-items-center", i === 3 ? "bg-nb-cyan text-nb-ink" : "bg-white/10 text-white/40")}><I className="h-4 w-4" /></span>)}</div>
            <p className="text-xs text-white/60 mt-3">Then turn left onto 109 St NW</p>
          </div>
        )}
      </div>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2">
        <button data-testid="native-voice" onClick={() => setVoice(!voice)} className="h-12 w-12 rounded-2xl nb-glass-dark text-white grid place-items-center">{voice ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}</button>
        <button data-testid="native-recenter" className="h-12 w-12 rounded-2xl nb-glass-dark text-white grid place-items-center"><LocateFixed className="h-5 w-5" /></button>
        <button data-testid="native-report" className="h-12 w-12 rounded-2xl nb-glass-dark text-white grid place-items-center"><Flag className="h-5 w-5" /></button>
      </div>
      <div className="absolute inset-x-0 bottom-0 lg:left-auto lg:right-4 lg:bottom-4 lg:w-[420px] rounded-t-[30px] lg:rounded-[30px] bg-white px-5 pt-4 pb-28 lg:pb-5 shadow-2xl">
        {s === "arrival" ? (
          <div data-testid="native-arrival" className="text-center"><MapPinCheck className="h-10 w-10 mx-auto text-nb-teal nb-pop" /><p className="text-xl font-semibold mt-2">You've arrived at {c.name.split(" ")[0]}'s</p><p className="text-sm text-nb-mute">Detected within 40 m of the address</p><button className="nb-btn-primary w-full mt-4">Confirm arrival</button></div>
        ) : s === "permission" ? (
          <div data-testid="native-permission"><ShieldAlert className="h-8 w-8 text-nb-blue" /><p className="text-lg font-semibold mt-2">Allow location while the app is closed?</p><p className="text-sm text-nb-mute mt-1">Keeps your client's ETA accurate when your phone is locked. Sharing stops automatically when you arrive.</p><div className="grid grid-cols-2 gap-2 mt-4"><button className="nb-btn-ghost">Only while using</button><button className="nb-btn-primary">Allow all the time</button></div></div>
        ) : (
          <div className="grid grid-cols-3 text-center"><div><p className="text-2xl font-semibold nb-num">{e?.min ?? "—"}</p><p className="text-xs text-nb-mute">min</p></div><div><p className="text-2xl font-semibold nb-num">{e?.km ?? "—"}</p><p className="text-xs text-nb-mute">km</p></div><div><p className="text-2xl font-semibold">{s === "offline" ? "Paused" : "On time"}</p><p className="text-xs text-nb-mute">status</p></div></div>
        )}
        <p className="nb-eyebrow mt-5 mb-2">Design states</p>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">{STATES.map(([k, l]) => <button key={k} data-testid={`native-state-${k}`} onClick={() => setS(k)} className={cx(s === k ? "nb-chip-on" : "nb-chip-off", "h-8 text-xs shrink-0")}>{l}</button>)}</div>
        <p className="text-[11px] text-nb-mute mt-3">Integration point for a native navigation SDK and background GPS. Not functional in the web app.</p>
      </div>
    </div>
  );
}
