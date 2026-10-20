export const TZ = "America/Edmonton";
export const pad2 = (n) => String(n).padStart(2, "0");
export const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").slice(0, 5).split(":").map(Number);
  return (Number.isNaN(h) ? 0 : h) * 60 + (m || 0);
};
export const fromMin = (mins) => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;

export function edmontonNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const time = `${parts.hour}:${parts.minute}`;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time, minutes: toMin(time) };
}

export const weekStart = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export function shiftMonth(iso, n) {
  const d = new Date(`${iso.slice(0, 8)}01T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

// Side-by-side lanes for overlapping visits in one day column.
export function layoutLanes(items) {
  const sorted = [...items].sort((a, b) => toMin(a.time) - toMin(b.time));
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => out.push({ ...c, lanes }));
    cluster = [];
  };
  sorted.forEach((appt) => {
    const start = toMin(appt.time);
    const end = start + Number(appt.duration || 60);
    if (start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.end > start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    cluster.push({ appt, start, end, lane });
    clusterEnd = Math.max(clusterEnd, end);
  });
  if (cluster.length) flush();
  return out;
}

export const MOVABLE = ["requested", "confirmed", "assigned"];

export const STATUS_FILL = {
  requested: "bg-amber-50 text-amber-950 ring-amber-200",
  confirmed: "bg-sky-50 text-sky-950 ring-sky-200",
  assigned: "bg-sky-50 text-sky-950 ring-sky-200",
  preparing: "bg-cyan-50 text-cyan-950 ring-cyan-200",
  en_route: "bg-cyan-50 text-cyan-950 ring-cyan-200",
  arrived: "bg-teal-50 text-teal-950 ring-teal-200",
  in_session: "bg-teal-100 text-teal-950 ring-teal-300",
  completed: "bg-slate-50 text-slate-600 ring-slate-200",
  processing: "bg-slate-50 text-slate-600 ring-slate-200",
  closed: "bg-slate-50 text-slate-600 ring-slate-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200 line-through",
  no_show: "bg-rose-50 text-rose-700 ring-rose-200",
};
