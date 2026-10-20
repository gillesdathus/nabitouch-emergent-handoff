/** Team Connect™ workspace paths and area definitions. Staff-only; no client bottom-tab. */

export const TEAM_AREAS = [
  {
    id: "messages",
    title: "Messages",
    detail: "Client visit chats now. Staff and group messaging arrives next.",
    path: "messages",
    tint: "tint-ice",
    phase: 2,
  },
  {
    id: "help",
    title: "Quick Help",
    detail: "Running late, vehicle, safety, address, supplies, and other assistance.",
    path: "help",
    tint: "tint-mint",
    phase: 3,
  },
  {
    id: "requests",
    title: "Requests",
    detail: "Assistance board with New, Accepted, In Progress, and Resolved.",
    path: "requests",
    tint: "tint-lagoon",
    phase: 3,
  },
  {
    id: "supplies",
    title: "Supplies",
    detail: "Stock overview, requests, and handoff confirmation.",
    path: "supplies",
    tint: "tint-meadow",
    phase: 5,
  },
];

export const QUICK_HELP_CATEGORIES = [
  { id: "running_late", title: "Running Late", detail: "Tell the desk you need time" },
  { id: "vehicle_issue", title: "Vehicle Issue", detail: "Fleet or roadside help" },
  { id: "safety_concern", title: "Safety Concern", detail: "Prioritise 911 when needed" },
  { id: "address_problem", title: "Address Problem", detail: "Access, buzzer, or wrong pin" },
  { id: "need_supplies", title: "Need Supplies", detail: "Linens, oils, or equipment" },
  { id: "other", title: "Other Assistance", detail: "Anything else for on-duty staff" },
];

export function teamBase(role) {
  if (role === "owner") return "/owner/team";
  if (role === "desk") return "/desk/team";
  return "/pro/team";
}

export function teamPath(role, area = "") {
  const base = teamBase(role);
  return area ? `${base}/${area}` : base;
}

export function teamNavFor(role) {
  const base = teamBase(role);
  return [
    { to: base, label: "Home", end: true },
    ...TEAM_AREAS.map((area) => ({ to: `${base}/${area.path}`, label: area.title })),
  ];
}

/** Align nav badge with threads still open for the practitioner inbox. */
export function visibleUnreadFromInbox(body) {
  const byAppointment = body?.byAppointment || {};
  const fromMap = Object.values(byAppointment).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const fromThreads = (body?.threads || []).reduce((sum, row) => sum + (Number(row?.unread) || 0), 0);
  const reported = Number(body?.unread || 0);
  if (fromMap > 0) return fromMap;
  if (fromThreads > 0) return fromThreads;
  return reported;
}
