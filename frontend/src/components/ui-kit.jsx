import { useEffect, useRef, useState } from "react";
import { animate, motion } from "framer-motion";
import { Check, FlaskConical, WifiOff } from "lucide-react";
import { STATUS, PAYMENT_STATUS, fmtStamp, clientVisitProgress, zoneFor, managedMediaPath } from "@/lib/domain";
import { api } from "@/lib/api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const TONES = {
  slate: "bg-slate-100 text-slate-700", blue: "bg-blue-50 text-nb-blue", cyan: "bg-cyan-50 text-cyan-700",
  turq: "bg-teal-50 text-teal-700", teal: "bg-emerald-50 text-emerald-700", green: "bg-lime-50 text-lime-700",
  amber: "bg-amber-50 text-amber-700", red: "bg-rose-50 text-rose-700",
};

export const Pill = ({ tone = "slate", children, className = "", testid }) => (
  <span data-testid={testid} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONES[tone]} ${className}`}>{children}</span>
);
export const StatusPill = ({ status, client, testid }) => {
  const s = STATUS[status] || STATUS.requested;
  return <Pill tone={s.tone} testid={testid}>{status === "in_session" && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}{client ? s.client : s.label}</Pill>;
};
export const PayPill = ({ status, testid }) => { const s = PAYMENT_STATUS[status] || PAYMENT_STATUS.unpaid; return <Pill tone={s.tone} testid={testid}>{s.label}</Pill>; };
export const DemoTag = ({ children = "Demo", className = "" }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border border-dashed border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ${className}`}><FlaskConical className="h-3 w-3" />{children}</span>
);

export function Counter({ value, prefix = "", suffix = "", decimals = 0, testid }) {
  const ref = useRef(null);
  const prev = useRef(0);
  useEffect(() => {
    const c = animate(prev.current, value, { duration: 1.1, ease: "easeOut", onUpdate: (v) => { if (ref.current) ref.current.textContent = `${prefix}${v.toLocaleString("en-CA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`; } });
    prev.current = value;
    return () => c.stop();
  }, [value, prefix, suffix, decimals]);
  return <span ref={ref} data-testid={testid}>{prefix}0{suffix}</span>;
}

export const SectionHead = ({ eyebrow, title, action, className = "" }) => (
  <div className={`flex items-end justify-between gap-4 mb-5 ${className}`}>
    <div>{eyebrow && <p className="nb-eyebrow mb-1.5">{eyebrow}</p>}<h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-nb-ink">{title}</h2></div>
    {action}
  </div>
);

export function Confirm({ open, onOpenChange, title, body, confirmLabel = "Confirm", onConfirm, testid = "confirm-dialog" }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={testid} className="rounded-3xl max-w-[92vw] sm:max-w-md">
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle>{body && <AlertDialogDescription>{body}</AlertDialogDescription>}</AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel data-testid={`${testid}-cancel`} className="rounded-full h-12">Not yet</AlertDialogCancel>
          <AlertDialogAction data-testid={`${testid}-confirm`} onClick={onConfirm} className="rounded-full h-12 bg-nb-blue hover:bg-nb-navy">{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const SuccessMark = ({ size = 72 }) => (
  <div className="relative mx-auto" style={{ width: size, height: size }}>
    <span className="nb-ping absolute inset-0 rounded-full bg-nb-turq/40" />
    <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className="nb-gradient relative flex h-full w-full items-center justify-center rounded-full text-white shadow-lg">
      <Check className="h-1/2 w-1/2" strokeWidth={3} />
    </motion.div>
  </div>
);

export function PageSkeleton({ error }) {
  return (
    <div className="mx-auto max-w-5xl px-5 pt-24 space-y-4" data-testid="page-skeleton">
      {error && <p className="text-sm text-rose-600 flex items-center gap-2"><WifiOff className="h-4 w-4" /> Can’t reach Nabitouch — retrying…</p>}
      <div className="nb-skeleton h-10 w-2/3 rounded-2xl" /><div className="nb-skeleton h-48 rounded-3xl" />
      <div className="grid grid-cols-2 gap-4"><div className="nb-skeleton h-32 rounded-3xl" /><div className="nb-skeleton h-32 rounded-3xl" /></div>
    </div>
  );
}

// Operational timeline (staff). Shows every recorded lifecycle event.
export function OpsTimeline({ appt, compact }) {
  const events = appt.events || [];
  return (
    <ol className="relative space-y-3 pl-5 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-sky-200" data-testid="ops-timeline">
      {events.map((e, i) => (
        <motion.li key={`${e.status}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: compact ? 0 : i * 0.04 }} className="relative">
          <span className={`absolute -left-5 top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${i === events.length - 1 ? "nb-gradient" : "bg-sky-300"}`} />
          <div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-medium text-nb-ink">{STATUS[e.status]?.label || e.status}</span><span className="text-xs tabular-nums text-nb-mute">{fmtStamp(e.at)}</span></div>
          {!compact && e.actor && <p className="text-[11px] text-slate-500">{e.actor}{e.note ? ` · ${e.note}` : ""}</p>}
        </motion.li>
      ))}
    </ol>
  );
}

// Client-safe visit status: operational appointment phases only (not intake/consent/prep).
export function ClientTracker({ appt }) {
  const progress = clientVisitProgress(appt);
  return (
    <div data-testid="client-tracker">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-mute">Visit status</p>
          <p className="mt-1 text-sm font-semibold text-nb-navy" data-testid="client-tracker-label">{progress.headline}</p>
        </div>
        {progress.showBar && (
          <p className="shrink-0 text-[11px] text-nb-mute" data-testid="client-tracker-phase">
            {progress.stageIndex + 1}/{progress.stageCount} · practitioner updates
          </p>
        )}
      </div>
      {progress.showBar && (
        <div className="mt-2.5 flex items-center gap-1" data-testid="client-tracker-bar" aria-hidden>
          {Array.from({ length: progress.stageCount }, (_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-sky-100">
              <motion.div className="nb-gradient h-full" initial={{ width: 0 }} animate={{ width: i <= progress.stageIndex ? "100%" : "0%" }} transition={{ duration: 0.45, delay: i * 0.04 }} />
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] leading-snug text-nb-mute" data-testid="client-tracker-detail">{progress.detail}</p>
    </div>
  );
}

// Stylised (non-GIS) map preview of demo service zones.
export function ZoneMap({ zones, point, pins = [], center, height = 220 }) {
  const c = center || { lat: 53.5461, lng: -113.4938 };
  const maxR = Math.max(...zones.map((z) => z.radiusKm), 25);
  const toXY = (p) => ({ x: 50 + ((p.lng - c.lng) * 111 * Math.cos((c.lat * Math.PI) / 180) / maxR) * 46, y: 50 - ((p.lat - c.lat) * 111 / maxR) * 46 });
  const res = point ? zoneFor(point, zones, c) : null;
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#EEF8FB]" style={{ height }} data-testid="zone-map">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <path d="M-5 62 C 20 55, 35 70, 50 56 S 80 40, 105 48" stroke="#9FD8F5" strokeWidth="2.4" fill="none" opacity=".8" />
        {[...zones].sort((a, b) => b.radiusKm - a.radiusKm).map((z) => (
          <circle key={z.id} cx="50" cy="50" r={(z.radiusKm / maxR) * 46} fill={z.color} fillOpacity={z.enabled ? 0.12 : 0.03} stroke={z.color} strokeOpacity=".5" strokeDasharray={z.enabled ? "0" : "2 2"} strokeWidth=".4" />
        ))}
        <circle cx="50" cy="50" r="1.4" fill="#0B2E8A" />
        {pins.filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))).map((p, i) => { const q = toXY(p); return <circle key={i} cx={q.x} cy={q.y} r="1.6" fill={p.color || "#1565F0"} stroke="white" strokeWidth=".5" />; })}
        {point && (() => { const q = toXY(point); return <g><circle cx={q.x} cy={q.y} r="3.5" fill="#1565F0" opacity=".25" /><circle cx={q.x} cy={q.y} r="1.8" fill="#1565F0" stroke="white" strokeWidth=".6" /></g>; })()}
      </svg>
      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5"><span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-nb-ink">Zone diagram, not a street map</span></div>
      {res && <div className="absolute bottom-3 left-3 right-3 rounded-2xl bg-white/90 px-3 py-2 text-xs text-nb-ink backdrop-blur">{res.zone ? <><b>{res.zone.name}</b> · ~{res.km.toFixed(1)} km from central Edmonton</> : <>Outside current service zones (~{res.km.toFixed(0)} km)</>}</div>}
    </div>
  );
}

export function useNow(interval = 1000, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(t); }, [interval, active]);
  return now;
}

export function CatalogueImage({ src, alt = "", className = "", style, size, fallback }) {
  const remote = managedMediaPath(src, size);
  const [url, setUrl] = useState(remote ? "" : (src || ""));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!remote) {
      setUrl(src || "");
      setFailed(false);
      return undefined;
    }
    let objectUrl = "";
    let cancelled = false;
    setFailed(false);
    setUrl("");
    api.mediaBlob(remote).then((blobUrl) => {
      if (cancelled) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      objectUrl = blobUrl;
      setUrl(blobUrl);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, remote]);
  if (!src || failed || (remote && !url)) {
    if (fallback) return fallback;
    return <span className={`block bg-sky-100 ${className}`} style={style} aria-hidden="true" />;
  }
  return <img src={url} alt={alt} className={className} style={style} onError={() => setFailed(true)} />;
}

export const Avatar = ({ person, size = 40, photo }) => {
  const src = photo || person?.photo || "";
  const initials = person?.initials || `${person?.firstName?.[0] || "G"}${person?.lastName?.[0] || ""}`;
  const fallback = <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: person?.color || "linear-gradient(120deg,#1565F0,#14D8C4)", fontSize: size * 0.36 }}>{initials}</span>;
  if (!src) return fallback;
  return <CatalogueImage src={src} alt="" size="thumb" className="rounded-full object-cover" style={{ width: size, height: size }} fallback={fallback} />;
};
