"""Security Shield Stage 2 — fleet vehicles, assignment, VIN fallback, flag gate."""
import os

import pytest
import requests

from config import security_shield_fleet_enabled
import fleet as fleet_mod


def _api():
    base = os.environ.get("REACT_APP_BACKEND_URL")
    if not base:
        pytest.skip("API fixture is not running")
    return base.rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    if response.json().get("mfaRequired"):
        pytest.skip("This fixture requires an authenticator before that sign-in")
    token = response.cookies.get("access_token")
    assert token
    return {"Authorization": f"Bearer {token}"}


def _owner():
    return _login(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])


def _require_fleet_api():
    """Live API must already expose SECURITY_SHIELD_FLEET_ENABLED=true."""
    health = requests.get(f"{_api()}/health", timeout=20)
    assert health.status_code == 200
    if not health.json().get("securityShieldFleet"):
        pytest.skip("SECURITY_SHIELD_FLEET_ENABLED is off on the running API")


def test_fleet_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("SECURITY_SHIELD_FLEET_ENABLED", raising=False)
    assert security_shield_fleet_enabled() is False


def test_normalize_vin_rejects_invalid():
    with pytest.raises(Exception) as raised:
        fleet_mod.normalize_vin("SHORT")
    assert raised.value.status_code == 400


def test_public_vehicle_never_includes_vin():
    row = {
        "id": "veh-1",
        "vin": "1HGCM82633A004352",
        "make": "Honda",
        "model": "Accord",
        "year": 2003,
        "color": "Silver",
        "licensePlate": "ABC-1234",
        "photos": [{"id": "vph-1"}],
    }
    public = fleet_mod.public_vehicle(row)
    assert "vin" not in public
    assert public["licensePlate"] == "ABC-1234"
    assert public["photoIds"] == ["vph-1"]


@pytest.mark.asyncio
async def test_vin_decode_manual_fallback_when_lookup_fails(monkeypatch):
    class FailClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            raise fleet_mod.httpx.ConnectError("down")

    monkeypatch.setattr(fleet_mod.httpx, "AsyncClient", FailClient)
    result = await fleet_mod.decode_vin_nhtsa("1HGCM82633A004352")
    assert result["ok"] is False
    assert "manually" in result["error"].lower() or "unavailable" in result["error"].lower()


def test_fleet_disabled_returns_403_or_ok_when_enabled():
    headers = _owner()
    health = requests.get(f"{_api()}/health", timeout=20).json()
    response = requests.get(f"{_api()}/fleet/vehicles", headers=headers, timeout=20)
    if health.get("securityShieldFleet"):
        assert response.status_code == 200
    else:
        assert response.status_code == 403
        assert "turned off" in response.json()["detail"].lower()


def test_fleet_create_assign_history_and_archive():
    _require_fleet_api()
    headers = _owner()
    state = requests.get(f"{_api()}/state", headers=headers, timeout=20)
    assert state.status_code == 200
    people = state.json().get("practitioners") or []
    assert people, "Need at least one practitioner in the fixture"
    practitioner_id = people[0]["id"]

    created = requests.post(
        f"{_api()}/fleet/vehicles",
        headers=headers,
        json={
            "make": "Toyota",
            "model": "RAV4",
            "year": 2021,
            "color": "White",
            "licensePlate": "TEST-123",
            "registrationJurisdiction": "AB",
            "description": "White RAV4 used for mobile visits",
            "applyVinDecode": False,
        },
        timeout=20,
    )
    assert created.status_code == 200, created.text
    vehicle = created.json()
    assert vehicle["make"] == "Toyota"
    assert vehicle["public"]["licensePlate"] == "TEST-123"
    assert "vin" not in vehicle["public"]
    vehicle_id = vehicle["id"]

    assigned = requests.post(
        f"{_api()}/fleet/vehicles/{vehicle_id}/assign",
        headers=headers,
        json={"practitionerId": practitioner_id, "kind": "primary"},
        timeout=20,
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assignment"]["practitionerId"] == practitioner_id

    history = requests.get(f"{_api()}/fleet/vehicles/{vehicle_id}/assignments", headers=headers, timeout=20)
    assert history.status_code == 200
    assert len(history.json()["assignments"]) >= 1

    mine = requests.get(f"{_api()}/fleet/practitioners/{practitioner_id}/vehicle", headers=headers, timeout=20)
    assert mine.status_code == 200
    assert mine.json()["vehicle"]["id"] == vehicle_id
    assert mine.json()["unavailable"] is False

    second = requests.post(
        f"{_api()}/fleet/vehicles",
        headers=headers,
        json={"make": "Honda", "model": "CR-V", "year": 2019, "color": "Blue", "licensePlate": "TEMP-9", "applyVinDecode": False},
        timeout=20,
    )
    assert second.status_code == 200, second.text
    temp_id = second.json()["id"]
    reassigned = requests.post(
        f"{_api()}/fleet/vehicles/{temp_id}/assign",
        headers=headers,
        json={"practitionerId": practitioner_id, "kind": "temporary", "note": "Loaner while primary is serviced"},
        timeout=20,
    )
    assert reassigned.status_code == 200, reassigned.text

    archived = requests.post(f"{_api()}/fleet/vehicles/{temp_id}/archive", headers=headers, timeout=20)
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    listed = requests.get(f"{_api()}/fleet/vehicles", headers=headers, timeout=20)
    assert listed.status_code == 200
    ids = {row["id"] for row in listed.json()["vehicles"]}
    assert vehicle_id in ids
    assert temp_id not in ids


def test_invalid_vin_on_create():
    _require_fleet_api()
    headers = _owner()
    response = requests.post(
        f"{_api()}/fleet/vehicles",
        headers=headers,
        json={"vin": "BADVIN", "applyVinDecode": False},
        timeout=20,
    )
    assert response.status_code == 400


def test_unavailable_vehicle_cannot_be_assigned():
    _require_fleet_api()
    headers = _owner()
    state = requests.get(f"{_api()}/state", headers=headers, timeout=20)
    practitioner_id = state.json()["practitioners"][0]["id"]
    created = requests.post(
        f"{_api()}/fleet/vehicles",
        headers=headers,
        json={
            "make": "Ford",
            "model": "Escape",
            "year": 2018,
            "status": "unavailable",
            "unavailableReason": "In shop",
            "applyVinDecode": False,
        },
        timeout=20,
    )
    assert created.status_code == 200, created.text
    blocked = requests.post(
        f"{_api()}/fleet/vehicles/{created.json()['id']}/assign",
        headers=headers,
        json={"practitionerId": practitioner_id, "kind": "primary"},
        timeout=20,
    )
    assert blocked.status_code == 409
