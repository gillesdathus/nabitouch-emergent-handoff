import { useState } from "react";
import { Navigation, Clock, MapPinCheck, BellRing, Send } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { BottomSheet, Notice, cx } from "@/components/ui-kit";

export const TRIP_EVENT = {
  started: { icon: Navigation, label: "Trip started", tone: "bg-nb-blue text-white", soft: "bg-sky-50 text-nb-blue ring-sky-200" },
  late: { icon: Clock, label: "Running late", tone: "bg-amber-500 text-white", soft: "bg-amber-50 text-amber-800 ring-amber-200" },
  arrived: { icon: MapPinCheck, label: "Arrived", tone: "bg-nb-teal text-white", soft: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60e3); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export const eventText = (e, first) => ({
  started: `${first} is on the way.`,
  late: `${first} is running about ${e.delay} min late${e.reason ? ` · ${e.reason}` : ""}.`,
  arrived: `${first} has arrived at your address.`,
}[e.kind]);

export const useTripEvents = (apptId) => {
  const { db } = usePreview();
  return db.tripEvents.filter((e) => e.apptId === apptId).sort((x, y) => new Date(y.at) - new Date(x.at));
};

export function LatestAlert({ apptId, name, testid = "trip-latest-alert" }) {
  const [e] = useTripEvents(apptId);
  if (!e) return null;
  const m = TRIP_EVENT[e.kind];
  return (
    <div data-testid={testid} className={cx("rounded-2xl ring-1 p-3 flex gap-3 items-start nb-pop", m.soft)}>
      <span className={cx("h-9 w-9 shrink-0 grid place-items-center rounded-xl", m.tone)}><m.icon className="h-4 w-4" /></span>
      <div className="flex-1 min-w-0"><p className="text-sm font-semibold flex items-center gap-1.5"><BellRing className="h-3.5 w-3.5" />{m.label}</p><p className="text-xs mt-0.5">{eventText(e, name)}</p><p className="text-[11px] opacity-70 mt-1">{ago(e.at)} · in-app alert preview</p></div>
    </div>
  );
}

export function TripHistory({ apptId, name, dark, testid = "trip-history" }) {
  const list = useTripEvents(apptId);
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between mb-2"><p className={cx("font-semibold text-sm", dark && "text-white")}>Trip alerts</p><span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Preview · not sent</span></div>
      {!list.length ? <p className={cx("text-xs", dark ? "text-white/60" : "text-nb-mute")} data-testid={`${testid}-empty`}>No alerts yet. They appear when the trip starts.</p> : (
        <ol className="space-y-0">
          {list.map((e, i) => { const m = TRIP_EVENT[e.kind]; return (
            <li key={e.id} data-testid={`${testid}-item-${e.kind}-${i}`} className="flex gap-3">
              <div className="flex flex-col items-center"><span className={cx("h-7 w-7 rounded-full grid place-items-center", m.tone)}><m.icon className="h-3.5 w-3.5" /></span>{i < list.length - 1 && <span className="w-0.5 flex-1 min-h-[18px] bg-sky-100" />}</div>
              <div className="pb-3 min-w-0"><p className="text-sm font-medium">{m.label}<span className="text-xs text-nb-mute font-normal"> · {clock(e.at)}</span></p><p className="text-xs text-nb-mute">{eventText(e, name)}</p><p className="text-[11px] text-nb-mute mt-0.5">{e.by} · {e.channels.join(", ")} · not delivered in preview</p></div>
            </li>
          ); })}
        </ol>
      )}
    </div>
  );
}

const DELAYS = [5, 10, 15, 20, 30];
const REASONS = ["Traffic", "Previous visit ran over", "Parking", "Weather"];

export function LateSheet({ open, onOpenChange, name, onSend }) {
  const [delay, setDelay] = useState(10);
  const [reason, setReason] = useState("Traffic");
  const [sms, setSms] = useState(true);
  const preview = `Hi ${name}, your therapist is running about ${delay} min late (${reason.toLowerCase()}). Thanks for your patience.`;
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} testid="late-sheet" title="Running late" sub="Let your client know"
      footer={<button data-testid="late-send-btn" onClick={() => onSend({ delay, reason, channels: sms ? ["In-app", "SMS"] : ["In-app"] })} className="nb-btn-primary w-full h-14 text-base"><Send className="h-5 w-5" />Record late alert</button>}>
      <p className="nb-label">How late?</p>
      <div className="grid grid-cols-5 gap-2">{DELAYS.map((d) => <button key={d} data-testid={`late-delay-${d}`} onClick={() => setDelay(d)} className={cx("h-12 rounded-2xl text-sm font-semibold nb-num transition-colors", delay === d ? "nb-lagoon text-white" : "bg-white ring-1 ring-sky-100")}>{d === 30 ? "30+" : d}</button>)}</div>
      <p className="nb-label mt-5">Reason</p>
      <div className="flex flex-wrap gap-2">{REASONS.map((r) => <button key={r} data-testid={`late-reason-${r.split(" ")[0].toLowerCase()}`} onClick={() => setReason(r)} className={cx(reason === r ? "nb-chip-on" : "nb-chip-off", "h-9 text-xs")}>{r}</button>)}</div>
      <p className="nb-label mt-5">Client will see</p>
      <div data-testid="late-message-preview" className="rounded-2xl rounded-bl-md bg-sky-50 p-3 text-sm">{preview}</div>
      <label className="flex items-center gap-2 mt-3 text-sm"><input type="checkbox" data-testid="late-sms-toggle" checked={sms} onChange={(e) => setSms(e.target.checked)} className="accent-[#0B2E8A] h-4 w-4" />Also send by SMS</label>
      <Notice className="mt-4">Preview only. The alert is added to the visit history, but no SMS or push notification is sent.</Notice>
    </BottomSheet>
  );
}
