import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export const isLiveTrial = (settings, appt) => !!settings?.liveGpsPractitionerId && appt?.practitionerId === settings.liveGpsPractitionerId;

export function trackingPhaseCopy(phase) {
  if (phase === 'paused') return 'Location sharing is paused.';
  if (phase === 'stale') return 'The last location signal is out of date.';
  if (phase === 'expired') return 'This tracking session has expired.';
  if (phase === 'stopped') return 'Location sharing has stopped.';
  if (phase === 'arrived') return 'Your practitioner has arrived. Location sharing has stopped.';
  if (phase === 'completed') return 'This visit is complete. Location sharing has stopped.';
  if (phase === 'ended') return 'This trip is no longer being tracked.';
  if (phase === 'unavailable') return 'Live location is not available right now.';
  return '';
}

export function shouldShowPosition(sess) {
  return !!(sess && sess.position && (sess.phase === 'live' || sess.phase === 'stale'));
}

export function trackingTransportForPhase(phase) {
  if (['expired', 'stopped', 'completed', 'arrived', 'ended'].includes(phase)) return 'stop';
  return 'stream';
}

export function trackingTransportAfterError() {
  return 'poll';
}

// Authenticated stream for one appointment, with polling if the stream drops.
export function useLiveSession(appt, enabled) {
  const [sess, setSess] = useState(null);
  const on = enabled && !!appt?.id && (appt.status === 'en_route' || appt.status === 'arrived');
  useEffect(() => {
    if (!on) { setSess(null); return; }
    let alive = true;
    let poll;
    const apply = (s) => { if (alive && s) setSess(s); };
    const startPoll = () => {
      if (poll) return;
      const load = () => api.trackingSession(appt.id).then(apply).catch(() => {});
      load();
      poll = setInterval(load, 5000);
    };
    let source;
    const base = process.env.REACT_APP_BACKEND_URL;
    if (base && typeof EventSource !== 'undefined') {
      source = new EventSource(`${base}/api/tracking/sessions/${appt.id}/stream`, { withCredentials: true });
      source.onmessage = (event) => {
        try {
          const next = JSON.parse(event.data);
          apply(next);
          if (trackingTransportForPhase(next.phase) === 'stop') source.close();
        } catch { /* ignore malformed events */ }
      };
      source.onerror = () => { source.close(); if (trackingTransportAfterError() === 'poll') startPoll(); };
    } else startPoll();
    return () => { alive = false; if (poll) clearInterval(poll); if (source) source.close(); };
  }, [on, appt?.id, appt?.status]);
  return sess;
}

// Overrides the simulated trip with the real phone fix for the trial practitioner.
export function applyLive(ts, sess, dest, trial) {
  if (!ts) return ts;
  if (!sess?.position) return trial ? { ...ts, live: true, waiting: true, route: [] } : ts;
  const pos = { lat: sess.position.lat, lng: sess.position.lng };
  const etaMin = sess.eta?.etaMin ?? ts.etaMin;
  return { ...ts, pos, route: sess.route?.length ? sess.route : [pos, dest], etaMin, arrival: new Date(Date.now() + etaMin * 60000), remainingKm: sess.eta?.remainingKm ?? ts.remainingKm,
    lateMin: ts.lateMin + (etaMin - ts.etaMin), arriving: etaMin === 0, live: sess.source === "gps", stale: sess.stale, ageSec: sess.ageSec, roadEta: sess.eta?.provider === "mapbox-traffic" };
}
