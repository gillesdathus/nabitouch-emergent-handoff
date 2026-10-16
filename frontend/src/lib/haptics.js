// Discreet haptics: native taps on the phone, a short vibration on the web where supported. Never audible.
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const native = () => !!window.Capacitor?.isNativePlatform?.();

export async function tap(kind = 'light') {
  try {
    if (native()) {
      if (kind === 'warning') await Haptics.notification({ type: NotificationType.Warning });
      else if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
      else await Haptics.impact({ style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
      return;
    }
    if (navigator.vibrate) navigator.vibrate(kind === 'warning' ? [60, 80, 60] : 30);
  } catch { /* haptics are optional */ }
}
