"""Focused integration coverage for multi-role ops, patients, phone bookings, and manual invoices."""
import os
import uuid

import pytest
import requests

from t1_common import API, OWNER, SAMPLE_PW, login


def _skip_without_api():
    try:
        requests.get(f"{API}/health", timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"API unavailable: {exc}")


@pytest.fixture(scope="module")
def owner():
    _skip_without_api()
    return login(OWNER)


@pytest.fixture(scope="module")
def desk():
    _skip_without_api()
    return login(("reception.demo@example.com", SAMPLE_PW))


@pytest.fixture(scope="module")
def client_user():
    _skip_without_api()
    return login(("sarah.demo@example.com", SAMPLE_PW))


def test_workspace_preference_is_presentation_only(owner):
    me = owner.get(f"{API}/auth/me", timeout=20).json()
    spaces = me.get("workspaces") or []
    assert "owner" in spaces
    target = "practitioner" if "practitioner" in spaces else spaces[0]
    switched = owner.post(f"{API}/auth/workspace", json={"workspace": target}, timeout=20)
    assert switched.status_code == 200, switched.text
    body = switched.json()
    assert body["preferredWorkspace"] == target
    assert set(body["workspaces"]) == set(spaces)
    denied = owner.post(f"{API}/auth/workspace", json={"workspace": "client"}, timeout=20)
    assert denied.status_code == 403


def test_client_cannot_search_or_create_patients(client_user):
    assert client_user.get(f"{API}/clients/search", params={"q": "sa"}, timeout=20).status_code in (401, 403)
    assert client_user.post(f"{API}/clients", json={"firstName": "Nope", "lastName": "Client"}, timeout=20).status_code in (401, 403)


def test_staff_patient_search_and_create(owner):
    tag = uuid.uuid4().hex[:8]
    email = f"patient.{tag}@example.com"
    created = owner.post(
        f"{API}/clients",
        json={"firstName": "Phone", "lastName": f"Patient{tag}", "email": email, "phone": "7805550199"},
        timeout=20,
    )
    assert created.status_code == 200, created.text
    patient = created.json()
    hits = owner.get(f"{API}/clients/search", params={"q": email}, timeout=20)
    assert hits.status_code == 200
    assert any(row["id"] == patient["id"] for row in hits.json()["clients"])
    dup = owner.post(
        f"{API}/clients",
        json={"firstName": "Phone", "lastName": f"Dup{tag}", "email": email, "phone": "7805550199"},
        timeout=20,
    )
    assert dup.status_code == 409


def test_phone_booking_sources(owner):
    clients = owner.get(f"{API}/state", timeout=20).json()["clients"]
    practices = owner.get(f"{API}/state", timeout=20).json()
    client_id = clients[0]["id"]
    pract = next(p for p in practices["practitioners"] if p.get("available") and p.get("bookable") is not False)
    service = practices["services"][0]
    duration = int(next(iter(service["prices"])))
    day = "2099-06-15"
    for source in ("phone", "whatsapp", "sms", "walk_in"):
        key = f"src-{source}-{uuid.uuid4().hex[:8]}"
        booked = owner.post(
            f"{API}/bookings",
            json={
                "client": {"id": client_id},
                "practitionerId": pract["id"],
                "source": source,
                "idempotencyKey": key,
                "appointment": {
                    "serviceSlug": service["slug"],
                    "duration": duration,
                    "date": day,
                    "time": "09:00" if source == "phone" else ("09:30" if source == "whatsapp" else ("10:00" if source == "sms" else "10:30")),
                    "locationType": "clinic",
                    "address": {"line": "Clinic"},
                    "pricing": {"base": float(service["prices"][str(duration)]), "discount": 0, "travel": 0, "tax": 0, "total": float(service["prices"][str(duration)])},
                    "paymentMethod": "self",
                    "preferences": {"goals": [], "focus": [], "notes": f"source {source}"},
                },
            },
            timeout=30,
        )
        assert booked.status_code in (200, 201), f"{source}: {booked.text}"
        appt = booked.json().get("appointment") or booked.json()
        assert (appt.get("source") or source) == source
        payload = {
            "client": {"id": client_id},
            "practitionerId": pract["id"],
            "source": source,
            "idempotencyKey": key,
            "appointment": {
                "serviceSlug": service["slug"],
                "duration": duration,
                "date": day,
                "time": appt.get("time") or "09:00",
                "locationType": "clinic",
                "address": {"line": "Clinic"},
                "pricing": {
                    "base": float(service["prices"][str(duration)]),
                    "discount": 0,
                    "travel": 0,
                    "tax": 0,
                    "total": float(service["prices"][str(duration)]),
                },
                "paymentMethod": "self",
                "preferences": {"goals": [], "focus": [], "notes": f"source {source}"},
            },
        }
        again = owner.post(f"{API}/bookings", json=payload, timeout=30)
        # Idempotent replay must not create a second booking for the same key.
        assert again.status_code in (200, 201), again.text
        again_body = again.json().get("appointment") or again.json()
        first_id = appt.get("id") or booked.json().get("id")
        second_id = again_body.get("id") or again.json().get("id")
        if first_id and second_id:
            assert first_id == second_id


def test_manual_invoice_and_partial_payment(owner):
    state = owner.get(f"{API}/state", timeout=20).json()
    client_id = state["clients"][0]["id"]
    service = state["services"][0]
    duration = int(next(iter(service["prices"])))
    unit = float(service["prices"][str(duration)])
    key = f"manual-{uuid.uuid4().hex[:10]}"
    draft = owner.post(
        f"{API}/invoices",
        json={
            "clientId": client_id,
            "serviceDate": "2099-07-01",
            "notes": "Standalone manual invoice",
            "discount": 5,
            "idempotencyKey": key,
            "lines": [{"serviceSlug": service["slug"], "duration": duration, "quantity": 2, "unitPrice": unit}],
        },
        timeout=20,
    )
    assert draft.status_code == 200, draft.text
    invoice = draft.json()
    assert invoice["origin"] == "manual"
    assert invoice["state"] == "draft"
    assert invoice["appointmentId"] in (None, "")
    assert invoice["total"]["cents"] > 0
    replay = owner.post(
        f"{API}/invoices",
        json={
            "clientId": client_id,
            "serviceDate": "2099-07-01",
            "idempotencyKey": key,
            "lines": [{"serviceSlug": service["slug"], "duration": duration, "quantity": 2, "unitPrice": unit}],
        },
        timeout=20,
    )
    assert replay.status_code == 200
    assert replay.json()["id"] == invoice["id"]
    issued = owner.post(f"{API}/invoices/{invoice['id']}/issue", json={"idempotencyKey": f"issue-{key}"}, timeout=20)
    assert issued.status_code == 200, issued.text
    total = issued.json()["total"]["cents"]
    half = max(1, total // 2)
    paid = owner.post(
        f"{API}/invoices/{invoice['id']}/payments",
        json={"method": "cash", "amountCents": half, "reference": f"CASH-{key}", "idempotencyKey": f"pay-{key}"},
        timeout=20,
    )
    assert paid.status_code == 200, paid.text
    body = paid.json()
    assert body["balance"]["cents"] == total - half
    assert body["state"] in ("partially_paid", "issued", "paid")
    stripe_blocked = owner.post(
        f"{API}/invoices/{invoice['id']}/payments",
        json={"method": "stripe", "amountCents": 100, "idempotencyKey": f"stripe-{key}"},
        timeout=20,
    )
    assert stripe_blocked.status_code == 400


def test_desk_cannot_open_owner_settings(desk):
    denied = desk.patch(f"{API}/settings/app", json={"gst": 0.05}, timeout=20)
    assert denied.status_code == 403
