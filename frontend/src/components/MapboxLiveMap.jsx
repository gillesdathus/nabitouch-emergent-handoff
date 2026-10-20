import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import mapboxgl from "mapbox-gl";

// Mapbox GL street map with the same props as LiveMap. Loaded only when REACT_APP_MAPBOX_PUBLIC_TOKEN is set.
const fc = (features) => ({ type: "FeatureCollection", features });
const line = (r) => ({ type: "Feature", geometry: { type: "LineString", coordinates: r.map((p) => [p.lng, p.lat]) } });

const MOBILE_PAD = { top: 56, bottom: 56, left: 40, right: 40 };

function ensureRouteLayer(m) {
  if (!m.getSource("routes")) {
    m.addSource("routes", { type: "geojson", data: fc([]) });
  }
  if (!m.getLayer("routes")) {
    m.addLayer({
      id: "routes",
      type: "line",
      source: "routes",
      paint: { "line-color": "#0B2E8A", "line-width": 5.5, "line-opacity": 0.92 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }
}

function collectBounds(routes, dests, markers) {
  const b = new mapboxgl.LngLatBounds();
  let any = false;
  const extend = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    b.extend([lng, lat]);
    any = true;
  };
  (routes || []).forEach((r) => (r || []).forEach((p) => extend(p.lng, p.lat)));
  (dests || []).forEach((d) => extend(d.pos?.lng, d.pos?.lat));
  (markers || []).forEach((mk) => extend(mk.pos?.lng, mk.pos?.lat));
  return any ? b : null;
}

export default function MapboxLiveMap({ markers = [], routes = [], dests = [], height = 320, testid = "live-map", tag = "Map", fitKey = "" }) {
  const el = useRef(null);
  const map = useRef(null);
  const pins = useRef([]);
  const lastFit = useRef("");

  useEffect(() => {
    mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_PUBLIC_TOKEN;
    map.current = new mapboxgl.Map({
      container: el.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-113.4938, 53.5461],
      zoom: 11,
      attributionControl: true,
    });
    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const onReady = () => ensureRouteLayer(map.current);
    map.current.on("load", onReady);
    // Style reloads drop custom layers; re-add so the road polyline stays visible.
    map.current.on("style.load", onReady);
    return () => {
      pins.current.forEach((p) => p.remove());
      pins.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const apply = () => {
      ensureRouteLayer(m);
      const validRoutes = (routes || []).filter((r) => Array.isArray(r) && r.length >= 2);
      m.getSource("routes")?.setData(fc(validRoutes.map(line)));

      pins.current.forEach((p) => p.remove());
      pins.current = [
        ...dests.map((d) => {
          const color = d.role === "origin" ? "#1565F0" : "#0E9E9A";
          if (d.label) {
            const pin = document.createElement("div");
            pin.className = "grid h-7 w-7 place-items-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow";
            pin.style.background = color;
            pin.textContent = d.label;
            return new mapboxgl.Marker({ element: pin }).setLngLat([d.pos.lng, d.pos.lat]).addTo(m);
          }
          return new mapboxgl.Marker({ color }).setLngLat([d.pos.lng, d.pos.lat]).addTo(m);
        }),
        ...markers.map((mk) => {
          const n = document.createElement("button");
          n.className = "nb-gradient h-10 w-10 rounded-full border-4 border-white text-xs font-bold text-white shadow-lg";
          n.textContent = mk.initials || "";
          if (mk.onClick) n.onclick = mk.onClick;
          return new mapboxgl.Marker({ element: n }).setLngLat([mk.pos.lng, mk.pos.lat]).addTo(m);
        }),
      ];

      const key = fitKey || JSON.stringify({
        routes: validRoutes.map((r) => r.map((p) => [p.lng, p.lat])),
        dests: dests.map((d) => [d.pos?.lng, d.pos?.lat, d.label]),
        markers: markers.map((mk) => [mk.pos?.lng, mk.pos?.lat]),
      });
      const bounds = collectBounds(validRoutes, dests, markers);
      if (bounds && lastFit.current !== key) {
        lastFit.current = key;
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        if (ne.lng === sw.lng && ne.lat === sw.lat) {
          m.easeTo({ center: [ne.lng, ne.lat], zoom: 13, duration: 400 });
        } else {
          const pad = typeof window !== "undefined" && window.innerWidth < 480 ? MOBILE_PAD : 60;
          m.fitBounds(bounds, { padding: pad, maxZoom: 14, duration: 400 });
        }
      }
    };

    if (m.isStyleLoaded()) apply();
    else m.once("load", apply);
  }, [markers, routes, dests, fitKey]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-sky-100" style={{ height }} data-testid={testid}>
      <div ref={el} className="h-full w-full" />
      <div className="absolute left-3 top-3">
        {tag === "Live GPS" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white" data-testid={`${testid}-live-tag`}>Live GPS</span>
        ) : (
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-nb-ink">{tag}</span>
        )}
      </div>
    </div>
  );
}
