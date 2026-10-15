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

const SCHEMES = {
  google: (lat, lng, line) => `comgooglemaps://?daddr=${lat ? `${lat},${lng}` : encodeURIComponent(line)}&directionsmode=driving`,
  apple: (lat, lng, line) => `maps://?daddr=${lat ? `${lat},${lng}` : encodeURIComponent(line)}`,
  waze: (lat, lng, line) => (lat ? `waze://?ll=${lat},${lng}&navigate=yes` : `waze://?q=${encodeURIComponent(line)}&navigate=yes`),
};

// Opens the installed app when it exists, otherwise the web link. Opening an app does not mean navigation has started.
export async function openNavigation(app, lat, lng, line, webHref) {
  if (!isNative()) return false;
  const { AppLauncher } = await import('@capacitor/app-launcher');
  const url = SCHEMES[app]?.(lat, lng, line);
  const ios = Capacitor.getPlatform() === 'ios';
  try {
    if (url && (app !== 'apple' || ios) && (await AppLauncher.canOpenUrl({ url })).value) { await AppLauncher.openUrl({ url }); return true; }
  } catch { /* fall through to the web link */ }
  await AppLauncher.openUrl({ url: webHref });
  return true;
}

let pushRegistered = false;
export async function registerPush() {
  if (!isNative() || pushRegistered) return;
  pushRegistered = true;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  PushNotifications.addListener('registration', ({ value }) => {
    api.registerDevice({ platform: Capacitor.getPlatform(), token: value, app: 'pro' }).catch(() => {});
  });
  await PushNotifications.register();
}
