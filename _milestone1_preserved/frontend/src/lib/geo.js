// Geography helpers. Mock grid coords (0–100) are projected onto real Edmonton lon/lat.
const BBOX = { w: -113.72, e: -113.22, n: 53.66, s: 53.40 };
export const TOKEN = process.env.REACT_APP_MAPBOX_TOKEN || "";
export const hasMapbox = TOKEN.startsWith("pk.");
export const EDMONTON = [-113.4938, 53.5461];

export const toLngLat = ([x, y]) => [+(BBOX.w + (x / 100) * (BBOX.e - BBOX.w)).toFixed(5), +(BBOX.n - (y / 100) * (BBOX.n - BBOX.s)).toFixed(5)];
export const zoneCoords = (z) => z.coords || z.poly.split(" ").map((p) => toLngLat(p.split(",").map(Number)));

// DEMO positions — not live GPS. minutesAgo drives freshness labels.
export const CLIENT_PTS = { c1: [48, 42], c2: [44, 74], c3: [52, 36], c4: [82, 38], c5: [18, 44], c6: [40, 14] };
export const DEMO_FIX = { p1: { pt: [42, 52], minutesAgo: 0.4 }, p2: { pt: [26, 46], minutesAgo: 4 }, p3: { pt: [66, 40], minutesAgo: 0.8 }, p4: { pt: null, minutesAgo: null } };
export const clientLngLat = (id) => toLngLat(CLIENT_PTS[id] || [50, 50]);
export const demoFix = (pid) => {
  const f = DEMO_FIX[pid];
  return f?.pt ? { lngLat: toLngLat(f.pt), at: Date.now() - f.minutesAgo * 60e3 } : null;
};

export const haversineKm = ([lo1, la1], [lo2, la2]) => {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(la2 - la1) / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
export const straightEstimate = (from, to) => {
  const km = haversineKm(from, to) * 1.3;
  return { km: +km.toFixed(1), min: Math.max(3, Math.round((km / 38) * 60)), source: "estimate", coords: [from, to] };
};

export async function fetchRoute(points) {
  if (!hasMapbox) return straightEstimate(points[0], points[points.length - 1]);
  const path = points.map((p) => p.join(",")).join(";");
  const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${path}?geometries=geojson&overview=full&access_token=${TOKEN}`);
  if (!res.ok) return straightEstimate(points[0], points[points.length - 1]);
  const r = (await res.json()).routes?.[0];
  if (!r) return straightEstimate(points[0], points[points.length - 1]);
  return { km: +(r.distance / 1000).toFixed(1), min: Math.round(r.duration / 60), source: "mapbox", coords: r.geometry.coordinates };
}

export async function geocode(q) {
  if (!hasMapbox || q.trim().length < 3) return [];
  const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=ca&bbox=${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n}&limit=5&access_token=${TOKEN}`);
  if (!res.ok) return [];
  return ((await res.json()).features || []).map((f) => ({ id: f.id, label: f.properties.full_address || f.properties.name, lngLat: f.geometry.coordinates }));
}

export const pointInPoly = ([x, y], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const NAV_APPS = [
  { key: "google", label: "Google Maps", url: ([lng, lat]) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving` },
  { key: "apple", label: "Apple Maps", appleOnly: true, url: ([lng, lat]) => `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` },
  { key: "waze", label: "Waze", url: ([lng, lat]) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` },
];
export const isApple = () => /iPhone|iPad|Macintosh/.test(navigator.userAgent);
export const availableApps = () => NAV_APPS.filter((a) => !a.appleOnly || isApple());
export const getNavPref = () => localStorage.getItem("nb-nav-app") || "google";
export const setNavPref = (k) => localStorage.setItem("nb-nav-app", k);

export const agoLabel = (at) => {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
export const freshness = (at) => (!at ? "offline" : Date.now() - at < 60e3 ? "live" : Date.now() - at < 10 * 60e3 ? "stale" : "offline");
