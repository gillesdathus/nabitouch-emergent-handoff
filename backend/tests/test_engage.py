"""Engage Phase 2 — unit coverage without live Mongo or bookings."""
import os

import pytest
from fastapi import HTTPException

from engage import (
    CONSENT_VERSION,
    SEED_EVENTS,
    attendance_row,
    check_in_code,
    engage_public_enabled,
    engage_writes_enabled,
    public_event_view,
    validate_screening,
)


def test_seed_events_match_frontend_ids():
    from engage import WORKPLACE_CHAIR_DURATION, WORKPLACE_CHAIR_SLUG, workplace_chair_service

    ids = {row["id"] for row in SEED_EVENTS}
    assert "aurora-chair-day" in ids
    assert "clearsky-afternoon" in ids
    for row in SEED_EVENTS:
        assert row.get("bookingDurationMinutes") == WORKPLACE_CHAIR_DURATION
        assert row.get("serviceSlug") == WORKPLACE_CHAIR_SLUG
        assert row.get("venue", {}).get("clientConfirmed") is True
    service = workplace_chair_service()
    assert service["kind"] == "engage"
    assert service["kind"] != "trial"
    assert str(WORKPLACE_CHAIR_DURATION) in service["prices"]


def test_rate_limit_blocks_burst():
    from engage import allow_checkin_rate, _CHECKIN_HITS

    _CHECKIN_HITS.clear()
    key = "test-rate-key"
    assert all(allow_checkin_rate(key) for _ in range(8))
    assert allow_checkin_rate(key) is False


def test_public_event_view_hides_venue_and_exposes_remaining():
    event = SEED_EVENTS[0]
    view = public_event_view(event, {"s-1100": 2, "s-1115": 0})
    assert view["id"] == "aurora-chair-day"
    assert "venue" not in view
    slot = next(s for s in view["slots"] if s["id"] == "s-1100")
    assert slot["remaining"] == 0
    open_slot = next(s for s in view["slots"] if s["id"] == "s-1115")
    assert open_slot["remaining"] == 2
    assert view["consentVersion"] == CONSENT_VERSION


def test_attendance_row_never_includes_clinical_keys():
    row = attendance_row(
        {
            "id": "eg-1",
            "eventId": "aurora-chair-day",
            "slotId": "s-1100",
            "slotLabel": "11:00",
            "firstName": "Alex",
            "lastName": "Rivera",
            "email": "alex@aurora.test",
            "phone": "7805550100",
            "checkInCode": "NT-AUR-AR1100",
            "status": "checked_in",
            "privateFollowUp": False,
            "appointmentId": None,
            "createdAt": "2026-10-30T12:00:00+00:00",
            "writeMode": "prototype",
            "clinicalSealed": "SECRET",
            "screening": {"unwell": "yes"},
        }
    )
    assert row["firstName"] == "Alex"
    assert "email" not in row
    assert "phone" not in row
    assert "screening" not in row
    assert "clinicalSealed" not in row
    assert row["mode"] == "prototype"


def test_validate_screening_hard_flags():
    ok = {qid: "no" for qid in ("unwell", "contagious", "clot", "injury", "pregnancy", "allergy")}
    hard, soft = validate_screening(ok)
    assert hard == []
    assert soft == []
    blocked = {**ok, "unwell": "yes", "injury": "yes"}
    hard, soft = validate_screening(blocked)
    assert hard == ["unwell"]
    assert soft == ["injury"]
    with pytest.raises(HTTPException):
        validate_screening({"unwell": "yes"})


def test_check_in_code_shape():
    code = check_in_code("aurora-chair-day", "Alex", "Rivera", "11:00")
    assert code.startswith("NT-AUR-AR")
    assert "1100" in code


def test_write_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("ENGAGE_WRITES_ENABLED", raising=False)
    assert engage_writes_enabled() is False
    monkeypatch.setenv("ENGAGE_WRITES_ENABLED", "true")
    assert engage_writes_enabled() is True


def test_public_flag_respects_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ENGAGE_PUBLIC_ENABLED", raising=False)
    assert engage_public_enabled() is False
    monkeypatch.setenv("ENGAGE_PUBLIC_ENABLED", "true")
    assert engage_public_enabled() is True
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("ENGAGE_PUBLIC_ENABLED", raising=False)
    assert engage_public_enabled() is True
