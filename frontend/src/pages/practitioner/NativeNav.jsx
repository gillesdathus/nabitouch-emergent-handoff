import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUp, CornerUpLeft, CornerUpRight, Flag, LocateFixed, MapPinCheck, RefreshCw, ShieldAlert, Volume2, VolumeX, WifiOff } from "lucide-react";

const STATES = [["nav", "Navigating"], ["reroute", "Rerouting"], ["offline", "Offline"], ["arrival", "Arrival"], ["permission", "Permission"]];

export default function NativeNav() {
  const { id } = useParams();
  const [state, setState] = useState("nav");
  const [voice, setVoice] = useState(true);
  return (
    <div className="relative -mx-4 -mt-6 min-h-[80vh] overflow-hidden rounded-b-[28px] text-white nb-tide sm:-mx-6 lg:-mx-10" data-testid="native-nav">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(20,216,196,0.35),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(18,201,239,0.25),transparent_35%)]" />
      <div className="relative space-y-3 px-4 pb-8 pt-6">
        <div className="flex items-center gap-2">
          <Link to={`/pro/visit/${id}`} data-testid="native-back" className="grid h-11 w-11 place-items-center rounded-2xl nb-glass-dark"><ArrowLeft className="h-5 w-5" /></Link>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-900">Design only · not navigating</span>
        </div>
        {state === "reroute" && <div data-testid="native-reroute" className="flex items-center gap-3 rounded-3xl bg-nb-blue p-4"><RefreshCw className="h-6 w-6" /><div><p className="font-semibold">Rerouting</p><p className="text-xs text-white/80">A native SDK would calculate this. Nothing is rerouted here.</p></div></div>}
        {state === "offline" && <div data-testid="native-offline" className="flex items-center gap-3 rounded-3xl bg-slate-700 p-4"><WifiOff className="h-6 w-6" /><div><p className="font-semibold">No connection</p><p className="text-xs text-white/80">Offline guidance is not available in the web app.</p></div></div>}
        {(state === "nav" || state === "arrival" || state === "permission") && (
          <div data-testid="native-maneuver" className="rounded-3xl bg-black/80 p-4">
            <div className="flex items-center gap-3"><CornerUpRight className="h-10 w-10 text-nb-cyan" /><div><p className="text-sm text-white/70">Sample maneuver</p><p className="text-sm">Turn instructions are not generated.</p></div></div>
            <div className="mt-3 flex gap-2">{[CornerUpLeft, ArrowUp, CornerUpRight].map((Icon, index) => <span key={index} className="grid h-9 flex-1 place-items-center rounded-xl bg-white/10"><Icon className="h-4 w-4" /></span>)}</div>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" data-testid="native-voice" onClick={() => setVoice((value) => !value)} className="grid h-12 w-12 place-items-center rounded-2xl nb-glass-dark">{voice ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}</button>
          <button type="button" data-testid="native-recenter" className="grid h-12 w-12 place-items-center rounded-2xl nb-glass-dark" aria-label="Recenter design control"><LocateFixed className="h-5 w-5" /></button>
          <button type="button" data-testid="native-report" className="grid h-12 w-12 place-items-center rounded-2xl nb-glass-dark" aria-label="Report design control"><Flag className="h-5 w-5" /></button>
        </div>
        <div className="rounded-[30px] bg-white px-5 py-4 text-nb-ink">
          {state === "arrival" && <div data-testid="native-arrival" className="text-center"><MapPinCheck className="mx-auto h-10 w-10 text-nb-teal" /><p className="mt-2 font-semibold">Arrival detection is not active</p><p className="text-sm text-nb-mute">Confirm arrival from the visit screen when you are there.</p></div>}
          {state === "permission" && <div data-testid="native-permission"><ShieldAlert className="h-8 w-8 text-nb-blue" /><p className="mt-2 font-semibold">Background location is not requested here</p><p className="text-sm text-nb-mute">The visit page asks only while it is open. This panel does not change permissions.</p></div>}
          {state !== "arrival" && state !== "permission" && <div className="grid grid-cols-3 text-center"><div><p className="nb-num text-2xl font-semibold">—</p><p className="text-xs text-nb-mute">min</p></div><div><p className="nb-num text-2xl font-semibold">—</p><p className="text-xs text-nb-mute">km</p></div><div><p className="text-sm font-semibold">Design</p><p className="text-xs text-nb-mute">status</p></div></div>}
          <p className="nb-eyebrow mb-2 mt-5">Design states</p>
          <div className="flex gap-2 overflow-x-auto">{STATES.map(([key, label]) => <button key={key} type="button" data-testid={`native-state-${key}`} onClick={() => setState(key)} className={state === key ? "nb-chip-on h-8 shrink-0 text-xs" : "nb-chip-off h-8 shrink-0 text-xs"}>{label}</button>)}</div>
          <p className="mt-3 text-[11px] text-nb-mute">This is the future native navigation interface. It does not move a vehicle, speak directions, or read GPS.</p>
        </div>
      </div>
    </div>
  );
}
