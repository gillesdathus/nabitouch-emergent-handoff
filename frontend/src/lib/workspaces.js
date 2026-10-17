export const WORKSPACES = {
  client: { to: "/me", label: "My Nabitouch" },
  practitioner: { to: "/pro", label: "Practitioner" },
  owner: { to: "/owner", label: "Owner" },
  desk: { to: "/desk", label: "Reception" },
};

export function spacesOf(user) {
  if (Array.isArray(user?.workspaces) && user.workspaces.length) return user.workspaces.filter((role) => WORKSPACES[role]);
  return user?.role && WORKSPACES[user.role] ? [user.role] : [];
}

export function homeFor(user) {
  const first = spacesOf(user)[0];
  return first ? WORKSPACES[first].to : "/";
}

export function workspaceForPath(pathname) {
  if (pathname.startsWith("/pro")) return "practitioner";
  if (pathname.startsWith("/owner")) return "owner";
  if (pathname.startsWith("/desk")) return "desk";
  return null;
}

export function canOpen(user, pathname) {
  const path = String(pathname || "").split("?")[0];
  const need = workspaceForPath(path);
  if (!need) return true;
  return spacesOf(user).includes(need);
}
