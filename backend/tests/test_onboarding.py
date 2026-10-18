"""Onboarding gates. No database, credentials, or invented practitioner facts."""
from datetime import date, timedelta

import pytest

from availability import draft_schedule, launch_practitioner, validate_scheduling
from onboarding import (
    CREDENTIAL_GRACE_DAYS, acceptable_identifier, acceptable_login, activation_blockers,
    assignment_credential_problem, launch_readiness, onboarding_gaps,
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


def _credential(kind, expiry, identifier=None):
    defaults = {
        "association": "ASSOC-200",
        "liability": "POL-100",
        "municipal": "MUNI-300",
        "cpr": "CPR-400",
        "registration": "REG-200",
    }
    return {
        "kind": kind,
        "status": "verified",
        "identifier": identifier or defaults.get(kind, "ID-100"),
        "expiresOn": expiry,
    }


def _required(expiry="2027-01-01"):
    return [_credential(kind, expiry) for kind in ("association", "liability", "municipal", "cpr")]


def test_launch_practitioner_stays_draft_with_every_required_gap():
    found = {row["id"]: row["status"] for row in gaps()}
    assert found["login_email"] == "pending owner input"
    assert found["association"] == "pending verification"
    assert found["association_expiry"] == "pending verification"
    assert found["liability"] == "pending verification"
    assert found["municipal"] == "pending verification"
    assert found["cpr"] == "pending verification"
    assert found["mfa"] == "pending enrollment"
    assert found["services"] == "pending owner approval"
    assert found["weekly"] == "pending owner approval"
    assert "schedule_approval" not in found
    assert "registration" not in found
    assert activation_blockers(gaps())


def test_placeholders_and_owner_email_are_not_credentials():
    assert acceptable_identifier("pending") is False
    assert acceptable_identifier("to be supplied") is False
    assert acceptable_identifier("POL-100") is True
    assert acceptable_login("info@nabitouch.com", "owner@example.test") is False
    assert acceptable_login("pending@nabitouch.com", "info@nabitouch.com") is False
    assert acceptable_login("nabitu.kahindo@nabitouch.com", "info@nabitouch.com") is True
    expired = gaps(credentials=[{
        "kind": "association", "status": "verified", "identifier": "pending", "expiresOn": "2026-12-01",
    }])
    assert any(row["id"] == "association" for row in expired)


def test_real_records_still_need_an_explicit_schedule_approval():
    ready = gaps(
        login_email="nabitu.kahindo@nabitouch.com",
        mfa_enrolled=True,
        credentials=_required(),
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


def test_assignment_allows_approved_during_grace_without_credentials():
    approved = {
        **PERSON,
        "onboardingStatus": "approved",
        "activatedAt": TODAY.isoformat() + "T12:00:00+00:00",
    }
    assert "not active" in assignment_credential_problem(PERSON, [])
    assert assignment_credential_problem({"name": "Demo"}, []) is None
    assert assignment_credential_problem(approved, [], TODAY) is None


def test_assignment_blocks_after_grace_until_four_credentials_exist():
    past = TODAY - timedelta(days=CREDENTIAL_GRACE_DAYS + 1)
    approved = {
        **PERSON,
        "onboardingStatus": "approved",
        "activatedAt": past.isoformat() + "T12:00:00+00:00",
    }
    problem = assignment_credential_problem(approved, [], TODAY)
    assert problem and "Association license number" in problem
    assert "Insurance liability policy number" in problem
    assert "Municipality license number" in problem
    assert "CPR / First Aid" in problem
    partial = assignment_credential_problem(approved, [_credential("association", "2027-01-01"), _credential("liability", "2027-01-01")], TODAY)
    assert "Municipality" in partial
    assert "CPR" in partial
    assert assignment_credential_problem(approved, _required(), TODAY) is None
    expired = assignment_credential_problem(
        approved,
        _required("2026-10-01"),
        TODAY,
    )
    assert expired and "missing or expired" in expired


def test_approved_gaps_show_grace_deadline():
    approved = {
        **PERSON,
        "onboardingStatus": "approved",
        "activatedAt": TODAY.isoformat() + "T12:00:00+00:00",
        "specialties": ["swedish"],
    }
    found = gaps(
        person=approved,
        login_email="nabitu.kahindo@nabitouch.com",
        mfa_enrolled=True,
        schedule={**SCHEDULE, "weekly": [{"weekday": 1, "start": "10:00", "end": "14:00"}], "status": "approved", "acceptingBookings": True},
    )
    due = (TODAY + timedelta(days=CREDENTIAL_GRACE_DAYS)).isoformat()
    assoc = next(row for row in found if row["id"] == "association")
    assert assoc["status"] == f"grace · due by {due}"
