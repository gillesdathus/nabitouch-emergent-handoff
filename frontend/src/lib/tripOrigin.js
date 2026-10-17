const STALE_MS = 30_000;

function finite(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lng: longitude };
}

export function tripOriginMessage(trip) {
  if (!trip || trip.location === "gps") return "";
  if (trip.location === "unavailable" || !trip.from) return "Current location is unavailable.";
  return "";
}

export function readTripOrigin(geolocation = globalThis.navigator?.geolocation, now = Date.now(), timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!geolocation?.getCurrentPosition) {
      resolve({ status: "unavailable" });
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs + 250);
    geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        const point = finite(pos?.coords?.latitude, pos?.coords?.longitude);
        const recorded = Number(pos?.timestamp);
        if (!point || !Number.isFinite(recorded)) {
          finish({ status: "invalid" });
          return;
        }
        if (Math.abs(now - recorded) > STALE_MS) {
          finish({ status: "stale" });
          return;
        }
        finish({
          status: "ready",
          location: { lat: point.lat, lng: point.lng, recordedAt: new Date(recorded).toISOString(), accuracy: pos.coords.accuracy },
        });
      },
      (error) => {
        clearTimeout(timer);
        finish({ status: error?.code === 1 ? "denied" : error?.code === 3 ? "timeout" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
