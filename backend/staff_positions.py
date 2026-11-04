"""Display positions vs access roles.

Positions are titles only. They never grant API permissions.
Access is controlled exclusively by `roles` / RBAC.
"""
from __future__ import annotations

from fastapi import HTTPException

from rbac import STAFF_ROLES, effective_roles, has_strict_role, normalize_roles, primary_role

# Access roles (system permissions). Desk is stored; UI may label it Receptionist.
ACCESS_ROLE_LABELS = {
    "owner": "Owner — full business administration",
    "manager": "Manager — delegated operational management",
    "desk": "Receptionist — bookings, scheduling and client reception",
    "practitioner": "Practitioner — clinical services and assigned appointments",
}

# Display titles. Independent from roles.
POSITION_OPTIONS = (
    ("owner", "Owner"),
    ("general_manager", "General Manager"),
    ("receptionist", "Receptionist"),
    ("registered_massage_therapist", "Registered Massage Therapist"),
    ("administrative_assistant", "Administrative Assistant"),
    ("other", "Other"),
)
POSITION_IDS = frozenset(pid for pid, _ in POSITION_OPTIONS)
PRIVILEGED_ROLE_CHANGES = frozenset({"owner", "practitioner", "manager"})


def normalize_positions(raw, *, custom_title=None):
    """Return cleaned position ids plus optional custom title for `other`."""
    selected = []
    for item in list(raw or []):
        text = str(item or "").strip().lower().replace(" ", "_").replace("-", "_")
        aliases = {
            "gm": "general_manager",
            "manager": "general_manager",
            "reception": "receptionist",
            "rmt": "registered_massage_therapist",
            "massage_therapist": "registered_massage_therapist",
            "admin": "administrative_assistant",
            "assistant": "administrative_assistant",
        }
        text = aliases.get(text, text)
        if text in POSITION_IDS and text not in selected:
            selected.append(text)
    title = " ".join(str(custom_title or "").split())[:80]
    if "other" in selected and not title:
        raise HTTPException(400, "Enter a custom title for the Other position")
    if "other" not in selected:
        title = ""
    return selected, title


def position_labels(positions, custom_title=""):
    labels = []
    by_id = dict(POSITION_OPTIONS)
    for pid in positions or []:
        if pid == "other" and custom_title:
            labels.append(custom_title)
        else:
            labels.append(by_id.get(pid, pid))
    return labels


def positions_never_grant_roles(positions):
    """Positions are display-only — return empty role grants intentionally."""
    _ = positions
    return []


def validate_role_assignment(*, actor, target, requested_roles, previous_roles, active_owner_count):
    """Enforce owner-only privilege changes and last-owner protection."""
    roles = normalize_roles(requested_roles)
    if not roles or any(role not in STAFF_ROLES for role in roles):
        raise HTTPException(400, "Choose owner, manager, practitioner, or reception roles")

    actor_roles = set(effective_roles(actor))
    previous = set(normalize_roles(previous_roles, (target or {}).get("role")))
    next_roles = set(roles)
    added = next_roles - previous
    removed = previous - next_roles

    # Managers (without strict owner) cannot grant/revoke owner, and cannot self-promote.
    if not has_strict_role(actor, "owner"):
        if "owner" in added or "owner" in removed:
            raise HTTPException(403, "Only an authorized owner can grant or revoke the owner role")
        if "owner" in next_roles and "owner" not in previous:
            raise HTTPException(403, "A manager cannot promote anyone to owner")
        if actor.get("id") and target and actor.get("id") == target.get("id") and ("owner" in added or "manager" in added):
            raise HTTPException(403, "You cannot grant yourself privileged roles")

    if "owner" in added and not has_strict_role(actor, "owner"):
        raise HTTPException(403, "Only an authorized owner can grant the owner role")

    # Never drop the last active owner.
    target_was_active_owner = (
        "owner" in previous
        and (target or {}).get("status") in (None, "active", "invited")
    )
    if target_was_active_owner and "owner" in removed:
        if int(active_owner_count or 0) <= 1:
            raise HTTPException(409, "Keep at least one active owner account")

    sensitive = bool((added | removed) & PRIVILEGED_ROLE_CHANGES) or ("owner" in added) or ("owner" in removed)
    return {
        "roles": roles,
        "primary": primary_role(roles),
        "added": sorted(added),
        "removed": sorted(removed),
        "sensitive": sensitive,
    }


def require_practitioner_link(roles, practitioner_id, existing_subject=None, *, allow_create=False):
    if "practitioner" not in roles:
        if practitioner_id:
            raise HTTPException(400, "Administrative accounts cannot link a therapist profile")
        return None
    subject = practitioner_id or existing_subject
    if not subject and not allow_create:
        raise HTTPException(400, "Practitioner role requires an explicitly linked practitioner profile")
    return subject
