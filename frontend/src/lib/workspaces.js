export const WORKSPACES = {
  client: { to: "/me", label: "My Nabitouch" },
  practitioner: { to: "/pro", label: "Practitioner" },
  owner: { to: "/owner", label: "Owner / Manager" },
  desk: { to: "/desk", label: "Reception" },
};

export const BOOKING_SOURCES = [
  { id: "phone", label: "Phone" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "walk_in", label: "Walk-in" },
  { id: "reception", label: "Reception" },
  { id: "staff", label: "Staff" },
];

export function spacesOf(user) {
  if (Array.isArray(user?.workspaces) && user.workspaces.length) return user.workspaces.filter((role) => WORKSPACES[role]);
  return user?.role && WORKSPACES[user.role] ? [user.role] : [];
}

export function homeFor(user) {
  const preferred = user?.preferredWorkspace;
  const spaces = spacesOf(user);
  if (preferred && spaces.includes(preferred)) return WORKSPACES[preferred].to;
  const first = spaces[0];
  return first ? WORKSPACES[first].to : "/";
}

export function workspaceForPath(pathname) {
  const path = String(pathname || "").split("?")[0];
  if (path.startsWith("/pro")) return "practitioner";
  if (path.startsWith("/owner")) return "owner";
  if (path.startsWith("/desk")) return "desk";
  // Client Account (/me) is not a public post-login target for staff.
  if (path === "/me" || path.startsWith("/me/")) return "client";
  return null;
}

export function canOpen(user, pathname) {
  const path = String(pathname || "").split("?")[0];
  const need = workspaceForPath(path);
  if (!need) return true;
  return spacesOf(user).includes(need);
}

/** Post-auth destination: honor ?next= only when that workspace is authorized. */
export function postLoginPath(user, next) {
  if (next && canOpen(user, next)) return next;
  return homeFor(user);
}
