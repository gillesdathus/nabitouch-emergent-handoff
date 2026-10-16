// Backend-authoritative session timing. Clocks derive from server timestamps, so locking the phone never resets them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

const QUEUE_KEY = 'nb.pendingSessionOps';

export const newOpId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
const writeQueue = (rows) => localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));

const SENDERS = {
  transition: (op) => api.transition(op.apptId, op.to, op.actor, op.note, op.opId),
  pause: (op) => api.pauseSession(op.apptId, { reason: op.reason, opId: op.opId }),
  resume: (op) => api.resumeSession(op.apptId, { opId: op.opId }),
  ready: (op) => api.readyForNext(op.apptId, { checklist: op.checklist, opId: op.opId }),
};

const isNetworkError = (err) => !err?.response;

// Sends one session action. A network failure keeps it queued with its opId; the server de-duplicates replays.
export async function sendSessionOp(op) {
  const row = { ...op, opId: op.opId || newOpId(), queuedAt: new Date().toISOString() };
  try {
    return { synced: true, result: await SENDERS[row.kind](row) };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    writeQueue([...readQueue().filter((item) => item.opId !== row.opId), row]);
    window.dispatchEvent(new Event('nabitouch:ops-queued'));
    return { synced: false, opId: row.opId };
  }
}

export async function flushSessionOps() {
  const rows = readQueue();
  if (!rows.length) return 0;
  let sent = 0;
  for (const row of rows) {
    try {
      await SENDERS[row.kind](row);
      sent += 1;
      writeQueue(readQueue().filter((item) => item.opId !== row.opId));
    } catch (err) {
      if (isNetworkError(err)) break;
      writeQueue(readQueue().filter((item) => item.opId !== row.opId));
      window.dispatchEvent(new CustomEvent('nabitouch:ops-rejected', { detail: err?.response?.data?.detail || 'A queued action was refused' }));
    }
  }
  window.dispatchEvent(new Event('nabitouch:ops-queued'));
  return sent;
}

export function usePendingOps(apptId) {
  const [rows, setRows] = useState(() => readQueue().filter((row) => row.apptId === apptId));
  useEffect(() => {
    const sync = () => setRows(readQueue().filter((row) => row.apptId === apptId));
    window.addEventListener('nabitouch:ops-queued', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('nabitouch:ops-queued', sync); window.removeEventListener('storage', sync); };
  }, [apptId]);
  return rows;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

// Polls the turnaround snapshot and keeps a server-clock offset so local ticking stays aligned to the backend.
export function useTurnaround(apptId, { active = true, interval = 15000 } = {}) {
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const offset = useRef(0);
  const load = useCallback(async () => {
    if (!apptId || !active) return null;
    try {
      const sentAt = Date.now();
      const row = await api.turnaround(apptId);
      const rtt = Date.now() - sentAt;
      offset.current = new Date(row.serverNow).getTime() - (sentAt + rtt / 2);
      setSnap({ ...row, fetchedAt: Date.now() });
      setLastSync(new Date());
      setError('');
      return row;
    } catch (err) {
      setError(err?.response ? (err.response.data?.detail || 'Could not load the session clock') : 'Offline. Showing the last synced clock.');
      return null;
    }
  }, [apptId, active]);
  useEffect(() => {
    if (!active) return undefined;
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, interval);
    const wake = () => { flushSessionOps().finally(load); };
    const visible = () => { if (!document.hidden) wake(); };
    window.addEventListener('online', wake);
    window.addEventListener('nabitouch:resume', wake);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); window.removeEventListener('online', wake); window.removeEventListener('nabitouch:resume', wake); document.removeEventListener('visibilitychange', visible); };
  }, [active, interval, load]);
  const serverNow = useCallback(() => Date.now() + offset.current, []);
  return { snap, error, lastSync, reload: load, serverNow };
}

export function treatmentClock(treatment, nowMs) {
  if (!treatment) return null;
  const started = new Date(treatment.startedAt).getTime();
  const end = treatment.endedAt ? new Date(treatment.endedAt).getTime() : nowMs;
  let paused = treatment.pausedMs || 0;
  if (treatment.pausedAt && !treatment.endedAt) paused += Math.max(0, nowMs - new Date(treatment.pausedAt).getTime());
  const elapsed = Math.max(0, end - started - paused);
  const booked = treatment.bookedMin * 60000;
  return { elapsed, remaining: booked - elapsed, booked, pct: Math.min(1, booked ? elapsed / booked : 0), overtime: elapsed > booked };
}

export const fmtSpan = (ms) => {
  const total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return ms < 0 ? `+${body}` : body;
};

export const fmtClockTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Edmonton' }) : '—');

export const NEXT_STATE = {
  on_schedule: { label: 'On schedule', tone: 'bg-teal-50 text-teal-800 ring-teal-200' },
  preparation_required: { label: 'Preparation required', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  departure_soon: { label: 'Departure soon', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  at_risk: { label: 'At risk of delay', tone: 'bg-orange-50 text-orange-800 ring-orange-200' },
  running_late: { label: 'Running late', tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
};

export const OPS_STATE = {
  in_session: { label: 'In session', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  treatment_overtime: { label: 'Treatment overtime', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  interrupted: { label: 'Paused / interrupted', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  cleanup_in_progress: { label: 'Cleanup in progress', tone: 'bg-cyan-50 text-cyan-800 ring-cyan-200' },
  ready_next: { label: 'Ready for next', tone: 'bg-teal-50 text-teal-800 ring-teal-200' },
  traveling: { label: 'Traveling', tone: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
  running_late: { label: 'Running late', tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
  idle: { label: 'No active visit', tone: 'bg-slate-50 text-slate-600 ring-slate-200' },
};
