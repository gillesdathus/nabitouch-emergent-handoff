"""Slice 2 Mapbox regressions. External Mapbox calls are mocked. The live suite does not need a token."""
import asyncio
import os
import uuid

import httpx
import pytest
import requests

from config import validate_env
from geo import GEO, GeocodeError, ProviderError
from tracking import MapboxDirections


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


BASE = _required("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"
SECRET = "sk.test-mapbox-secret"


def login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


@pytest.fixture(scope="module")
def sarah():
    return login("sarah.demo@example.com", _required("DEMO_PASSWORD"))


@pytest.fixture(scope="module")
def owner():
    return login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))


@pytest.fixture(scope="module")
def desk():
    return login("reception.demo@example.com", _required("DEMO_PASSWORD"))


def _book(headers, address, location="home", pricing=None, when="10:00", day="2027-08-02"):
    return requests.post(f"{API}/bookings", headers=headers, json={
        "source": "online",
        "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": day, "time": when,
            "locationType": location, "paymentMethod": "self",
            "pricing": pricing or {"total": 1, "travel": 1, "discount": 99},
            "address": address,
        },
    }, timeout=20)


def test_edmonton_suggestion_and_zone_fee(sarah):
    suggestions = requests.get(f"{API}/geo/suggest", params={"q": "10150 104 St NW, Edmonton"}, timeout=20)
    if suggestions.status_code == 503:
        assert "Mapbox" in suggestions.json().get("detail", "")
        assert suggestions.json().get("suggestions", []) == []
    else:
        assert suggestions.status_code == 200, suggestions.text
        labels = [item["label"] for item in suggestions.json()["suggestions"]]
        assert labels, suggestions.text
        assert any("Edmonton" in label or "104" in label for label in labels)
        assert all(not str(item.get("id", "")).startswith("local-") for item in suggestions.json()["suggestions"])
    checked = requests.post(f"{API}/geo/check", json={"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown"}, timeout=20)
    assert checked.status_code == 200, checked.text
    body = checked.json()
    assert body["eligible"] is True
    assert body["zone"]["id"] == "z-central"
    assert body["travel"] == 0
    assert body["confirmedArrival"] is False
    booked = _book(sarah, {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.2594, "lng": -113.5492, "unit": "4"}, day="2027-08-02")
    assert booked.status_code == 200, booked.text
    appointment = booked.json()["appointment"]
    assert appointment["pricing"]["travel"] == 0
    assert appointment["pricing"]["total"] != 1
    assert appointment["address"]["unit"] == "4"
    assert appointment["address"]["lat"] != 53.2594


def test_unsupported_location_is_rejected_in_zones_mode(sarah, owner):
    """Custom service zones still reject outside rings; open coverage does not."""
    prior = requests.get(f"{API}/state", headers=owner, timeout=20).json()["settings"]
    prior_cov = dict(prior.get("serviceCoverage") or {})
    try:
        patched = requests.patch(f"{API}/settings/app", headers=owner, json={
            "serviceCoverage": {**prior_cov, "mode": "zones", "travelFeesEnabled": prior_cov.get("travelFeesEnabled", False)},
        }, timeout=20)
        assert patched.status_code == 200, patched.text
        checked = requests.post(f"{API}/geo/check", json={
            "line": "4950 Gateway Blvd, Leduc, AB", "mapboxId": "local-leduc", "lat": 53.5461, "lng": -113.4938,
        }, timeout=20)
        assert checked.status_code == 200, checked.text
        assert checked.json()["eligible"] is False
        booked = _book(sarah, {"line": "4950 Gateway Blvd, Leduc, AB", "mapboxId": "local-leduc", "lat": 53.5461, "lng": -113.4938})
        assert booked.status_code == 400
        assert "outside" in booked.text.lower()
    finally:
        requests.patch(f"{API}/settings/app", headers=owner, json={"serviceCoverage": prior_cov or {"mode": "open", "travelFeesEnabled": False}}, timeout=20)


def test_unresolved_address_is_rejected(sarah):
    missing = requests.post(f"{API}/geo/check", json={"line": "999 Nowhere Road, Edmonton, AB"}, timeout=20)
    if missing.status_code == 503:
        assert "Mapbox" in missing.json().get("detail", "")
    else:
        assert missing.status_code == 400
        assert "find" in missing.json()["detail"].lower()
    booked = _book(sarah, {"line": "999 Nowhere Road, Edmonton, AB"})
    assert booked.status_code in (400, 503)


def test_travel_fee_tamper_uses_the_sherwood_zone(sarah, owner):
    prior = requests.get(f"{API}/state", headers=owner, timeout=20).json()["settings"]
    prior_cov = dict(prior.get("serviceCoverage") or {})
    try:
        assert requests.patch(f"{API}/settings/app", headers=owner, json={
            "serviceCoverage": {**prior_cov, "mode": prior_cov.get("mode") or "open", "travelFeesEnabled": True},
        }, timeout=20).status_code == 200
        booked = _book(sarah, {
            "line": "2020 Sherwood Dr, Sherwood Park, AB", "mapboxId": "local-sherwood",
            "postal": "T8A 2G4", "clientConfirmed": True,
            "lat": 53.5461, "lng": -113.4938,
        }, pricing={"total": 1, "travel": 0, "discount": 0}, day="2027-08-03")
        assert booked.status_code == 200, booked.text
        pricing = booked.json()["appointment"]["pricing"]
        assert pricing["travel"] == 15
        assert pricing["total"] != 1
        assert booked.json()["appointment"]["address"]["line"].startswith("2020 Sherwood")
    finally:
        requests.patch(f"{API}/settings/app", headers=owner, json={"serviceCoverage": prior_cov or {"mode": "open", "travelFeesEnabled": False}}, timeout=20)


def test_distance_rate_is_added_on_the_server(owner):
    state = requests.get(f"{API}/state", headers=owner, timeout=20).json()
    zone = next(item for item in state["zones"] if item["id"] == "z-inner")
    prior_cov = dict((state.get("settings") or {}).get("serviceCoverage") or {})
    patched = requests.patch(f"{API}/zones/z-inner", headers=owner, json={"perKm": 1}, timeout=20)
    assert patched.status_code == 200, patched.text
    try:
        assert requests.patch(f"{API}/settings/app", headers=owner, json={
            "serviceCoverage": {**prior_cov, "mode": prior_cov.get("mode") or "open", "travelFeesEnabled": True},
        }, timeout=20).status_code == 200
        checked = requests.post(f"{API}/geo/check", json={"mapboxId": "local-sherwood"}, timeout=20)
        assert checked.status_code == 200, checked.text
        body = checked.json()
        assert body["travel"] > 15
        assert body["zone"]["perKm"] == 1
    finally:
        requests.patch(f"{API}/zones/z-inner", headers=owner, json={"perKm": zone.get("perKm") or 0}, timeout=20)
        requests.patch(f"{API}/settings/app", headers=owner, json={"serviceCoverage": prior_cov or {"mode": "open", "travelFeesEnabled": False}}, timeout=20)


def test_clinic_booking_skips_geocoding(sarah):
    booked = _book(sarah, {"lat": 53.2594, "lng": -113.5492}, location="clinic", pricing={"travel": 40, "total": 1}, day="2027-08-04")
    assert booked.status_code == 200, booked.text
    appointment = booked.json()["appointment"]
    assert appointment["pricing"]["travel"] == 0
    assert appointment["locationType"] == "clinic"


def test_desk_cannot_see_practitioner_home_on_a_trip(owner, desk):
    people = requests.get(f"{API}/state", headers=owner, timeout=20).json()["practitioners"]
    base = next(person["base"] for person in people if person["id"] == "p-liam")
    trip = next(item["trip"] for item in requests.get(f"{API}/state", headers=desk, timeout=20).json()["appointments"] if item["id"] == "a-106")
    assert "from" not in trip
    assert trip.get("sharing") is not True
    assert [base["lat"], base["lng"]] != [trip.get("to", {}).get("lat"), trip.get("to", {}).get("lng")]


def test_tracking_still_requires_a_session_and_suggest_does_not_echo_a_token():
    active = requests.get(f"{API}/tracking/active", timeout=20)
    assert active.status_code == 401
    suggestions = requests.get(f"{API}/geo/suggest", params={"q": "Edmonton"}, timeout=20)
    assert suggestions.status_code in (200, 503)
    assert SECRET not in suggestions.text
    assert "access_token" not in suggestions.text


def test_public_scope_mapbox_token_is_accepted_on_the_server(monkeypatch):
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.public-scope-backend-token")
    monkeypatch.delenv("REACT_APP_MAPBOX_PUBLIC_TOKEN", raising=False)
    try:
        validate_env()
    except RuntimeError as exc:
        assert "secret token" not in str(exc)


def test_secret_token_is_rejected_as_a_browser_token(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "nabitouch_unit")
    monkeypatch.setenv("JWT_SECRET", "launch-unit-secret-16")
    monkeypatch.setenv("OWNER_EMAIL", "admin@nabitouch.com")
    monkeypatch.setenv("OWNER_PASSWORD", "not-a-default-password")
    monkeypatch.setenv("EMAIL_FROM_NAME", "Nabitouch")
    monkeypatch.setenv("APP_URL", "https://nabitouch.com")
    monkeypatch.setenv("DEMO_PASSWORD", "demo-password-value")
    monkeypatch.setenv("CORS_ORIGINS", "https://nabitouch.com")
    monkeypatch.setenv("REACT_APP_MAPBOX_PUBLIC_TOKEN", "sk.secret-must-not-ship-to-browser")
    with pytest.raises(RuntimeError, match="secret sk. token"):
        validate_env()


def test_mapbox_resolve_ignores_client_coordinates_and_hides_provider_errors(monkeypatch):
    previous = os.environ.get("MAPBOX_TOKEN")
    os.environ["MAPBOX_TOKEN"] = SECRET
    calls = {"mode": "outside"}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            if calls["mode"] == "empty":
                return {"features": []}
            return {"features": [{"geometry": {"coordinates": [-113.5492, 53.2594]}, "properties": {
                "full_address": "4950 Gateway Blvd, Leduc, AB", "mapbox_id": "mbx-leduc", "context": {"place": {"name": "Leduc"}},
            }}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, params=None):
            assert params["access_token"] == SECRET
            assert SECRET not in url
            if calls["mode"] == "down":
                raise httpx.ConnectError(f"GET {url}?access_token={params['access_token']}")
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    async def run():
        # Ephemeral resolve (coverage check) must not require permanent storage.
        hit = await GEO.resolve(line="4950 Gateway Blvd, Leduc, AB", point={"lat": 53.5461, "lng": -113.4938}, persist=False)
        assert hit["lat"] == 53.2594
        assert hit["provider"] == "mapbox"
        calls["mode"] = "down"
        with pytest.raises(ProviderError) as caught:
            await GEO.resolve(line="10150 104 St NW, Edmonton, AB", persist=False)
        assert SECRET not in str(caught.value)
        assert "access_token" not in str(caught.value)
        calls["mode"] = "empty"
        with pytest.raises(GeocodeError):
            await GEO.resolve(line="missing address Edmonton AB", persist=False)

    try:
        asyncio.run(run())
    finally:
        GEO.reset()
        if previous is None:
            os.environ.pop("MAPBOX_TOKEN", None)
        else:
            os.environ["MAPBOX_TOKEN"] = previous


def test_directions_fall_back_without_calling_a_failure_live_traffic():
    previous = os.environ.get("MAPBOX_TOKEN")
    os.environ["MAPBOX_TOKEN"] = SECRET
    directions = MapboxDirections()
    calls = []
    roads = {"n": 0}

    async def fetch(profile, position, dest, token):
        calls.append(profile)
        assert token == SECRET
        if profile == "driving-traffic":
            raise RuntimeError(f"https://api.mapbox.com/directions?access_token={token}")
        roads["n"] += 1
        if roads["n"] == 1:
            return {"distance": 4200, "duration": 540, "geometry": {"coordinates": [[-113.5, 53.54], [-113.49, 53.55]]}}
        raise RuntimeError("quota")

    directions._fetch = fetch

    async def run():
        origin = {"lat": 53.54, "lng": -113.5}
        dest = {"lat": 53.55, "lng": -113.49}
        eta, route = await directions.eta("trip-1", origin, dest)
        assert eta["provider"] == "mapbox"
        assert eta["confirmed"] is False
        assert route
        assert SECRET not in str(eta)
        again, _route = await directions.eta("trip-1", origin, dest)
        assert again["provider"] == "mapbox"
        assert calls.count("driving-traffic") == 1
        failed, no_route = await directions.eta("trip-2", origin, dest)
        assert failed["provider"] == "estimated"
        assert failed["confirmed"] is False
        assert no_route is None
        assert "mapbox-traffic" not in str(failed)

    try:
        asyncio.run(run())
    finally:
        if previous is None:
            os.environ.pop("MAPBOX_TOKEN", None)
        else:
            os.environ["MAPBOX_TOKEN"] = previous
