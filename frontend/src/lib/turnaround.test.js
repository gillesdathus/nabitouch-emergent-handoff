import { vi, beforeEach, test, expect } from 'vitest';
import { api } from '@/lib/api';
import { sendSessionOp, flushSessionOps, treatmentClock } from './turnaround';

vi.mock('@/lib/api', () => ({ api: { transition: vi.fn(), pauseSession: vi.fn(), resumeSession: vi.fn(), readyForNext: vi.fn() } }));
const key = 'nb.pendingSessionOps';
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });

test('an offline action replays its original operation ID and is removed only after success', async () => {
  api.pauseSession.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
  const op = { kind: 'pause', apptId: 'synthetic-visit', reason: 'water break', opId: 'stable-op' };
  expect(await sendSessionOp(op)).toEqual({ synced: false, opId: 'stable-op' });
  expect(JSON.parse(localStorage.getItem(key))).toHaveLength(1);
  expect(await flushSessionOps()).toBe(1);
  expect(api.pauseSession).toHaveBeenLastCalledWith('synthetic-visit', { reason: 'water break', opId: 'stable-op' });
  expect(JSON.parse(localStorage.getItem(key))).toEqual([]);
  expect(await flushSessionOps()).toBe(0);
  expect(api.pauseSession).toHaveBeenCalledTimes(2);
});

test('a failed reconnect preserves action order and leaves later actions unsent', async () => {
  localStorage.setItem(key, JSON.stringify([{ kind: 'pause', apptId: 'a', opId: '1' }, { kind: 'resume', apptId: 'a', opId: '2' }]));
  api.pauseSession.mockRejectedValue(new Error('offline'));
  expect(await flushSessionOps()).toBe(0);
  expect(JSON.parse(localStorage.getItem(key)).map(op => op.opId)).toEqual(['1', '2']);
  expect(api.resumeSession).not.toHaveBeenCalled();
});

test('a server rejection is surfaced and removed from the replay queue', async () => {
  localStorage.setItem(key, JSON.stringify([{ kind: 'ready', apptId: 'a', opId: '1' }]));
  api.readyForNext.mockRejectedValue({ response: { status: 409, data: { detail: 'Session not finished' } } });
  const rejected = vi.fn();
  window.addEventListener('nabitouch:ops-rejected', rejected, { once: true });
  expect(await flushSessionOps()).toBe(0);
  expect(rejected.mock.calls[0][0].detail).toBe('Session not finished');
  expect(JSON.parse(localStorage.getItem(key))).toEqual([]);
});

test('the treatment clock excludes pauses and reports overtime from server timestamps', () => {
  const start = Date.parse('2026-10-15T15:00:00Z');
  const treatment = { startedAt: new Date(start).toISOString(), bookedMin: 60, pausedMs: 300000 };
  expect(treatmentClock(treatment, start + 65 * 60000).remaining).toBe(0);
  expect(treatmentClock(treatment, start + 66 * 60000)).toMatchObject({ overtime: true, remaining: -60000 });
  const paused = { ...treatment, pausedAt: new Date(start + 30 * 60000).toISOString() };
  expect(treatmentClock(paused, start + 90 * 60000).elapsed).toBe(25 * 60000);
});
