import { addDays, endTime, fmtTime } from "@/lib/domain";
import { toMin, weekStart } from "@/components/ops/calendar/time";

export const CALENDAR_VIEWS = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function monthStart(day) {
  return `${day.slice(0, 8)}01`;
}

export function monthEnd(day) {
  const [year, month] = day.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${day.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

export function rangeForView(view, cursor) {
  if (view === "day") return [cursor, cursor];
  if (view === "month") return [monthStart(cursor), monthEnd(cursor)];
  const start = weekStart(cursor);
  return [start, addDays(start, 6)];
}

export function stepCursor(view, cursor, dir) {
  if (view === "month") {
    const d = new Date(`${cursor.slice(0, 8)}01T12:00:00`);
    d.setMonth(d.getMonth() + dir);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }
  return addDays(cursor, dir * (view === "day" ? 1 : 7));
}

/** Clinic visits use locationType "clinic"; everything else is treated as mobile. */
export function isClinicVisit(appt) {
  return appt?.locationType === "clinic";
}

export function visitPlaceLabel(appt) {
  return isClinicVisit(appt) ? "Clinic" : "Mobile";
}

export function timeRangeLabel(start, endOrDuration) {
  if (!start) return "";
  const end = typeof endOrDuration === "number" ? endTime(start, endOrDuration) : endOrDuration;
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

export function validateTimeRange(start, end) {
  if (!start || !end) return "Enter a start and end time.";
  if (toMin(end) <= toMin(start)) return "End time must be after start time.";
  return "";
}

export function dayRow(days, date) {
  return (days || []).find((row) => row.date === date) || null;
}

export function daySegments(days, date) {
  return dayRow(days, date)?.segments || [];
}

/** True when the API returned a day row for this date (empty segments still count). */
export function dayKnown(days, date) {
  return Boolean(dayRow(days, date));
}

export function workingWindow(segments) {
  const available = (segments || []).filter((s) => s.state === "available");
  if (!available.length) return null;
  const start = available.reduce((min, s) => (toMin(s.start) < toMin(min) ? s.start : min), available[0].start);
  const end = available.reduce((max, s) => (toMin(s.end) > toMin(max) ? s.end : max), available[0].end);
  return { start, end };
}

export function dayAvailabilityTone(segments, { known = true } = {}) {
  if (!known) return "pending";
  const list = segments || [];
  if (!list.length) return "off";
  if (list.some((s) => s.state === "blocked" || s.state === "unavailable")) {
    if (list.some((s) => s.state === "available" || s.state === "booked")) return "partial";
    return "blocked";
  }
  if (list.some((s) => s.state === "available" || s.state === "booked")) return "open";
  return "off";
}

export function appointmentsOnDate(appointments, date) {
  return (appointments || [])
    .filter((a) => a.date === date && a.status !== "cancelled" && a.status !== "rescheduled")
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export function conflictingAppointments(appointments, date, start, end, fullDay) {
  const rows = appointmentsOnDate(appointments, date);
  if (fullDay || !start || !end) return rows;
  const a0 = toMin(start);
  const a1 = toMin(end);
  return rows.filter((appt) => {
    const b0 = toMin(appt.time);
    const b1 = b0 + Number(appt.duration || 60);
    return a0 < b1 && a1 > b0;
  });
}

export function weeklyDefaults(schedule) {
  const byDay = Object.fromEntries(WEEKDAY_LABELS.map((_, i) => [i, { on: false, start: "09:00", end: "17:00" }]));
  (schedule?.weekly || []).forEach((row) => {
    const day = Number(row.weekday);
    if (day < 0 || day > 6) return;
    byDay[day] = { on: true, start: row.start || "09:00", end: row.end || "17:00" };
  });
  return byDay;
}
