"""Service catalogue ownership, audit attribution, and historical prices."""
import os
import uuid

import pytest
import requests
from fastapi import HTTPException

from catalog import booking_block_reason, normalize_prices
from seed import SERVICES

ADDRESS = {
    "line": "10150 104 St NW, Edmonton, AB",
    "mapboxId": "local-downtown",
    "postal": "T5J 2R4",
    "clientConfirmed": True,
    "lat": 53.5461,
    "lng": -113.4938,
}


def _api():
    base = os.environ.get("REACT_APP_BACKEND_URL")
    if not base:
        pytest.skip("API fixture is not running")
    return base.rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def _owner():
    return _login(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])


def _body(slug, **changes):
    body = {
        "name": f"Catalog {slug}",
        "slug": slug,
        "short": "A private catalogue row for this test.",
        "description": "This treatment exists only so the catalogue tests can create and remove a row.",
        "benefits": ["May support a focused regression check"],
        "goals": ["Catalogue coverage"],
        "category": "specialty",
        "prices": {"60": 80},
        "mobile": True,
        "clinic": False,
        "prep": ["Arrive ready for the visit."],
        "prepMinutes": 10,
        "taxable": True,
        "enabled": True,
    }
    body.update(changes)
    return body


def _audits(headers, entity_id):
    state = requests.get(f"{_api()}/state", headers=headers, timeout=30)
    assert state.status_code == 200, state.text
    return [row for row in state.json()["audit"] if row.get("entity") == "service" and row.get("entityId") == entity_id]


def test_invalid_prices_and_duplicate_durations_are_rejected():
    with pytest.raises(HTTPException) as duplicate:
        normalize_prices({"prices": [{"duration": 60, "price": 10}, {"duration": 60, "price": 12}]})
    assert duplicate.value.status_code == 400
    assert "Duplicate" in duplicate.value.detail
    with pytest.raises(HTTPException) as negative:
        normalize_prices({"prices": {"60": -1}})
    assert negative.value.status_code == 400
    with pytest.raises(HTTPException) as zero_minutes:
        normalize_prices({"durations": [0, 0], "prices": {"60": 10}})
    assert zero_minutes.value.status_code == 400


def test_archived_disabled_and_unpriced_services_are_not_bookable():
    priced = {"enabled": True, "mobile": True, "clinic": True, "prices": {"60": 80}}
    assert booking_block_reason({**priced, "archived": True}, 60, "home") == "Choose a service"
    assert booking_block_reason({**priced, "enabled": False}, 60, "home") == "Choose a service"
    assert booking_block_reason(priced, 90, "home") == "Choose a duration"
    assert booking_block_reason({**priced, "prices": {"60": -5}}, 60, "home") == "Choose a duration"
    assert booking_block_reason({**priced, "clinic": False}, 60, "clinic") == "This service is not offered in clinic"
    assert booking_block_reason(priced, 60, "home") is None


def test_existing_catalogue_stays_compatible():
    rows = requests.get(f"{_api()}/services", timeout=30)
    assert rows.status_code == 200, rows.text
    by_slug = {row["slug"]: row for row in rows.json()}
    for expected in SERVICES:
        got = by_slug[expected["slug"]]
        assert got["id"] == expected["id"]
        assert got["prices"] == expected["prices"]
        assert got["name"] == expected["name"]
        assert got["enabled"] is True
        assert got.get("archived") is not True
        for field in ("short", "description", "benefits", "goals", "img", "mobile", "clinic", "prep"):
            assert got[field] == expected[field]


def test_non_owner_cannot_create_or_edit_a_service():
    api = _api()
    sarah = _login("sarah.demo@example.com", os.environ["DEMO_PASSWORD"])
    slug = f"blocked-{uuid.uuid4().hex[:8]}"
    created = requests.post(f"{api}/services", headers=sarah, json=_body(slug), timeout=20)
    assert created.status_code == 403
    edited = requests.patch(f"{api}/services/swedish", headers=sarah, json={"prices": {"60": 1}, "_actor": "Owner", "_audit": "forged"}, timeout=20)
    assert edited.status_code == 403
    swedish = requests.get(f"{api}/services/swedish", timeout=20)
    assert swedish.status_code == 200
    assert swedish.json()["prices"]["60"] == 120


def test_service_audits_belong_to_the_signed_in_owner():
    api = _api()
    owner = _owner()
    me = requests.get(f"{api}/auth/me", headers=owner, timeout=20)
    assert me.status_code == 200, me.text
    identity = me.json()
    slug = f"audit-{uuid.uuid4().hex[:8]}"
    forged = "Impersonated Owner"
    created = requests.post(f"{api}/services", headers=owner, json=_body(slug, _actor=forged, _audit="forged create"), timeout=20)
    assert created.status_code == 200, created.text
    try:
        creation = _audits(owner, slug)
        assert len(creation) == 1
        assert creation[0]["actor"] == identity["name"]
        assert creation[0]["actorId"] == identity["id"]
        assert creation[0]["actor"] != forged
        assert creation[0]["action"].startswith("Service created:")
        assert "forged create" not in creation[0]["action"]
        priced = requests.patch(
            f"{api}/services/{slug}", headers=owner,
            json={"prices": {"60": 90}, "version": created.json()["version"], "_actor": forged, "_audit": "forged price"},
            timeout=20,
        )
        assert priced.status_code == 200, priced.text
        price_audit = [row for row in _audits(owner, slug) if str(row.get("action") or "").startswith("Service updated:")]
        assert len(price_audit) == 1
        assert price_audit[0]["actorId"] == identity["id"]
        assert price_audit[0]["actor"] != forged
        assert price_audit[0]["before"]["prices"]["60"] == 80
        assert price_audit[0]["after"]["prices"]["60"] == 90
        assert price_audit[0]["action"].startswith("Service updated:")
        turned_off = requests.patch(
            f"{api}/services/{slug}", headers=owner,
            json={"enabled": False, "version": priced.json()["version"], "_actor": forged, "_audit": "forged deactivation"},
            timeout=20,
        )
        assert turned_off.status_code == 200, turned_off.text
        deactivated = [row for row in _audits(owner, slug) if row.get("action", "").startswith("Service deactivated:")]
        assert len(deactivated) == 1
        assert deactivated[0]["actorId"] == identity["id"]
        assert deactivated[0]["changed"] == ["enabled"]
        assert deactivated[0]["before"]["enabled"] is True
        assert deactivated[0]["after"]["enabled"] is False
        before = _audits(owner, slug)
        invalid = requests.patch(f"{api}/services/{slug}", headers=owner, json={"prices": {"60": -5}, "_actor": forged, "_audit": "forged failure"}, timeout=20)
        assert invalid.status_code == 400
        stale = requests.patch(f"{api}/services/{slug}", headers=owner, json={"name": "Stale Catalog Name", "version": 1}, timeout=20)
        assert stale.status_code == 409
        assert _audits(owner, slug) == before
        duplicate = requests.post(f"{api}/services", headers=owner, json=_body(slug), timeout=20)
        assert duplicate.status_code == 409
    finally:
        requests.delete(f"{api}/services/{slug}", headers=owner, timeout=20)


def test_archived_and_disabled_services_cannot_be_quoted_or_booked():
    api = _api()
    owner = _owner()
    slug = f"closed-{uuid.uuid4().hex[:8]}"
    created = requests.post(f"{api}/services", headers=owner, json=_body(slug, enabled=False), timeout=20)
    assert created.status_code == 200, created.text
    try:
        hidden = requests.get(f"{api}/services", timeout=20)
        assert all(row["slug"] != slug for row in hidden.json())
        visible = requests.get(f"{api}/services", headers=owner, timeout=20)
        assert any(row["slug"] == slug for row in visible.json())
        appointment = {
            "serviceSlug": slug, "duration": 60, "date": "2031-04-14", "time": "11:00",
            "locationType": "home", "paymentMethod": "self", "address": ADDRESS,
        }
        quoted = requests.post(f"{api}/bookings/quote", json={"appointment": appointment}, timeout=20)
        assert quoted.status_code == 400
        booked = requests.post(f"{api}/bookings", json={"source": "online", "client": {"firstName": "Ada", "lastName": "Guest", "email": f"{slug}@example.com", "phone": "7805550199"}, "appointment": appointment}, timeout=20)
        assert booked.status_code == 400
        opened = requests.patch(f"{api}/services/{slug}", headers=owner, json={"enabled": True, "version": created.json()["version"]}, timeout=20)
        assert opened.status_code == 200, opened.text
        archived = requests.post(f"{api}/services/{slug}/archive", headers=owner, timeout=20)
        assert archived.status_code == 200, archived.text
        assert archived.json()["archived"] is True
        archive_audit = [row for row in _audits(owner, slug) if row.get("action", "").startswith("Service archived:")]
        assert len(archive_audit) == 1
        quoted_again = requests.post(f"{api}/bookings/quote", json={"appointment": appointment}, timeout=20)
        assert quoted_again.status_code == 400
        recommend = requests.post(f"{api}/availability/recommendations", json={"serviceSlug": slug, "duration": 60, "date": "2031-04-14", "locationType": "home", "address": ADDRESS}, timeout=20)
        assert recommend.status_code == 400
        public = requests.get(f"{api}/services/{slug}", timeout=20)
        assert public.status_code == 404
        listed = requests.get(f"{api}/services", timeout=20)
        assert all(row["slug"] != slug for row in listed.json())
        profile = requests.get(f"{api}/state", headers=owner, timeout=30).json()
        person = next(row for row in profile["practitioners"] if row["id"] == "p-maya")
        original = list(person.get("specialties") or [])
        try:
            assigned = requests.put(f"{api}/practitioners/p-maya/services", headers=owner, json={"specialties": original + [slug]}, timeout=20)
            assert assigned.status_code == 200, assigned.text
            still_closed = requests.post(f"{api}/bookings/quote", json={"appointment": appointment, "practitionerId": "p-maya"}, timeout=20)
            assert still_closed.status_code == 400
        finally:
            requests.put(f"{api}/practitioners/p-maya/services", headers=owner, json={"specialties": original}, timeout=20)
    finally:
        requests.delete(f"{api}/services/{slug}", headers=owner, timeout=20)


def test_historical_prices_survive_a_catalogue_edit_and_block_deletion():
    api = _api()
    owner = _owner()
    slug = f"history-{uuid.uuid4().hex[:8]}"
    created = requests.post(f"{api}/services", headers=owner, json=_body(slug, prices={"60": 80}), timeout=20)
    assert created.status_code == 200, created.text
    profile = requests.get(f"{api}/state", headers=owner, timeout=30).json()
    person = next(row for row in profile["practitioners"] if row["id"] == "p-maya")
    original = list(person.get("specialties") or [])
    try:
        assigned = requests.put(f"{api}/practitioners/p-maya/services", headers=owner, json={"specialties": original + [slug]}, timeout=20)
        assert assigned.status_code == 200, assigned.text
        day = 1 + (uuid.uuid4().int % 27)
        booked = requests.post(f"{api}/bookings", json={
            "source": "online",
            "practitionerId": "p-maya",
            "client": {"firstName": "Price", "lastName": "Guest", "email": f"{slug}@example.com", "phone": f"780557{uuid.uuid4().int % 10000:04d}"},
            "appointment": {
                "serviceSlug": slug, "duration": 60, "date": f"2031-06-{day:02d}", "time": "11:00",
                "locationType": "home", "paymentMethod": "self", "address": ADDRESS,
                "pricing": {"total": 1, "base": 1, "tax": 0},
            },
        }, timeout=30)
        assert booked.status_code == 200, booked.text
        appointment = booked.json()["appointment"]
        assert appointment["pricing"]["base"] == 80
        draft = requests.post(f"{api}/invoices/from-appointment/{appointment['id']}", headers=owner, json={}, timeout=20)
        assert draft.status_code == 200, draft.text
        invoice_id = draft.json()["id"]
        changed = requests.patch(f"{api}/services/{slug}", headers=owner, json={"prices": {"60": 140}, "version": created.json()["version"]}, timeout=20)
        assert changed.status_code == 200, changed.text
        state = requests.get(f"{api}/state", headers=owner, timeout=30)
        stored = next(row for row in state.json()["appointments"] if row["id"] == appointment["id"])
        assert stored["pricing"]["base"] == 80
        assert stored["pricing"]["discount"] == appointment["pricing"]["discount"]
        assert stored["pricing"]["tax"] == appointment["pricing"]["tax"]
        assert stored["pricing"]["total"] == appointment["pricing"]["total"]
        invoice = requests.get(f"{api}/invoices/{invoice_id}", headers=owner, timeout=20)
        assert invoice.status_code == 200, invoice.text
        treatment = next(line for line in invoice.json()["lines"] if line["description"] == "Treatment")
        assert treatment["netCents"] == 8000
        removed = requests.delete(f"{api}/services/{slug}", headers=owner, timeout=20)
        assert removed.status_code == 409
        assert "appointments" in removed.json()["detail"]
        still = requests.get(f"{api}/services/{slug}", headers=owner, timeout=20)
        assert still.status_code == 200
        requests.post(f"{api}/services/{slug}/archive", headers=owner, timeout=20)
    finally:
        requests.put(f"{api}/practitioners/p-maya/services", headers=owner, json={"specialties": original}, timeout=20)
        requests.post(f"{api}/services/{slug}/archive", headers=owner, timeout=20)
