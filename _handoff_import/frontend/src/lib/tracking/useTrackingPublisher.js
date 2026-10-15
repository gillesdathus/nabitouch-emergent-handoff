import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { locationProviderFor } from './providers';

// Publishes fixes for an authorised trip only (status en_route + sharing). Keeps only the latest unsent fix while offline.
export function useTrackingPublisher(appt, practitionerId, live = false) {
  const [state, setState] = useState({ status: 'idle', lastAck: null, error: null });
  const apptRef = useRef(appt);
  apptRef.current = appt;
  const active = appt?.status === 'en_route' && appt?.trip?.sharing && appt?.practitionerId === practitionerId;

  useEffect(() => {
    if (!active) { setState((s) => ({ ...s, status: appt?.status === 'en_route' && appt?.practitionerId !== practitionerId ? 'not authorised (not your trip)' : 'idle' })); return; }
    let seq = Date.now();
    let pending = null;
    const auth = `practitioner:${practitionerId}`;
    const send = async (fix) => {
      if (!navigator.onLine) { pending = fix; setState((s) => ({ ...s, status: 'offline' })); return; }
      try {
        const r = await api.trackingIngest(apptRef.current.id, { ...fix, seq: ++seq }, auth);
        setState({ status: r.accepted ? 'sharing' : 'degraded', lastAck: new Date(), error: r.accepted ? null : r.reason });
      } catch (e) { setState((s) => ({ ...s, status: 'error', error: e?.response?.data?.detail || 'network' })); pending = fix; }
    };
    const onOnline = () => { if (pending) { const f = { ...pending, recordedAt: new Date().toISOString() }; pending = null; send(f); } };
    window.addEventListener('online', onOnline);
    const beat = setInterval(() => api.trackingHeartbeat(apptRef.current.id).catch(() => {}), 20000);
    const msg = { denied: 'location permission denied — allow location for this site in your browser settings', timeout: 'GPS timed out', unavailable: 'GPS unavailable' };
    const stop = locationProviderFor(() => apptRef.current, live).start(send, (code) => {
      if (code === 'not_live') { setState({ status: 'not using phone GPS', lastAck: null, error: null }); return; }
      setState((s) => ({ ...s, status: 'error', error: msg[code] || code }));
    });
    return () => { stop(); clearInterval(beat); window.removeEventListener('online', onOnline); };
  }, [active, practitionerId, live]); // eslint-disable-line

  return state;
}
