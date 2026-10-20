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
  if (provider === "conservative" || provider === "estimated") return "Qualified estimate";
  return "Travel estimate";
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
