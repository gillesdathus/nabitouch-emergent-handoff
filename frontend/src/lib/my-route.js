/** My Route™ helpers — eligibility, leave-by math, navigation chips. */

import { navigationHref, visitNavigationPoint } from "@/lib/domain";

/** Clinic is legacy / non-driving. Missing type is treated as mobile (Nabitouch is mobile-first). */
export function isMobileRouteStop(row) {
  const stop = row?.stop || row || {};
  const location = stop.locationType ?? row?.locationType;
  if (location === "clinic") return false;
  return true;
}

export function stopDestinationPoint(row) {
  const stop = row?.stop || row || {};
  if (stop.position && Number.isFinite(stop.position.lat) && Number.isFinite(stop.position.lng)) {
    return { lat: stop.position.lat, lng: stop.position.lng };
  }
  return visitNavigationPoint({
    locationType: stop.locationType,
    address: {
      lat: stop.position?.lat,
      lng: stop.position?.lng,
      line: stop.addressLine,
      navigation: stop.navigation,
      arrival: stop.arrival,
    },
  });
}

/** Leave-by for origin → appointment (setup + travel buffer only; no cleanup). */
export function leaveByMinutes(startMin, driveMin, rules = {}) {
  const setup = Number(rules.setupMin) || 0;
  const travelBuffer = Number(rules.travelBufferMin) || 0;
  return Number(startMin) - Number(driveMin) - setup - travelBuffer;
}

export function minutesFromHhmm(value) {
  if (!value || typeof value !== "string" || !value.includes(":")) return null;
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function hhmmFromMinutes(total) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(total) || 0)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function providerLabel(provider) {
  if (provider === "mapbox-traffic") return "Live traffic estimate";
  if (provider === "mapbox") return "Road estimate";
  if (provider === "same-stop") return "Same stop";
  if (provider === "unavailable") return "Driving ETA unavailable";
  if (provider === "conservative" || provider === "estimated") return "Qualified estimate";
  return "Travel estimate";
}

/** True only when Mapbox (or same-stop) returned a usable driving estimate. */
export function isRoadLeg(leg) {
  if (!leg) return false;
  if (leg.available === false) return false;
  if (leg.provider === "unavailable" || leg.provider === "conservative" || leg.provider === "estimated") return false;
  return ["mapbox", "mapbox-traffic", "same-stop"].includes(leg.provider) && Number.isFinite(Number(leg.minutes));
}

/** Decode GeoJSON LineString or lat/lng route points into LiveMap route arrays. */
export function routePolyline(leg) {
  if (!leg || !isRoadLeg(leg)) return null;
  if (Array.isArray(leg.route) && leg.route.length >= 2) {
    const pts = leg.route
      .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    return pts.length >= 2 ? pts : null;
  }
  const coords = leg.geometry?.type === "LineString" ? leg.geometry.coordinates : null;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const pts = [];
  for (const pair of coords) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    pts.push({ lat, lng });
  }
  return pts.length >= 2 ? pts : null;
}

/** Collect road polylines for the day map (skips unavailable / geometry-less legs). */
export function roadRoutesFromStops(stops = []) {
  return (stops || []).map((row) => routePolyline(row?.leg)).filter(Boolean);
}

export function formatKm(km) {
  if (km == null || !Number.isFinite(Number(km))) return null;
  const value = Number(km);
  if (value < 0.1) return "< 0.1 km";
  return `${value.toFixed(1)} km`;
}

export function freshnessLabel(iso) {
  if (!iso) return null;
  try {
    const stamp = new Date(iso);
    if (Number.isNaN(stamp.getTime())) return null;
    return stamp.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Edmonton" });
  } catch {
    return null;
  }
}

export const NAV_APPS = [
  ["google", "Google Maps"],
  ["apple", "Apple Maps"],
  ["waze", "Waze"],
];

export function navHrefForStop(app, row) {
  const point = stopDestinationPoint(row);
  return point ? navigationHref(app, point) : "";
}
