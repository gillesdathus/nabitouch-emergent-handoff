/** Team Connect™ workspace paths and area definitions. Staff-only; no client bottom-tab. */

export const TEAM_AREAS = [
  {
    id: "messages",
    title: "Messages",
    detail: "Client visit chats plus invitation-only staff and group messaging.",
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
    detail: "Assistance board with Active, Escalated, and Resolved filters.",
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

/** Shell / pages listen for this after mark-read so badges clear without waiting for the poll. */
export const UNREAD_REFRESH_EVENT = "nabitouch:unread-refresh";

export function notifyUnreadRefresh(scope = "all") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UNREAD_REFRESH_EVENT, { detail: { scope } }));
}

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
  const items = [
    { to: base, label: "Home", end: true },
    ...TEAM_AREAS.map((area) => ({ to: `${base}/${area.path}`, label: area.title })),
  ];
  if (role === "desk" || role === "owner") {
    items.push({ to: `${base}/client-comms`, label: "Client msgs" });
  }
  return items;
}

function sumCounts(values) {
  return values.reduce((sum, n) => sum + (Number(n) || 0), 0);
}

/**
 * Visit-chat unread. Prefer detail maps when present (including zero after clear)
 * so a stale top-level total cannot keep the badge lit.
 */
export function visibleUnreadFromInbox(body) {
  if (!body || typeof body !== "object") return 0;
  if (body.byAppointment && typeof body.byAppointment === "object") {
    return sumCounts(Object.values(body.byAppointment));
  }
  if (Array.isArray(body.threads)) {
    return sumCounts(body.threads.map((row) => row?.unread));
  }
  return Number(body.unread || 0);
}

/** Staff Team Connect unread from GET /api/team/inbox. */
export function visibleStaffUnreadFromInbox(body) {
  if (!body || typeof body !== "object") return 0;
  if (body.byThread && typeof body.byThread === "object") {
    return sumCounts(Object.values(body.byThread));
  }
  if (Array.isArray(body.threads)) {
    return sumCounts(body.threads.map((row) => row?.unread));
  }
  return Number(body.unread || 0);
}

/** Build Quick Help deep link with optional category + appointmentId. */
export function quickHelpHref(role, { category, appointmentId } = {}) {
  const base = teamPath(role, "help");
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (appointmentId) params.set("appointmentId", appointmentId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Supplies board deep link with optional appointment for next-client handoff. */
export function suppliesHref(role, { appointmentId } = {}) {
  const base = teamPath(role, "supplies");
  if (!appointmentId) return base;
  return `${base}?appointmentId=${encodeURIComponent(appointmentId)}`;
}
