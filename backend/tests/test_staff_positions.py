"""Roles vs positions, privilege safeguards. No production writes."""
import pytest
from fastapi import HTTPException

from staff_positions import (
    normalize_positions,
    positions_never_grant_roles,
    require_practitioner_link,
    validate_role_assignment,
)


def test_positions_never_grant_access_roles():
    assert positions_never_grant_roles(["owner", "general_manager", "receptionist"]) == []
    positions, title = normalize_positions(["Owner", "General Manager", "other"], custom_title="Ops Lead")
    assert positions == ["owner", "general_manager", "other"]
    assert title == "Ops Lead"


def test_manager_cannot_grant_owner():
    manager = {"id": "u-mgr", "role": "manager", "roles": ["manager", "desk"]}
    with pytest.raises(HTTPException) as raised:
        validate_role_assignment(
            actor=manager,
            target={"id": "u-2", "status": "active", "role": "desk", "roles": ["desk"]},
            requested_roles=["owner", "desk"],
            previous_roles=["desk"],
            active_owner_count=2,
        )
    assert raised.value.status_code == 403


def test_last_active_owner_cannot_be_removed():
    owner = {"id": "u-owner", "role": "owner", "roles": ["owner"]}
    with pytest.raises(HTTPException) as raised:
        validate_role_assignment(
            actor=owner,
            target={"id": "u-owner", "status": "active", "role": "owner", "roles": ["owner"]},
            requested_roles=["manager", "desk"],
            previous_roles=["owner"],
            active_owner_count=1,
        )
    assert raised.value.status_code == 409


def test_practitioner_role_requires_linked_profile():
    with pytest.raises(HTTPException):
        require_practitioner_link(["practitioner"], None, None, allow_create=False)
    assert require_practitioner_link(["practitioner"], "p-f3a4279b") == "p-f3a4279b"
    assert require_practitioner_link(["owner", "manager", "desk"], None) is None
