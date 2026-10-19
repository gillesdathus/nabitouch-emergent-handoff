"""Dual Owner+Practitioner messaging access and author role."""
from messaging import acting_chat_role, can_access


def test_acting_chat_role_owner_practitioner_on_own_visit():
    user = {
        "id": "u-nabitu",
        "role": "owner",
        "roles": ["owner", "practitioner"],
        "subject": "p-nabitu-kahindo",
    }
    appt = {"practitionerId": "p-nabitu-kahindo", "clientId": "c-1", "status": "assigned"}
    assert acting_chat_role(user, appt) == "practitioner"


def test_acting_chat_role_falls_back_when_not_assigned():
    user = {
        "role": "owner",
        "roles": ["owner", "practitioner"],
        "subject": "p-nabitu-kahindo",
    }
    appt = {"practitionerId": "p-other", "clientId": "c-1", "status": "assigned"}
    assert acting_chat_role(user, appt) == "owner"


def test_can_access_dual_role_assigned_visit():
    user = {
        "role": "owner",
        "roles": ["owner", "practitioner"],
        "subject": "p-nabitu-kahindo",
    }
    appt = {"practitionerId": "p-nabitu-kahindo", "clientId": "c-1", "status": "assigned"}
    assert can_access(user, appt, {}) is True
    assert can_access(user, appt, {}, write=True) is True


def test_can_access_blocks_write_on_cancelled():
    user = {
        "role": "owner",
        "roles": ["owner", "practitioner"],
        "subject": "p-nabitu-kahindo",
    }
    appt = {"practitionerId": "p-nabitu-kahindo", "clientId": "c-1", "status": "cancelled"}
    assert can_access(user, appt, {}) is True
    assert can_access(user, appt, {}, write=True) is False
