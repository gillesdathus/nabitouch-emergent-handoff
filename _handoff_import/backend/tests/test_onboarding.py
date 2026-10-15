"""Onboarding gates. No database, credentials, or invented practitioner facts."""
from datetime import date

import pytest

from availability import draft_schedule, launch_practitioner, validate_scheduling
from onboarding import (
    acceptable_identifier, acceptable_login, activation_blockers, assignment_credential_problem,
    launch_readiness, onboarding_gaps,
)


TODAY = date(2026, 10, 13)
PERSON = launch_practitioner()
SCHEDULE = draft_schedule(PERSON["id"])


def gaps(**overrides):
    payload = {
        "person": PERSON,
        "credentials": [],
        "login_email": "",
        "owner_email": "info@nabitouch.com",
        "schedule": SCHEDULE,
        "mfa_enrolled": False,
        "mfa_required": True,
        "today": TODAY,
    }
    payload.update(overrides)
    return onboarding_gaps(**payload)


def test_launch_practitioner_stays_draft_with_every_required_gap():
    found = {row["id"]: row["status"] for row in gaps()}
    assert found["login_email"] == "pending owner input"
    assert found["registration"] == "pending verification"
    assert found["registration_expiry"] == "pending verification"
    assert found["liability"] == "pending verification"
    assert found["insurance_expiry"] == "pending verification"
    assert found["mfa"] == "pending enrollment"
    assert found["services"] == "pending owner approval"
    assert found["weekly"] == "pending owner approval"
    assert "schedule_approval" not in found
    assert activation_blockers(gaps())


def test_placeholders_and_owner_email_are_not_credentials():
    assert acceptable_identifier("pending") is False
    assert acceptable_identifier("to be supplied") is False
    assert acceptable_identifier("POL-100") is True
    assert acceptable_login("info@nabitouch.com", "owner@example.test") is False
    assert acceptable_login("pending@nabitouch.com", "info@nabitouch.com") is False
    assert acceptable_login("nabitu.kahindo@nabitouch.com", "info@nabitouch.com") is True
    expired = gaps(credentials=[{
        "kind": "registration", "status": "verified", "identifier": "pending", "expiresOn": "2026-12-01",
    }])
    assert any(row["id"] == "registration" for row in expired)


def test_real_records_still_need_an_explicit_schedule_approval():
    ready = gaps(
        login_email="nabitu.kahindo@nabitouch.com",
        mfa_enrolled=True,
        credentials=[
            {"kind": "registration", "status": "verified", "identifier": "REG-200", "expiresOn": "2027-01-01"},
            {"kind": "liability", "status": "verified", "identifier": "POL-100", "expiresOn": "2027-06-01"},
        ],
        person={**PERSON, "specialties": ["swedish"]},
        schedule={**SCHEDULE, "weekly": [{"weekday": 1, "start": "10:00", "end": "14:00"}]},
    )
    assert [row["id"] for row in ready] == ["schedule_approval"]
    assert activation_blockers(ready) == []


def test_launch_configuration_is_prepared_and_not_published():
    report = launch_readiness({})
    assert report["published"] is False
    assert report["apply"] == "not authorized"
    assert report["prepared"]["phoneTel"] == "+17802356508"
    assert report["prepared"]["phoneDisplay"] == "(780) 235-6508"
    assert report["prepared"]["hours"] == "By appointment only"
    assert report["prepared"]["clinicEnabled"] is False
    assert report["prepared"]["rewards"] is False
    assert report["prepared"]["cancellationFee"] is False
    assert "automatic cancellation fee" in report["prepared"]["policyText"]
    with pytest.raises(ValueError):
        validate_scheduling({"setupMin": -1})


def _credential(kind, expiry):
    return {"kind": kind, "status": "verified", "identifier": "POL-100" if kind == "liability" else "REG-200", "expiresOn": expiry}


def test_assignment_refuses_inactive_or_expired_credentials():
    approved = {**PERSON, "onboardingStatus": "approved"}
    assert "not active" in assignment_credential_problem(PERSON, [])
    assert assignment_credential_problem({"name": "Demo"}, []) is None
    assert "Registration" in assignment_credential_problem(approved, [_credential("liability", "2027-01-01")], TODAY)
    assert "insurance" in assignment_credential_problem(
        approved, [_credential("registration", "2027-01-01"), _credential("liability", "2026-10-01")], TODAY,
    )
    assert assignment_credential_problem(
        approved, [_credential("registration", "2027-01-01"), _credential("liability", "2027-01-01")], TODAY,
    ) is None
