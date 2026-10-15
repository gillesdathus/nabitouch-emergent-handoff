import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPinOff, Radio, Clock3, WifiOff, ShieldOff, Satellite, FlaskConical, Route as RouteIcon, Smartphone } from "lucide-react";
import { cx } from "@/components/ui-kit";
import { TOKEN, hasMapbox, EDMONTON, agoLabel } from "@/lib/geo";

const EMPTY = { type: "FeatureCollection", features: [] };
const RING = { live: "#14D8C4", en_route: "#1565F0", in_session: "#0B2E8A", arrived: "#12C9EF", assigned: "#18A8F5", available: "#7BC74D", offline: "#94A3B8", stale: "#94A3B8" };

function markerEl(m) {
  const b = document.createElement("button");
  b.setAttribute("data-testid", `map-marker-${m.id}`);
  b.className = "nb-marker";
  const ring = RING[m.state] || "#1565F0";
  if (m.kind === "pin") b.innerHTML = `<span class="nb-pin"><span></span></span>${m.label ? `<em>${m.label}</em>` : ""}`;
  else if (m.kind === "me") b.innerHTML = `<span class="nb-me"><i></i></span>`;
  else b.innerHTML = `<span class="nb-photo ${m.dim ? "is-dim" : ""}" style="--ring:${ring}">${m.pulse ? "<b></b>" : ""}<img src="${m.photo}" alt=""/></span>${m.label ? `<em>${m.label}</em>` : ""}`;
  if (m.onClick) b.onclick = (e) => { e.stopPropagation(); m.onClick(); };
  return b;
}

export function MapView({ className = "", dark, center = EDMONTON, zoom = 10.4, zones = [], markers = [], route, draft, onMapClick, fit, testid = "map-view", children }) {
  const el = useRef(null);
  const map = useRef(null);
  const pins = useRef([]);
  const click = useRef(onMapClick);
  click.current = onMapClick;
  const [ready, setReady] = useState(0);
  useEffect(() => {
    if (!hasMapbox) return undefined;
    mapboxgl.accessToken = TOKEN;
    const m = new mapboxgl.Map({ container: el.current, style: dark ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11", center, zoom });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true }), "top-right");
    m.on("load", () => {
      ["zones", "route", "draft"].forEach((id) => m.addSource(id, { type: "geojson", data: EMPTY }));
      m.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "active"], 0.32, 0.13] } });
      m.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "active"], 3, 1.5] } });
      m.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": dark ? "#0B1B3F" : "#ffffff", "line-width": 10 } });
      m.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#12C9EF", "line-width": 5 } });
      m.addLayer({ id: "draft-fill", type: "fill", source: "draft", paint: { "fill-color": "#1565F0", "fill-opacity": 0.18 } });
      m.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#1565F0", "line-width": 2.5, "line-dasharray": [2, 1] } });
      setReady((x) => x + 1);
    });
    m.on("click", (e) => click.current?.([+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)]));
    map.current = m;
    return () => { map.current = null; m.remove(); };
  }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.getSource("zones").setData({ type: "FeatureCollection", features: zones.map((z) => ({ type: "Feature", properties: { color: z.color, active: !!z.active }, geometry: { type: "Polygon", coordinates: [[...z.coords, z.coords[0]]] } })) });
    m.getSource("route").setData(route?.length > 1 ? { type: "Feature", geometry: { type: "LineString", coordinates: route } } : EMPTY);
    m.getSource("draft").setData(draft?.length > 1 ? { type: "Feature", geometry: draft.length > 2 ? { type: "Polygon", coordinates: [[...draft, draft[0]]] } : { type: "LineString", coordinates: draft } } : EMPTY);
  }, [zones, route, draft, ready]);

  const mkKey = JSON.stringify(markers.map((m) => [m.id, m.lngLat, m.state, m.label, m.dim, m.pulse]));
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    pins.current.forEach((p) => p.remove());
    pins.current = markers.filter((x) => x.lngLat).map((x) => new mapboxgl.Marker({ element: markerEl(x), anchor: x.kind === "pin" ? "bottom" : "center" }).setLngLat(x.lngLat).addTo(m));
  }, [mkKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitKey = JSON.stringify(fit);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !fit?.length) return;
    if (fit.length === 1) m.easeTo({ center: fit[0], zoom: 13.5 });
    else m.fitBounds(fit.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(fit[0], fit[0])), { padding: 70, maxZoom: 14, duration: 600 });
  }, [fitKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasMapbox) return <MapUnavailable className={className} dark={dark} testid={testid}>{children}</MapUnavailable>;
  return (
    <div data-testid={testid} data-vaul-no-drag className={cx("relative overflow-hidden", className)}>
      <div ref={el} className="absolute inset-0" />
      {children}
    </div>
  );
}

export function MapUnavailable({ className = "", dark, testid, children }) {
  return (
    <div data-testid={testid} className={cx("relative overflow-hidden", dark ? "bg-nb-tide2" : "bg-gradient-to-br from-sky-50 to-nb-mint", className)}>
      <div data-testid="mapbox-not-configured" className="absolute inset-0 grid place-items-center p-6 text-center">
        <div className="max-w-xs">
          <span className={cx("mx-auto grid place-items-center h-14 w-14 rounded-2xl", dark ? "bg-white/10 text-white/70" : "bg-white text-nb-mute shadow-sm")}><MapPinOff className="h-6 w-6" /></span>
          <p className={cx("font-semibold mt-3", dark ? "text-white" : "text-nb-ink")}>Mapbox not configured</p>
          <p className={cx("text-xs mt-1", dark ? "text-white/60" : "text-nb-mute")}>Add a public Mapbox token (REACT_APP_MAPBOX_TOKEN, pk.…) to load the interactive map. Lists, ETAs and actions keep working.</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const CAP = {
  demo: [FlaskConical, "Demo position · not live GPS", "bg-amber-50 text-amber-800 ring-amber-200"],
  device: [Satellite, "Your device GPS", "bg-nb-turq/15 text-nb-teal ring-nb-turq/30"],
  mapbox: [RouteIcon, "Mapbox route ETA", "bg-nb-blue/10 text-nb-blue ring-nb-blue/20"],
  estimate: [RouteIcon, "Straight-line estimate", "bg-slate-100 text-nb-mute ring-slate-200"],
  native: [Smartphone, "Native app only · not active on web", "bg-amber-100 text-amber-900 ring-amber-300"],
};
export const CapBadge = ({ kind, className = "" }) => {
  const [I, l, t] = CAP[kind];
  return <span data-testid={`cap-${kind}`} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 h-6 text-[10.5px] font-semibold ring-1 ring-inset whitespace-nowrap", t, className)}><I className="h-3 w-3" />{l}</span>;
};

const FRESH = {
  live: [Radio, "Live", "bg-nb-turq/15 text-nb-teal ring-nb-turq/30"],
  stale: [Clock3, "Last known", "bg-amber-50 text-amber-800 ring-amber-200"],
  offline: [WifiOff, "Offline", "bg-slate-100 text-nb-mute ring-slate-200"],
  denied: [ShieldOff, "Location permission denied", "bg-nb-coral/10 text-nb-coral ring-nb-coral/25"],
  unavailable: [WifiOff, "GPS unavailable", "bg-nb-coral/10 text-nb-coral ring-nb-coral/25"],
  requesting: [Satellite, "Waiting for GPS…", "bg-sky-50 text-nb-blue ring-sky-200"],
  idle: [MapPinOff, "Not sharing location", "bg-slate-100 text-nb-mute ring-slate-200"],
};
export const FreshnessPill = ({ state, at, className = "", testid = "freshness-pill" }) => {
  const [I, l, t] = FRESH[state] || FRESH.offline;
  return <span data-testid={testid} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 h-6 text-[10.5px] font-semibold ring-1 ring-inset whitespace-nowrap", t, className)}><I className={cx("h-3 w-3", state === "live" && "animate-pulse")} />{l}{at && ["live", "stale", "offline"].includes(state) ? ` · ${agoLabel(at)}` : ""}</span>;
};
