"""Regression: open coverage accepts confirmed addresses across the metro and beyond."""
import os

import pytest
import requests

from booking_fixtures import (
    EDMONTON_HOME, LEDUC_OUTSIDE, SHERWOOD_PARK, SPRUCE_GROVE, ST_ALBERT, WETASKIWIN,
)


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"

CASES = [
    ("edmonton", EDMONTON_HOME),
    ("spruce_grove", SPRUCE_GROVE),
    ("st_albert", ST_ALBERT),
    ("sherwood_park", SHERWOOD_PARK),
    ("leduc", LEDUC_OUTSIDE),
    ("wetaskiwin", WETASKIWIN),
]


@pytest.fixture(scope="module")
def owner():
    response = requests.post(
        f"{API}/auth/login",
        json={"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")},
        timeout=20,
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


@pytest.fixture(scope="module")
def open_coverage(owner):
    prior = requests.get(f"{API}/state", headers=owner, timeout=20).json()["settings"]
    prior_cov = dict(prior.get("serviceCoverage") or {})
    patched = requests.patch(f"{API}/settings/app", headers=owner, json={
        "serviceCoverage": {"mode": "open", "radiusKm": prior_cov.get("radiusKm") or 25, "travelFeesEnabled": False},
    }, timeout=20)
    assert patched.status_code == 200, patched.text
    yield
    requests.patch(f"{API}/settings/app", headers=owner, json={
        "serviceCoverage": prior_cov or {"mode": "open", "travelFeesEnabled": False},
    }, timeout=20)


@pytest.mark.parametrize("name,address", CASES)
def test_geo_check_and_confirm_accept_open_coverage(open_coverage, name, address):
    checked = requests.post(f"{API}/geo/check", json={
        "line": address["line"], "mapboxId": address["mapboxId"],
        "lat": address["lat"], "lng": address["lng"],
    }, timeout=20)
    assert checked.status_code == 200, f"{name}: {checked.text}"
    body = checked.json()
    assert body["eligible"] is True, name
    assert body["travel"] == 0, name
    assert "outside the mobile service area" not in (body.get("message") or "").lower()

    confirmed = requests.post(f"{API}/geo/confirm", json={
        "line": address["line"], "mapboxId": address["mapboxId"],
        "postal": address["postal"], "clientConfirmed": True,
    }, timeout=20)
    assert confirmed.status_code == 200, f"{name}: {confirmed.text}"
    accepted = confirmed.json()
    assert accepted.get("eligible") is True, name
    assert accepted.get("accepted") is True, name
    assert accepted.get("travel") == 0, name
    assert accepted.get("confidence") == "address", name


def test_incomplete_address_still_fails_confirmation(open_coverage):
    refused = requests.post(f"{API}/geo/confirm", json={
        "mapboxId": "local-spruce", "line": "400 Calahoo Rd, Spruce Grove, AB",
        "clientConfirmed": True,
    }, timeout=20)
    assert refused.status_code == 200, refused.text
    body = refused.json()
    # Postal missing → not accepted for booking storage even under open coverage.
    assert body.get("accepted") is False
    assert body.get("postalStatus") == "missing" or body.get("confidence") != "address" or body.get("accepted") is False
