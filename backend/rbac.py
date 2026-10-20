"""Identity roles and workspace presentation. Workspaces are presentation context, not grants."""

STAFF_ROLES = ("owner", "manager", "practitioner", "desk")
CLIENT_ROLE = "client"
ALL_ROLES = STAFF_ROLES + (CLIENT_ROLE,)
WORKSPACE_ROLES = ("owner", "practitioner", "desk", "client")
BOOKING_SOURCES = ("online", "reception", "phone", "whatsapp", "sms", "walk_in", "staff")
BOOKING_SOURCE_LABELS = {
    "online": "Online",
    "reception": "Reception",
    "phone": "Phone",
    "whatsapp": "WhatsApp",
    "sms": "SMS",
    "walk_in": "Walk-in",
    "staff": "Staff",
}

# Operational owner endpoints also accept an authorized manager.
OWNER_EQUIVALENT = frozenset({"owner", "manager"})
# MFA policy, emergency capability, and similar stay owner-primary.
OWNER_ONLY = frozenset({"owner"})


def effective_roles(user):
    if not user:
        return []
    roles = [r for r in (user.get("roles") or []) if r in ALL_ROLES]
    primary = user.get("role")
    if primary in ALL_ROLES and primary not in roles:
        roles.insert(0, primary)
    return roles


def has_role(user, *allowed):
    have = set(effective_roles(user))
    want = set(allowed)
    if want & OWNER_EQUIVALENT and have & OWNER_EQUIVALENT:
        return True
    return bool(have & want)


def has_strict_role(user, *allowed):
    return bool(set(effective_roles(user)) & set(allowed))


def is_privileged(user):
    return bool(set(effective_roles(user)) & set(STAFF_ROLES))


def is_sysadmin(user):
    """Emergency capability flag only. Never appears as a daily workspace."""
    return "sysadmin" in (user.get("capabilities") or [])


def workspaces_for(user):
    """Authorized presentation workspaces. Sysadmin is never a daily workspace."""
    roles = effective_roles(user)
    spaces = []
    if "owner" in roles or "manager" in roles:
        spaces.append("owner")
    if "practitioner" in roles and user.get("subject"):
        spaces.append("practitioner")
    if "desk" in roles:
        spaces.append("desk")
    if "client" in roles:
        spaces.append("client")
    # Legacy: owner linked to a practitioner profile may open practitioner workspace.
    if "owner" in roles and user.get("subject") and "practitioner" not in spaces:
        spaces.append("practitioner")
    # Preferred default first when authorized.
    preferred = user.get("preferredWorkspace")
    if preferred in spaces:
        spaces = [preferred] + [s for s in spaces if s != preferred]
    return spaces


def require_roles(user, *allowed, strict=False):
    from fastapi import HTTPException
    if not user:
        raise HTTPException(401, "Not authenticated")
    ok = has_strict_role(user, *allowed) if strict else has_role(user, *allowed)
    if allowed and not ok:
        raise HTTPException(403, "Not permitted for your role")
    return user


def normalize_roles(roles, primary=None):
    out = []
    for role in list(roles or []) + ([primary] if primary else []):
        if role in ALL_ROLES and role not in out:
            out.append(role)
    if not out and primary in ALL_ROLES:
        out = [primary]
    return out


def primary_role(roles):
    for candidate in ("owner", "manager", "practitioner", "desk", "client"):
        if candidate in roles:
            return candidate
    return roles[0] if roles else "client"


def normalize_booking_source(value, *, default="online"):
    source = str(value or default).strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {"walkin": "walk_in", "walk-in": "walk_in", "front_desk": "reception", "desk": "reception"}
    source = aliases.get(source, source)
    return source if source in BOOKING_SOURCES else default
