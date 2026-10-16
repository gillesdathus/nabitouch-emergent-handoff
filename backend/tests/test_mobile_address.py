"""Mobile bookings require a confirmed civic address. Clinic visits do not."""
import os
import uuid
from datetime import date, timedelta

import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
CONFIRMED = {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True}


def _login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def _book(headers, address, when="11:00", day="2028-06-02"):
    return requests.post(f"{API}/bookings", headers=headers, json={
        "source": "online", "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": day, "time": when,
            "locationType": "home", "paymentMethod": "self", "address": address,
        },
    }, timeout=20)


def test_mobile_booking_requires_confirmation_and_a_fee_approval():
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    day = (date.today() + timedelta(days=500 + uuid.uuid4().int % 800)).isoformat()
    refused = _book(sarah, {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown"}, day=day)
    assert refused.status_code == 400
    booked = _book(sarah, CONFIRMED, "12:00", day)
    assert booked.status_code == 200, booked.text
    appointment = booked.json()["appointment"]
    assert appointment["address"]["civic"]["direction"] == "NW"
    assert appointment["address"]["version"] == 1
    stale = requests.post(f"{API}/appointments/{appointment['id']}/address", headers=sarah, json={
        "version": 0, "address": CONFIRMED,
    }, timeout=20)
    assert stale.status_code == 409
    same = requests.post(f"{API}/appointments/{appointment['id']}/address", headers=sarah, json={
        "version": 1, "address": {**CONFIRMED, "unit": "12", "arrival": {"lat": appointment["address"]["lat"], "lng": appointment["address"]["lng"]}},
    }, timeout=20)
    assert same.status_code == 200, same.text
    assert same.json()["appointment"]["address"]["version"] == 2
    assert same.json()["appointment"]["address"]["civic"]["direction"] == "NW"
    clinic = requests.post(f"{API}/bookings", headers=sarah, json={
        "source": "online",
        "appointment": {"serviceSlug": "swedish", "duration": 60, "date": "2028-06-03", "time": "09:00", "locationType": "clinic", "paymentMethod": "self", "address": {"lat": 53.54, "lng": -113.49}},
    }, timeout=20)
    assert clinic.status_code == 400 and "not available" in clinic.text.lower(), clinic.text
