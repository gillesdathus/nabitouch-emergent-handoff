/**
 * Resolve which practitioner profile the signed-in account should operate as.
 * Never fall back to a demo seed id (e.g. p-jordan) — that crashes production
 * when the seed profile does not exist.
 */
export function resolvePractitionerId(user, fallback = "") {
  if (!user) return fallback || "";
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const linked = typeof user.subject === "string" && user.subject.trim() ? user.subject.trim() : "";
  const practices =
    user.role === "practitioner" ||
    roles.includes("practitioner") ||
    ((user.role === "owner" || roles.includes("owner") || roles.includes("manager")) && Boolean(linked));
  if (practices && linked) return linked;
  if (user.role === "practitioner") return linked || fallback || "";
  return fallback || "";
}

export function hasPractitionerCapability(user) {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return user.role === "practitioner" || roles.includes("practitioner") ||
    ((user.role === "owner" || roles.includes("owner") || roles.includes("manager")) && Boolean(user.subject));
}
