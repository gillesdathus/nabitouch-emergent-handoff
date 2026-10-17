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
    """Phone/front-desk sources book mobile visits; clinic stays disabled in launch settings."""
    practices = owner.get(f"{API}/state", timeout=20).json()
    client_id = practices["clients"][0]["id"]
    pract = next(p for p in practices["practitioners"] if p.get("available") and p.get("bookable") is not False)
    service = next((s for s in practices["services"] if s.get("slug") == "swedish"), practices["services"][0])
    duration = int(next(iter(service["prices"])))
    address = {
        "line": "10150 104 St NW, Edmonton, AB",
        "mapboxId": "local-downtown",
        "postal": "T5J 2R4",
        "clientConfirmed": True,
        "lat": 53.5461,
        "lng": -113.4938,
    }
    # Separate days so travel buffers between sources cannot collide.
    schedule = (("phone", "2099-06-15", "09:00"), ("whatsapp", "2099-06-16", "11:00"), ("sms", "2099-06-17", "13:00"), ("walk_in", "2099-06-18", "15:00"))
    for source, day, when in schedule:
        key = f"src-{source}-{uuid.uuid4().hex[:8]}"
        payload = {
            "client": {"id": client_id},
            "practitionerId": pract["id"],
            "source": source,
            "idempotencyKey": key,
            "appointment": {
                "serviceSlug": service["slug"],
                "duration": duration,
                "date": day,
                "time": when,
                "locationType": "home",
                "address": address,
                "pricing": {"base": float(service["prices"][str(duration)]), "discount": 0, "travel": 0, "tax": 0, "total": float(service["prices"][str(duration)])},
                "paymentMethod": "self",
                "preferences": {"goals": [], "focus": [], "notes": f"source {source}"},
            },
        }
        booked = owner.post(f"{API}/bookings", json=payload, timeout=30)
        assert booked.status_code in (200, 201), f"{source}: {booked.text}"
        appt = booked.json().get("appointment") or booked.json()
        assert (appt.get("source") or source) == source
        again = owner.post(f"{API}/bookings", json=payload, timeout=30)
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


def test_staff_invite_resend_and_revoke(owner):
    tag = uuid.uuid4().hex[:8]
    email = f"invite.{tag}@example.com"
    created = owner.post(
        f"{API}/auth/staff/invite",
        json={"name": f"Desk {tag}", "email": email, "role": "desk", "roles": ["desk", "manager"]},
        timeout=20,
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert "desk" in (body.get("roles") or [body.get("role")])
    invite_id = body.get("inviteId")
    assert invite_id
    resent = owner.post(f"{API}/auth/staff/invites/{invite_id}/resend", json={}, timeout=20)
    assert resent.status_code == 200, resent.text
    new_id = resent.json().get("inviteId")
    assert new_id and new_id != invite_id
    revoked = owner.post(f"{API}/auth/staff/invites/{new_id}/revoke", json={}, timeout=20)
    assert revoked.status_code == 200, revoked.text


def test_desk_cannot_invite_staff(desk):
    denied = desk.post(
        f"{API}/auth/staff/invite",
        json={"name": "Nope", "email": f"nope.{uuid.uuid4().hex[:6]}@example.com", "role": "desk"},
        timeout=20,
    )
    assert denied.status_code == 403


def test_multi_service_manual_invoice_pdf(owner):
    state = owner.get(f"{API}/state", timeout=20).json()
    client_id = state["clients"][0]["id"]
    services = state["services"][:2]
    lines = []
    for service in services:
        duration = int(next(iter(service["prices"])))
        lines.append({
            "serviceSlug": service["slug"],
            "duration": duration,
            "quantity": 1,
            "unitPrice": float(service["prices"][str(duration)]),
        })
    key = f"multi-{uuid.uuid4().hex[:8]}"
    draft = owner.post(
        f"{API}/invoices",
        json={"clientId": client_id, "serviceDate": "2099-08-01", "idempotencyKey": key, "lines": lines},
        timeout=20,
    )
    assert draft.status_code == 200, draft.text
    invoice = draft.json()
    assert len(invoice.get("lines") or []) >= 2
    issued = owner.post(f"{API}/invoices/{invoice['id']}/issue", json={"idempotencyKey": f"issue-{key}"}, timeout=20)
    assert issued.status_code == 200, issued.text
    pdf = owner.get(f"{API}/invoices/{invoice['id']}/pdf", timeout=20)
    assert pdf.status_code == 200, pdf.text[:200]
    assert pdf.headers.get("content-type", "").startswith("application/pdf")
    assert pdf.content[:4] == b"%PDF"


def test_practitioner_conflict_on_overlap(owner):
    state = owner.get(f"{API}/state", timeout=20).json()
    client_id = state["clients"][0]["id"]
    pract = next(p for p in state["practitioners"] if p.get("available") and p.get("bookable") is not False)
    service = next((s for s in state["services"] if s.get("slug") == "swedish"), state["services"][0])
    duration = int(next(iter(service["prices"])))
    address = {
        "line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4",
        "clientConfirmed": True, "lat": 53.5461, "lng": -113.4938,
    }
    day, when = "2099-09-01", "14:00"
    base = {
        "client": {"id": client_id}, "practitionerId": pract["id"], "source": "phone",
        "appointment": {
            "serviceSlug": service["slug"], "duration": duration, "date": day, "time": when,
            "locationType": "home", "address": address, "paymentMethod": "self",
            "pricing": {"base": float(service["prices"][str(duration)]), "discount": 0, "travel": 0, "tax": 0, "total": float(service["prices"][str(duration)])},
            "preferences": {"goals": [], "focus": [], "notes": "conflict check"},
        },
    }
    first = owner.post(f"{API}/bookings", json={**base, "idempotencyKey": f"conflict-a-{uuid.uuid4().hex[:8]}"}, timeout=30)
    assert first.status_code in (200, 201), first.text
    second = owner.post(f"{API}/bookings", json={**base, "idempotencyKey": f"conflict-b-{uuid.uuid4().hex[:8]}"}, timeout=30)
    assert second.status_code in (400, 409), second.text
