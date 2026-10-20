// Capacitor shell glue: secure token store, app lifecycle, background GPS, external navigation and push registration.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { api } from './api';
import { deferStore, isNative, setTokenStore } from './native';

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
let booted = false;

export async function bootNativeShell() {
  if (!isNative() || booted) return;
  booted = true;
  const setup = setupStore();
  deferStore(setup);
  await setup;
  const { App } = await import('@capacitor/app');
  App.addListener('appStateChange', ({ isActive }) => { if (isActive) window.dispatchEvent(new Event('nabitouch:resume')); });
}

async function setupStore() {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
  await SecureStorage.setKeyPrefix('nabitouch_');
  setTokenStore({
    get: (key) => SecureStorage.get(key).then((v) => (typeof v === 'string' ? v : null)).catch(() => null),
    set: (key, value) => SecureStorage.set(key, value),
    remove: (key) => SecureStorage.remove(key).catch(() => {}),
  });
}

export function nativeLocationProvider() {
  return {
    kind: 'native',
    start(onFix, onError) {
      let watcher = null;
      BackgroundGeolocation.addWatcher(
        { backgroundMessage: 'Sharing your trip with your client until you arrive.', backgroundTitle: 'Nabitouch trip sharing', requestPermissions: true, stale: false, distanceFilter: 25 },
        (location, error) => {
          if (error) { onError(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable'); return; }
          onFix({ lat: location.latitude, lng: location.longitude, accuracy: location.accuracy, speed: location.speed ?? undefined, heading: location.bearing ?? undefined,
            recordedAt: new Date(location.time || Date.now()).toISOString(), approximate: location.accuracy > 500, source: 'gps' });
        },
      ).then((id) => { watcher = id; }).catch(() => onError('unavailable'));
      return () => { if (watcher) BackgroundGeolocation.removeWatcher({ id: watcher }).catch(() => {}); };
    },
  };
}

function coordinatePair(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return "";
  return `${latitude},${longitude}`;
}

const SCHEMES = {
  google: (lat, lng) => { const pair = coordinatePair(lat, lng); return pair ? `comgooglemaps://?daddr=${pair}&directionsmode=driving` : ""; },
  apple: (lat, lng) => { const pair = coordinatePair(lat, lng); return pair ? `maps://?daddr=${pair}` : ""; },
  waze: (lat, lng) => { const pair = coordinatePair(lat, lng); return pair ? `waze://?ll=${pair}&navigate=yes` : ""; },
};

// Opens the installed app when it exists, otherwise the web link. Opening an app does not mean navigation has started.
export async function openNavigation(app, lat, lng, webHref) {
  if (!coordinatePair(lat, lng) || !webHref) return false;
  if (!isNative()) return false;
  const { AppLauncher } = await import('@capacitor/app-launcher');
  const url = SCHEMES[app]?.(lat, lng);
  const ios = Capacitor.getPlatform() === 'ios';
  try {
    if (url && (app !== 'apple' || ios) && (await AppLauncher.canOpenUrl({ url })).value) { await AppLauncher.openUrl({ url }); return true; }
  } catch { /* fall through to the web link */ }
  await AppLauncher.openUrl({ url: webHref });
  return true;
}

const CHANNELS = [
  { id: 'safety', name: 'Safety alerts', description: 'Assistance requests and unsafe-space reports', importance: 5, visibility: 1, vibration: true },
  { id: 'visits', name: 'Visits & messages', description: 'New assignments, schedule changes and client messages', importance: 4, visibility: 0, vibration: true },
];
let pushListening = false;
let deviceId = null;

// Registers this phone for push. Called after sign-in and on every resume; a new FCM token re-registers (token refresh).
export async function registerPush() {
  if (!isNative()) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  if (!pushListening) {
    pushListening = true;
    if (Capacitor.getPlatform() === 'android') await Promise.all(CHANNELS.map((c) => PushNotifications.createChannel(c).catch(() => {})));
    PushNotifications.addListener('registration', ({ value }) => {
      api.registerDevice({ platform: Capacitor.getPlatform(), token: value, app: 'practitioner' }).then((d) => { deviceId = d.id; }).catch(() => {});
    });
    PushNotifications.addListener('registrationError', () => {});
    PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const path = notification?.data?.path;
      if (typeof path === 'string' && path.startsWith('/')) window.location.assign(path);
    });
    window.addEventListener('nabitouch:resume', () => { PushNotifications.register().catch(() => {}); });
  }
  await PushNotifications.register();
}

// Sign-out: revoke on the server first (needs the live session), then drop the local FCM registration.
export async function unregisterPush() {
  if (!isNative()) return;
  if (deviceId) await api.removeDevice(deviceId).catch(() => {});
  deviceId = null;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  await PushNotifications.removeAllListeners().catch(() => {});
  await PushNotifications.unregister().catch(() => {});
  pushListening = false;
}
