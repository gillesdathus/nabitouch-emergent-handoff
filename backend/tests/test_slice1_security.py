"""Slice 1 regressions. These assert the closed P0 paths, not the old permissive ones."""
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

from config import validate_env


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


BASE = _required("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"


def login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    token = response.cookies.get("access_token")
    return {"Authorization": f"Bearer {token}"}


def cookie_session(email, password):
    session = requests.Session()
    response = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    session.headers["X-CSRF-Token"] = session.cookies.get("csrf_token")
    return session


@pytest.fixture(scope="module")
def owner():
    return login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))


@pytest.fixture(scope="module")
def sarah():
    return login("sarah.demo@example.com", _required("DEMO_PASSWORD"))


@pytest.fixture(scope="module")
def maya():
    return login("maya.demo@example.com", _required("DEMO_PASSWORD"))


@pytest.fixture(scope="module")
def desk():
    return login("reception.demo@example.com", _required("DEMO_PASSWORD"))


def test_production_refuses_demo_mode(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("EMAIL_PROVIDER", "disabled")
    with pytest.raises(RuntimeError, match="DEMO_MODE"):
        validate_env()


def test_client_price_is_ignored(sarah):
    response = requests.post(f"{API}/bookings", headers=sarah, json={
        "source": "online", "client": {}, "practitionerId": None,
        "appointment": {"serviceSlug": "swedish", "duration": 60, "date": "2026-12-02", "time": "11:00",
                        "locationType": "home", "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.5461, "lng": -113.4938},
                        "paymentMethod": "self", "pricing": {"total": 1, "discount": 99, "tax": 0, "travel": 0, "base": 1}},
    }, timeout=20)
    assert response.status_code == 200, response.text
    pricing = response.json()["appointment"]["pricing"]
    assert pricing["total"] != 1
    assert pricing["base"] == 120
    assert pricing["discount"] != 99


def test_concurrent_slot_allows_one(sarah):
    address = {
        "line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4",
        "clientConfirmed": True, "lat": 53.5461, "lng": -113.4938,
    }
    def book(time):
        return requests.post(f"{API}/bookings", headers=sarah, json={
            "source": "online", "practitionerId": "p-liam",
            "appointment": {"serviceSlug": "swedish", "duration": 60, "date": "2026-12-03", "time": time,
                            "locationType": "home", "paymentMethod": "self",
                            "pricing": {"total": 1}, "address": address},
        }, timeout=20)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: book("16:00"), (1, 2)))
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409], [r.status_code for r in results]


def test_promo_limit_is_atomic(owner):
    state = requests.get(f"{API}/state", headers=owner).json()
    promo = next(p for p in state["promotions"] if p["id"] == "promo-welcome")
    original = promo["redemptionLimit"]
    patched = requests.patch(f"{API}/promotions/promo-welcome", headers=owner, json={"redemptionLimit": promo["redemptions"]})
    assert patched.status_code == 200, patched.text
    try:
        response = requests.post(f"{API}/bookings", headers=owner, json={
            "source": "online", "client": {"firstName": "Limit", "lastName": "Guest", "email": "limit.guest@example.com"},
            "appointment": {"serviceSlug": "swedish", "duration": 60, "date": "2026-12-04", "time": "12:00",
                            "locationType": "home", "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.55, "lng": -113.5},
                            "paymentMethod": "self", "pricing": {"total": 1, "promoId": "promo-welcome"}},
        }, timeout=20)
        assert response.status_code == 200, response.text
        assert response.json()["appointment"]["pricing"]["discount"] == 0
    finally:
        requests.patch(f"{API}/promotions/promo-welcome", headers=owner, json={"redemptionLimit": original})


def test_signed_soap_cannot_return_to_draft(owner, maya):
    patched = requests.patch(f"{API}/soap/soap-090", headers=owner, json={"status": "draft"})
    assert patched.status_code == 403
    again = requests.put(f"{API}/soap/a-090", headers=maya, json={"S": "tamper"})
    assert again.status_code == 409


def test_event_set_cannot_change_payment(maya):
    response = requests.post(f"{API}/appointments/a-105/event", headers=maya, json={
        "kind": "delayed", "set": {"pricing": {"total": 0}, "paymentStatus": "fully_paid"},
    })
    assert response.status_code == 400


def test_desk_cannot_complete_by_patch(desk):
    response = requests.patch(f"{API}/appointments/a-105", headers=desk, json={"status": "completed"})
    assert response.status_code == 400


def test_webhook_rejects_client(sarah):
    response = requests.post(f"{API}/payments/a-111/webhook", headers=sarah, json={"paymentId": "pay-x", "outcome": "succeeded"})
    assert response.status_code == 404


def test_cookie_mutation_requires_csrf():
    session = requests.Session()
    response = session.post(f"{API}/auth/login", json={"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")}, timeout=20)
    assert response.status_code == 200
    denied = session.post(f"{API}/demo/reset", timeout=20)
    assert denied.status_code == 403
    session.headers["X-CSRF-Token"] = session.cookies.get("csrf_token")
    allowed = session.post(f"{API}/demo/reset", timeout=30)
    assert allowed.status_code == 200, allowed.text


def test_anonymous_snapshot_hides_operations():
    state = requests.get(f"{API}/state", timeout=15).json()
    assert state["clients"] == [] and state["soap"] == []
    settings = state["settings"][0]
    assert "receptionPerms" not in settings and "revenueTrend" not in settings
    assert all("base" not in person for person in state["practitioners"])


def test_desk_without_address_perm_hides_addresses(owner, desk):
    state = requests.get(f"{API}/state", headers=owner).json()
    perms = state["settings"][0]["receptionPerms"]
    requests.patch(f"{API}/settings/app", headers=owner, json={"receptionPerms": {**perms, "viewAddresses": False, "viewInsuranceStatus": False}})
    try:
        desk_state = requests.get(f"{API}/state", headers=desk).json()
        assert desk_state["soap"] == []
        assert all("address" not in appt for appt in desk_state["appointments"])
        assert all("insurance" not in client for client in desk_state["clients"])
    finally:
        requests.patch(f"{API}/settings/app", headers=owner, json={"receptionPerms": perms})


def test_logout_revokes_refresh():
    session = cookie_session(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    access = session.cookies.get("access_token")
    assert session.get(f"{API}/auth/me").status_code == 200
    assert session.post(f"{API}/auth/logout").status_code == 200
    revoked = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {access}"}, timeout=15)
    assert revoked.status_code == 401
