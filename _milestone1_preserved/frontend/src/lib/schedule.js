import { fromISO, minutesOf, hhmm } from "@/lib/domain";

export function daySegments(db, pid, date) {
  const sch = db.schedules[pid];
  if (!sch) return [];
  const hours = sch.weekly[fromISO(date).getDay()];
  if (!hours) return [{ start: "08:00", end: "20:00", state: "closed" }];
  const segs = [{ start: hours[0], end: hours[1], state: "available" }];
  sch.breaks.forEach(([s, e]) => segs.push({ start: s, end: e, state: "break" }));
  db.blocks.filter((b) => b.practitionerId === pid && b.date === date).forEach((b) => segs.push({ start: b.time, end: hhmm(minutesOf(b.time) + b.length), state: "blocked" }));
  return segs;
}

const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

export function isFree(db, pid, date, time, duration) {
  const s = minutesOf(time);
  const e = s + duration;
  const segs = daySegments(db, pid, date);
  const open = segs.find((g) => g.state === "available" && minutesOf(g.start) <= s && minutesOf(g.end) >= e);
  if (!open) return false;
  if (segs.some((g) => g.state !== "available" && g.state !== "closed" && overlaps(s, e, minutesOf(g.start), minutesOf(g.end)))) return false;
  return !db.appointments.some((a) => a.practitionerId === pid && a.date === date && a.status !== "cancelled" && overlaps(s, e, minutesOf(a.time), minutesOf(a.time) + a.duration + 30));
}

export function freeSlots(db, pids, date, duration) {
  const out = [];
  for (let m = 8 * 60; m <= 20 * 60 - duration; m += 30) {
    const t = hhmm(m);
    const who = pids.filter((p) => isFree(db, p, date, t, duration));
    if (who.length) out.push({ time: t, practitioners: who });
  }
  return out;
}
