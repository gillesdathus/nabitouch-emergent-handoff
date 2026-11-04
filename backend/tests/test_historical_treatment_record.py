"""Record completed treatment — historical / on-the-spot (no prior booking)."""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from historical_treatment import (  # noqa: E402
    apply_correction_payload,
    apply_recorded_payment_status,
    build_completed_appointment,
    build_pricing,
    counts_toward_career,
    natural_duplicate_query,
    resolve_payment_fields,
    resolve_source,
    validate_service_date,
    validate_service_time,
)
from payments import with_settle  # noqa: E402
from profiles import career_completed_treatments, count_eligible_completed_appointments  # noqa: E402
from rbac import is_advance_booking_source  # noqa: E402


def test_reject_future_service_date():
    with pytest.raises(ValueError, match="future"):
        validate_service_date("2099-01-01", today="2026-11-04")
    assert validate_service_date("2026-11-03", today="2026-11-04") == "2026-11-03"
    assert validate_service_date("2026-11-04", today="2026-11-04") == "2026-11-04"


def test_validate_time_and_source_defaults():
    assert validate_service_time("09:05") == "09:05"
    with pytest.raises(ValueError):
        validate_service_time("25:00")
    assert resolve_source({}, "2026-11-03", today="2026-11-04") == "historical_manual"
    assert resolve_source({}, "2026-11-04", today="2026-11-04") == "on_the_spot"
    assert resolve_source({"source": "on_the_spot"}, "2026-11-03", today="2026-11-04") == "on_the_spot"


def test_finance_gate_strips_charge_without_permission():
    unpaid = resolve_payment_fields({"charge": 120, "recordedPaymentStatus": "paid"}, can_finance=False)
    assert unpaid["charge"] == 0
    assert unpaid["recordedPaymentStatus"] == "unpaid"
    paid = resolve_payment_fields({"charge": 120, "selfMethod": "cash", "recordedPaymentStatus": "paid"}, can_finance=True)
    assert paid["charge"] == 120
    assert paid["selfMethod"] == "cash"


def test_build_appointment_has_safeguards_and_no_ledger():
    appt = build_completed_appointment(
        client_id="c-synth",
        practitioner_id="p-nabitu-kahindo",
        service={"slug": "swedish"},
        duration=60,
        service_date="2026-11-03",
        service_time="14:00",
        location_type="home",
        address={"line": "10150 104 St NW, Edmonton, AB"},
        payment={"charge": 95, "paymentMethod": "self", "selfMethod": "cash", "recordedPaymentStatus": "paid"},
        source="historical_manual",
        admin_notes="On-location add-on while already at another client",
        user={"id": "u-owner", "name": "Owner"},
        settings={"gst": 0.05},
        ref="NT-9999",
        recorded_at="2026-11-04T20:00:00+00:00",
        idempotency_key="test-key-1",
    )
    settled = apply_recorded_payment_status(with_settle(appt))
    assert settled["status"] == "completed"
    assert settled["source"] == "historical_manual"
    assert settled["serviceDate"] == "2026-11-03"
    assert settled["date"] == "2026-11-03"
    assert settled["recordedAt"] == "2026-11-04T20:00:00+00:00"
    assert settled["recordedBy"]["id"] == "u-owner"
    assert settled["countsAsAdvanceBooking"] is False
    assert settled["bookingKind"] == "completed_treatment_record"
    assert settled["payments"] == []
    assert settled["claim"]["status"] == "none"
    assert settled["paymentStatus"] == "fully_paid"
    assert settled["pricing"]["total"] == 95
    assert len(settled["events"]) == 1
    assert settled["events"][0]["status"] == "completed"
    assert "en_route" not in settled["timestamps"]
    assert not is_advance_booking_source(settled["source"])


def test_career_count_respects_baseline_cutoff():
    person = {
        "id": "p-1",
        "historicalCompletedTreatments": 1714,
        "historicalCountAsOf": "2026-10-31",
    }
    rows = [
        {"id": "a0", "practitionerId": "p-1", "status": "completed", "date": "2026-10-31", "source": "historical_manual"},
        {"id": "a1", "practitionerId": "p-1", "status": "completed", "date": "2026-11-03", "source": "historical_manual"},
        {"id": "a1", "practitionerId": "p-1", "status": "completed", "date": "2026-11-03", "source": "historical_manual"},
    ]
    assert count_eligible_completed_appointments(rows, "p-1", "2026-10-31") == 1
    assert career_completed_treatments(person, rows) == 1715
    assert counts_toward_career(rows[0], "2026-10-31") is False
    assert counts_toward_career(rows[1], "2026-10-31") is True


def test_correction_appends_audit_without_delete():
    appt = build_completed_appointment(
        client_id="c-1",
        practitioner_id="p-1",
        service={"slug": "swedish"},
        duration=60,
        service_date="2026-11-03",
        service_time="14:00",
        location_type="clinic",
        address={"line": "Clinic"},
        payment={"charge": 80, "paymentMethod": "self", "selfMethod": "cash", "recordedPaymentStatus": "unpaid"},
        source="historical_manual",
        admin_notes="",
        user={"id": "u-1", "name": "Owner"},
        settings={"gst": 0.05},
        ref="NT-1",
        recorded_at="2026-11-04T12:00:00+00:00",
    )
    updated, before, after = apply_correction_payload(
        appt,
        {"charge": 100, "recordedPaymentStatus": "paid", "adminNotes": "Corrected charge"},
        settings={"gst": 0.05},
        can_finance=True,
        today="2026-11-04",
    )
    assert before["charge"] == 80
    assert after["charge"] == 100
    assert after["recordedPaymentStatus"] == "paid"
    assert updated["adminNotes"] == "Corrected charge"
    assert updated["payments"] == []
    assert updated["source"] == "historical_manual"


def test_pricing_inclusive_gst():
    pricing = build_pricing(105, {"gst": 0.05})
    assert pricing["total"] == 105
    assert pricing["base"] + pricing["tax"] == pytest.approx(105, abs=0.02)


def test_natural_duplicate_query_shape():
    q = natural_duplicate_query("c-1", "p-1", "2026-11-03", "14:00", "swedish")
    assert q["clientId"] == "c-1"
    assert q["date"] == "2026-11-03"
    assert "historical_manual" in q["source"]["$in"]


def _live():
    return bool(os.environ.get("REACT_APP_BACKEND_URL")) and bool(os.environ.get("OWNER_EMAIL"))


def _api():
    return os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    token = s.cookies.get("csrf_token")
    if token:
        s.headers["X-CSRF-Token"] = token
    return s


@pytest.mark.skipif(not _live(), reason="Live API env not configured")
def test_record_nov3_synthetic_completed_treatment_once():
    owner = _login(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])
    token = uuid.uuid4().hex[:8]
    idem = f"ht-test-{token}"
    # Discover a real service + practitioner from state.
    state = owner.get(f"{_api()}/state", timeout=30)
    assert state.status_code == 200, state.text
    body = state.json()
    service = next((s for s in body.get("services") or [] if s.get("slug")), None)
    person = next((p for p in body.get("practitioners") or [] if p.get("id") == "p-nabitu-kahindo"), None) \
        or next((p for p in body.get("practitioners") or [] if p.get("id")), None)
    assert service and person

    payload = {
        "newClient": {
            "firstName": "Synth",
            "lastName": f"Hist{token}",
            "phone": f"780555{token[:4]}",
            "addresses": [{
                "line": "10150 104 St NW, Edmonton, AB T5J 0Z1",
                "label": "Home",
                "purpose": "home",
                "lat": 53.54,
                "lng": -113.49,
                "clientConfirmed": True,
                "confidence": "address",
                "mapboxId": f"local-{token}",
            }],
        },
        "practitionerId": person["id"],
        "serviceSlug": service["slug"],
        "duration": int(list((service.get("prices") or {60: 0}).keys())[0]),
        "serviceDate": "2026-11-03",
        "serviceTime": "14:30",
        "locationType": "home",
        "charge": 95,
        "selfMethod": "cash",
        "recordedPaymentStatus": "paid",
        "adminNotes": "Synthetic historical treatment — no prior booking",
        "completed": True,
        "idempotencyKey": idem,
    }
    created = owner.post(f"{_api()}/treatments/completed", json=payload, timeout=30)
    assert created.status_code == 200, created.text
    data = created.json()
    appt = data["appointment"]
    client = data["client"]
    assert data["clientCreated"] is True
    assert appt["source"] == "historical_manual"
    assert appt["date"] == "2026-11-03"
    assert appt["serviceDate"] == "2026-11-03"
    assert appt["status"] == "completed"
    assert appt["recordedAt"]
    assert appt["recordedBy"]
    assert appt["payments"] == []
    assert appt["claim"]["status"] == "none"
    assert appt["countsAsAdvanceBooking"] is False
    assert appt["paymentStatus"] == "fully_paid"
    assert client["email"] == ""
    cid = client["id"]
    aid = appt["id"]

    # Idempotent retry — same key must not create a second client or treatment.
    replay = owner.post(f"{_api()}/treatments/completed", json=payload, timeout=30)
    assert replay.status_code == 200, replay.text
    assert replay.json()["appointment"]["id"] == aid
    assert replay.json()["client"]["id"] == cid
    assert replay.json().get("replayed") is True

    # Natural duplicate for the same client / slot / service is refused.
    dup_body = {k: v for k, v in payload.items() if k != "newClient"}
    dup_body.update({"clientId": cid, "idempotencyKey": f"{idem}-b"})
    dup = owner.post(f"{_api()}/treatments/completed", json=dup_body, timeout=30)
    assert dup.status_code == 409, dup.text

    # Future date refused.
    future_body = {k: v for k, v in payload.items() if k != "newClient"}
    future_body.update({"clientId": cid, "serviceDate": "2099-01-01", "idempotencyKey": f"{idem}-future"})
    future = owner.post(f"{_api()}/treatments/completed", json=future_body, timeout=30)
    assert future.status_code == 400, future.text

    # Appears in client history.
    ws = owner.get(f"{_api()}/clients/{cid}/workspace", timeout=30)
    assert ws.status_code == 200
    ids = [a["id"] for a in ws.json()["appointments"]]
    assert aid in ids
    assert ids.count(aid) == 1

    # Audited correction preserves history.
    corrected = owner.patch(f"{_api()}/treatments/completed/{aid}", json={
        "charge": 100,
        "recordedPaymentStatus": "paid",
        "reason": "Corrected cash total",
    }, timeout=30)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["appointment"]["pricing"]["total"] == 100
    assert len(corrected.json()["appointment"]["corrections"]) >= 1
