import { lazy, Suspense, useRef, useState } from "react";
import { Minus, Plus, LocateFixed } from "lucide-react";
import { TRACKING_CONFIG } from "@/lib/tracking/providers";

const MapboxLiveMap = lazy(() => import("@/components/MapboxLiveMap"));

// Switch: real Mapbox street map when a public token is configured, otherwise the stylised simulated map.
export function LiveMap(props) {
  // fitKey is Mapbox-only (camera refit); SimulatedMap ignores unknown props safely.
  if (props.localOnly || !TRACKING_CONFIG.mapboxPublicToken) return <SimulatedMap {...props} />;
  return <Suspense fallback={<div className="nb-skeleton rounded-3xl" style={{ height: props.height || 320 }} />}><MapboxLiveMap {...props} /></Suspense>;
}

// Nabitouch-styled interactive map (pan / zoom) on a stylised Edmonton canvas. Simulated positions only.
function SimulatedMap({ markers = [], routes = [], dests = [], height = 320, testid = "live-map", tag }) {
  const pts = [...markers.map((m) => m.pos), ...dests.map((d) => d.pos), ...routes.flat()].filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (!pts.length) return <div className="grid place-items-center rounded-3xl bg-sky-50 px-6 text-center text-sm text-nb-mute" style={{ height }} data-testid={testid}>Current location is unavailable.</div>;
  const lat = pts.map((p) => p.lat), lng = pts.map((p) => p.lng);
  const pad = 0.025;
  const b = { n: Math.max(...lat) + pad, s: Math.min(...lat) - pad, e: Math.max(...lng) + pad, w: Math.min(...lng) - pad };
  const kx = Math.cos((53.5 * Math.PI) / 180);
  const spanX = (b.e - b.w) * kx, spanY = b.n - b.s, span = Math.max(spanX, spanY * 1.6);
  const P = (p) => ({ x: 500 + (((p.lng - (b.e + b.w) / 2) * kx) / span) * 900, y: 300 - ((p.lat - (b.n + b.s) / 2) / span) * 900 });
  const [v, setV] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef(null);
  const zoom = (f) => setV((s) => ({ ...s, k: Math.min(4, Math.max(0.7, s.k * f)) }));
  const path = (r) => r.map((p, i) => { const q = P(p); return `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join(" ");

  return (
    <div className="relative overflow-hidden rounded-3xl border border-sky-100 bg-[#EAF6FA] touch-none select-none" style={{ height }} data-testid={testid}
      onPointerDown={(e) => { if (e.target.closest("button")) return; drag.current = { sx: e.clientX, sy: e.clientY, x0: v.x, y0: v.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (d) setV((s) => ({ ...s, x: d.x0 + e.clientX - d.sx, y: d.y0 + e.clientY - d.sy })); }}
      onPointerUp={() => { drag.current = null; }} onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 0.87)}>
      <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label="Map unavailable until a Mapbox public token is configured">
        <g transform={`translate(${v.x * 1.4} ${v.y * 1.4}) translate(500 300) scale(${v.k}) translate(-500 -300)`}>
          <rect x="-1000" y="-1000" width="3000" height="2600" fill="#EAF6FA" />
          {Array.from({ length: 24 }, (_, i) => <line key={`h${i}`} x1="-1000" x2="2000" y1={-400 + i * 70} y2={-400 + i * 70} stroke="#fff" strokeWidth="6" />)}
          {Array.from({ length: 30 }, (_, i) => <line key={`v${i}`} y1="-1000" y2="1600" x1={-600 + i * 80} x2={-600 + i * 80} stroke="#fff" strokeWidth="6" />)}
          <path d="M-600 420 C -100 330, 150 520, 420 380 S 900 230, 1700 330" stroke="#B8E3F5" strokeWidth="38" fill="none" strokeLinecap="round" />
          <circle cx="760" cy="140" r="70" fill="#D7F3E6" /><circle cx="180" cy="200" r="55" fill="#D7F3E6" />
          {routes.map((r, i) => <g key={i}><path d={path(r)} stroke="#0B2E8A" strokeOpacity=".15" strokeWidth="14" fill="none" strokeLinecap="round" /><path d={path(r)} stroke="url(#nbRoute)" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray="1 0" /></g>)}
          {dests.map((d, i) => { const q = P(d.pos); return <g key={i} transform={`translate(${q.x} ${q.y})`}><circle r="22" fill="#14D8C4" opacity=".2" /><path d="M0 -26 C 14 -26 20 -14 20 -8 C 20 6 0 18 0 18 C 0 18 -20 6 -20 -8 C -20 -14 -14 -26 0 -26Z" fill="#0E9E9A" stroke="#fff" strokeWidth="3" /><circle cy="-8" r="6" fill="#fff" />{d.label && <text y="40" textAnchor="middle" fontSize="18" fontWeight="600" fill="#0B1B3F">{d.label}</text>}</g>; })}
          {markers.map((m) => { const q = P(m.pos); return (
            <g key={m.id} transform={`translate(${q.x} ${q.y})`} onClick={m.onClick} style={{ cursor: m.onClick ? "pointer" : "default", transition: "transform 1s linear" }} data-testid={`map-marker-${m.id}`}>
              <circle r="34" fill={m.color || "#1565F0"} opacity=".18"><animate attributeName="r" values="26;40;26" dur="2.4s" repeatCount="indefinite" /></circle>
              <circle r="22" fill={m.color || "#1565F0"} stroke="#fff" strokeWidth="4" />
              <text y="7" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff">{m.initials}</text>
              {m.label && <g transform="translate(0 -44)"><rect x={-m.label.length * 5 - 12} y="-18" width={m.label.length * 10 + 24} height="28" rx="14" fill="#0B1B3F" /><text y="2" textAnchor="middle" fontSize="15" fontWeight="600" fill="#fff">{m.label}</text></g>}
            </g>); })}
        </g>
        <defs><linearGradient id="nbRoute" x1="0" x2="1"><stop offset="0" stopColor="#1565F0" /><stop offset=".6" stopColor="#12C9EF" /><stop offset="1" stopColor="#14D8C4" /></linearGradient></defs>
      </svg>
      <div className="absolute left-3 top-3"><span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-nb-ink">{tag && tag !== "Simulated map" && tag !== "Simulated positions" ? tag : "Street map needs a Mapbox public token"}</span></div>
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-2xl bg-white shadow">
        <button onClick={() => zoom(1.25)} data-testid={`${testid}-zoom-in`} aria-label="Zoom in" className="p-2.5 hover:bg-sky-50"><Plus className="h-4 w-4" /></button>
        <button onClick={() => zoom(0.8)} data-testid={`${testid}-zoom-out`} aria-label="Zoom out" className="border-t p-2.5 hover:bg-sky-50"><Minus className="h-4 w-4" /></button>
        <button onClick={() => setV({ k: 1, x: 0, y: 0 })} data-testid={`${testid}-recenter`} aria-label="Recenter" className="border-t p-2.5 hover:bg-sky-50"><LocateFixed className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
