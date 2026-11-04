/** Access roles vs display positions. Positions never grant permissions. */

export const ACCESS_ROLES = [
  ["owner", "Owner", "Full business administration"],
  ["manager", "Manager", "Delegated operational management"],
  ["desk", "Receptionist", "Bookings, scheduling and client reception"],
  ["practitioner", "Practitioner", "Clinical services and assigned appointments"],
];

export const POSITION_OPTIONS = [
  ["owner", "Owner"],
  ["general_manager", "General Manager"],
  ["receptionist", "Receptionist"],
  ["registered_massage_therapist", "Registered Massage Therapist"],
  ["administrative_assistant", "Administrative Assistant"],
  ["other", "Other — custom title"],
];

export function roleLabel(role) {
  if (role === "desk") return "Receptionist";
  return String(role || "").replace(/^\w/, (c) => c.toUpperCase());
}

/** Mirror backend rbac.has_role: owner and manager are operationally equivalent. */
export function hasStaffRole(user, ...allowed) {
  const have = new Set([...(user?.roles || []), user?.role].filter(Boolean));
  const want = new Set(allowed);
  if ((want.has("owner") || want.has("manager")) && (have.has("owner") || have.has("manager"))) return true;
  return [...want].some((role) => have.has(role));
}

export function formatRoles(roles) {
  return (roles || []).map(roleLabel).join(", ") || "—";
}

export function formatPositions(user) {
  if (user?.positionLabels?.length) return user.positionLabels.join(", ");
  const byId = Object.fromEntries(POSITION_OPTIONS);
  return (user?.positions || [])
    .map((id) => (id === "other" && user?.customPositionTitle ? user.customPositionTitle : byId[id] || id))
    .join(", ") || "—";
}

export function toggleList(list, id) {
  const have = new Set(list || []);
  if (have.has(id)) have.delete(id);
  else have.add(id);
  return Array.from(have);
}
