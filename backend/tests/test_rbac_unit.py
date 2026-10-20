"""Pure RBAC helpers — no live server required."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rbac import (  # noqa: E402
    BOOKING_SOURCES,
    effective_roles,
    has_role,
    has_strict_role,
    is_sysadmin,
    normalize_booking_source,
    normalize_roles,
    primary_role,
    workspaces_for,
)


def test_multi_role_owner_and_practitioner_workspaces():
    nabitu = {"role": "practitioner", "roles": ["owner", "practitioner"], "subject": "p-nabitu", "preferredWorkspace": "practitioner"}
    assert effective_roles(nabitu) == ["owner", "practitioner"]
    assert workspaces_for(nabitu)[0] == "practitioner"
    assert "owner" in workspaces_for(nabitu)
    assert has_role(nabitu, "owner")
    assert has_strict_role(nabitu, "owner")


def test_owner_without_practitioner_profile_gets_owner_and_optional_desk():
    owner_a = {"role": "owner", "roles": ["owner", "desk"]}
    spaces = workspaces_for(owner_a)
    assert spaces[0] == "owner"
    assert "desk" in spaces
    assert "practitioner" not in spaces


def test_manager_is_owner_equivalent_but_not_strict_owner():
    manager = {"role": "manager", "roles": ["manager"]}
    assert has_role(manager, "owner")
    assert not has_strict_role(manager, "owner")
    assert workspaces_for(manager) == ["owner"]


def test_sysadmin_is_capability_not_workspace():
    admin = {"role": "owner", "roles": ["owner"], "capabilities": ["sysadmin"]}
    assert is_sysadmin(admin)
    assert "sysadmin" not in workspaces_for(admin)


def test_normalize_roles_and_primary():
    assert normalize_roles(["desk", "owner"], "practitioner") == ["desk", "owner", "practitioner"]
    assert primary_role(["desk", "practitioner", "owner"]) == "owner"
    assert primary_role(["desk"]) == "desk"


def test_booking_sources_normalize():
    assert set(BOOKING_SOURCES) >= {"online", "reception", "phone", "whatsapp", "sms", "walk_in", "staff"}
    assert normalize_booking_source("WhatsApp") == "whatsapp"
    assert normalize_booking_source("walk-in") == "walk_in"
    assert normalize_booking_source("front_desk") == "reception"
    assert normalize_booking_source("unknown", default="phone") == "phone"
