"""Address confidence uses the local Edmonton catalog. Mapbox is not called."""
import requests
import os

from addresses import classify, parse_civic

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def test_directions_and_postal_rules_do_not_rewrite_the_street():
    northwest = parse_civic("10150 104 St NW, Edmonton, AB")
    northeast = parse_civic("10150 104 St NE, Edmonton, AB")
    avenue = parse_civic("10150 104 Ave NW, Edmonton, AB")
    assert northwest["direction"] == "NW"
    assert northeast["direction"] == "NE"
    assert avenue["type"].lower().startswith("ave")
    assert northwest["type"].lower().startswith("st")
    hit = {"line": "10150 104 St NW, Edmonton, AB T5J 2R4", "lat": 53.5435, "lng": -113.499, "provider": "mapbox"}
    conflict = classify(hit, hit["line"], "T5S 1A1", None)
    assert conflict["postalStatus"] == "conflict" and conflict["confidence"] == "review"
    assert conflict["civic"]["direction"] == "NW"
    moved = classify(
        {"line": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.499, "provider": "local"},
        "10150 104 St NW, Edmonton, AB", "", {"lat": 53.62, "lng": -113.3},
    )
    assert moved["arrivalDiscrepancy"] is True
    assert moved["civic"]["line"].startswith("10150 104 St NW")
    assert moved["confidence"] == "review"


def test_confirm_endpoint_keeps_edmonton_direction_and_rejects_a_different_street():
    found = requests.post(f"{API}/geo/confirm", json={
        "mapboxId": "local-downtown", "line": "10150 104 St NW, Edmonton, AB",
        "postal": "T5J 2R4", "clientConfirmed": True,
    }, timeout=20)
    assert found.status_code == 200, found.text
    body = found.json()
    assert body["civic"]["direction"] == "NW"
    assert body["accepted"] is True
    assert body["confidence"] == "address"
    # Open coverage (default): Leduc is eligible when confirmed; zones mode can still reject.
    outside = requests.post(f"{API}/geo/confirm", json={
        "mapboxId": "local-leduc", "line": "4950 Gateway Blvd, Leduc, AB",
        "postal": "T9E 0A1", "clientConfirmed": True,
    }, timeout=20)
    assert outside.status_code == 200, outside.text
    body_out = outside.json()
    if body_out.get("coverageMode") == "zones" or body_out.get("eligible") is False:
        assert body_out["confidence"] == "unresolved" and body_out["accepted"] is False
    else:
        assert body_out.get("eligible") is True
        assert body_out["confidence"] == "address"
    other = requests.post(f"{API}/geo/confirm", json={"line": "10150 104 Ave NW, Edmonton, AB", "clientConfirmed": True}, timeout=20)
    if other.status_code in (400, 503):
        assert "find" in other.text.lower() or "address" in other.text.lower() or "mapbox" in other.text.lower()
    else:
        resolved = other.json()
        line = (resolved.get("line") or "").lower()
        assert other.status_code == 200, other.text
        assert "104" in line and "ave" in line
        assert "104 st" not in line
    missing = requests.post(f"{API}/geo/confirm", json={
        "mapboxId": "local-downtown", "line": "10150 104 St NW, Edmonton, AB", "clientConfirmed": True,
    }, timeout=20)
    assert missing.json()["postalStatus"] == "missing" and missing.json()["accepted"] is False
