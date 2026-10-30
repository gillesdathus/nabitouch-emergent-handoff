"""Checkpoint C — sole-therapist booking resolution and appointment audit.

Synthetic data only. No production database access.
"""
import pytest
from fastapi import HTTPException

from booking_assign import (
    audit_appointment_assignments,
    categorize_appointment,
    designated_practitioner_id,
    filter_recommendation_people,
    normalize_requested_practitioner_id,
)
from staff_identity import CANONICAL_PRACTITIONER_ID, CANONICAL_PRACTITIONER_NAME
from availability import launch_practitioner


def test_designated_id_is_nabitu():
    assert designated_practitioner_id() == "p-nabitu-kahindo"
    assert designated_practitioner_id() == CANONICAL_PRACTITIONER_ID


@pytest.mark.parametrize("requested", [None, "", "any", "Any", "any_available", "*"])
def test_empty_or_any_resolves_to_nabitu(requested):
    pid, mode = normalize_requested_practitioner_id(requested)
    assert pid == CANONICAL_PRACTITIONER_ID
    assert mode == "auto"


def test_explicit_nabitu_accepted():
    pid, mode = normalize_requested_practitioner_id(CANONICAL_PRACTITIONER_ID)
    assert pid == CANONICAL_PRACTITIONER_ID
    assert mode == "explicit"


@pytest.mark.parametrize("requested", ["p-maya", "p-jordan", "p-dathus", "owner-uuid", "p-liam"])
def test_unauthorized_practitioner_ids_rejected(requested):
    with pytest.raises(HTTPException) as raised:
        normalize_requested_practitioner_id(requested)
    assert raised.value.status_code == 409
    assert CANONICAL_PRACTITIONER_NAME.split()[0] in raised.value.detail


def test_recommendation_people_filter_sole_therapist():
    people = [
        launch_practitioner(),
        {"id": "p-maya", "name": "Maya Chen", "available": True, "bookable": True, "onboardingStatus": "approved"},
    ]
    matched, pid = filter_recommendation_people(people, None)
    assert pid == CANONICAL_PRACTITIONER_ID
    assert [row["id"] for row in matched] == [CANONICAL_PRACTITIONER_ID]


def test_recommendation_rejects_missing_canonical_profile():
    with pytest.raises(HTTPException) as raised:
        filter_recommendation_people([{"id": "p-maya", "name": "Maya"}], None)
    assert raised.value.status_code == 409


def test_appointment_audit_categories_without_mutation():
    rows = [
        {"id": "a1", "ref": "NT-1", "status": "assigned", "practitionerId": CANONICAL_PRACTITIONER_ID, "date": "2026-10-01", "time": "10:00"},
        {"id": "a2", "ref": "NT-2", "status": "requested", "practitionerId": None, "date": "2026-10-02", "time": "11:00"},
        {"id": "a3", "ref": "NT-3", "status": "assigned", "practitionerId": "p-maya", "date": "2026-10-03", "time": "12:00"},
        {"id": "a4", "ref": "NT-4", "status": "cancelled", "practitionerId": CANONICAL_PRACTITIONER_ID, "date": "2026-09-01", "time": "09:00"},
        {"id": "a5", "ref": "NT-5", "status": "completed", "practitionerId": "p-liam", "date": "2026-08-01", "time": "14:00"},
    ]
    original = [dict(row) for row in rows]
    report = audit_appointment_assignments(rows)
    assert rows == original
    assert report["bulkReassign"] == "not authorized"
    assert report["counts"]["assigned_nabitu"] == 1
    assert report["counts"]["unassigned"] == 1
    assert report["counts"]["assigned_other"] == 1  # open visit on another therapist
    assert report["counts"]["cancelled_or_historical"] == 2  # cancelled + completed
    assert report["counts"]["manual_review"] == 1  # open visit on another therapist (a3)
    assert categorize_appointment(rows[1]) == "unassigned"
    assert categorize_appointment(rows[0]) == "assigned_nabitu"
