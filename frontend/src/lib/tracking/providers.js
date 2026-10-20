import { isNative } from '@/lib/native';
import { nativeLocationProvider } from '@/lib/nativeShell';
// Phone GPS publishes while an authorised en-route trip is sharing (Visit page open).
export const TRACKING_CONFIG = {
  mode: process.env.REACT_APP_TRACKING_MODE || 'simulated',
  mapboxPublicToken: process.env.REACT_APP_MAPBOX_PUBLIC_TOKEN || null, // URL-restricted public token only; secret tokens stay server-side
};

/** Foreground browser GPS. Background tracking requires the Capacitor native app (Phase 3). */
export function browserLocationProvider() {
  return {
    kind: 'browser',
    start(onFix, onError) {
      if (!navigator.geolocation) { onError('unavailable'); return () => {}; }
      const id = navigator.geolocation.watchPosition(
        (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed ?? undefined, heading: p.coords.heading ?? undefined, recordedAt: new Date(p.timestamp).toISOString(), approximate: p.coords.accuracy > 500, source: 'gps' }),
        (e) => onError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
      return () => navigator.geolocation.clearWatch(id);
    },
  };
}

/** Idle provider kept for tests and explicit opt-out. Operational trips publish phone GPS while sharing. */
export function idleLocationProvider() {
  return {
    kind: 'idle',
    start(_onFix, onError) {
      onError?.('not_live');
      return () => {};
    },
  };
}

/** Phone GPS while an authorised trip is sharing. Simulated paths are never published. */
export const locationProviderFor = () => (
  isNative() ? nativeLocationProvider() : browserLocationProvider()
);

/** Road ETAs are calculated on the server. The browser never calls Mapbox Directions. */
export function etaCopy(provider) {
  if (provider === 'mapbox-traffic') return 'Live traffic estimate — not a confirmed arrival.';
  if (provider === 'mapbox') return 'Road estimate. Live traffic is unavailable — not a confirmed arrival.';
  return 'Estimated travel time — not a confirmed arrival.';
}

export const mapboxRouteProvider = {
  async route() { throw new Error('Mapbox routing stays on the server during an active trip.'); },
};
