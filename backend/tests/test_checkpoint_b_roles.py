"""Checkpoint B — sole practitioner identity, staff designations, clinical care separation.

Uses synthetic accounts only. No production database writes.
"""
from datetime import date

from availability import draft_schedule, launch_practitioner
from onboarding import activation_blockers
from profiles import person_booking_block
from rbac import has_role, has_strict_role, workspaces_for
from seed import build_launch_seed
from staff_identity import (
    CANONICAL_PRACTITIONER_ID,
    CANONICAL_PRACTITIONER_NAME,
    DESIGNATION_MANAGER_RECEPTIONIST,
    DESIGNATION_PRACTITIONER,
    account_is_bookable_therapist,
    account_may_link_practitioner,
    activation_summary,
    can_review_clinical_compliance,
    duplicate_canonical_profiles,
    is_treating_clinician,
    normalize_designation,
    sole_canonical_ok,
)


TODAY = date(2026, 10, 30)


def _dathus():
    return {
        "id": "u-dathus-synth",
        "email": "owner.synth@nabitouch.test",
        "name": "Dathus Gilles (synthetic)",
        "role": "owner",
        "roles": ["owner", "manager", "desk"],
        "operationalDesignation": DESIGNATION_MANAGER_RECEPTIONIST,
        "subject": None,
        "preferredWorkspace": "owner",
    }


def _nabitu_user():
    return {
        "id": "u-nabitu-synth",
        "email": "nabitu.synth@nabitouch.test",
        "name": "Nabitu Kahindo (synthetic)",
        "role": "practitioner",
        "roles": ["practitioner"],
        "operationalDesignation": DESIGNATION_PRACTITIONER,
        "subject": CANONICAL_PRACTITIONER_ID,
        "preferredWorkspace": "practitioner",
    }


def _visit():
    return {
        "id": "a-synth-1",
        "practitionerId": CANONICAL_PRACTITIONER_ID,
        "clientId": "c-synth-1",
        "status": "assigned",
        "date": "2026-10-30",
        "time": "10:00",
        "duration": 60,
    }


def test_launch_seed_has_one_canonical_nabitu_profile():
    seed = build_launch_seed()
    people = seed["practitioners"]
    assert sole_canonical_ok(people)
    assert people[0]["id"] == CANONICAL_PRACTITIONER_ID
    assert people[0]["name"] == CANONICAL_PRACTITIONER_NAME
    assert people[0]["onboardingStatus"] == "draft"
    assert people[0]["bookable"] is False
    assert people[0]["available"] is False
    assert duplicate_canonical_profiles(people) == [people[0]]
    # Appointments are unchanged empty launch set — no destructive rewrite.
    assert seed["appointments"] == []
    assert seed["soap"] == []


def test_alias_nabitu_profile_is_detected_as_duplicate_risk():
    people = [
        launch_practitioner(),
        {"id": "p-other", "name": "Nabitu Kahindo", "onboardingStatus": "draft"},
    ]
    assert sole_canonical_ok(people) is False
    assert len(duplicate_canonical_profiles(people)) == 2


def test_dathus_has_no_bookable_practitioner_identity():
    dathus = _dathus()
    assert normalize_designation(dathus["operationalDesignation"], dathus["roles"], dathus["role"]) == DESIGNATION_MANAGER_RECEPTIONIST
    assert account_is_bookable_therapist(dathus) is False
    assert "practitioner" not in workspaces_for(dathus)
    ok, reason = account_may_link_practitioner(dathus["roles"], CANONICAL_PRACTITIONER_ID)
    assert ok is False
    assert "practitioner role" in reason


def test_admin_privileges_do_not_create_therapist_eligibility():
    owner_only = {"role": "owner", "roles": ["owner"], "subject": CANONICAL_PRACTITIONER_ID}
    manager = {"role": "manager", "roles": ["manager"], "subject": CANONICAL_PRACTITIONER_ID}
    desk = {"role": "desk", "roles": ["desk"], "subject": CANONICAL_PRACTITIONER_ID}
    assert account_is_bookable_therapist(owner_only) is False
    assert account_is_bookable_therapist(manager) is False
    assert account_is_bookable_therapist(desk) is False
    assert "practitioner" not in workspaces_for(owner_only)


def test_business_admin_keeps_owner_equivalent_management_access():
    dathus = _dathus()
    assert has_role(dathus, "owner")
    assert has_strict_role(dathus, "owner")
    assert has_role(dathus, "manager")
    assert has_role(dathus, "desk")
    spaces = workspaces_for(dathus)
    assert "owner" in spaces
    assert "desk" in spaces
    assert "practitioner" not in spaces


def test_manager_and_reception_cannot_access_soap_via_operational_roles():
    visit = _visit()
    assert is_treating_clinician(_dathus(), visit) is False
    assert is_treating_clinician({"role": "manager", "roles": ["manager"], "subject": None}, visit) is False
    assert is_treating_clinician({"role": "desk", "roles": ["desk"], "subject": None}, visit) is False
    # Owner compliance export remains available; routine SOAP does not.
    assert can_review_clinical_compliance(_dathus()) is True


def test_nabitu_retains_clinical_workflow_for_her_visits():
    nabitu = _nabitu_user()
    visit = _visit()
    other = {**visit, "practitionerId": "p-other"}
    assert account_is_bookable_therapist(nabitu) is True
    assert is_treating_clinician(nabitu, visit) is True
    assert is_treating_clinician(nabitu, other) is False
    assert "practitioner" in workspaces_for(nabitu)


def test_dual_role_owner_practitioner_uses_subject_not_owner_role_for_soap():
    dual = {
        "role": "owner",
        "roles": ["owner", "practitioner"],
        "subject": CANONICAL_PRACTITIONER_ID,
    }
    visit = _visit()
    assert is_treating_clinician(dual, visit) is True
    assert is_treating_clinician({**dual, "subject": None}, visit) is False


def test_activation_still_enforces_existing_requirements_without_fabricating_credentials():
    person = launch_practitioner()
    schedule = draft_schedule(person["id"])
    report = activation_summary(
        person=person,
        credentials=[],
        login_email="",
        owner_email="info@nabitouch.com",
        schedule=schedule,
        mfa_enrolled=False,
        mfa_required=True,
        today=TODAY,
    )
    assert report["canonical"] is True
    assert report["bookableNow"] is False
    assert report["bookingBlock"]
    assert activation_blockers(report["gaps"])
    gap_ids = {row["id"] for row in report["gaps"]}
    assert "login_email" in gap_ids
    assert "association" in gap_ids
    assert "liability" in gap_ids
    assert "weekly" in gap_ids
    # Draft profile remains blocked for booking.
    assert person_booking_block(person, service={"slug": "swedish"}, credentials=[]) is not None



def test_no_synthetic_practitioner_injected_into_launch_catalogue():
    seed = build_launch_seed()
    assert [p["id"] for p in seed["practitioners"]] == [CANONICAL_PRACTITIONER_ID]
    assert all(not p.get("demo") for p in seed["practitioners"])
