import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import mapboxgl from "mapbox-gl";

const EDMONTON = { lat: 53.5461, lng: -113.4938 };

function circle(center, km, steps = 72) {
  const coords = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * 2 * Math.PI;
    const dLat = (km / 111.32) * Math.sin(a);
    const dLng = (km / (111.32 * Math.cos((center.lat * Math.PI) / 180))) * Math.cos(a);
    coords.push([center.lng + dLng, center.lat + dLat]);
  }
  return coords;
}

const zoneFeatures = (zones, center) => ({
  type: "FeatureCollection",
  features: [...zones].sort((a, b) => b.radiusKm - a.radiusKm).map((z) => ({
    type: "Feature",
    properties: { id: z.id, color: z.color || "#1565F0", enabled: z.enabled !== false },
    geometry: { type: "Polygon", coordinates: [circle(center, Number(z.radiusKm) || 0)] },
  })),
});

function pinElement(color, label) {
  const n = document.createElement("span");
  n.className = "nb-pin";
  n.style.background = color;
  n.setAttribute("aria-label", label);
  n.innerHTML = "<span></span>";
  return n;
}

export default function ZoneStreetMap({ zones = [], center, pins = [], clinic, height = 340, testid = "zone-street-map" }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const [blocked, setBlocked] = useState(false);
  const c = center?.lat ? center : EDMONTON;
  const zoneKey = JSON.stringify(zones.map((z) => [z.id, z.radiusKm, z.color, z.enabled]));
  const pinKey = JSON.stringify(pins) + JSON.stringify(clinic || null);

  useEffect(() => {
    mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_PUBLIC_TOKEN;
    const m = new mapboxgl.Map({ container: el.current, style: "mapbox://styles/mapbox/streets-v12", center: [c.lng, c.lat], zoom: 9.6, cooperativeGestures: true });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    m.on("error", (e) => { if ([401, 403].includes(e?.error?.status)) setBlocked(true); });
    m.on("load", () => {
      m.addSource("zones", { type: "geojson", data: zoneFeatures([], c) });
      m.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "enabled"], 0.12, 0.03] } });
      m.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.8, "line-dasharray": ["case", ["get", "enabled"], ["literal", [1, 0]], ["literal", [2, 2]]] } });
    });
    map.current = m;
    return () => m.remove();
  }, []); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    const apply = () => {
      m.getSource("zones")?.setData(zoneFeatures(zones, c));
      const outer = Math.max(5, ...zones.map((z) => Number(z.radiusKm) || 0));
      const b = new mapboxgl.LngLatBounds();
      circle(c, outer, 16).forEach((p) => b.extend(p));
      m.fitBounds(b, { padding: 24, duration: 0 });
    };
    if (m.isStyleLoaded() && m.getSource("zones")) apply(); else m.once("load", apply);
  }, [zoneKey, c.lat, c.lng]); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [
      new mapboxgl.Marker({ element: pinElement("#0B1B3F", "Service centre") }).setLngLat([c.lng, c.lat]).setPopup(new mapboxgl.Popup({ offset: 16 }).setText("Service centre (zone origin)")).addTo(m),
      ...(clinic?.lat ? [new mapboxgl.Marker({ color: "#0E9E9A" }).setLngLat([clinic.lng, clinic.lat]).setPopup(new mapboxgl.Popup({ offset: 24 }).setText(clinic.label || "Clinic")).addTo(m)] : []),
      ...pins.map((p) => new mapboxgl.Marker({ element: pinElement(p.color || "#1565F0", p.label) }).setLngLat([p.lng, p.lat]).setPopup(new mapboxgl.Popup({ offset: 16 }).setText(p.label)).addTo(m)),
    ];
    return undefined;
  }, [pinKey, c.lat, c.lng]); // eslint-disable-line

  return (
    <div className="relative overflow-hidden rounded-[var(--nb-r-lg)] border border-sky-100" style={{ height }} data-testid={testid}>
      <div ref={el} className="h-full w-full" aria-label="Service zone map" role="region" />
      {blocked && <p role="status" className="absolute inset-x-3 top-3 mr-12 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900 ring-1 ring-amber-200" data-testid={`${testid}-tiles-blocked`}>Street tiles are blocked for this web address. Add this domain to the Mapbox public token's URL restrictions. Zones and pins still use real coordinates.</p>}
      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] rounded-2xl bg-white/95 p-2.5 text-[11px] shadow-[var(--nb-elev-2)]" data-testid={`${testid}-legend`}>
        {[...zones].sort((a, b) => a.radiusKm - b.radiusKm).map((z) => (
          <p key={z.id} className="flex items-center gap-1.5 leading-5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: z.color }} /><b className="truncate font-semibold">{z.name}</b><span className="shrink-0 text-nb-mute">≤{z.radiusKm} km · ${z.fee}{z.perKm ? ` + $${z.perKm}/km` : ""}{z.enabled === false ? " · off" : ""}</span></p>
        ))}
        <p className="mt-1 text-nb-mute">{pins.length} upcoming confirmed address{pins.length === 1 ? "" : "es"}</p>
      </div>
    </div>
  );
}
