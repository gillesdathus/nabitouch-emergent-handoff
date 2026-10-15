import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import mapboxgl from "mapbox-gl";

// Mapbox GL street map with the same props as LiveMap. Loaded only when REACT_APP_MAPBOX_PUBLIC_TOKEN is set.
const fc = (features) => ({ type: "FeatureCollection", features });
const line = (r) => ({ type: "Feature", geometry: { type: "LineString", coordinates: r.map((p) => [p.lng, p.lat]) } });

export default function MapboxLiveMap({ markers = [], routes = [], dests = [], height = 320, testid = "live-map", tag = "Map" }) {
  const el = useRef(null);
  const map = useRef(null);
  const pins = useRef([]);
  useEffect(() => {
    mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_PUBLIC_TOKEN;
    map.current = new mapboxgl.Map({ container: el.current, style: "mapbox://styles/mapbox/light-v11", center: [-113.4938, 53.5461], zoom: 11, attributionControl: true });
    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.current.on("load", () => {
      map.current.addSource("routes", { type: "geojson", data: fc([]) });
      map.current.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": "#1565F0", "line-width": 5, "line-opacity": 0.85 }, layout: { "line-cap": "round" } });
    });
    return () => map.current?.remove();
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => m.getSource("routes")?.setData(fc(routes.map(line)));
    m.loaded() ? apply() : m.once("load", apply);
    pins.current.forEach((p) => p.remove());
    pins.current = [
      ...dests.map((d) => new mapboxgl.Marker({ color: "#0E9E9A" }).setLngLat([d.pos.lng, d.pos.lat]).addTo(m)),
      ...markers.map((mk) => { const n = document.createElement("button"); n.className = "nb-gradient h-10 w-10 rounded-full border-4 border-white text-xs font-bold text-white shadow-lg"; n.textContent = mk.initials || ""; if (mk.onClick) n.onclick = mk.onClick; return new mapboxgl.Marker({ element: n }).setLngLat([mk.pos.lng, mk.pos.lat]).addTo(m); }),
    ];
    const pts = [...markers.map((x) => x.pos), ...dests.map((x) => x.pos)];
    if (pts.length > 1 && !m._fitted) { const b = new mapboxgl.LngLatBounds(); pts.forEach((p) => b.extend([p.lng, p.lat])); m.fitBounds(b, { padding: 60, maxZoom: 14 }); m._fitted = true; }
  }, [markers, routes, dests]);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-sky-100" style={{ height }} data-testid={testid}>
      <div ref={el} className="h-full w-full" />
      <div className="absolute left-3 top-3">{tag === "Live GPS" ? <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white" data-testid={`${testid}-live-tag`}>Live GPS</span> : <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-nb-ink">{tag}</span>}</div>
    </div>
  );
}
