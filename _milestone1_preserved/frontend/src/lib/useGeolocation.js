import { useEffect, useState } from "react";

// Browser GPS. Web apps lose GPS when backgrounded (esp. iOS) — callers must show stale states.
export function useGeolocation(active) {
  const [s, setS] = useState({ state: "idle" });
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) {
      setS({ state: "idle" });
      return undefined;
    }
    if (!("geolocation" in navigator)) {
      setS({ state: "unavailable" });
      return undefined;
    }
    setS((x) => ({ ...x, state: "requesting" }));
    const id = navigator.geolocation.watchPosition(
      (p) => setS({ state: "live", lngLat: [p.coords.longitude, p.coords.latitude], accuracy: Math.round(p.coords.accuracy), at: Date.now() }),
      (e) => setS((x) => ({ ...x, state: e.code === 1 ? "denied" : "unavailable" })),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 10000);
    return () => clearInterval(t);
  }, []);
  const stale = s.state === "live" && Date.now() - s.at > 60e3;
  return { ...s, state: stale ? "stale" : s.state };
}
