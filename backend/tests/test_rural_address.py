"""Rural Alberta Range Road addresses — normalize, parse, and book under radius coverage."""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

from addresses import classify, normalize_destination_line, normalize_rural_query, parse_civic
from pricing import VERIFIED_DESTINATION_EXCEPTIONS, assess_coverage


ARDROSSAN_FULL = "53337 Range Road 215, Ardrossan, AB T8E 2B2, Canada"
ARDROSSAN_ABBREV = "53337 Rge Rd 215"
ARDROSSAN_POINT = {"lat": 53.591591, "lng": -113.073364}
ARDROSSAN_MAPBOX = VERIFIED_DESTINATION_EXCEPTIONS[0]["mapboxId"]
CENTER = {"lat": 53.5461, "lng": -113.4938}


def test_normalize_expands_rural_abbreviations():
    assert normalize_rural_query("53337 Rge Rd 215") == "53337 Range Road 215"
    assert normalize_rural_query("53337 Range Rd 215") == "53337 Range Road 215"
    assert normalize_rural_query("53337 RR 215") == "53337 Range Road 215"
    assert normalize_rural_query("12 Twp Rd 510") == "12 Township Road 510"
    assert "Range Road 215" in normalize_destination_line(
        "53337 Range Road 215, Ardrossan, Alberta T8E 2B2, Canada"
    )
    assert ", AB " in normalize_destination_line(
        "53337 Range Road 215, Ardrossan, Alberta T8E 2B2, Canada"
    ) or normalize_destination_line(
        "53337 Range Road 215, Ardrossan, Alberta T8E 2B2, Canada"
    ).endswith("Canada")


def test_parse_civic_accepts_range_road_without_cardinal():
    abbrev = parse_civic(ARDROSSAN_ABBREV)
    full = parse_civic(ARDROSSAN_FULL)
    assert abbrev["number"] == "53337"
    assert "Range Road 215" in abbrev["street"]
    assert full["number"] == "53337"
    assert full["city"] == "Ardrossan"
    assert full["province"] in ("AB", "")
    assert full["postal"] == "T8E 2B2"
    # City street with direction still parses.
    downtown = parse_civic("10150 104 St NW, Edmonton, AB")
    assert downtown["direction"] == "NW" and downtown["type"].lower().startswith("st")


def test_classify_accepts_geocoded_rural_destination():
    hit = {
        "line": "53337 Range Road 215, Ardrossan, Alberta T8E 2B2, Canada",
        "lat": ARDROSSAN_POINT["lat"],
        "lng": ARDROSSAN_POINT["lng"],
        "provider": "mapbox",
        "postal": "T8E 2B2",
        "matchConfidence": "exact",
    }
    for requested in (ARDROSSAN_ABBREV, ARDROSSAN_FULL):
        assessed = classify(hit, requested, "T8E 2B2", None)
        assert assessed["confidence"] == "address", requested
        assert assessed["postalStatus"] == "match"
        assert assessed["civic"]["number"] == "53337"


def test_radius_exception_matches_by_coordinates_or_mapbox_id():
    settings = {"center": CENTER, "serviceCoverage": {"mode": "radius", "radiusKm": 25}}
    zone, km, ok = assess_coverage(ARDROSSAN_POINT, [], settings, mapbox_id=ARDROSSAN_MAPBOX)
    assert ok and km > 25 and zone is not None
    zone2, _, ok2 = assess_coverage(ARDROSSAN_POINT, [], settings, mapbox_id="")
    assert ok2 and zone2 is not None


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _api():
    return _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def _live_api_ready():
    return bool(os.environ.get("REACT_APP_BACKEND_URL")) and bool(os.environ.get("MAPBOX_LIVE") or os.environ.get("DEMO_PASSWORD"))


@pytest.mark.skipif(not _live_api_ready(), reason="Live API env not configured")
def test_geo_check_and_confirm_accept_ardrossan_rural_address():
    """Live API: abbreviated + full rural forms stay eligible under production-like radius."""
    api = _api()
    for line in (ARDROSSAN_ABBREV, ARDROSSAN_FULL):
        checked = requests.post(f"{api}/geo/check", json={"line": line}, timeout=25)
        assert checked.status_code == 200, f"{line}: {checked.text}"
        body = checked.json()
        assert body["eligible"] is True, f"{line}: {body}"
        assert "Range Road 215" in body["line"]
        assert "Ardrossan" in body["line"]
        assert body.get("municipality", {}).get("name") == "Strathcona County"

        confirmed = requests.post(f"{api}/geo/confirm", json={
            "line": body["line"], "mapboxId": body["mapboxId"],
            "postal": "T8E 2B2", "clientConfirmed": True,
        }, timeout=25)
        assert confirmed.status_code == 200, confirmed.text
        accepted = confirmed.json()
        assert accepted.get("eligible") is True
        assert accepted.get("accepted") is True
        assert accepted.get("confidence") == "address"
        assert "Range Road 215" in (accepted.get("line") or "")


@pytest.mark.skipif(not os.environ.get("REACT_APP_BACKEND_URL"), reason="Live API env not configured")
def test_edmonton_address_still_eligible_regression():
    api = _api()
    checked = requests.post(f"{api}/geo/check", json={
        "line": "10150 104 St NW, Edmonton, AB",
        "lat": 53.5435, "lng": -113.499,
    }, timeout=25)
    assert checked.status_code == 200, checked.text
    assert checked.json()["eligible"] is True


@pytest.mark.skipif(not _live_api_ready(), reason="Live API env not configured")
def test_booking_persists_normalized_rural_address():
    """Book with confirmed Ardrossan address; do not complete payment."""
    api = _api()
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    day = (date.today() + timedelta(days=400 + uuid.uuid4().int % 500)).isoformat()
    address = {
        "line": ARDROSSAN_FULL,
        "mapboxId": ARDROSSAN_MAPBOX,
        "postal": "T8E 2B2",
        "clientConfirmed": True,
        "lat": ARDROSSAN_POINT["lat"],
        "lng": ARDROSSAN_POINT["lng"],
    }
    booked = requests.post(f"{api}/bookings", headers=sarah, json={
        "source": "online", "practitionerId": "p-nabitu-kahindo",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": day, "time": "11:00",
            "locationType": "home", "paymentMethod": "self", "address": address,
        },
    }, timeout=30)
    assert booked.status_code == 200, booked.text
    appt = booked.json()["appointment"]
    assert "Range Road 215" in appt["address"]["line"]
    assert appt["address"]["clientConfirmed"] is True
    assert appt["address"]["confidence"] == "address"
    # Cancel so the slot is free and no paid visit remains.
    cancelled = requests.patch(
        f"{api}/appointments/{appt['id']}",
        headers=sarah,
        json={"status": "cancelled"},
        timeout=20,
    )
    assert cancelled.status_code in (200, 409), cancelled.text
