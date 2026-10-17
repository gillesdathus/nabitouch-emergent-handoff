"""Synthetic Edmonton bookings for isolated tests.

These addresses match the sample catalog in geo.py. They include a postal code
so classify() can accept them. They do not skip zone checks, confirmation, or
the postal rules. Live Mapbox calls stay behind MAPBOX_LIVE=true.

`book_appointment` does not assume the full demo seed (p-maya / c-sarah). The
acceptance QA database may only have a synthetic practitioner and clients, so
the helper prefers demo ids when present and otherwise uses a bookable
practitioner plus an inline synthetic client. Validation and payment rules stay
unchanged.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

EDMONTON_HOME = {
    "label": "Home",
    "line": "10150 104 St NW, Edmonton, AB T5J 1A7, Canada",
    "postal": "T5J 1A7",
    "mapboxId": "local-downtown",
    "lat": 53.5435,
    "lng": -113.499,
    "id": "ad-sarah",
    "clientConfirmed": True,
}

LEDUC_OUTSIDE = {
    "label": "Outside",
    "line": "4950 Gateway Blvd, Leduc, AB",
    "postal": "T9E 0A1",
    "mapboxId": "local-leduc",
    "lat": 53.2594,
    "lng": -113.5492,
    "clientConfirmed": True,
}

TZ = ZoneInfo("America/Edmonton")


def resolve_bookable_practitioner_id(session, api, preferred="p-maya"):
    """Prefer the demo practitioner when seeded; otherwise use any bookable staff."""
    state = session.get(f"{api}/state", timeout=40)
    if state.status_code != 200:
        pytest.fail(f"fixture state failed: HTTP {state.status_code}")
    people = state.json().get("practitioners") or []
    bookable = [
        person for person in people
        if person.get("bookable") is not False and person.get("available") is not False
    ]
    ids = {person["id"] for person in bookable if person.get("id")}
    if preferred and preferred in ids:
        return preferred
    if bookable:
        return bookable[0]["id"]
    pytest.fail("fixture database has no bookable practitioner")


def booking_client_payload(session, api):
    """Use c-sarah when the demo client exists; otherwise create an inline synthetic client."""
    state = session.get(f"{api}/state", timeout=40)
    if state.status_code != 200:
        pytest.fail(f"fixture state failed: HTTP {state.status_code}")
    if any(client.get("id") == "c-sarah" for client in state.json().get("clients") or []):
        return {"id": "c-sarah"}
    tag = uuid.uuid4().hex[:10]
    return {
        "firstName": "Fixture",
        "lastName": "Client",
        "email": f"fixture-{tag}@example.com",
        "phone": "7805550100",
    }


def book_appointment(
    session,
    api,
    *,
    slug="swedish",
    day_offset=(20, 200),
    times=("09:00", "12:00", "16:00"),
    practitioner=None,
    address=None,
):
    """Create a reception booking through the live API. Returns the appointment on HTTP 200."""
    pid = practitioner or resolve_bookable_practitioner_id(session, api)
    client = booking_client_payload(session, api)
    addr = dict(address or EDMONTON_HOME)
    last = None
    for day_n in range(*day_offset):
        day = (datetime.now(TZ).date() + timedelta(days=day_n)).isoformat()
        for time in times:
            body = {
                "source": "reception",
                "practitionerId": pid,
                "client": client,
                "idempotencyKey": "TEST_" + uuid.uuid4().hex[:10],
                "appointment": {
                    "serviceSlug": slug,
                    "duration": 60,
                    "date": day,
                    "time": time,
                    "locationType": "home",
                    "paymentMethod": "self",
                    "addressId": addr.get("id") or "ad-fixture",
                    "address": addr,
                },
            }
            response = session.post(f"{api}/bookings", json=body, timeout=40)
            last = {"practitionerId": pid, "day": day, "time": time, "status": response.status_code, "body": response.text[:400]}
            if response.status_code == 200:
                return response.json()["appointment"]
    pytest.fail(f"could not book via {api}/bookings last={last}")
